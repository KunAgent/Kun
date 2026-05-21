import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { app } from 'electron'
import type { DeepseekPackageSource } from '../shared/deepseek-update'

type InstallModule = {
  getBinaryPath: (name: string) => Promise<string>
}

type UpdateManifest = {
  version: string
}

export type ManagedDeepseekPackage = {
  source: DeepseekPackageSource
  resolverPackageJsonPath: string
  packageJsonPath: string
  packageRoot: string
  version: string | null
}

const UPDATE_ROOT_DIR = 'deepseek-tui-updates'

function bundledDeepseekPackageRoots(): string[] {
  const appRoot = app.getAppPath()
  const roots = [join(appRoot, 'node_modules', 'deepseek-tui')]
  if (appRoot.endsWith('app.asar')) {
    roots.push(
      join(appRoot.replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules', 'deepseek-tui')
    )
  }
  return roots
}

function managedUserBinaryPath(userBinaryPath: string): boolean {
  const u = userBinaryPath?.trim() ?? ''
  return !u || u === 'deepseek'
}

function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null
  } catch {
    return null
  }
}

function packageInfoForResolver(
  resolverPackageJsonPath: string,
  source: DeepseekPackageSource
): ManagedDeepseekPackage {
  const req = createRequire(resolverPackageJsonPath)
  const packageJsonPath = req.resolve('deepseek-tui/package.json')
  return {
    source,
    resolverPackageJsonPath,
    packageJsonPath,
    packageRoot: dirname(packageJsonPath),
    version: readPackageVersion(packageJsonPath)
  }
}

function managedDeepseekCliName(): string {
  return process.platform === 'win32' ? 'deepseek.exe' : 'deepseek'
}

function resolveBundledDeepseekCliPath(resolverPackageJsonPath: string): string | null {
  try {
    const req = createRequire(resolverPackageJsonPath)
    const packageJsonPath = req.resolve('deepseek-tui/package.json')
    const candidate = join(dirname(packageJsonPath), 'bin', 'downloads', managedDeepseekCliName())
    if (!existsSync(candidate)) return null
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

type CopyMirrorOptions = {
  /**
   * When the GUI mirrors bundled `bin/downloads` into userData, the managed
   * `deepseek` process may still be running and Windows keeps the executable
   * locked. Skip the overwrite so update checks can run without requiring a
   * full app restart; the existing mirrored binary remains in use.
   */
  skipIfDestLocked?: boolean
}

function copyFileToMirror(
  sourcePath: string,
  destPath: string,
  executable = false,
  options?: CopyMirrorOptions
): void {
  mkdirSync(dirname(destPath), { recursive: true })
  const sourceStat = statSync(sourcePath)
  try {
    const destStat = statSync(destPath)
    if (
      destStat.isFile() &&
      destStat.size === sourceStat.size &&
      destStat.mtimeMs >= sourceStat.mtimeMs
    ) {
      return
    }
  } catch {
    /* copy missing or unreadable destination */
  }
  try {
    copyFileSync(sourcePath, destPath)
    try {
      utimesSync(destPath, sourceStat.atime, sourceStat.mtime)
    } catch {
      /* preserving mtimes is an optimization, not a correctness requirement */
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (
      options?.skipIfDestLocked &&
      process.platform === 'win32' &&
      existsSync(destPath) &&
      (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')
    ) {
      return
    }
    throw e
  }
  if (executable && process.platform !== 'win32') {
    chmodSync(destPath, 0o755)
  }
}

function mirrorRequiredInstallerFile(
  sourceRoots: string[],
  packageRoot: string,
  relativePath: string
): void {
  for (const sourceRoot of sourceRoots) {
    const sourcePath = join(sourceRoot, relativePath)
    if (existsSync(sourcePath)) {
      copyFileToMirror(sourcePath, join(packageRoot, relativePath))
      return
    }
  }
  throw new Error(`Cannot find deepseek-tui installer file: ${relativePath}`)
}

function mirrorBundledDownloads(sourceRoots: string[], packageRoot: string): void {
  const copied = new Set<string>()
  const cliName = managedDeepseekCliName()
  const requiredNames = new Set([cliName, `${cliName}.version`])
  for (const sourceRoot of sourceRoots) {
    const sourceDownloads = join(sourceRoot, 'bin', 'downloads')
    if (!existsSync(sourceDownloads)) continue
    for (const name of readdirSync(sourceDownloads)) {
      if (!requiredNames.has(name)) continue
      if (copied.has(name)) continue
      const sourcePath = join(sourceDownloads, name)
      try {
        if (!statSync(sourcePath).isFile()) continue
      } catch {
        continue
      }
      const executable = !name.endsWith('.version')
      copyFileToMirror(sourcePath, join(packageRoot, 'bin', 'downloads', name), executable, {
        skipIfDestLocked: true
      })
      copied.add(name)
    }
  }
}

function ensureBundledInstallerMirror(): string {
  const cacheRoot = join(app.getPath('userData'), 'deepseek-tui-installer')
  const packageRoot = join(cacheRoot, 'node_modules', 'deepseek-tui')
  const destPackageJson = join(packageRoot, 'package.json')
  const sourceRoots = bundledDeepseekPackageRoots()
  const filesToMirror = [
    'package.json',
    'scripts/install.js',
    'scripts/artifacts.js',
    'scripts/preflight-glibc.js'
  ]

  mkdirSync(packageRoot, { recursive: true })

  // Mirror only the installer files we need into userData so the deepseek-tui
  // package writes its downloaded binaries to a writable location outside app.asar.
  for (const relativePath of filesToMirror) {
    mirrorRequiredInstallerFile(sourceRoots, packageRoot, relativePath)
  }
  // Packaged builds often already contain the platform binary downloaded at
  // build time. Copy it into the writable mirror first so first launch does
  // not depend on a fresh GitHub download, especially on Windows.
  mirrorBundledDownloads(sourceRoots, packageRoot)

  return destPackageJson
}

export function getDeepseekTuiUpdatePackageRoot(version: string): string {
  if (!/^[0-9A-Za-z.+_-]+$/.test(version)) {
    throw new Error(`Invalid deepseek-tui version: ${version}`)
  }
  return join(app.getPath('userData'), UPDATE_ROOT_DIR, 'versions', version, 'node_modules', 'deepseek-tui')
}

export function getDeepseekTuiUpdateTempRoot(): string {
  return join(app.getPath('userData'), UPDATE_ROOT_DIR, 'tmp')
}

function getDeepseekTuiUpdateManifestPath(): string {
  return join(app.getPath('userData'), UPDATE_ROOT_DIR, 'current.json')
}

function readActiveDeepseekTuiUpdate(): UpdateManifest | null {
  const manifestPath = getDeepseekTuiUpdateManifestPath()
  if (!existsSync(manifestPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<UpdateManifest>
    if (typeof parsed.version !== 'string' || !parsed.version.trim()) return null
    return { version: parsed.version.trim() }
  } catch {
    return null
  }
}

export function setActiveDeepseekTuiUpdate(version: string): void {
  const packageJsonPath = join(getDeepseekTuiUpdatePackageRoot(version), 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Cannot activate missing deepseek-tui package: ${packageJsonPath}`)
  }
  const manifestPath = getDeepseekTuiUpdateManifestPath()
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify({ version }, null, 2))
}

function activeUpdatePackage(): ManagedDeepseekPackage | null {
  const active = readActiveDeepseekTuiUpdate()
  if (!active) return null
  const packageJsonPath = join(getDeepseekTuiUpdatePackageRoot(active.version), 'package.json')
  if (!existsSync(packageJsonPath)) return null
  try {
    return packageInfoForResolver(packageJsonPath, 'updated')
  } catch {
    return null
  }
}

export function getManagedDeepseekPackage(userBinaryPath: string): ManagedDeepseekPackage | null {
  if (!managedUserBinaryPath(userBinaryPath)) return null

  const updated = activeUpdatePackage()
  if (updated) return updated

  const resolverPackageJsonPath = app.isPackaged
    ? ensureBundledInstallerMirror()
    : join(app.getAppPath(), 'package.json')

  if (!existsSync(resolverPackageJsonPath)) {
    throw new Error(
      `Cannot find package.json at ${resolverPackageJsonPath}; cannot load deepseek-tui installer.`
    )
  }

  return packageInfoForResolver(resolverPackageJsonPath, app.isPackaged ? 'bundled' : 'dev')
}

export async function resolveDeepseekExecutableFromPackageJson(
  resolverPackageJsonPath: string
): Promise<string> {
  // The GUI only launches the `deepseek` CLI (`config` / `serve`) and never
  // invokes `deepseek-tui`. Reuse an already bundled or mirrored CLI binary
  // directly so Windows first-run setup does not block on downloading the
  // unrelated TUI executable.
  const bundledCli = resolveBundledDeepseekCliPath(resolverPackageJsonPath)
  if (bundledCli) {
    return bundledCli
  }

  const req = createRequire(resolverPackageJsonPath)
  let install: InstallModule
  try {
    install = req('deepseek-tui/scripts/install.js') as InstallModule
  } catch (e) {
    throw new Error(
      `deepseek-tui npm package missing. Run \`npm install\` in the DeepSeek-GUI folder. ${e instanceof Error ? e.message : ''}`
    )
  }

  return install.getBinaryPath('deepseek')
}

/**
 * Resolve the native `deepseek` executable:
 * - If the user set an explicit path (not the placeholder `deepseek`), use it.
 * - Otherwise use the `deepseek-tui` npm package installer, which downloads the
 *   matching GitHub release binary on first use (same as `npm i -g deepseek-tui`).
 */
export async function resolveDeepseekExecutable(userBinaryPath: string): Promise<string> {
  const u = userBinaryPath?.trim() ?? ''

  if (!managedUserBinaryPath(u)) {
    return u
  }

  const managedPackage = getManagedDeepseekPackage(u)
  if (!managedPackage) return u
  return resolveDeepseekExecutableFromPackageJson(managedPackage.resolverPackageJsonPath)
}
