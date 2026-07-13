import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { cp, lstat, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { ProjectTransferResult } from '../../shared/project-transfer'

export const PROJECT_TRANSFER_MAX_FILES = 100_000
export const PROJECT_TRANSFER_MAX_BYTES = 5 * 1024 * 1024 * 1024

type DirectoryDialogResult = { canceled: boolean; filePaths: string[] }
type ChooseDirectory = (options: OpenDialogOptions, parentWindow: BrowserWindow | null) => Promise<DirectoryDialogResult>

type CopySummary = {
  copiedFiles: number
  copiedBytes: number
  skippedPaths: string[]
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !relativePath.includes(`${sep}..${sep}`))
}

function shouldSkip(relativePath: string): boolean {
  const normalized = relativePath.split(sep).join('/')
  return normalized === '.kun/worktrees' || normalized.startsWith('.kun/worktrees/')
}

async function scanProject(sourceRoot: string): Promise<{ entries: Set<string>; summary: CopySummary }> {
  const entries = new Set<string>()
  const skippedPaths: string[] = []
  let copiedFiles = 0
  let copiedBytes = 0

  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const absolutePath = join(directory, child.name)
      const relativePath = relative(sourceRoot, absolutePath)
      if (shouldSkip(relativePath)) {
        skippedPaths.push(relativePath.split(sep).join('/'))
        continue
      }
      const details = await lstat(absolutePath)
      if (details.isSymbolicLink()) {
        skippedPaths.push(relativePath.split(sep).join('/'))
        continue
      }
      entries.add(relativePath)
      if (details.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!details.isFile()) continue
      copiedFiles += 1
      copiedBytes += details.size
      if (copiedFiles > PROJECT_TRANSFER_MAX_FILES) {
        throw new Error(`Project contains more than ${PROJECT_TRANSFER_MAX_FILES.toLocaleString()} files.`)
      }
      if (copiedBytes > PROJECT_TRANSFER_MAX_BYTES) {
        throw new Error(`Project is larger than ${Math.round(PROJECT_TRANSFER_MAX_BYTES / (1024 * 1024 * 1024))} GiB.`)
      }
    }
  }

  await visit(sourceRoot)
  return { entries, summary: { copiedFiles, copiedBytes, skippedPaths } }
}

async function uniqueDestination(parentDirectory: string, sourceName: string): Promise<string> {
  const safeName = sourceName.trim() || 'project'
  let candidate = join(parentDirectory, safeName)
  let suffix = 2
  while (true) {
    try {
      await stat(candidate)
      candidate = join(parentDirectory, `${safeName}-copy-${suffix}`)
      suffix += 1
    } catch {
      return candidate
    }
  }
}

async function defaultChooseDirectory(
  options: OpenDialogOptions,
  parentWindow: BrowserWindow | null
): Promise<DirectoryDialogResult> {
  return parentWindow ? dialog.showOpenDialog(parentWindow, options) : dialog.showOpenDialog(options)
}

async function pickDirectory(
  title: string,
  defaultPath: string | undefined,
  parentWindow: BrowserWindow | null,
  chooseDirectory: ChooseDirectory
): Promise<string | null> {
  const result = await chooseDirectory({
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
  }, parentWindow)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function copyProjectDirectory(
  sourceRoot: string,
  destinationParent: string,
  sourceName: string
): Promise<ProjectTransferResult> {
  const source = await realpath(resolve(sourceRoot))
  const parent = await realpath(resolve(destinationParent))
  const sourceStats = await stat(source)
  if (!sourceStats.isDirectory()) return { ok: false, message: 'The selected project is not a directory.' }
  if (isWithinDirectory(source, parent)) {
    return { ok: false, message: 'Choose a destination outside the source project.' }
  }

  const { entries, summary } = await scanProject(source)
  const destination = await uniqueDestination(parent, sourceName)
  const staging = join(parent, `.kun-project-transfer-${randomUUID()}`)
  try {
    await cp(source, staging, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async (candidate) => {
        const relativePath = relative(source, candidate)
        if (!relativePath) return true
        if (shouldSkip(relativePath)) return false
        return entries.has(relativePath)
      }
    })
    await rename(staging, destination)
    return { ok: true, path: destination, ...summary }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function exportProjectDirectory(input: {
  sourceRoot: string
  parentWindow?: BrowserWindow | null
  chooseDirectory?: ChooseDirectory
}): Promise<ProjectTransferResult> {
  try {
    const source = await realpath(resolve(input.sourceRoot.trim()))
    const parentWindow = input.parentWindow ?? null
    const chooseDirectory = input.chooseDirectory ?? defaultChooseDirectory
    const destinationParent = await pickDirectory(
      'Choose where to export the project',
      dirname(source),
      parentWindow,
      chooseDirectory
    )
    if (!destinationParent) return { ok: false, canceled: true, message: 'Operation cancelled.' }
    return await copyProjectDirectory(source, destinationParent, basename(source))
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function importProjectDirectory(input: {
  destinationParent?: string
  parentWindow?: BrowserWindow | null
  chooseDirectory?: ChooseDirectory
}): Promise<ProjectTransferResult> {
  try {
    const parentWindow = input.parentWindow ?? null
    const chooseDirectory = input.chooseDirectory ?? defaultChooseDirectory
    const source = await pickDirectory(
      'Choose a project to import',
      undefined,
      parentWindow,
      chooseDirectory
    )
    if (!source) return { ok: false, canceled: true, message: 'Operation cancelled.' }
    const sourceRoot = await realpath(resolve(source))
    const destinationParent = await pickDirectory(
      'Choose where to import the project',
      input.destinationParent?.trim() || dirname(sourceRoot),
      parentWindow,
      chooseDirectory
    )
    if (!destinationParent) return { ok: false, canceled: true, message: 'Operation cancelled.' }
    return await copyProjectDirectory(sourceRoot, destinationParent, basename(sourceRoot))
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
