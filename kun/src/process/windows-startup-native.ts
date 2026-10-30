import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type WindowsProcessInspection = {
  state: 'alive' | 'dead' | 'unknown'
  identity?: string
  startedAtMs?: number
}
export type WindowsStartupLock = { handle: object; created: boolean; text: string }
export type WindowsStartupNative = {
  acquire(guardPath: string, legacyPath: string): WindowsStartupLock | undefined
  publish(handle: object, owner: string): void
  release(handle: object): void
  inspectProcess(pid: number): WindowsProcessInspection
}

const nativeName = 'kun_windows_startup.node'
const launcherName = 'kun-owned-launcher.exe'
let directory: string | undefined
let binding: WindowsStartupNative | undefined

export class WindowsStartupIntegrityError extends Error {
  readonly code = 'windows_startup_integrity'
  constructor() {
    super('Kun Windows startup components are missing, incompatible, or damaged. Repair or reinstall Kun; saved conversations and settings do not need to be deleted.')
    this.name = 'WindowsStartupIntegrityError'
  }
}

/** Never compile or search PATH at runtime. Packaged processes use only their own resources. */
export function windowsStartupDirectory(): string {
  if (directory) return directory
  const moduleDirectory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const folder = `win32-${process.arch}`
  // Shared Electron main modules are emitted one level deeper than entry bundles.
  const developmentMainDirectory = basename(moduleDirectory) === 'chunks' &&
    basename(dirname(moduleDirectory)) === 'main' && basename(dirname(dirname(moduleDirectory))) === 'out'
    ? dirname(moduleDirectory) : moduleDirectory
  const candidates = resources && existsSync(join(resources, 'app.asar'))
    ? [join(resources, 'app.asar.unpacked', 'kun', 'dist', 'native', folder)]
    : [join(moduleDirectory, '..', 'native', folder),
      join(moduleDirectory, '..', '..', 'dist', 'native', folder),
      join(developmentMainDirectory, '..', '..', 'kun', 'dist', 'native', folder)]
  const root = candidates.find((path) => existsSync(join(path, 'manifest.json')))
  if (!root) throw new WindowsStartupIntegrityError()
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      version: number; arch: string; files: Record<string, string>
    }
    if (manifest.version !== 1 || manifest.arch !== process.arch) throw new Error('manifest')
    for (const name of [nativeName, launcherName]) {
      const digest = createHash('sha256').update(readFileSync(join(root, name))).digest('hex')
      if (manifest.files[name] !== digest) throw new Error('digest')
    }
    directory = root
    return root
  } catch { throw new WindowsStartupIntegrityError() }
}

export function windowsOwnedLauncherPath(): string {
  return join(windowsStartupDirectory(), launcherName)
}

export function windowsStartupNative(): WindowsStartupNative {
  if (binding) return binding
  const root = windowsStartupDirectory()
  try {
    const require = createRequire(join(root, 'manifest.json'))
    binding = require(join(root, nativeName)) as WindowsStartupNative
    if (['acquire', 'publish', 'release', 'inspectProcess'].some((name) =>
      typeof binding?.[name as keyof WindowsStartupNative] !== 'function')) throw new Error('exports')
    return binding
  } catch { binding = undefined; throw new WindowsStartupIntegrityError() }
}
