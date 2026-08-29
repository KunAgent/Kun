'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const { mkdir, readFile, realpath, stat, writeFile } = require('node:fs/promises')
const { isAbsolute, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  DEFAULT_TIMEOUT_MS,
  EXTENSION_ID,
  MEDIA_IMAGE_HANDLE_ID,
  MEDIA_PLAYBACK_HANDLE_ID,
  PROCESS_OUTPUT_LIMIT
} = require('./smoke-packaged-extension-desktop-constants.cjs')
const processSupport = require('./smoke-packaged-extension-desktop-process.cjs')
const {
  startNetworkCanary,
  evaluationValue,
  pollUntil,
  processState,
  assertDesktopProcessRunning,
  terminateProcessTree,
  signalLiveProcess,
  isProcessRunning,
  remainingMilliseconds,
  waitForProcessExit,
  waitForPortsClosed,
  isLoopbackPortOpen,
  availablePort,
  argumentValue,
  positiveIntegerArgument,
  delay
} = processSupport

async function stopIsolatedSharedRuntime(unpackedRoot, profile) {
  const discoveryPath = join(profile, 'runtime.json')
  const owner = await readDiscoveryOwner(discoveryPath)
  const modulePath = join(unpackedRoot, 'kun', 'dist', 'cli', 'shared-runtime.js')
  const { stopSharedRuntime } = await import(pathToFileURL(modulePath).href)
  let stopError
  try {
    await stopSharedRuntime(profile)
  } catch (error) {
    stopError = error
  }
  if (owner && !await waitForPidExit(owner.pid, 5_000)) {
    await terminateVerifiedIsolatedProcess({
      owner,
      kind: 'runtime',
      expectedDataDir: profile
    })
  }
  if (stopError && (!owner || await processIsAlive(owner.pid))) throw stopError
}

async function stopIsolatedServiceManager(home, profile) {
  const discoveryPath = join(home, '.kun', 'control', 'manager.json')
  const owner = await readDiscoveryOwner(discoveryPath)
  if (!owner) return
  if (resolve(owner.dataDir ?? '') !== resolve(profile)) {
    throw new Error('Refusing to stop an isolated Kun Service Manager whose dataDir does not match the smoke profile')
  }
  try {
    await fetch(`${String(owner.baseUrl).replace(/\/$/u, '')}/v1/manager/shutdown`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.managerToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ instanceId: owner.instanceId }),
      signal: AbortSignal.timeout(5_000)
    })
  } catch {
    // The manager may already be closing. PID and command verification below
    // decides whether a bounded termination fallback is permitted.
  }
  if (await waitForPidExit(owner.pid, 5_000)) return
  await terminateVerifiedIsolatedProcess({
    owner,
    kind: 'manager',
    expectedDataDir: profile
  })
}

async function readDiscoveryOwner(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return value && Number.isSafeInteger(value.pid) && value.pid > 0 &&
      typeof value.instanceId === 'string'
      ? value
      : undefined
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function terminateVerifiedIsolatedProcess({ owner, kind, expectedDataDir }) {
  if (!await processIsAlive(owner.pid)) return
  const command = processCommandLine(owner.pid)
  const verified = isVerifiedIsolatedKunCommand({
    command,
    kind,
    expectedDataDir,
    discoveryDataDir: owner.dataDir
  })
  if (!verified) {
    throw new Error(
      `Refusing to terminate unverified PID ${owner.pid} while cleaning the packaged Extension smoke`
    )
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(owner.pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8'
    })
    if (result.error && await processIsAlive(owner.pid)) throw result.error
  } else {
    try {
      process.kill(owner.pid, 'SIGTERM')
    } catch {
      return
    }
    if (!await waitForPidExit(owner.pid, 3_000)) {
      try {
        process.kill(owner.pid, 'SIGKILL')
      } catch {
        return
      }
    }
  }
  if (!await waitForPidExit(owner.pid, 2_000)) {
    throw new Error(`Verified isolated Kun ${kind} PID ${owner.pid} did not exit`)
  }
}

function isVerifiedIsolatedKunCommand({ command, kind, expectedDataDir, discoveryDataDir }) {
  if (!command || !expectedDataDir) return false
  if (kind === 'runtime') {
    return command.includes('serve-entry.js') && command.includes(resolve(expectedDataDir))
  }
  return kind === 'manager' &&
    command.includes('manager-entry.js') &&
    resolve(discoveryDataDir ?? '') === resolve(expectedDataDir)
}

function processCommandLine(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`
    ], { windowsHide: true, encoding: 'utf8' })
    return result.status === 0 ? String(result.stdout).trim() : ''
  }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8'
  })
  return result.status === 0 ? String(result.stdout).trim() : ''
}

async function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await processIsAlive(pid)) return true
    await delay(100)
  }
  return !await processIsAlive(pid)
}

function releaseChildProcessHandles(child) {
  child?.stdout?.destroy()
  child?.stderr?.destroy()
  child?.unref?.()
}

async function withTimeout(operation, timeoutMs, description) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out while ${description}`)),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function desktopSmokeWorkspaceParent(sourceRoot = resolve(__dirname, '..')) {
  return join(sourceRoot, 'dist', '.kun-desktop-smoke')
}

function desktopSmokeSettings(runtimePort, workspaceRoot, dataDir) {
  if (!isAbsolute(dataDir)) {
    throw new TypeError('Packaged desktop smoke dataDir must be absolute')
  }
  return {
    version: 1,
    workspaceRoot,
    agents: {
      kun: {
        apiKey: 'packaged-desktop-smoke-placeholder',
        baseUrl: 'https://invalid.example',
        providerId: 'deepseek',
        model: 'deepseek-chat',
        dataDir,
        port: runtimePort
      }
    }
  }
}

async function grantSmokeWorkspaceTrust(unpackedRoot, profile, workspaceRoot) {
  const modulePath = join(unpackedRoot, 'kun', 'dist', 'extensions', 'index.js')
  const extensionModule = await import(
    `${pathToFileURL(modulePath).href}?desktop-smoke=${Date.now()}-${Math.random()}`
  )
  const paths = new extensionModule.ExtensionPaths({
    packageRoot: join(profile, 'extensions'),
    dataRoot: join(profile, 'extension-data')
  })
  const registry = new extensionModule.ExtensionRegistry(paths)
  const entry = await registry.get(EXTENSION_ID)
  const active = entry?.useDevelopment
    ? entry.development
    : entry?.selectedVersion
      ? entry.versions[entry.selectedVersion]
      : undefined
  if (!active) throw new Error('Desktop smoke extension has no selected registry version')
  // Extension workspace identity is deliberately lexical. Using realpath here
  // can grant a different key from the absolute path sent by the renderer when
  // a CI workspace or one of its parents is a symlink.
  const workspaceKey = paths.workspaceKey(workspaceRoot)
  await registry.setWorkspaceEnabled(EXTENSION_ID, workspaceKey, true)
  await registry.setWorkspacePermissionGrant(
    EXTENSION_ID,
    workspaceKey,
    [...active.grantedPermissions],
    active.manifest.version
  )
}

async function seedDesktopMediaPlaybackFixture(profile, workspaceRoot) {
  const canonicalWorkspace = await realpath(workspaceRoot)
  const fixtures = [
    {
      id: MEDIA_PLAYBACK_HANDLE_ID,
      displayName: 'packaged-playback.wav',
      mimeType: 'audio/wav',
      bytes: buildDesktopPlaybackWav()
    },
    {
      id: MEDIA_IMAGE_HANDLE_ID,
      displayName: 'packaged-proof.png',
      mimeType: 'image/png',
      bytes: buildDesktopPlaybackPng()
    }
  ]
  const handles = {}
  for (const fixture of fixtures) {
    const path = join(workspaceRoot, fixture.displayName)
    await writeFile(path, fixture.bytes)
    const canonicalPath = await realpath(path)
    const identity = await stat(canonicalPath)
    handles[fixture.id] = {
      id: fixture.id,
      ownerExtensionId: EXTENSION_ID,
      ownerExtensionVersion: '1.0.0',
      workspaceRoot: canonicalWorkspace,
      absolutePath: canonicalPath,
      displayName: fixture.displayName,
      mode: 'read',
      source: 'workspace',
      mimeType: fixture.mimeType,
      identity: {
        size: identity.size,
        mtimeMs: identity.mtimeMs,
        device: identity.dev,
        inode: identity.ino
      },
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  }
  const storePath = join(profile, 'extensions', 'media-handles.json')
  await mkdir(join(profile, 'extensions'), { recursive: true })
  await writeFile(storePath, `${JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    handles
  }, null, 2)}\n`)
}

function buildDesktopPlaybackWav() {
  const sampleRate = 8_000
  const sampleCount = sampleRate * 2
  const dataBytes = sampleCount * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    const phase = index % 80
    const triangle = phase < 40 ? phase : 80 - phase
    wav.writeInt16LE((triangle - 20) * 900, 44 + index * 2)
  }
  return wav
}

function buildDesktopPlaybackPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
}

function desktopApplicationEntry(
  resourcesDir,
  runtimeExecutable,
  packagedRuntimeExecutable,
  selfContainedDesktopExecutable = false
) {
  if (selfContainedDesktopExecutable) return undefined
  if (
    packagedRuntimeExecutable &&
    resolve(runtimeExecutable) === resolve(packagedRuntimeExecutable)
  ) return undefined
  return join(resourcesDir, 'app.asar')
}

function resolveDesktopLaunchSelection({
  resourcesDir,
  runtimeExecutable,
  packagedRuntimeExecutable,
  desktopExecutable
}) {
  if (desktopExecutable === undefined) {
    return {
      cliExecutable: runtimeExecutable,
      desktopExecutable: runtimeExecutable,
      applicationEntry: desktopApplicationEntry(
        resourcesDir,
        runtimeExecutable,
        packagedRuntimeExecutable
      ),
      selfContained: false
    }
  }

  const resolvedDesktopExecutable = resolve(desktopExecutable)
  if (!existsSync(resolvedDesktopExecutable)) {
    throw new Error(`Desktop executable does not exist: ${resolvedDesktopExecutable}`)
  }
  if (!statSync(resolvedDesktopExecutable).isFile()) {
    throw new Error(`Desktop executable is not a file: ${resolvedDesktopExecutable}`)
  }

  return {
    cliExecutable: runtimeExecutable,
    desktopExecutable: resolvedDesktopExecutable,
    applicationEntry: desktopApplicationEntry(
      resourcesDir,
      runtimeExecutable,
      packagedRuntimeExecutable,
      true
    ),
    selfContained: true
  }
}

function desktopResourceCandidates(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return ['dist/mac-arm64/Kun.app/Contents/Resources']
    if (arch === 'x64') return ['dist/mac/Kun.app/Contents/Resources']
    return []
  }
  if (platform === 'win32') return ['dist/win-unpacked/resources']
  if (platform === 'linux') return ['dist/linux-unpacked/resources']
  return []
}

function resolvedDesktopResourceCandidates(
  platform = process.platform,
  arch = process.arch,
  cwd = process.cwd()
) {
  return desktopResourceCandidates(platform, arch).map((candidate) => resolve(cwd, candidate))
}

function desktopUserDataCandidates({ platform, home, appData, explicitUserData }) {
  const candidates = new Set([explicitUserData, join(appData, 'Kun')])
  if (platform === 'darwin') candidates.add(join(home, 'Library', 'Application Support', 'Kun'))
  if (platform === 'linux') candidates.add(join(home, '.config', 'Kun'))
  return [...candidates]
}

function resolveDesktopResources(explicit) {
  if (explicit) {
    const path = resolve(explicit)
    if (!existsSync(path)) throw new Error(`Packaged resources do not exist: ${path}`)
    return path
  }
  const candidates = resolvedDesktopResourceCandidates()
  const found = candidates.find(existsSync)
  if (!found) {
    throw new Error(
      `Cannot find host-native packaged resources for ${process.platform}/${process.arch}; ` +
      `pass --resources <path> (checked ${candidates.join(', ') || 'no supported path'})`
    )
  }
  return found
}

function createIsolatedEnvironment(environment, paths) {
  const result = scrubDesktopEnvironment({ ...environment })
  Object.assign(result, {
    HOME: paths.home,
    USERPROFILE: paths.home,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    XDG_CONFIG_HOME: join(paths.home, '.config'),
    XDG_CACHE_HOME: join(paths.home, '.cache'),
    TMPDIR: paths.temporaryDirectory,
    TMP: paths.temporaryDirectory,
    TEMP: paths.temporaryDirectory,
    KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE: '1',
    KUN_DISABLE_OS_CREDENTIAL_STORE: '1',
    NO_AT_BRIDGE: '1',
    ELECTRON_ENABLE_LOGGING: '1',
    NODE_ENV: 'production'
  })
  return result
}

function scrubDesktopEnvironment(environment) {
  const result = { ...environment }
  const exactOverrides = new Set([
    'ELECTRON_RENDERER_URL',
    'ELECTRON_RUN_AS_NODE',
    'KUN_PACKAGED_EXTENSION_SMOKE_REEXEC',
    'NODE_OPTIONS',
    'NODE_PATH',
    'VITE_DEV_SERVER_URL',
    'WEBPACK_DEV_SERVER_URL'
  ])
  for (const key of Object.keys(result)) {
    if (
      exactOverrides.has(key) ||
      (key.startsWith('KUN_') &&
        key !== 'KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE' &&
        key !== 'KUN_PACKAGED_UPDATE_HANDOFF_SMOKE' &&
        key !== 'KUN_PACKAGED_UPDATE_HANDOFF_DENY_INSPECTION' &&
        key !== 'KUN_DISABLE_OS_CREDENTIAL_STORE') ||
      key.startsWith('DEEPSEEK_')
    ) {
      delete result[key]
    }
  }
  return result
}

function createDesktopLaunchPlan({
  executable,
  applicationArguments,
  environment,
  platform,
  hasDisplay,
  xvfbExecutable = 'xvfb-run'
}) {
  const env = scrubDesktopEnvironment(environment)
  const args = [...applicationArguments]
  if (platform === 'linux' && !hasDisplay) {
    return {
      command: xvfbExecutable,
      args: ['-a', '-s', '-screen 0 1280x900x24', executable, ...args],
      env,
      wrappedByXvfb: true
    }
  }
  return { command: executable, args, env, wrappedByXvfb: false }
}

function platformDesktopArguments(platform = process.platform) {
  if (platform !== 'linux') return []
  const args = ['--disable-gpu', '--disable-dev-shm-usage']
  if (
    process.env.CI === 'true' &&
    process.env.KUN_CI_ALLOW_NO_SANDBOX === '1' &&
    process.env.KUN_CI_NO_SANDBOX_ACTIVE === '1'
  ) {
    args.push('--no-sandbox')
  }
  return args
}

function runPackagedKun(executable, runtimeEntry, args, environment, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const result = spawnSync(executable, [runtimeEntry, ...args], {
    cwd: process.cwd(),
    env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    windowsHide: true
  })
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`Packaged Kun command timed out after ${timeoutMs} ms: ${args.join(' ')}`)
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    const exitReason = result.signal ?? result.status ?? 'unknown exit'
    throw new Error([
      `Packaged Kun command failed (${exitReason}): ${args.join(' ')}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}


module.exports = {
  stopIsolatedSharedRuntime,
  stopIsolatedServiceManager,
  readDiscoveryOwner,
  terminateVerifiedIsolatedProcess,
  isVerifiedIsolatedKunCommand,
  processCommandLine,
  processIsAlive,
  waitForPidExit,
  releaseChildProcessHandles,
  withTimeout,
  desktopSmokeWorkspaceParent,
  desktopSmokeSettings,
  grantSmokeWorkspaceTrust,
  seedDesktopMediaPlaybackFixture,
  buildDesktopPlaybackWav,
  buildDesktopPlaybackPng,
  desktopApplicationEntry,
  resolveDesktopLaunchSelection,
  desktopResourceCandidates,
  resolvedDesktopResourceCandidates,
  desktopUserDataCandidates,
  resolveDesktopResources,
  createIsolatedEnvironment,
  scrubDesktopEnvironment,
  createDesktopLaunchPlan,
  platformDesktopArguments,
  runPackagedKun
}
