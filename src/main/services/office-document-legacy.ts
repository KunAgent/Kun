import { runOwnedCommand } from '../owned-command'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, extname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  LegacyOfficeDocumentFormat,
  OfficeDocumentFormat
} from '../../shared/office-document'

const LIBREOFFICE_TIMEOUT_MS = 60_000
const LIBREOFFICE_MAX_OUTPUT_BYTES = 256 * 1024

export const LIBREOFFICE_UNAVAILABLE_CODE = 'libreoffice_unavailable'
export const LIBREOFFICE_UNAVAILABLE_MESSAGE =
  'LibreOffice is required to preview legacy .doc and .ppt files. Install LibreOffice or set KUN_LIBREOFFICE_BINARY.'

export type LibreOfficeRunResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type LegacyOfficeDocumentConversion = {
  path: string
  format: OfficeDocumentFormat
  cleanup: () => Promise<void>
}

export type LegacyOfficeDocumentConversionDependencies = {
  resolveLibreOfficeBinary?: () => Promise<string | undefined> | string | undefined
  runLibreOffice?: (
    binaryPath: string,
    args: string[],
    signal?: AbortSignal
  ) => Promise<LibreOfficeRunResult>
  temporaryDirectory?: string
  signal?: AbortSignal
}

export class OfficeDocumentConversionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OfficeDocumentConversionError'
  }
}

export function modernOfficeFormatForLegacy(
  format: LegacyOfficeDocumentFormat
): OfficeDocumentFormat {
  if (format === 'doc') return 'docx'
  if (format === 'xls') return 'xlsx'
  return 'pptx'
}

/**
 * Converts only into a private temporary directory. The source path is passed
 * to LibreOffice as input and is never a target of a write or rename.
 */
export async function convertLegacyOfficeDocument(
  sourcePath: string,
  sourceFormat: LegacyOfficeDocumentFormat,
  dependencies: LegacyOfficeDocumentConversionDependencies = {}
): Promise<LegacyOfficeDocumentConversion> {
  const binaryPath = dependencies.resolveLibreOfficeBinary
    ? await dependencies.resolveLibreOfficeBinary()
    : await resolveLibreOfficeBinary()
  if (!binaryPath) {
    throw new OfficeDocumentConversionError(
      LIBREOFFICE_UNAVAILABLE_CODE,
      LIBREOFFICE_UNAVAILABLE_MESSAGE
    )
  }
  if (dependencies.signal?.aborted) throw abortError()

  const temporaryRoot = await mkdtemp(join(dependencies.temporaryDirectory ?? tmpdir(), 'kun-office-preview-'))
  await chmod(temporaryRoot, 0o700).catch(() => undefined)
  const outputDirectory = join(temporaryRoot, 'output')
  const profileDirectory = join(temporaryRoot, 'profile')
  const format = modernOfficeFormatForLegacy(sourceFormat)
  try {
    await Promise.all([
      mkdir(outputDirectory, { recursive: true, mode: 0o700 }),
      mkdir(profileDirectory, { recursive: true, mode: 0o700 })
    ])
    const args = [
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      '--headless',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--nofirststartwizard',
      '--convert-to',
      format,
      '--outdir',
      outputDirectory,
      sourcePath
    ]
    const run = dependencies.runLibreOffice ?? runLibreOffice
    let result: LibreOfficeRunResult
    try {
      result = await run(binaryPath, args, dependencies.signal)
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new OfficeDocumentConversionError(
          LIBREOFFICE_UNAVAILABLE_CODE,
          LIBREOFFICE_UNAVAILABLE_MESSAGE
        )
      }
      throw error
    }
    if (result.exitCode !== 0) {
      throw new OfficeDocumentConversionError(
        'libreoffice_conversion_failed',
        summarizeLibreOfficeFailure(result)
      )
    }
    const convertedPath = await findConvertedOfficeDocument(outputDirectory, sourcePath, format)
    if (!convertedPath) {
      throw new OfficeDocumentConversionError(
        'libreoffice_conversion_failed',
        'LibreOffice did not produce a converted Office preview file.'
      )
    }
    return {
      path: convertedPath,
      format,
      cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function resolveLibreOfficeBinary(): Promise<string | undefined> {
  const explicit = process.env.KUN_LIBREOFFICE_BINARY?.trim()
  if (explicit) return findExecutable(explicit)

  for (const candidate of commonLibreOfficeCandidates()) {
    const found = await findExecutable(candidate)
    if (found) return found
  }
  return undefined
}

function commonLibreOfficeCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      join(homedir(), 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
      'soffice',
      'libreoffice'
    ]
  }
  if (process.platform === 'win32') {
    const installRoots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter((path): path is string => Boolean(path?.trim()))
    return [
      ...installRoots.map((root) => join(root, 'LibreOffice', 'program', 'soffice.exe')),
      'soffice.exe',
      'libreoffice.exe'
    ]
  }
  return ['soffice', 'libreoffice']
}

async function findExecutable(candidate: string): Promise<string | undefined> {
  if (!candidate) return undefined
  if (isAbsolute(candidate)) return await isExecutable(candidate) ? candidate : undefined

  const names = executableNames(candidate)
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const path = join(directory, name)
      if (await isExecutable(path)) return path
    }
  }
  return undefined
}

function executableNames(candidate: string): string[] {
  if (process.platform !== 'win32' || extname(candidate)) return [candidate]
  const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
  return [candidate, ...extensions.map((extension) => `${candidate}${extension}`)]
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findConvertedOfficeDocument(
  outputDirectory: string,
  sourcePath: string,
  format: OfficeDocumentFormat
): Promise<string | undefined> {
  const expectedName = `${basename(sourcePath, extname(sourcePath))}.${format}`.toLowerCase()
  const entries = await readdir(outputDirectory, { withFileTypes: true })
  const exact = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === expectedName)
  if (exact) return join(outputDirectory, exact.name)
  const fallback = entries.find((entry) => entry.isFile() && extname(entry.name).toLowerCase() === `.${format}`)
  return fallback ? join(outputDirectory, fallback.name) : undefined
}

async function runLibreOffice(
  binaryPath: string,
  args: string[],
  signal?: AbortSignal
): Promise<LibreOfficeRunResult> {
  if (signal?.aborted) throw abortError()
  const result = await runOwnedCommand(binaryPath, args, {
    signal, timeoutMs: LIBREOFFICE_TIMEOUT_MS, maxOutputBytes: LIBREOFFICE_MAX_OUTPUT_BYTES,
    messages: {
      aborted: 'Office document conversion was cancelled.',
      timeout: `LibreOffice timed out after ${LIBREOFFICE_TIMEOUT_MS}ms.`,
      outputLimit: 'LibreOffice conversion output exceeded its limit.'
    }
  })
  return { ...result, exitCode: result.exitCode ?? 1 }
}

function summarizeLibreOfficeFailure(result: LibreOfficeRunResult): string {
  const detail = result.stderr.trim() || result.stdout.trim()
  return detail ? `LibreOffice conversion failed: ${detail}` : 'LibreOffice conversion failed.'
}

function isMissingExecutable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function abortError(): Error {
  const error = new Error('Office document conversion was cancelled.')
  error.name = 'AbortError'
  return error
}
