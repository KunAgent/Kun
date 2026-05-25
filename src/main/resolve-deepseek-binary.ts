import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
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

type ManagedPackageName = 'deepseek-tui' | 'codewhale'

type ManagedPackageJson = {
  name?: unknown
  version?: unknown
}

type UpdateManifest = {
  version: string
}

export type ManagedDeepseekPackage = {
  packageName: ManagedPackageName
  source: DeepseekPackageSource
  resolverPackageJsonPath: string
  packageJsonPath: string
  packageRoot: string
  version: string | null
}

const UPDATE_ROOT_DIR = 'deepseek-tui-updates'
const LEGACY_MANAGED_PACKAGE_NAME: ManagedPackageName = 'deepseek-tui'
const UPDATED_MANAGED_PACKAGE_NAME: ManagedPackageName = 'codewhale'
const MANAGED_PACKAGE_NAMES: ManagedPackageName[] = [
  UPDATED_MANAGED_PACKAGE_NAME,
  LEGACY_MANAGED_PACKAGE_NAME
]

function isManagedPackageName(value: unknown): value is ManagedPackageName {
  return value === LEGACY_MANAGED_PACKAGE_NAME || value === UPDATED_MANAGED_PACKAGE_NAME
}

function managedPackageMetadata(packageJsonPath: string): {
  packageName: ManagedPackageName | null
  version: string | null
} {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as ManagedPackageJson
    return {
      packageName: isManagedPackageName(parsed.name) ? parsed.name : null,
      version:
        typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null
    }
  } catch {
    return { packageName: null, version: null }
  }
}

export function managedPackageInstallModuleRequest(
  resolverPackageJsonPath: string,
  packageName: ManagedPackageName
): string {
  const packageRoot = dirname(resolverPackageJsonPath)
  return isManagedPackageName(basename(packageRoot))
    ? './scripts/install.js'
    : `${packageName}/scripts/install.js`
}

export function managedPackageBinaryName(packageName: ManagedPackageName): string {
  return packageName === UPDATED_MANAGED_PACKAGE_NAME ? 'codewhale' : 'deepseek'
}

function managedPackageExecutableCandidates(packageName: ManagedPackageName): string[] {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const primary = managedPackageBinaryName(packageName)
  const fallback = primary === 'deepseek' ? 'codewhale' : 'deepseek'
  return [`${primary}${suffix}`, `${fallback}${suffix}`]
}

function bundledManagedPackageRoots(packageName: ManagedPackageName): string[] {
  const appRoot = app.getAppPath()
  const roots = [join(appRoot, 'node_modules', packageName)]
  if (appRoot.endsWith('app.asar')) {
    roots.push(
      join(appRoot.replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules', packageName)
    )
  }
  return roots
}

function bundledManagedPackage(): { packageName: ManagedPackageName; sourceRoots: string[] } {
  for (const packageName of MANAGED_PACKAGE_NAMES) {
    const sourceRoots = bundledManagedPackageRoots(packageName)
    if (sourceRoots.some((sourceRoot) => existsSync(join(sourceRoot, 'package.json')))) {
      return { packageName, sourceRoots }
    }
  }
  throw new Error('Cannot find bundled managed runtime package.')
}

function managedUserBinaryPath(userBinaryPath: string): boolean {
  const u = userBinaryPath?.trim() ?? ''
  return !u || u === 'deepseek'
}

function packageInfoFromManagedPackageJson(
  packageJsonPath: string,
  resolverPackageJsonPath: string,
  source: DeepseekPackageSource
): ManagedDeepseekPackage | null {
  const metadata = managedPackageMetadata(packageJsonPath)
  if (!metadata.packageName) return null
  return {
    packageName: metadata.packageName,
    source,
    resolverPackageJsonPath,
    packageJsonPath,
    packageRoot: dirname(packageJsonPath),
    version: metadata.version
  }
}

function packageInfoForResolver(
  resolverPackageJsonPath: string,
  source: DeepseekPackageSource
): ManagedDeepseekPackage {
  const direct = packageInfoFromManagedPackageJson(
    resolverPackageJsonPath,
    resolverPackageJsonPath,
    source
  )
  if (direct) return direct

  const req = createRequire(resolverPackageJsonPath)
  for (const packageName of MANAGED_PACKAGE_NAMES) {
    try {
      const packageJsonPath = req.resolve(`${packageName}/package.json`)
      const resolved = packageInfoFromManagedPackageJson(
        packageJsonPath,
        resolverPackageJsonPath,
        source
      )
      if (resolved) return resolved
    } catch {
      /* try the next managed package name */
    }
  }

  throw new Error(`Cannot resolve managed runtime package from ${resolverPackageJsonPath}`)
}

function resolveBundledDeepseekCliPath(managedPackage: ManagedDeepseekPackage): string | null {
  for (const executableName of managedPackageExecutableCandidates(managedPackage.packageName)) {
    const candidate = join(managedPackage.packageRoot, 'bin', 'downloads', executableName)
    if (!existsSync(candidate)) continue
    try {
      if (statSync(candidate).isFile()) {
        return candidate
      }
    } catch {
      /* ignore unreadable candidates and keep searching */
    }
  }
  return null
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
  throw new Error(`Cannot find managed runtime installer file: ${relativePath}`)
}

function mirrorBundledDownloads(
  sourceRoots: string[],
  packageRoot: string,
  packageName: ManagedPackageName
): void {
  const copied = new Set<string>()
  const cliName = managedPackageExecutableCandidates(packageName)[0]
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
  const bundled = bundledManagedPackage()
  const cacheRoot = join(app.getPath('userData'), 'deepseek-tui-installer')
  const packageRoot = join(cacheRoot, 'node_modules', bundled.packageName)
  const destPackageJson = join(packageRoot, 'package.json')
  const filesToMirror = [
    'package.json',
    'scripts/install.js',
    'scripts/artifacts.js',
    'scripts/preflight-glibc.js'
  ]

  mkdirSync(packageRoot, { recursive: true })

  // Mirror only the installer files we need into userData so the bundled
  // package writes its downloaded binaries to a writable location outside app.asar.
  for (const relativePath of filesToMirror) {
    mirrorRequiredInstallerFile(bundled.sourceRoots, packageRoot, relativePath)
  }
  // Packaged builds often already contain the platform binary downloaded at
  // build time. Copy it into the writable mirror first so first launch does
  // not depend on a fresh GitHub download, especially on Windows.
  mirrorBundledDownloads(bundled.sourceRoots, packageRoot, bundled.packageName)

  return destPackageJson
}

export function getDeepseekTuiUpdatePackageRoot(version: string): string {
  if (!/^[0-9A-Za-z.+_-]+$/.test(version)) {
    throw new Error(`Invalid managed runtime version: ${version}`)
  }
  return join(
    app.getPath('userData'),
    UPDATE_ROOT_DIR,
    'versions',
    version,
    'node_modules',
    UPDATED_MANAGED_PACKAGE_NAME
  )
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
    throw new Error(`Cannot activate missing managed runtime package: ${packageJsonPath}`)
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
      `Cannot find package.json at ${resolverPackageJsonPath}; cannot load the managed runtime installer.`
    )
  }

  return packageInfoForResolver(resolverPackageJsonPath, app.isPackaged ? 'bundled' : 'dev')
}

export async function resolveDeepseekExecutableFromPackageJson(
  resolverPackageJsonPath: string
): Promise<string> {
  const managedPackage = packageInfoForResolver(resolverPackageJsonPath, 'updated')

  // The GUI only launches the `deepseek` CLI (`config` / `serve`) and never
  // invokes the package entrypoint. Reuse an already bundled or mirrored CLI binary
  // directly so Windows first-run setup does not block on downloading the
  // unrelated TUI executable.
  const bundledCli = resolveBundledDeepseekCliPath(managedPackage)
  if (bundledCli) {
    return bundledCli
  }

  const req = createRequire(managedPackage.resolverPackageJsonPath)
  let install: InstallModule
  try {
    install = req(
      managedPackageInstallModuleRequest(
        managedPackage.resolverPackageJsonPath,
        managedPackage.packageName
      )
    ) as InstallModule
  } catch (e) {
    throw new Error(
      `${managedPackage.packageName} npm package missing. Run \`npm install\` in the DeepSeek-GUI folder. ${
        e instanceof Error ? e.message : ''
      }`
    )
  }

  return install.getBinaryPath(managedPackageBinaryName(managedPackage.packageName))
}

/**
 * Resolve the native `deepseek` executable:
 * - If the user set an explicit path (not the placeholder `deepseek`), use it.
 * - Otherwise use the managed npm package installer, which downloads the
 *   matching GitHub release binary on first use.
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
