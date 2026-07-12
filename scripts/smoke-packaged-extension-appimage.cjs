#!/usr/bin/env node

'use strict'

const { spawnSync } = require('node:child_process')
const {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')
const {
  LINUX_SANDBOX_LAUNCHER_FLAG,
  _internals: { assertElfExecutable, linuxElectronLauncherContent, linuxRealExecutableName }
} = require('./after-pack.cjs')

const APPIMAGE_FILE_PATTERN = /^Kun-[0-9A-Za-z][0-9A-Za-z._-]*-linux-x86_64\.AppImage$/
const APPIMAGE_EXTRACTION_TIMEOUT_MS = 120_000

function assertLinuxX64(platform = process.platform, arch = process.arch) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error(
      `The final AppImage smoke requires a native linux/x64 runner, got ${platform}/${arch}`
    )
  }
}

function resolveSingleLinuxAppImage(distDirectory = resolve('dist')) {
  const dist = resolve(distDirectory)
  const distDetails = lstatSync(dist)
  if (distDetails.isSymbolicLink() || !distDetails.isDirectory()) {
    throw new Error(`Linux distribution root must be a non-symlink directory: ${dist}`)
  }
  const canonicalDist = realpathSync(dist)
  const candidates = readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isFile() && APPIMAGE_FILE_PATTERN.test(entry.name))
    .map((entry) => join(dist, entry.name))
    .sort()

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one final Linux x64 AppImage in ${dist}, ` +
      `found ${candidates.length}${candidates.length ? `: ${candidates.join(', ')}` : ''}`
    )
  }
  const appImage = candidates[0]
  const details = lstatSync(appImage)
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error(`Final Linux AppImage must be a non-symlink regular file: ${appImage}`)
  }
  assertContained(canonicalDist, realpathSync(appImage), 'Final Linux AppImage')
  return appImage
}

function createAppImageExtractionInvocation({
  appImage,
  extractionDirectory,
  environment = process.env
}) {
  const env = { ...environment }
  delete env.APPIMAGE_EXTRACT_AND_RUN
  delete env.ELECTRON_RUN_AS_NODE
  delete env.APPDIR
  delete env.APPIMAGE
  delete env.OWD
  return {
    command: resolve(appImage),
    args: ['--appimage-extract'],
    options: {
      cwd: resolve(extractionDirectory),
      env,
      shell: false,
      stdio: 'inherit',
      timeout: APPIMAGE_EXTRACTION_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true
    }
  }
}

function createAppImageSmokeInvocation({
  appImage,
  resourcesDir,
  desktopSmokePath = join(__dirname, 'smoke-packaged-extension-desktop.cjs'),
  environment = process.env
}) {
  const env = { ...environment }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.APPDIR
  delete env.APPIMAGE
  delete env.OWD
  env.APPIMAGE_EXTRACT_AND_RUN = '1'

  return {
    command: process.execPath,
    args: [
      resolve(desktopSmokePath),
      '--resources',
      resolve(resourcesDir),
      '--desktop-executable',
      resolve(appImage)
    ],
    options: {
      env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true
    }
  }
}

function runAppImageSmoke(options = {}) {
  assertLinuxX64(options.platform, options.arch)
  const appImage = resolveSingleLinuxAppImage(options.distDirectory)
  const mode = statSync(appImage).mode
  chmodSync(appImage, mode | 0o111)
  if ((statSync(appImage).mode & 0o111) !== 0o111) {
    throw new Error(`Final Linux AppImage is not executable after chmod: ${appImage}`)
  }

  const extractionDirectory = options.extractionDirectory
    ? resolve(options.extractionDirectory)
    : mkdtempSync(join(tmpdir(), 'kun-appimage-extract-'))
  const ownsExtractionDirectory = options.extractionDirectory === undefined
  inspectEmptyExtractionDirectory(extractionDirectory)

  try {
    const extract = createAppImageExtractionInvocation({
      appImage,
      extractionDirectory,
      environment: options.environment
    })
    runInvocation(
      extract,
      options.spawnSyncCommand ?? spawnSync,
      'Final Linux AppImage --appimage-extract failed'
    )

    const extractedRoot = join(extractionDirectory, 'squashfs-root')
    const inspectBundle = options.inspectBundle ?? inspectExtractedAppImageBundle
    const layout = inspectBundle(extractedRoot, { trustedRoot: extractionDirectory })

    const smoke = createAppImageSmokeInvocation({
      appImage,
      resourcesDir: layout.resourcesDir,
      desktopSmokePath: options.desktopSmokePath,
      environment: options.environment
    })
    runInvocation(
      smoke,
      options.spawnSyncCommand ?? spawnSync,
      'Final Linux AppImage Extension desktop smoke failed'
    )
    return appImage
  } finally {
    if (ownsExtractionDirectory) {
      rmSync(extractionDirectory, { recursive: true, force: true })
    }
  }
}

function inspectExtractedAppImageBundle(appRoot, { trustedRoot } = {}) {
  if (!trustedRoot) throw new Error('A trusted AppImage extraction root is required')
  const trusted = inspectDirectory(trustedRoot, 'trusted AppImage extraction root')
  const root = inspectDirectory(appRoot, 'extracted AppImage root')
  assertContained(trusted.canonicalPath, root.canonicalPath, 'extracted AppImage root')

  const resources = inspectDirectory(join(root.path, 'resources'), 'extracted AppImage resources')
  const appAsar = inspectRegularFile(join(resources.path, 'app.asar'), 'extracted app.asar')
  const appRun = inspectRegularFile(join(root.path, 'AppRun'), 'extracted AppImage AppRun')
  assertContained(root.canonicalPath, resources.canonicalPath, 'extracted AppImage resources')
  assertContained(root.canonicalPath, appAsar.canonicalPath, 'extracted app.asar')
  assertContained(root.canonicalPath, appRun.canonicalPath, 'extracted AppImage AppRun')
  if ((appRun.details.mode & 0o111) === 0) {
    throw new Error(`Extracted AppImage AppRun is not executable: ${appRun.path}`)
  }
  if (appRun.details.size > 64 * 1024) {
    throw new Error(`Extracted AppImage AppRun is unexpectedly large: ${appRun.path}`)
  }

  const appRunBinLines = readFileSync(appRun.path, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('BIN='))
  const executableMatch = appRunBinLines.length === 1
    ? /^BIN="\$APPDIR\/([0-9A-Za-z._-]+)"$/u.exec(appRunBinLines[0])
    : null
  if (!executableMatch) {
    throw new Error(`Extracted AppImage AppRun must select exactly one safe packaged executable: ${appRun.path}`)
  }
  const executableName = executableMatch[1]
  const launcher = inspectRegularFile(
    join(root.path, executableName),
    'packaged Linux Electron launcher'
  )
  const realExecutable = inspectRegularFile(
    join(root.path, linuxRealExecutableName(executableName)),
    'packaged Linux Electron payload'
  )
  assertContained(root.canonicalPath, launcher.canonicalPath, 'packaged Linux Electron launcher')
  assertContained(root.canonicalPath, realExecutable.canonicalPath, 'packaged Linux Electron payload')
  if ((launcher.details.mode & 0o111) === 0 || (realExecutable.details.mode & 0o111) === 0) {
    throw new Error('Packaged Linux Electron launcher and payload must both be executable')
  }
  assertElfExecutable(realExecutable.path)
  const launcherContent = readFileSync(launcher.path, 'utf8')
  if (launcherContent !== linuxElectronLauncherContent(executableName)) {
    throw new Error(`Packaged Linux Electron launcher is not the approved sandbox wrapper: ${launcher.path}`)
  }
  if (!launcherContent.includes(LINUX_SANDBOX_LAUNCHER_FLAG) || launcherContent.includes('--no-sandbox')) {
    throw new Error(`Packaged Linux Electron launcher has unsafe sandbox arguments: ${launcher.path}`)
  }

  const desktopCandidates = readdirSync(root.path, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.desktop'))
    .map((entry) => join(root.path, entry.name))
    .sort()
  if (desktopCandidates.length !== 1) {
    throw new Error(
      `Expected exactly one root-level AppImage desktop entry in ${root.path}, ` +
      `found ${desktopCandidates.length}`
    )
  }
  const desktopEntry = inspectRegularFile(desktopCandidates[0], 'extracted AppImage desktop entry')
  assertContained(root.canonicalPath, desktopEntry.canonicalPath, 'extracted AppImage desktop entry')
  if (desktopEntry.details.size > 64 * 1024) {
    throw new Error(`Extracted AppImage desktop entry is unexpectedly large: ${desktopEntry.path}`)
  }
  const execLines = readFileSync(desktopEntry.path, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('Exec='))
  if (execLines.length !== 1) {
    throw new Error(`AppImage desktop entry must contain exactly one Exec line: ${desktopEntry.path}`)
  }
  const expectedExec = 'Exec=AppRun --disable-setuid-sandbox --no-first-run %U'
  if (execLines[0] !== expectedExec) {
    throw new Error(`AppImage desktop entry must use exactly "${expectedExec}": ${desktopEntry.path}`)
  }

  return {
    appRoot: root.path,
    resourcesDir: resources.path,
    appAsar: appAsar.path,
    appRun: appRun.path,
    launcher: launcher.path,
    realExecutable: realExecutable.path,
    desktopEntry: desktopEntry.path
  }
}

function inspectDirectory(path, label) {
  return inspectPath(path, label, (details) => details.isDirectory(), 'directory')
}

function inspectRegularFile(path, label) {
  return inspectPath(path, label, (details) => details.isFile(), 'regular file')
}

function inspectPath(path, label, expectedType, expectedTypeLabel) {
  const absolutePath = resolve(path)
  let details
  try {
    details = lstatSync(absolutePath)
  } catch (error) {
    throw new Error(
      `${label} is missing or inaccessible: ${absolutePath}: ` +
      `${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (details.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${absolutePath}`)
  if (!expectedType(details)) throw new Error(`${label} must be a ${expectedTypeLabel}: ${absolutePath}`)
  return { path: absolutePath, canonicalPath: realpathSync(absolutePath), details }
}

function inspectEmptyExtractionDirectory(extractionDirectory) {
  const details = lstatSync(extractionDirectory)
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(
      `AppImage extraction root must be a non-symlink directory: ${extractionDirectory}`
    )
  }
  if (readdirSync(extractionDirectory).length !== 0) {
    throw new Error(`AppImage extraction root must be empty: ${extractionDirectory}`)
  }
}

function runInvocation(invocation, spawnSyncCommand, failureMessage) {
  const result = spawnSyncCommand(invocation.command, invocation.args, invocation.options)
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`${failureMessage} (timed out after ${String(invocation.options.timeout)} ms)`)
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${failureMessage}${result.signal ? ` (signal ${result.signal})` : ` (exit ${String(result.status)})`}`
    )
  }
}

function assertContained(root, candidate, label) {
  const rel = relative(root, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} escapes its trusted root: ${candidate}`)
  }
}

module.exports = {
  APPIMAGE_FILE_PATTERN,
  assertLinuxX64,
  createAppImageExtractionInvocation,
  createAppImageSmokeInvocation,
  inspectExtractedAppImageBundle,
  resolveSingleLinuxAppImage,
  runAppImageSmoke
}

if (require.main === module) {
  try {
    const appImage = runAppImageSmoke()
    process.stdout.write(
      `Final Linux AppImage direct Extension desktop smoke OK: ${appImage}\n`
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
