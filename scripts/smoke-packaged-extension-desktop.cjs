#!/usr/bin/env node

'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } = require('node:fs/promises')
const { createServer: createHttpServer } = require('node:http')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { isAbsolute, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  EXTENSION_ID,
  installSmokeExtensionFixture,
  makeTreeWritable,
  resolvePackagedRuntimeExecutable,
  validatePackagedResources
} = require('./smoke-packaged-extensions.cjs')

const CONTRIBUTION_ID = `extension:${EXTENSION_ID}/smoke`
const WEBVIEW_MARKER = 'Packaged Webview smoke'
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 30_000
const GUEST_MEDIA_READY_TIMEOUT_MS = 20_000
const PROCESS_OUTPUT_LIMIT = 128 * 1024
const POPUP_SETTLE_MS = 500
const MAX_CLEANUP_TIMEOUT_MS = 15_000
const MEDIA_PLAYBACK_HANDLE_ID = 'media_packaged_playback_00000001'
const MEDIA_IMAGE_HANDLE_ID = 'media_packaged_image_00000000001'

async function main() {
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const resourcesDir = resolveDesktopResources(argumentValue('--resources'))
  const packagedRuntimeExecutable = resolvePackagedRuntimeExecutable(resourcesDir)
  const runtimeExecutable = resolvePackagedRuntimeExecutable(
    resourcesDir,
    argumentValue('--runtime-executable')
  )
  if (!runtimeExecutable) {
    throw new Error(`The packaged application at ${resourcesDir} is not host-native for ${process.arch}`)
  }
  const desktopLaunchSelection = resolveDesktopLaunchSelection({
    resourcesDir,
    runtimeExecutable,
    packagedRuntimeExecutable,
    desktopExecutable: argumentValue('--desktop-executable')
  })

  const unpackedRoot = join(resourcesDir, 'app.asar.unpacked')
  const runtimeEntry = join(unpackedRoot, 'kun', 'dist', 'cli', 'serve-entry.js')
  validatePackagedResources(resourcesDir, unpackedRoot)

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-packaged-extension-desktop-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const workspaceParent = desktopSmokeWorkspaceParent()
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'workspace-'))
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(profile, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(userData, { recursive: true }),
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(temporaryDirectory, { recursive: true })
  ])
  const runtimePort = await availablePort()
  const desktopSettings = `${JSON.stringify(
    desktopSmokeSettings(runtimePort, workspaceRoot, profile),
    null,
    2
  )}\n`
  await Promise.all(desktopUserDataCandidates({
    platform: process.platform,
    home,
    appData,
    explicitUserData: userData
  }).map(async (directory) => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'kun-settings.json'), desktopSettings)
  }))

  const isolatedEnvironment = createIsolatedEnvironment(process.env, {
    home,
    appData,
    localAppData,
    temporaryDirectory
  })
  let desktopProcess
  let cdp
  let networkCanary
  let debuggingPort
  let output = ''
  let primaryError
  const cleanupErrors = []

  try {
    networkCanary = await startNetworkCanary()
    await installSmokeExtensionFixture({
      temporaryRoot,
      profile,
      webviewConnectUrls: [networkCanary.url],
      runCli: (args) => runPackagedKun(
        desktopLaunchSelection.cliExecutable,
        runtimeEntry,
        args,
        isolatedEnvironment,
        timeoutMs
      )
    })
    await grantSmokeWorkspaceTrust(unpackedRoot, profile, workspaceRoot)
    await seedDesktopMediaPlaybackFixture(profile, workspaceRoot)

    const installedWebview = join(
      profile,
      'extensions',
      EXTENSION_ID,
      '1.0.0',
      'dist',
      'webview',
      'index.html'
    )
    const installedWebviewBody = await readFile(installedWebview, 'utf8')
    if (!installedWebviewBody.includes('data-kun-packaged-webview-smoke="ready"')) {
      throw new Error('Installed desktop smoke fixture is missing its Webview body marker')
    }
    if (!installedWebviewBody.includes(`connect-src ${networkCanary.origin}`)) {
      throw new Error('Installed desktop smoke fixture does not explicitly allow its loopback canary')
    }

    debuggingPort = await availablePort()
    while (debuggingPort === runtimePort) debuggingPort = await availablePort()
    const applicationEntry = desktopLaunchSelection.applicationEntry
    const applicationArguments = [
      ...(applicationEntry ? [applicationEntry] : []),
      `--remote-debugging-port=${debuggingPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${userData}`,
      '--no-first-run',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps'
    ]
    applicationArguments.push(...platformDesktopArguments(process.platform))
    const launch = createDesktopLaunchPlan({
      executable: desktopLaunchSelection.desktopExecutable,
      applicationArguments,
      environment: isolatedEnvironment,
      platform: process.platform,
      hasDisplay: Boolean(isolatedEnvironment.DISPLAY),
      xvfbExecutable: argumentValue('--xvfb-run') ?? 'xvfb-run'
    })
    desktopProcess = spawn(launch.command, launch.args, {
      cwd: home,
      env: launch.env,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const appendOutput = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT)
    }
    desktopProcess.stdout?.on('data', appendOutput)
    desktopProcess.stderr?.on('data', appendOutput)
    desktopProcess.once('error', (error) => appendOutput(`\nlaunch error: ${String(error)}\n`))

    const endpoint = await waitForCdpEndpoint({
      port: debuggingPort,
      timeoutMs,
      processState: () => processState(desktopProcess)
    })
    cdp = await CdpConnection.connect(
      endpoint.webSocketDebuggerUrl,
      globalThis.WebSocket,
      Math.min(timeoutMs, DEFAULT_CDP_COMMAND_TIMEOUT_MS)
    )
    await cdp.send('Target.setDiscoverTargets', { discover: true })

    const workbenchTarget = await waitForTarget(
      cdp,
      isWorkbenchTarget,
      'packaged Kun workbench',
      timeoutMs,
      () => processState(desktopProcess)
    )
    const workbenchSession = {
      targetId: workbenchTarget.targetId,
      sessionId: undefined
    }
    await synchronizeWorkbenchContributionDiscovery({
      cdp,
      session: workbenchSession,
      workspaceRoot,
      contributionId: CONTRIBUTION_ID,
      timeoutMs,
      processState: () => processState(desktopProcess)
    })
    await waitForContributionAndClick({
      cdp,
      session: workbenchSession,
      contributionId: CONTRIBUTION_ID,
      timeoutMs,
      processState: () => processState(desktopProcess)
    })

    const guestTarget = await waitForTarget(
      cdp,
      isExtensionGuestTarget,
      `kun-extension guest target for ${EXTENSION_ID}`,
      timeoutMs,
      () => processState(desktopProcess)
    )
    const guestSession = {
      targetId: guestTarget.targetId,
      sessionId: undefined
    }
    const guestResult = await inspectGuestSecurity({
      cdp,
      session: guestSession,
      targetId: guestTarget.targetId,
      workbenchSession,
      localFileUrl: pathToFileURL(join(workspaceRoot, 'packaged-playback.wav')).href,
      fetchUrl: networkCanary.url,
      popupUrl: networkCanary.popupUrl,
      timeoutMs,
      processState: () => processState(desktopProcess)
    })
    assertGuestSecurityResult(guestResult, networkCanary.requestCount())

    await assertStaleViewSessionMediaBlocked({
      cdp,
      guestSession,
      guestTargetId: guestTarget.targetId,
      workbenchSession,
      timeoutMs,
      processState: () => processState(desktopProcess)
    })

    process.stdout.write(
      `Packaged Extension desktop Chromium smoke OK (${process.platform}/${process.arch}): ` +
      `${desktopLaunchSelection.selfContained
        ? 'explicit self-contained packaged desktop executable'
        : applicationEntry
          ? 'explicit host Electron with packaged app.asar'
          : 'normal packaged Electron launch'}, ` +
      `CDP contribution click, ${guestTarget.type} guest, body marker, ` +
      'narrow kunExtension bridge, Theme and View-state round-trips, sender-bound kun-media playback/seek and image load, ' +
      'copied URL, arbitrary file URL, post-release, and stale View Session denial, ' +
      'hidden kunGui/require/process, ' +
      'Host-blocked loopback fetch, and user-gesture popup denial without a new target.\n'
    )
  } catch (error) {
    primaryError = error
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => undefined)
      cdp.close()
    }
    if (desktopProcess) {
      await terminateProcessTree(desktopProcess, process.platform, {
        timeoutMs: Math.min(MAX_CLEANUP_TIMEOUT_MS, Math.max(5_000, timeoutMs)),
        ports: [runtimePort, debuggingPort].filter(Number.isSafeInteger)
      }).catch((error) => cleanupErrors.push(error))
    }
    if (networkCanary) {
      await networkCanary.close().catch((error) => cleanupErrors.push(error))
      await waitForPortsClosed([networkCanary.port], 2_000)
        .catch((error) => cleanupErrors.push(error))
    }
    if (process.env.KUN_KEEP_PACKAGED_EXTENSION_DESKTOP_SMOKE === '1') {
      process.stderr.write(`Preserved packaged desktop smoke profile: ${temporaryRoot}\n`)
      process.stderr.write(`Preserved packaged desktop smoke workspace: ${workspaceRoot}\n`)
    } else {
      await Promise.all([temporaryRoot, workspaceRoot].map(async (path) => {
        await makeTreeWritable(path).catch(() => undefined)
        await rm(path, { recursive: true, force: true })
          .catch((error) => cleanupErrors.push(error))
      }))
    }
  }

  if (primaryError || cleanupErrors.length > 0) {
    const message = primaryError instanceof Error
      ? primaryError.stack ?? primaryError.message
      : primaryError === undefined
        ? 'Packaged Extension desktop smoke cleanup failed'
        : String(primaryError)
    const cleanupDiagnostics = cleanupErrors.length > 0
      ? `\nCleanup failures:\n${cleanupErrors.map((error) => `- ${error instanceof Error ? error.message : String(error)}`).join('\n')}`
      : ''
    const diagnostics = output.trim() ? `\nPackaged Electron output (tail):\n${output.trim()}` : ''
    throw new Error(`${message}${cleanupDiagnostics}${diagnostics}`)
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
  return ['--disable-gpu', '--disable-dev-shm-usage']
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

class CdpConnection {
  constructor(socket, commandTimeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS) {
    this.socket = socket
    this.commandTimeoutMs = commandTimeoutMs
    this.sequence = 0
    this.pending = new Map()
    this.eventListeners = new Map()
    socket.addEventListener('message', (event) => this.onMessage(event.data))
    socket.addEventListener('close', () => this.rejectPending(new Error('CDP WebSocket closed')))
    socket.addEventListener('error', () => this.rejectPending(new Error('CDP WebSocket failed')))
  }

  static async connect(
    url,
    WebSocketClass = globalThis.WebSocket,
    commandTimeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS
  ) {
    if (typeof WebSocketClass !== 'function') {
      throw new Error('The desktop smoke requires the WebSocket global from Node.js 22 or newer')
    }
    const socket = new WebSocketClass(url)
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to CDP: ${url}`)), 10_000)
      const finish = (callback) => {
        clearTimeout(timer)
        callback()
      }
      socket.addEventListener('open', () => finish(resolvePromise), { once: true })
      socket.addEventListener('error', () => finish(() => reject(new Error(`Cannot connect to CDP: ${url}`))), {
        once: true
      })
    })
    return new CdpConnection(socket, commandTimeoutMs)
  }

  send(method, params = {}, sessionId) {
    if (this.socket.readyState !== 1) return Promise.reject(new Error('CDP WebSocket is not open'))
    this.sequence += 1
    const id = this.sequence
    const envelope = { id, method, params, ...(sessionId ? { sessionId } : {}) }
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command timed out: ${method}`))
      }, this.commandTimeoutMs)
      this.pending.set(id, { resolvePromise, reject, timer, method })
      this.socket.send(JSON.stringify(envelope))
    })
  }

  onEvent(method, listener) {
    if (typeof method !== 'string' || typeof listener !== 'function') {
      throw new TypeError('CDP event subscriptions require a method and listener')
    }
    const listeners = this.eventListeners.get(method) ?? new Set()
    listeners.add(listener)
    this.eventListeners.set(method, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.eventListeners.delete(method)
    }
  }

  onMessage(raw) {
    if (typeof raw !== 'string') return
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!Number.isSafeInteger(message.id)) {
      if (typeof message.method !== 'string') return
      for (const listener of this.eventListeners.get(message.method) ?? []) {
        try {
          listener(message.params ?? {}, message)
        } catch {
          // Event observation must not corrupt the CDP command channel.
        }
      }
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(new Error(
        `CDP ${pending.method} failed (${message.error.code ?? 'unknown'}): ${message.error.message ?? 'unknown error'}`
      ))
      return
    }
    pending.resolvePromise(message.result ?? {})
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  close() {
    this.eventListeners.clear()
    if (this.socket.readyState === 0 || this.socket.readyState === 1) this.socket.close()
  }
}

async function waitForCdpEndpoint({ port, timeoutMs, processState: readProcessState }) {
  const endpoint = `http://127.0.0.1:${port}`
  return pollUntil(async () => {
    assertDesktopProcessRunning(readProcessState())
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_500)
      })
      if (!response.ok) return undefined
      const body = await response.json()
      return typeof body.webSocketDebuggerUrl === 'string' ? body : undefined
    } catch {
      return undefined
    }
  }, {
    timeoutMs,
    description: `CDP endpoint on ${endpoint}`
  })
}

async function waitForTarget(cdp, predicate, description, timeoutMs, readProcessState) {
  let observedTargets = []
  try {
    return await pollUntil(async () => {
      assertDesktopProcessRunning(readProcessState())
      const { targetInfos = [] } = await cdp.send('Target.getTargets')
      observedTargets = targetInfos
      return targetInfos.find(predicate)
    }, { timeoutMs, description })
  } catch (error) {
    const detail = observedTargets
      .slice(0, 20)
      .map((target) => `${String(target.type)}:${String(target.url).slice(0, 512)}`)
      .join(', ')
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
      `observed CDP targets: ${detail || '(none)'}`
    )
  }
}

function isWorkbenchTarget(target) {
  if (!target || target.type !== 'page' || typeof target.url !== 'string') return false
  try {
    const url = new URL(target.url)
    return (
      url.protocol === 'file:' &&
      url.hostname === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.replaceAll('\\', '/').endsWith('/app.asar/out/renderer/index.html')
    )
  } catch {
    return false
  }
}

function isExtensionGuestTarget(target) {
  if (
    !target ||
    typeof target.targetId !== 'string' ||
    target.targetId.length === 0 ||
    target.type !== 'webview' ||
    typeof target.url !== 'string'
  ) return false
  try {
    const url = new URL(target.url)
    const queryKeys = [...url.searchParams.keys()]
    return (
      url.protocol === 'kun-extension:' &&
      url.hostname === EXTENSION_ID &&
      url.pathname === '/dist/webview/index.html' &&
      queryKeys.length === 1 &&
      queryKeys[0] === 'kunViewSession' &&
      Boolean(url.searchParams.get('kunViewSession')) &&
      url.hash === ''
    )
  } catch {
    return false
  }
}

async function attachToTarget(cdp, targetId) {
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  if (typeof attached.sessionId !== 'string') throw new Error(`CDP did not attach to target ${targetId}`)
  await cdp.send('Runtime.enable', {}, attached.sessionId)
  return attached.sessionId
}

function isRecoverableCdpSessionError(error) {
  return error instanceof Error &&
    /(?:Session with given id not found|No session with given id|Target (?:closed|is detached)|Execution context was destroyed|Cannot find context with specified id)/iu.test(error.message)
}

function isCdpCommandTimeout(error) {
  return error instanceof Error && /CDP command timed out:/u.test(error.message)
}

async function sendToRecoverableTargetSession({
  cdp,
  session,
  targetMatches,
  targetDescription,
  method,
  params,
  timeoutMs,
  processState: readProcessState,
  operation
}) {
  const deadline = Date.now() + timeoutMs
  let lastSessionError
  while (Date.now() < deadline) {
    assertDesktopProcessRunning(readProcessState())
    if (!session.sessionId) {
      const { targetInfos = [] } = await cdp.send('Target.getTargets')
      const target = targetInfos.find((candidate) =>
        candidate.targetId === session.targetId && targetMatches(candidate)) ??
        targetInfos.find(targetMatches)
      if (!target) {
        await delay(100)
        continue
      }
      try {
        session.targetId = target.targetId
        session.sessionId = await attachToTarget(cdp, target.targetId)
      } catch (error) {
        if (!isRecoverableCdpSessionError(error) && !isCdpCommandTimeout(error)) throw error
        lastSessionError = error
        session.sessionId = undefined
        await delay(100)
        continue
      }
    }
    try {
      return await cdp.send(method, params, session.sessionId)
    } catch (error) {
      if (
        !isRecoverableCdpSessionError(error) &&
        !(method === 'Runtime.evaluate' && isCdpCommandTimeout(error))
      ) throw error
      lastSessionError = error
      session.sessionId = undefined
      await delay(100)
    }
  }
  throw new Error(
    `Timed out while ${operation} after the packaged ${targetDescription} CDP session was replaced; ` +
    `last error: ${lastSessionError instanceof Error ? lastSessionError.message : 'session unavailable'}`
  )
}

function sendToWorkbenchSession(options) {
  return sendToRecoverableTargetSession({
    ...options,
    targetMatches: isWorkbenchTarget,
    targetDescription: 'workbench'
  })
}

function sendToGuestSession(options) {
  return sendToRecoverableTargetSession({
    ...options,
    targetMatches: isExtensionGuestTarget,
    targetDescription: 'Extension guest'
  })
}

const WORKBENCH_DISCOVERY_RETRY_DELAYS_MS = [0, 250, 1_000]

function hasWorkbenchContribution(response, contributionId) {
  if (!response || response.ok !== true || typeof response.body !== 'string') return false
  try {
    const snapshot = JSON.parse(response.body)
    return Array.isArray(snapshot?.extensions) && snapshot.extensions.some((extension) =>
      extension?.id === EXTENSION_ID &&
      Array.isArray(extension?.contributes?.['views.rightSidebar']) &&
      extension.contributes['views.rightSidebar'].some(
        (view) => `extension:${extension.id}/${view?.id}` === contributionId
      )
    )
  } catch {
    return false
  }
}

async function synchronizeWorkbenchContributionDiscovery({
  cdp,
  session,
  workspaceRoot,
  contributionId,
  timeoutMs,
  processState: readProcessState
}) {
  let lastResponse
  try {
    await pollUntil(async () => {
      assertDesktopProcessRunning(readProcessState())
      const evaluated = await sendToWorkbenchSession({
        cdp,
        session,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => {
            const root = document.getElementById('root')
            const bridge = globalThis.kunGui
            if (!root?.hasChildNodes() || !bridge || typeof bridge.extensionGetWorkbench !== 'function') {
              return null
            }
            return bridge.extensionGetWorkbench({ workspaceRoot: ${JSON.stringify(workspaceRoot)} })
          })()`,
          awaitPromise: true,
          returnByValue: true
        },
        timeoutMs,
        processState: readProcessState,
        operation: 'reading the packaged workbench contribution snapshot'
      })
      lastResponse = evaluationValue(
        evaluated,
        'reading the packaged workbench contribution snapshot'
      )
      return hasWorkbenchContribution(lastResponse, contributionId) ? lastResponse : undefined
    }, { timeoutMs, description: `packaged workbench discovery for ${contributionId}` })
  } catch (error) {
    const diagnostic = lastResponse === undefined
      ? 'no bridge response'
      : JSON.stringify(lastResponse).slice(0, 2_000)
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last bridge response: ${diagnostic}`)
  }

  // The bridge response proves that the runtime, registry, workspace grant,
  // and renderer preload are ready. Notify the committed layout effect only
  // after that point, with short retries for the final React commit boundary.
  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Runtime.evaluate',
    params: {
      expression: `(() => {
        for (const delayMs of ${JSON.stringify(WORKBENCH_DISCOVERY_RETRY_DELAYS_MS)}) {
          window.setTimeout(() => window.dispatchEvent(new Event('kun:extensions-changed')), delayMs)
        }
        return true
      })()`,
      returnByValue: true
    },
    timeoutMs,
    processState: readProcessState,
    operation: 'notifying the packaged workbench contribution listener'
  })
}

async function waitForContributionAndClick({
  cdp,
  session,
  contributionId,
  timeoutMs,
  processState: readProcessState
}) {
  // The open View, its Webview, and its toolbar button all carry the same
  // contribution marker. Target the actual workbench control so a second
  // click reliably toggles the surface closed.
  const selector = `button[data-contribution-id="${contributionId}"]`
  const point = await pollUntil(async () => {
    assertDesktopProcessRunning(readProcessState())
    const evaluated = await sendToWorkbenchSession({
      cdp,
      session,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          const element = document.querySelector(${JSON.stringify(selector)})
          if (!(element instanceof HTMLElement) || element.matches(':disabled')) return null
          element.scrollIntoView({ block: 'center', inline: 'center' })
          const rectangle = element.getBoundingClientRect()
          if (rectangle.width <= 0 || rectangle.height <= 0) return null
          return {
            x: rectangle.left + rectangle.width / 2,
            y: rectangle.top + rectangle.height / 2
          }
        })()`,
        returnByValue: true
      },
      timeoutMs,
      processState: readProcessState,
      operation: `locating ${selector}`
    })
    return evaluationValue(evaluated, `locating ${selector}`)
  }, { timeoutMs, description: `workbench contribution ${contributionId}` })

  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x: point.x, y: point.y },
    timeoutMs,
    processState: readProcessState,
    operation: `moving to ${selector}`
  })
  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    },
    timeoutMs,
    processState: readProcessState,
    operation: `pressing ${selector}`
  })
  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    },
    timeoutMs,
    processState: readProcessState,
    operation: `releasing ${selector}`
  })
}

async function waitForContributionTabCloseAndClick({
  cdp,
  session,
  contributionId,
  timeoutMs,
  processState: readProcessState
}) {
  const selector = `.ds-extension-view[data-contribution-id="${contributionId}"]`
  const point = await pollUntil(async () => {
    assertDesktopProcessRunning(readProcessState())
    const evaluated = await sendToWorkbenchSession({
      cdp,
      session,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          const view = document.querySelector(${JSON.stringify(selector)})
          const panel = view?.closest('[role="tabpanel"]')
          const tabId = panel?.getAttribute('aria-labelledby')
          const tab = tabId ? document.getElementById(tabId) : null
          const closeButton = tab?.parentElement?.querySelector('button:not([role="tab"])')
          if (!(closeButton instanceof HTMLElement) || closeButton.matches(':disabled')) return null
          closeButton.scrollIntoView({ block: 'center', inline: 'center' })
          const rectangle = closeButton.getBoundingClientRect()
          if (rectangle.width <= 0 || rectangle.height <= 0) return null
          return {
            x: rectangle.left + rectangle.width / 2,
            y: rectangle.top + rectangle.height / 2
          }
        })()`,
        returnByValue: true
      },
      timeoutMs,
      processState: readProcessState,
      operation: `locating the close control for ${selector}`
    })
    return evaluationValue(evaluated, `locating the close control for ${selector}`)
  }, { timeoutMs, description: `workbench contribution tab close ${contributionId}` })

  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x: point.x, y: point.y },
    timeoutMs,
    processState: readProcessState,
    operation: `moving to the close control for ${selector}`
  })
  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    },
    timeoutMs,
    processState: readProcessState,
    operation: `pressing the close control for ${selector}`
  })
  await sendToWorkbenchSession({
    cdp,
    session,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    },
    timeoutMs,
    processState: readProcessState,
    operation: `releasing the close control for ${selector}`
  })
}

async function inspectGuestSecurity({
  cdp,
  session,
  targetId,
  workbenchSession,
  localFileUrl,
  fetchUrl,
  popupUrl,
  timeoutMs,
  processState: readProcessState
}) {
  const sendGuest = (method, params, operation) => sendToGuestSession({
    cdp,
    session,
    method,
    params,
    timeoutMs,
    processState: readProcessState,
    operation
  })
  await waitForGuestReady(
    cdp,
    session.sessionId,
    timeoutMs,
    readProcessState,
    (method, params) => sendGuest(method, params, 'waiting for the extension guest')
  )

  await sendGuest('Page.enable', {}, 'enabling the Extension guest page domain')
  // Prove sender-bound kun-media loading and seeking under the production CSP
  // before the separate Host network-filter test intentionally bypasses CSP.
  const mediaPlaybackResult = await waitForSuccessfulGuestInspection({
    inspect: () => inspectGuestMediaPlayback(
      cdp,
      session.sessionId,
      (method, params) => sendGuest(method, params, 'loading sender-bound kun-media playback')
    ),
    isSuccessful: (result) => result?.mediaPlaybackMode === 'ok',
    timeoutMs,
    description: 'sender-bound kun-media playback readiness'
  })
  const imagePlaybackResult = await waitForSuccessfulGuestInspection({
    inspect: () => inspectGuestImagePlayback(
      cdp,
      session.sessionId,
      (method, params) => sendGuest(method, params, 'loading a sender-bound kun-media image')
    ),
    isSuccessful: (result) => result?.imagePlaybackMode === 'ok',
    timeoutMs,
    description: 'sender-bound kun-media image readiness'
  })

  // The protocol response carries the production `connect-src 'none'` baseline in
  // addition to the fixture's explicit loopback source. Bypass CSP only after
  // media playback so the Host webRequest filter is the fetch control under test.
  await sendGuest(
    'Page.setBypassCSP',
    { enabled: true },
    'enabling Extension guest CSP bypass for network-filter validation'
  )
  const sendWorkbench = (method, params, operation) => sendToWorkbenchSession({
    cdp,
    session: workbenchSession,
    method,
    params,
    timeoutMs,
    processState: readProcessState,
    operation
  })
  await sendWorkbench('Page.enable', {}, 'enabling the packaged workbench page domain')
  await sendWorkbench(
    'Page.setBypassCSP',
    { enabled: true },
    'enabling workbench CSP bypass for sender-isolation validation'
  )

  let mediaIsolationResult
  try {
    const copiedMediaUrlMode = await inspectMediaUrlFetch(
      cdp,
      workbenchSession.sessionId,
      mediaPlaybackResult.mediaLeaseUrl,
      'checking a copied kun-media URL from the workbench sender',
      (method, params) => sendWorkbench(
        method,
        params,
        'checking a copied kun-media URL from the workbench sender'
      )
    )
    const arbitraryLocalPathMode = await inspectMediaUrlFetch(
      cdp,
      session.sessionId,
      localFileUrl,
      'checking an arbitrary file URL from the extension guest',
      (method, params) => sendGuest(
        method,
        params,
        'checking an arbitrary file URL from the extension guest'
      )
    )
    const releaseMode = await releaseGuestMediaLease(
      cdp,
      session.sessionId,
      mediaPlaybackResult.mediaPlayback?.leaseId,
      (method, params) => sendGuest(method, params, 'releasing the packaged media lease')
    )
    const postReleaseMediaUrlMode = await inspectMediaUrlFetch(
      cdp,
      session.sessionId,
      mediaPlaybackResult.mediaLeaseUrl,
      'checking a released kun-media URL from its original guest',
      (method, params) => sendGuest(
        method,
        params,
        'checking a released kun-media URL from its original guest'
      )
    )
    mediaIsolationResult = {
      copiedMediaUrlMode,
      arbitraryLocalPathMode,
      releaseMode,
      postReleaseMediaUrlMode
    }
  } finally {
    await releaseGuestMediaLease(
      cdp,
      session.sessionId,
      mediaPlaybackResult.mediaPlayback?.leaseId,
      (method, params) => sendGuest(method, params, 'cleaning up the packaged media lease')
    ).catch(() => undefined)
  }

  const { targetInfos: targetsBefore = [] } = await cdp.send('Target.getTargets')
  const beforeTargetIds = new Set(targetsBefore.map((target) => target.targetId).filter(Boolean))
  const observedTargets = []
  const stopObservingTargets = cdp.onEvent('Target.targetCreated', (params) => {
    if (params?.targetInfo) observedTargets.push(params.targetInfo)
  })
  let value
  let targetsAfter = []
  try {
    const evaluated = await sendGuest('Runtime.evaluate', {
      expression: `(async () => {
        const bridgeMethods = ['request', 'notify', 'onNotification', 'registerHandler', 'dispose']
          .filter((name) => typeof globalThis.kunExtension?.[name] === 'function')
        const bridgeOwnKeys = globalThis.kunExtension && typeof globalThis.kunExtension === 'object'
          ? Reflect.ownKeys(globalThis.kunExtension)
              .map((key) => typeof key === 'symbol'
                ? { kind: 'symbol', name: String(key.description ?? '') }
                : { kind: 'string', name: key })
              .sort((left, right) => (left.kind + ':' + left.name).localeCompare(right.kind + ':' + right.name))
          : []
        const bounded = (promise) => new Promise((resolve) => {
          let finished = false
          const finish = (value) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            resolve(value)
          }
          const timer = setTimeout(() => finish({ mode: 'timeout' }), 5_000)
          Promise.resolve(promise).then(
            (result) => finish({ mode: 'ok', result }),
            () => finish({ mode: 'rejected' })
          )
        })

        let bridgeRequestMode = 'unavailable'
        let theme = null
        let viewStateRoundTripMode = 'unavailable'
        let viewState = null
        if (typeof globalThis.kunExtension?.request === 'function') {
          const themeOutcome = await bounded(
            globalThis.kunExtension.request('ui.getTheme', {}, { timeoutMs: 5_000 })
          )
          bridgeRequestMode = themeOutcome.mode === 'ok' && themeOutcome.result && typeof themeOutcome.result === 'object'
            ? 'ok'
            : themeOutcome.mode === 'ok' ? 'invalid' : themeOutcome.mode
          if (bridgeRequestMode === 'ok') theme = themeOutcome.result

          const expectedViewState = {
            schemaVersion: 1,
            marker: 'packaged-desktop-view-state-round-trip',
            nested: { count: 1, enabled: true }
          }
          const viewStateOutcome = await bounded((async () => {
            await globalThis.kunExtension.request(
              'ui.setViewState',
              { value: expectedViewState },
              { timeoutMs: 5_000 }
            )
            return globalThis.kunExtension.request('ui.getViewState', {}, { timeoutMs: 5_000 })
          })())
          viewStateRoundTripMode = viewStateOutcome.mode
          if (viewStateOutcome.mode === 'ok') viewState = viewStateOutcome.result

        }

        let fetchMode = 'unavailable'
        if (typeof globalThis.fetch === 'function') {
          try {
            const outcome = await bounded(globalThis.fetch(${JSON.stringify(fetchUrl)}, {
              cache: 'no-store',
              mode: 'cors'
            }))
            fetchMode = outcome.mode === 'ok' ? 'allowed' : outcome.mode
          } catch {
            fetchMode = 'threw'
          }
        }

        let popupMode = 'unavailable'
        if (typeof globalThis.open === 'function') {
          try {
            const popup = globalThis.open(${JSON.stringify(popupUrl)})
            popupMode = popup === null ? 'denied' : 'allowed'
          } catch {
            popupMode = 'threw'
          }
        }

        return {
          href: globalThis.location.href,
          marker: document.querySelector('[data-kun-packaged-webview-smoke="ready"]')?.textContent?.trim() ?? null,
          bridgeMethods,
          bridgeOwnKeys,
          bridgeRequestMode,
          theme,
          viewStateRoundTripMode,
          viewState,
          hasKunGui: 'kunGui' in globalThis,
          hasElectron: 'electron' in globalThis,
          hasIpcRenderer: 'ipcRenderer' in globalThis,
          hasBuffer: 'Buffer' in globalThis,
          hasRequire: typeof globalThis.require !== 'undefined' || typeof require !== 'undefined',
          hasProcess: typeof globalThis.process !== 'undefined' || typeof process !== 'undefined',
          fetchMode,
          popupMode
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, 'inspecting extension guest security')
    value = evaluationValue(evaluated, 'inspecting extension guest security')
    await delay(POPUP_SETTLE_MS)
    ;({ targetInfos: targetsAfter = [] } = await cdp.send('Target.getTargets'))
  } finally {
    stopObservingTargets()
  }
  return {
    ...value,
    ...mediaPlaybackResult,
    ...imagePlaybackResult,
    ...mediaIsolationResult,
    popupTargets: findUnexpectedPopupTargets({
      beforeTargetIds,
      observedTargets,
      targetsAfter,
      guestTargetId: targetId,
      popupUrl
    })
  }
}

async function waitForSuccessfulGuestInspection({
  inspect,
  isSuccessful,
  timeoutMs,
  description
}) {
  let lastResult
  try {
    return await pollUntil(async () => {
      lastResult = await inspect()
      return isSuccessful(lastResult) ? lastResult : undefined
    }, {
      timeoutMs: Math.min(timeoutMs, GUEST_MEDIA_READY_TIMEOUT_MS),
      description
    })
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
      `last guest inspection: ${JSON.stringify(lastResult ?? null)}`
    )
  }
}

let guestAsyncInspectionSequence = 0

async function runGuestAsyncInspection({
  cdp,
  sessionId,
  sendCommand,
  expression,
  userGesture = false,
  timeoutMs,
  description
}) {
  guestAsyncInspectionSequence += 1
  const resultKey = `__kunPackagedGuestInspection${guestAsyncInspectionSequence}`
  const serializedKey = JSON.stringify(resultKey)
  const send = (method, params) => sendCommand
    ? sendCommand(method, params)
    : cdp.send(method, params, sessionId)
  const start = () => send('Runtime.evaluate', {
      expression: `(() => {
        const key = ${serializedKey}
        globalThis[key] = { state: 'pending' }
        Promise.resolve(${expression}).then(
          (value) => { globalThis[key] = { state: 'fulfilled', value } },
          (error) => {
            globalThis[key] = {
              state: 'rejected',
              error: error instanceof Error ? error.message : String(error)
            }
          }
        )
        return key
      })()`,
      returnByValue: true,
      userGesture
    })
  await start()
  try {
    const completed = await pollUntil(async () => {
      const evaluated = await send('Runtime.evaluate', {
        expression: `globalThis[${serializedKey}] ?? null`,
        returnByValue: true
      })
      const state = evaluationValue(evaluated, description)
      if (state === null || state === undefined) {
        // A guest main-frame navigation replaces the execution context without
        // necessarily invalidating the flattened target session. Restart the
        // inspection in the current context instead of waiting on the orphaned
        // promise from the previous document.
        await start()
        return undefined
      }
      if (state?.state === 'rejected') {
        throw new Error(`${description} rejected: ${String(state.error ?? 'unknown error')}`)
      }
      return state?.state === 'fulfilled' ? { value: state.value } : undefined
    }, { timeoutMs, description })
    return completed.value
  } finally {
    await send('Runtime.evaluate', {
      expression: `delete globalThis[${serializedKey}]`,
      returnByValue: true
    }).catch(() => undefined)
  }
}

async function inspectGuestImagePlayback(cdp, sessionId, sendCommand) {
  const params = {
    expression: `(async () => {
      if (typeof globalThis.kunExtension?.request !== 'function') {
        return { imagePlaybackMode: 'unavailable', imagePlayback: null }
      }
      let image = null
      let lease = null
      try {
        lease = await globalThis.kunExtension.request(
          'media.openViewResource',
          { handleId: ${JSON.stringify(MEDIA_IMAGE_HANDLE_ID)} },
          { timeoutMs: 5_000 }
        )
        image = document.createElement('img')
        image.src = lease.url
        document.body.append(image)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('image metadata timeout')), 5_000)
          image.addEventListener('load', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
          image.addEventListener('error', () => {
            clearTimeout(timer)
            reject(new Error('image element failed'))
          }, { once: true })
        })
        let imageReleaseMode = 'ok'
        try {
          await globalThis.kunExtension.request(
            'media.release',
            { resource: 'lease', leaseId: lease.leaseId },
            { timeoutMs: 5_000 }
          )
        } catch {
          imageReleaseMode = 'rejected'
        }
        return {
          imagePlaybackMode: 'ok',
          imageReleaseMode,
          imagePlayback: {
            scheme: new URL(lease.url).protocol,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            leaseId: lease.leaseId
          }
        }
      } catch (error) {
        if (lease?.leaseId) {
          await globalThis.kunExtension.request(
            'media.release',
            { resource: 'lease', leaseId: lease.leaseId },
            { timeoutMs: 5_000 }
          ).catch(() => undefined)
        }
        return {
          imagePlaybackMode: 'rejected',
          imagePlayback: null,
          imagePlaybackError: error instanceof Error ? error.message : String(error)
        }
      } finally {
        image?.removeAttribute('src')
        image?.remove()
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }
  return runGuestAsyncInspection({
    cdp,
    sessionId,
    sendCommand,
    expression: params.expression,
    userGesture: true,
    timeoutMs: GUEST_MEDIA_READY_TIMEOUT_MS,
    description: 'loading a sender-bound kun-media image under production CSP'
  })
}

async function inspectGuestMediaPlayback(cdp, sessionId, sendCommand) {
  const params = {
    expression: `(async () => {
      if (typeof globalThis.kunExtension?.request !== 'function') {
        return { mediaPlaybackMode: 'unavailable', mediaPlayback: null }
      }
      let audio = null
      let lease = null
      let stage = 'open-lease'
      try {
        lease = await globalThis.kunExtension.request(
          'media.openViewResource',
          { handleId: ${JSON.stringify(MEDIA_PLAYBACK_HANDLE_ID)} },
          { timeoutMs: 5_000 }
        )
        stage = 'load-metadata'
        audio = document.createElement('audio')
        audio.preload = 'auto'
        audio.src = lease.url
        document.body.append(audio)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('media metadata timeout')), 5_000)
          audio.addEventListener('loadedmetadata', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
          audio.addEventListener('error', () => {
            clearTimeout(timer)
            reject(new Error('media element failed'))
          }, { once: true })
          audio.load()
        })
        stage = 'seek'
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('media seek timeout')), 5_000)
          audio.addEventListener('seeked', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
          audio.addEventListener('error', () => {
            clearTimeout(timer)
            reject(new Error('media seek failed'))
          }, { once: true })
          audio.currentTime = 0.5
        })
        return {
          mediaPlaybackMode: 'ok',
          mediaLeaseUrl: lease.url,
          mediaPlayback: {
            scheme: new URL(lease.url).protocol,
            duration: audio.duration,
            currentTime: audio.currentTime,
            readyState: audio.readyState,
            leaseId: lease.leaseId
          }
        }
      } catch (error) {
        const result = {
          mediaPlaybackMode: 'rejected',
          mediaPlayback: null,
          mediaLeaseUrl: null,
          mediaPlaybackError: {
            stage,
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
            mediaErrorCode: audio?.error?.code ?? null,
            mediaErrorMessage: audio?.error?.message ?? null,
            networkState: audio?.networkState ?? null,
            readyState: audio?.readyState ?? null
          }
        }
        if (lease?.leaseId) {
          await globalThis.kunExtension.request(
            'media.release',
            { resource: 'lease', leaseId: lease.leaseId },
            { timeoutMs: 5_000 }
          ).catch(() => undefined)
        }
        return result
      } finally {
        audio?.removeAttribute('src')
        audio?.load()
        audio?.remove()
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }
  return runGuestAsyncInspection({
    cdp,
    sessionId,
    sendCommand,
    expression: params.expression,
    userGesture: true,
    timeoutMs: GUEST_MEDIA_READY_TIMEOUT_MS,
    description: 'loading sender-bound kun-media playback under production CSP'
  })
}

async function waitForGuestReady(cdp, sessionId, timeoutMs, readProcessState, sendCommand) {
  let lastGuestState
  try {
    await pollUntil(async () => {
      assertDesktopProcessRunning(readProcessState())
      const params = {
        expression: `(() => ({
          readyState: document.readyState,
          location: location.href,
          title: document.title,
          body: document.body?.innerText?.slice(0, 1_024) ?? '',
          marker: document.querySelector('[data-kun-packaged-webview-smoke="ready"]')?.textContent?.trim() ?? null,
          bridge: typeof globalThis.kunExtension === 'object'
        }))()`,
        returnByValue: true
      }
      const evaluated = sendCommand
        ? await sendCommand('Runtime.evaluate', params)
        : await cdp.send('Runtime.evaluate', params, sessionId)
      const value = evaluationValue(evaluated, 'waiting for the extension guest')
      lastGuestState = value
      return value?.readyState === 'complete' && value.marker === WEBVIEW_MARKER && value.bridge
    }, { timeoutMs, description: 'loaded kun-extension guest bridge and body marker' })
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
      `last guest state: ${JSON.stringify(lastGuestState ?? null)}`
    )
  }
}

async function inspectMediaUrlFetch(cdp, sessionId, url, description, sendCommand) {
  if (typeof url !== 'string' || url.length === 0) return 'invalid-url'
  const params = {
    expression: `(async () => {
      try {
        const response = await Promise.race([
          globalThis.fetch(${JSON.stringify(url)}, {
            cache: 'no-store',
            headers: { Range: 'bytes=0-43' }
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000))
        ])
        if (!response?.ok) return 'blocked'
        const bytes = await response.arrayBuffer()
        return bytes.byteLength > 0 ? 'allowed' : 'blocked'
      } catch {
        return 'blocked'
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  }
  const evaluated = sendCommand
    ? await sendCommand('Runtime.evaluate', params)
    : await cdp.send('Runtime.evaluate', params, sessionId)
  return evaluationValue(evaluated, description)
}

async function releaseGuestMediaLease(cdp, sessionId, leaseId, sendCommand) {
  if (typeof leaseId !== 'string' || leaseId.length === 0) return 'invalid-lease'
  const params = {
    expression: `(async () => {
      try {
        await globalThis.kunExtension.request(
          'media.release',
          { resource: 'lease', leaseId: ${JSON.stringify(leaseId)} },
          { timeoutMs: 5_000 }
        )
        return 'ok'
      } catch {
        return 'rejected'
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  }
  const evaluated = sendCommand
    ? await sendCommand('Runtime.evaluate', params)
    : await cdp.send('Runtime.evaluate', params, sessionId)
  return evaluationValue(evaluated, 'releasing the packaged media lease')
}

async function createGuestMediaLease(cdp, sessionId, sendCommand) {
  const params = {
    expression: `(async () => globalThis.kunExtension.request(
      'media.openViewResource',
      { handleId: ${JSON.stringify(MEDIA_PLAYBACK_HANDLE_ID)} },
      { timeoutMs: 5_000 }
    ))()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }
  const evaluated = sendCommand
    ? await sendCommand('Runtime.evaluate', params)
    : await cdp.send('Runtime.evaluate', params, sessionId)
  return evaluationValue(evaluated, 'minting a media lease for stale View Session validation')
}

async function assertStaleViewSessionMediaBlocked({
  cdp,
  guestSession,
  guestTargetId,
  workbenchSession,
  timeoutMs,
  processState: readProcessState
}) {
  const sendGuest = (method, params, operation) => sendToGuestSession({
    cdp,
    session: guestSession,
    method,
    params,
    timeoutMs,
    processState: readProcessState,
    operation
  })
  const staleLease = await createGuestMediaLease(
    cdp,
    guestSession.sessionId,
    (method, params) => sendGuest(
      method,
      params,
      'minting a media lease for stale View Session validation'
    )
  )
  if (
    !staleLease ||
    typeof staleLease.url !== 'string' ||
    typeof staleLease.leaseId !== 'string'
  ) {
    throw new Error(`Could not create the stale-session media lease: ${JSON.stringify(staleLease)}`)
  }

  // Close the surface through the workbench, matching the production React
  // lifecycle that unmounts the Webview and disposes its View Session. The
  // guest bridge's dispose() only tears down bridge listeners and is not a UI
  // request to unmount its owning surface.
  await waitForContributionTabCloseAndClick({
    cdp,
    session: workbenchSession,
    contributionId: CONTRIBUTION_ID,
    timeoutMs,
    processState: readProcessState
  })
  const closedGuestTargetId = guestSession.targetId ?? guestTargetId
  await pollUntil(async () => {
    assertDesktopProcessRunning(readProcessState())
    const { targetInfos = [] } = await cdp.send('Target.getTargets')
    return targetInfos.every((target) => target.targetId !== closedGuestTargetId)
  }, { timeoutMs, description: 'disposed packaged Extension View Session' })

  await waitForContributionAndClick({
    cdp,
    session: workbenchSession,
    contributionId: CONTRIBUTION_ID,
    timeoutMs,
    processState: readProcessState
  })
  const replacementTarget = await waitForTarget(
    cdp,
    (target) => isExtensionGuestTarget(target) && target.targetId !== closedGuestTargetId,
    'replacement kun-extension guest for stale View Session validation',
    timeoutMs,
    readProcessState
  )
  const replacementSession = {
    targetId: replacementTarget.targetId,
    sessionId: undefined
  }
  const sendReplacementGuest = (method, params, operation) => sendToGuestSession({
    cdp,
    session: replacementSession,
    method,
    params,
    timeoutMs,
    processState: readProcessState,
    operation
  })
  await waitForGuestReady(
    cdp,
    replacementSession.sessionId,
    timeoutMs,
    readProcessState,
    (method, params) => sendReplacementGuest(
      method,
      params,
      'waiting for the replacement Extension guest'
    )
  )
  await sendReplacementGuest(
    'Page.enable',
    {},
    'enabling the replacement Extension guest page domain'
  )
  await sendReplacementGuest(
    'Page.setBypassCSP',
    { enabled: true },
    'enabling replacement Extension guest CSP bypass'
  )
  const staleViewSessionMode = await inspectMediaUrlFetch(
    cdp,
    replacementSession.sessionId,
    staleLease.url,
    'checking a stale View Session media URL from its replacement guest',
    (method, params) => sendReplacementGuest(
      method,
      params,
      'checking a stale View Session media URL from its replacement guest'
    )
  )
  if (staleViewSessionMode !== 'blocked') {
    throw new Error(
      `Stale View Session reused a kun-media URL: ${String(staleViewSessionMode)}`
    )
  }
}

function findUnexpectedPopupTargets({
  beforeTargetIds,
  observedTargets,
  targetsAfter,
  guestTargetId,
  popupUrl
}) {
  const candidates = new Map()
  for (const target of [...observedTargets, ...targetsAfter]) {
    if (!target?.targetId || beforeTargetIds.has(target.targetId) || target.targetId === guestTargetId) continue
    candidates.set(target.targetId, { ...candidates.get(target.targetId), ...target })
  }
  return [...candidates.values()]
    .filter((target) => (
      target.type === 'page' &&
      (target.openerId === guestTargetId || target.url === popupUrl)
    ))
    .map((target) => ({
      targetId: target.targetId,
      type: target.type,
      url: typeof target.url === 'string' ? target.url : '',
      openerId: typeof target.openerId === 'string' ? target.openerId : undefined
    }))
    .sort((left, right) => left.targetId.localeCompare(right.targetId))
}

function assertGuestSecurityResult(result, networkCanaryRequests = 0) {
  if (!result || typeof result !== 'object') throw new Error('Extension guest returned no security result')
  if (result.marker !== WEBVIEW_MARKER) {
    throw new Error(`Extension guest body marker mismatch: ${String(result.marker)}`)
  }
  const expectedMethods = ['request', 'notify', 'onNotification', 'registerHandler', 'dispose']
  if (JSON.stringify(result.bridgeMethods) !== JSON.stringify(expectedMethods)) {
    throw new Error(`kunExtension bridge is missing methods: ${JSON.stringify(result.bridgeMethods)}`)
  }
  const expectedOwnKeys = [...expectedMethods]
    .sort()
    .map((name) => ({ kind: 'string', name }))
  if (JSON.stringify(result.bridgeOwnKeys) !== JSON.stringify(expectedOwnKeys)) {
    throw new Error(`kunExtension bridge exposes unexpected own keys: ${JSON.stringify(result.bridgeOwnKeys)}`)
  }
  if (result.bridgeRequestMode !== 'ok') {
    throw new Error(`kunExtension bridge request round-trip failed: ${String(result.bridgeRequestMode)}`)
  }
  assertTheme(result.theme)
  const expectedViewState = {
    found: true,
    value: {
      schemaVersion: 1,
      marker: 'packaged-desktop-view-state-round-trip',
      nested: { count: 1, enabled: true }
    }
  }
  if (
    result.viewStateRoundTripMode !== 'ok' ||
    JSON.stringify(result.viewState) !== JSON.stringify(expectedViewState)
  ) {
    throw new Error(
      `kunExtension runtime View-state round-trip failed: ` +
      `${String(result.viewStateRoundTripMode)} ${JSON.stringify(result.viewState)}`
    )
  }
  if (
    result.mediaPlaybackMode !== 'ok' ||
    result.mediaPlayback?.scheme !== 'kun-media:' ||
    !Number.isFinite(result.mediaPlayback?.duration) ||
    result.mediaPlayback.duration <= 0 ||
    result.mediaPlayback.currentTime < 0.4 ||
    result.mediaPlayback.readyState < 1 ||
    typeof result.mediaPlayback.leaseId !== 'string'
  ) {
    throw new Error(
      `kun-media desktop playback/seek failed: ` +
      `${String(result.mediaPlaybackMode)} ${JSON.stringify(result.mediaPlayback)} ` +
      `${JSON.stringify(result.mediaPlaybackError ?? null)}`
    )
  }
  if (
    result.imagePlaybackMode !== 'ok' ||
    result.imagePlayback?.scheme !== 'kun-media:' ||
    result.imagePlayback?.naturalWidth !== 1 ||
    result.imagePlayback?.naturalHeight !== 1 ||
    typeof result.imagePlayback?.leaseId !== 'string'
  ) {
    throw new Error(
      `kun-media desktop image playback failed: ` +
      `${String(result.imagePlaybackMode)} ${JSON.stringify(result.imagePlayback)} ` +
      `${JSON.stringify(result.imagePlaybackError ?? null)}`
    )
  }
  if (result.imageReleaseMode !== 'ok') {
    throw new Error(`Extension guest image lease release failed: ${String(result.imageReleaseMode)}`)
  }
  for (const [label, mode] of [
    ['copied sender URL', result.copiedMediaUrlMode],
    ['arbitrary local file URL', result.arbitraryLocalPathMode],
    ['post-release URL', result.postReleaseMediaUrlMode]
  ]) {
    if (mode !== 'blocked') {
      throw new Error(`Extension guest ${label} was not blocked: ${String(mode)}`)
    }
  }
  if (result.releaseMode !== 'ok') {
    throw new Error(`Extension guest media lease release failed: ${String(result.releaseMode)}`)
  }
  if (result.hasKunGui) throw new Error('Extension guest can see the privileged window.kunGui bridge')
  if (result.hasElectron) throw new Error('Extension guest can see an Electron bridge')
  if (result.hasIpcRenderer) throw new Error('Extension guest can see ipcRenderer')
  if (result.hasBuffer) throw new Error('Extension guest can see Node Buffer')
  if (result.hasRequire) throw new Error('Extension guest can see Node require')
  if (result.hasProcess) throw new Error('Extension guest can see Node process')
  if (result.fetchMode !== 'rejected') {
    throw new Error(`Extension guest loopback fetch was not rejected by the Host filter: ${String(result.fetchMode)}`)
  }
  if (networkCanaryRequests !== 0) {
    throw new Error(`Extension guest reached the loopback network canary (${networkCanaryRequests} requests)`)
  }
  if (result.popupMode !== 'denied') {
    throw new Error(`Extension guest window.open was not blocked: ${String(result.popupMode)}`)
  }
  if (!Array.isArray(result.popupTargets) || result.popupTargets.length !== 0) {
    throw new Error(`Extension guest window.open created a CDP target: ${JSON.stringify(result.popupTargets)}`)
  }
  if (!isExactExtensionGuestUrl(result.href)) {
    throw new Error(`Extension guest has an unexpected origin: ${String(result.href)}`)
  }
}

function assertTheme(theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new Error(`kunExtension Theme is not an object: ${JSON.stringify(theme)}`)
  }
  const expectedKeys = ['kind', 'reducedMotion', 'tokens', 'zoomFactor']
  if (JSON.stringify(Object.keys(theme).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(`kunExtension Theme has unexpected fields: ${JSON.stringify(theme)}`)
  }
  if (!['light', 'dark', 'high-contrast'].includes(theme.kind)) {
    throw new Error(`kunExtension Theme has an invalid kind: ${String(theme.kind)}`)
  }
  if (!theme.tokens || typeof theme.tokens !== 'object' || Array.isArray(theme.tokens)) {
    throw new Error(`kunExtension Theme has invalid tokens: ${JSON.stringify(theme.tokens)}`)
  }
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (!key || typeof value !== 'string') {
      throw new Error(`kunExtension Theme has an invalid token: ${JSON.stringify([key, value])}`)
    }
  }
  if (!Number.isFinite(theme.zoomFactor) || theme.zoomFactor <= 0) {
    throw new Error(`kunExtension Theme has an invalid zoomFactor: ${String(theme.zoomFactor)}`)
  }
  if (typeof theme.reducedMotion !== 'boolean') {
    throw new Error(`kunExtension Theme has invalid reducedMotion: ${String(theme.reducedMotion)}`)
  }
}

function isExactExtensionGuestUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false
  try {
    const url = new URL(rawUrl)
    const queryKeys = [...url.searchParams.keys()]
    return (
      url.protocol === 'kun-extension:' &&
      url.hostname === EXTENSION_ID &&
      url.pathname === '/dist/webview/index.html' &&
      queryKeys.length === 1 &&
      queryKeys[0] === 'kunViewSession' &&
      Boolean(url.searchParams.get('kunViewSession')) &&
      url.hash === ''
    )
  } catch {
    return false
  }
}

async function startNetworkCanary() {
  let requests = 0
  const server = createHttpServer((_request, response) => {
    requests += 1
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('cache-control', 'no-store')
    response.end('network access must remain blocked')
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  if (!port) {
    await new Promise((resolvePromise) => server.close(resolvePromise))
    throw new Error('Could not allocate the desktop smoke network canary')
  }
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    port,
    url: `${origin}/extension-network-canary`,
    popupUrl: `${origin}/extension-popup-canary`,
    requestCount: () => requests,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise())
      server.closeAllConnections?.()
    })
  }
}

function evaluationValue(evaluated, operation) {
  if (evaluated.exceptionDetails) {
    const description = evaluated.exceptionDetails.exception?.description ??
      evaluated.exceptionDetails.text ??
      'unknown exception'
    throw new Error(`CDP Runtime.evaluate failed while ${operation}: ${description}`)
  }
  return evaluated.result?.value
}

async function pollUntil(operation, { timeoutMs, description, intervalMs = 250 }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await operation()
    if (result) return result
    await delay(intervalMs)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function processState(child) {
  return {
    exitCode: child.exitCode,
    signalCode: child.signalCode
  }
}

function assertDesktopProcessRunning(state) {
  if (state.exitCode !== null || state.signalCode !== null) {
    throw new Error(
      `Packaged Electron exited before the desktop smoke completed ` +
      `(exit=${String(state.exitCode)}, signal=${String(state.signalCode)})`
    )
  }
}

async function terminateProcessTree(child, platform, {
  timeoutMs = MAX_CLEANUP_TIMEOUT_MS,
  ports = [],
  spawnSyncCommand = spawnSync,
  killProcessGroup = (pid, signal) => process.kill(-pid, signal),
  verifyPortsClosed = waitForPortsClosed
} = {}) {
  const deadline = Date.now() + timeoutMs
  let terminationDiagnostic

  // Never signal a stale PID. If the launcher is already gone, only verify that
  // its isolated runtime/CDP ports disappeared and report an orphan if not.
  if (isProcessRunning(child)) {
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
      terminationDiagnostic = 'Packaged Electron has no safe process ID for cleanup'
    } else if (platform === 'win32') {
      const result = spawnSyncCommand('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: Math.max(1, Math.min(10_000, remainingMilliseconds(deadline))),
        killSignal: 'SIGKILL',
        windowsHide: true
      })
      if (result.error?.code === 'ETIMEDOUT') {
        terminationDiagnostic = `taskkill timed out for packaged Electron PID ${child.pid}`
      } else if (result.error) {
        terminationDiagnostic = `taskkill failed for packaged Electron PID ${child.pid}: ${result.error.message}`
      } else if (result.status !== 0) {
        terminationDiagnostic = `taskkill exited with status ${String(result.status)} for packaged Electron PID ${child.pid}`
      }
      await waitForProcessExit(child, Math.min(5_000, remainingMilliseconds(deadline)))
    } else {
      terminationDiagnostic = signalLiveProcess(child, 'SIGTERM', killProcessGroup)
      await waitForProcessExit(child, Math.min(5_000, remainingMilliseconds(deadline)))
      if (isProcessRunning(child)) {
        terminationDiagnostic = signalLiveProcess(child, 'SIGKILL', killProcessGroup) ?? terminationDiagnostic
        await waitForProcessExit(child, remainingMilliseconds(deadline))
      }
    }
  }

  const failures = []
  if (isProcessRunning(child)) {
    failures.push(
      terminationDiagnostic ?? `Packaged Electron PID ${String(child.pid)} did not exit before cleanup timeout`
    )
  }
  try {
    await verifyPortsClosed(ports, remainingMilliseconds(deadline))
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  if (failures.length > 0) throw new Error(failures.join('; '))
}

function signalLiveProcess(child, signal, killProcessGroup) {
  if (!isProcessRunning(child)) return undefined
  try {
    killProcessGroup(child.pid, signal)
    return undefined
  } catch (groupError) {
    if (!isProcessRunning(child)) return undefined
    try {
      if (child.kill(signal)) return undefined
    } catch (childError) {
      return `Could not send ${signal} to packaged Electron PID ${child.pid}: ${childError instanceof Error ? childError.message : String(childError)}`
    }
    return `Could not send ${signal} to packaged Electron PID ${child.pid}: ${groupError instanceof Error ? groupError.message : String(groupError)}`
  }
}

function isProcessRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

function remainingMilliseconds(deadline) {
  return Math.max(0, deadline - Date.now())
}

async function waitForProcessExit(child, timeoutMs) {
  if (!isProcessRunning(child)) return true
  if (timeoutMs <= 0) return false
  return new Promise((resolvePromise) => {
    const finish = (exited) => {
      clearTimeout(timer)
      child.off?.('exit', onExit)
      resolvePromise(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    if (!isProcessRunning(child)) finish(true)
  })
}

async function waitForPortsClosed(ports, timeoutMs) {
  const remainingPorts = [...new Set(ports)]
    .filter((port) => Number.isSafeInteger(port) && port > 0 && port <= 65_535)
  if (remainingPorts.length === 0) return
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (true) {
    const openPorts = []
    for (const port of remainingPorts) {
      if (await isLoopbackPortOpen(port)) openPorts.push(port)
    }
    if (openPorts.length === 0) return
    if (Date.now() >= deadline) {
      throw new Error(
        `Packaged Electron left isolated loopback port(s) open: ${openPorts.join(', ')}; ` +
        'refusing to signal an exited launcher PID because it may have been reused'
      )
    }
    await delay(Math.min(100, Math.max(1, remainingMilliseconds(deadline))))
  }
}

function isLoopbackPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(250, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.unref()
  })
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise())
  })
  if (!port) throw new Error('Could not allocate a desktop smoke CDP port')
  return port
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function positiveIntegerArgument(name, fallback) {
  const raw = argumentValue(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

module.exports = {
  CONTRIBUTION_ID,
  WEBVIEW_MARKER,
  CdpConnection,
  assertGuestSecurityResult,
  createDesktopLaunchPlan,
  createIsolatedEnvironment,
  desktopApplicationEntry,
  desktopResourceCandidates,
  desktopSmokeSettings,
  desktopSmokeWorkspaceParent,
  resolvedDesktopResourceCandidates,
  desktopUserDataCandidates,
  findUnexpectedPopupTargets,
  hasWorkbenchContribution,
  WORKBENCH_DISCOVERY_RETRY_DELAYS_MS,
  runGuestAsyncInspection,
  sendToGuestSession,
  synchronizeWorkbenchContributionDiscovery,
  waitForSuccessfulGuestInspection,
  isExtensionGuestTarget,
  isWorkbenchTarget,
  platformDesktopArguments,
  resolveDesktopLaunchSelection,
  runPackagedKun,
  terminateProcessTree,
  waitForPortsClosed
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
