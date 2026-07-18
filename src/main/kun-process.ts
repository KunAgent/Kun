import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  isKunRuntimeInsecure,
  getKunRuntimeSettings,
  getModelProviderSettings,
  resolveModelProviderProxyUrl,
  resolveKunRuntimeSettings,
  type ModelProviderProfileV1,
  type KunRuntimeSettingsV1,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildKunServeArgs,
  resolveKunExecutable,
  shouldRunKunServeAsElectronChild
} from './resolve-kun-binary'
import { resolveCodexOAuthApiKey } from './codex-auth'
import {
  KunConfigSchema,
  type KunConfig,
  KunServeConfigSchema,
  ModelConfigSchema,
  ContextCompactionConfigSchema,
  QualityConfigSchema,
  RuntimeTuningConfigSchema,
  RolesConfigSchema
} from '../../kun/src/config/kun-config.js'
import { HooksConfigSchema } from '../../kun/src/hooks/hook-config.js'
import {
  AttachmentsCapabilityConfig,
  ComputerUseCapabilityConfig,
  ImageGenCapabilityConfig,
  InstructionsCapabilityConfig,
  McpCapabilityConfig,
  McpServerConfig,
  MemoryCapabilityConfig,
  MusicGenCapabilityConfig,
  SkillsCapabilityConfig,
  SpeechGenCapabilityConfig,
  SubagentsCapabilityConfig,
  VideoGenCapabilityConfig,
  WebCapabilityConfig
} from '../../kun/src/contracts/capabilities.js'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { defaultKunDataDir } from './runtime/kun-adapter'
import { resolveClaudeBinary } from './agent-sdk-installer'
import { appendManagedLogLine } from './logger'
import {
  KunProcessController,
  type KunUnexpectedExitInfo
} from './runtime/kun-process-controller'
import {
  waitForKunStartup
} from './runtime/kun-runtime-health-monitor'
import {
  contextCompactionConfigForRuntime,
  modelConfigForRuntime,
  providersConfigForRuntime,
  rolesConfigForRuntime,
  storageConfigForRuntime,
  tokenEconomyConfigForRuntime,
  toolOutputLimitsConfigForRuntime
} from './runtime/kun-runtime-model-config'
import {
  computerUseConfigForRuntime,
  imageGenConfigForRuntime,
  musicGenConfigForRuntime,
  qualityConfigForRuntime,
  runtimeTuningConfigForRuntime,
  speechGenConfigForRuntime,
  videoGenConfigForRuntime
} from './runtime/kun-runtime-capability-config'
import {
  buildGuiScheduleKunMcpServer,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  readGuiManagedMcpServers,
  readJsonObjectIfExists,
  skillCapabilityConfigForRuntime
} from './runtime/kun-runtime-mcp-config'
import { availableBundledExtensionsDirectory } from './bundled-extension-resources'
import { subagentProfilesForRuntime } from './runtime/kun-runtime-subagent-config'
import { syncGuiManagedKunConfig } from './runtime/kun-runtime-config-service'

export { subagentProfilesForRuntime } from './runtime/kun-runtime-subagent-config'
export { syncGuiManagedKunConfig } from './runtime/kun-runtime-config-service'

export type { KunUnexpectedExitInfo } from './runtime/kun-process-controller'
export { resolveKunStartupTimeoutMs } from './runtime/kun-runtime-health-monitor'

/**
 * Called when a READY kun child exits without the GUI asking for it.
 * Startup failures are excluded: those are already reported to the
 * caller of startKunChild via the thrown error.
 */
export function setKunUnexpectedExitHandler(
  handler: ((info: KunUnexpectedExitInfo) => void) | null
): void {
  processController.setUnexpectedExitHandler(handler)
}

const execFileAsync = promisify(execFile)
const KUN_STOP_GRACE_MS = 5_000
const KUN_STOP_FORCE_MS = 1_000
const STDERR_TAIL_MAX_CHARS = 32_768
const MAX_TCP_PORT = 65_535

type KunLogStream = 'stdout' | 'stderr' | 'lifecycle'
type KunChildLogCapture = {
  captureStdout: (chunk: Buffer | string) => void
  captureStderr: (chunk: Buffer | string) => void
  logLifecycle: (message: string) => void
  close: () => Promise<void>
}

const processController = new KunProcessController<KunChildLogCapture>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function appendTail(current: string, nextChunk: string, maxChars = STDERR_TAIL_MAX_CHARS): string {
  const combined = `${current}${nextChunk}`
  return combined.length > maxChars ? combined.slice(-maxChars) : combined
}

function formatKunLogLine(
  stream: KunLogStream,
  pid: number | undefined,
  message: string
): string {
  const stamp = new Date().toISOString()
  const pidLabel = typeof pid === 'number' ? `kun pid=${pid}` : 'kun'
  return `[${stamp}] [${stream.toUpperCase()}] [${pidLabel}] ${message}\n`
}

function normalizeCapturedChunk(chunk: Buffer | string): string {
  return String(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function createKunChildLogCapture(pid: number | undefined): KunChildLogCapture {
  let stdoutRemainder = ''
  let stderrRemainder = ''
  let closed = false
  let pending = Promise.resolve()

  const writeLine = (stream: KunLogStream, message: string): void => {
    pending = pending
      .then(() => appendManagedLogLine('kun', formatKunLogLine(stream, pid, message)))
      .catch(() => undefined)
  }

  const captureChunk = (
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string
  ): void => {
    if (closed) return
    const text = normalizeCapturedChunk(chunk)
    const buffered = `${stream === 'stdout' ? stdoutRemainder : stderrRemainder}${text}`
    const parts = buffered.split('\n')
    const remainder = parts.pop() ?? ''
    if (stream === 'stdout') {
      stdoutRemainder = remainder
    } else {
      stderrRemainder = remainder
    }
    for (const part of parts) {
      writeLine(stream, part)
    }
  }

  return {
    captureStdout(chunk) {
      captureChunk('stdout', chunk)
    },
    captureStderr(chunk) {
      captureChunk('stderr', chunk)
    },
    logLifecycle(message) {
      if (closed) return
      writeLine('lifecycle', message)
    },
    async close() {
      if (closed) {
        await pending
        return
      }
      closed = true
      if (stdoutRemainder) {
        writeLine('stdout', stdoutRemainder)
        stdoutRemainder = ''
      }
      if (stderrRemainder) {
        writeLine('stderr', stderrRemainder)
        stderrRemainder = ''
      }
      await pending
    }
  }
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

function resolveNodeScriptCommand(command: string): string {
  if (command !== process.execPath) return command
  if (process.platform !== 'darwin') return command
  return resolveClawScheduleMcpCommand({
    appPath: app.getAppPath(),
    execPath: command,
    isPackaged: app.isPackaged
  })
}

export function resolveKunDataDir(runtime: { dataDir: string }): string {
  const trimmed = runtime.dataDir?.trim()
  if (trimmed) return expandHomePath(trimmed)
  return defaultKunDataDir()
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}

export function isKunChildRunning(): boolean {
  return processController.isRunning()
}

function isCurrentKunChildPid(pid: number): boolean {
  return processController.isCurrentPid(pid)
}

/**
 * Resolve once any in-flight kun launch has settled — whether it became
 * ready or failed. The settings/MCP-apply paths use this to avoid
 * SIGTERM-ing a child that is still inside its (deliberately generous)
 * startup window: interrupting a slow-but-healthy boot only restarts the
 * clock and is what turns one slow start into the #544 restart storm.
 *
 * Deadlock-safe by construction: `kunStartPromise` is only set once a launch
 * has already passed the settings-apply gate, so an apply that awaits it can
 * never be the thing that launch is itself waiting on.
 */
export function waitForKunStartupSettled(): Promise<void> {
  return processController.waitForStartupSettled()
}

export function startKunChild(settings: AppSettingsV1): Promise<void> {
  return processController.start(async () => {
    const runtime = resolveKunRuntimeSettings(settings)
    if (isKunChildRunning() || !runtime.autoStart) return
    await startKunChildOnce(settings, runtime)
  })
}

async function startKunChildOnce(
  settings: AppSettingsV1,
  runtime: KunRuntimeSettingsV1
): Promise<void> {
  if (processController.logCapture) {
    await processController.logCapture.close()
    processController.logCapture = null
  }
  const root = appRoot()
  const resolution = resolveKunExecutable(root, runtime.binaryPath)
  if (resolution.command === process.execPath && !existsSync(resolution.args[0])) {
    throw new Error(
      `Kun runtime build is missing at ${resolution.args[0]}. Run \`npm run build:kun\` before starting the GUI.`
    )
  }
  const dataDir = resolveKunDataDir(runtime)
  await syncGuiManagedKunConfig(dataDir, runtime, {
    scheduleMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    }
  })
  processController.lastResolvedBinary = resolution.command === process.execPath
    ? resolution.args.join(' ')
    : resolution.command
  const args = buildKunServeArgs({
    resolution,
    host: '127.0.0.1',
    port: runtime.port,
    dataDir,
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    tokenEconomyMode: runtime.tokenEconomyMode,
    insecure: isKunRuntimeInsecure(runtime)
  })
  // On macOS, libnut links AppKit and calls `[NSApplication sharedApplication]`
  // on its first screen-grab/mouse/keyboard call. That promotes a pure-Node
  // (ELECTRON_RUN_AS_NODE) child to a regular Cocoa app and a second Kun icon
  // appears in the Dock. In dev, when computer-use is enabled, we instead
  // spawn kun as a real Electron instance so it can call `app.dock.hide()`
  // itself (see kun/src/cli/serve-entry.ts). Packaged .app executables are not
  // generic Electron script runners: passing serve-entry.js to the main app
  // launches the GUI process instead of kun serve, so packaged builds must use
  // the Node helper path even when computer-use is enabled.
  const runAsElectron = shouldRunKunServeAsElectronChild({
    platform: process.platform,
    isPackaged: app.isPackaged,
    computerUseEnabled: runtime.computerUse?.enabled === true
  })
  const command = runAsElectron ? resolution.command : resolveNodeScriptCommand(resolution.command)
  // When the active provider is Codex, runtime.apiKey holds JSON-encoded OAuth
  // credentials; unwrap to the bare access token so the default client sends a
  // valid Bearer (the Codex headers are written to serve.headers in config).
  const defaultClientApiKey = resolveCodexOAuthApiKey(runtime.apiKey).apiKey
  // When the runtime's own (default) provider is the Claude subscription, tell
  // the runtime so its dispatch routes default-provider turns (thread.providerId
  // absent or equal to it) to the embedded SDK instead of the HTTP default.
  const activeProviderKind = (getModelProviderSettings(settings).providers as ModelProviderProfileV1[]).find(
    (provider) => provider.id?.trim() === getKunRuntimeSettings(settings).providerId.trim()
  )?.kind
  // Point the runtime at the on-demand Claude Code binary (the ~222MB binary is
  // not bundled; it's downloaded into userData). Absent in dev when it's still
  // resolvable from kun/node_modules — the SDK auto-resolves it there.
  const claudeBinary = resolveClaudeBinary(app.getPath('userData'), [join(appRoot(), 'kun')])
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    KUN_RUNTIME_TOKEN: runtime.runtimeToken,
    DEEPSEEK_API_KEY: defaultClientApiKey || process.env.DEEPSEEK_API_KEY || '',
    ...(activeProviderKind === 'agent-sdk' ? { KUN_RUNTIME_PROVIDER_KIND: 'agent-sdk' } : {}),
    ...(claudeBinary ? { KUN_CLAUDE_BINARY: claudeBinary } : {})
  }
  const bundledExtensionsDirectory = availableBundledExtensionsDirectory({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: root
  })
  if (bundledExtensionsDirectory) {
    childEnv.KUN_BUNDLED_EXTENSIONS_DIR = bundledExtensionsDirectory
  }
  if (!runAsElectron) childEnv.ELECTRON_RUN_AS_NODE = '1'
  else delete childEnv.ELECTRON_RUN_AS_NODE
  processController.child = spawn(command, args, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const startedChild = processController.child
  processController.childPort = runtime.port
  const startedLogCapture = createKunChildLogCapture(startedChild.pid)
  processController.logCapture = startedLogCapture
  processController.stderrTail = ''
  startedLogCapture.logLifecycle(`spawned on port ${runtime.port} using data dir ${dataDir}`)
  startedChild.stdout?.on('data', startedLogCapture.captureStdout)
  startedChild.stderr?.on('data', (chunk: Buffer | string) => {
    processController.stderrTail = appendTail(
      processController.stderrTail,
      normalizeCapturedChunk(chunk)
    )
    startedLogCapture.captureStderr(chunk)
  })
  startedChild.on('exit', (code, signal) => {
    startedLogCapture.logLifecycle(
      signal
        ? `exited with signal ${signal}`
        : `exited with code ${code ?? 'unknown'}`
    )
    void startedLogCapture.close()
    processController.clearChild(startedChild)
    if (processController.shouldReportUnexpectedExit(startedChild)) {
      processController.reportUnexpectedExit({
        code: code ?? null,
        signal: signal ?? null,
        stderrTail: processController.stderrTail
      })
    }
  })
  startedChild.on('error', (error) => {
    startedLogCapture.logLifecycle(
      `process error: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  try {
    await waitForKunStartup(startedChild, runtime.port)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    startedLogCapture.logLifecycle(`startup failed before ready: ${message}`)
    if (processController.child === startedChild) {
      await stopKunChildAndWait()
    }
    throw error
  }
  processController.markReady(startedChild)
  startedLogCapture.logLifecycle(`ready marker received on port ${runtime.port}`)
}

export async function stopKunChildAndWait(): Promise<void> {
  if (!processController.child) {
    if (processController.logCapture) {
      const capture = processController.logCapture
      processController.logCapture = null
      await capture.close()
    }
    return
  }
  const stoppingChild = processController.child
  processController.markIntentionalStop(stoppingChild)
  const pid = stoppingChild.pid
  const capture = processController.logCapture
  if (stoppingChild.exitCode === null && stoppingChild.signalCode === null) {
    try {
      stoppingChild.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  const exited = await waitForChildExit(stoppingChild, KUN_STOP_GRACE_MS)
  if (!exited) {
    try {
      if (pid) process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
    await waitForChildExit(stoppingChild, KUN_STOP_FORCE_MS)
  }
  processController.clearChild(stoppingChild)
  if (capture) {
    processController.logCapture = null
    await capture.close()
  }
}

function waitForChildExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => settle(false), timeoutMs)
    const settle = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.removeListener('exit', onExit)
      process.removeListener('error', onError)
      resolve(exited)
    }
    const onExit = (): void => settle(true)
    const onError = (): void => settle(true)
    process.once('exit', onExit)
    process.once('error', onError)
  })
}

export async function reclaimKunPort(
  port: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (port <= 0) return { ok: true }
  if (await canBindTcpPort(port, '127.0.0.1')) return { ok: true }
  if (await killStaleKunOnPort(port) && await canBindTcpPort(port, '127.0.0.1')) {
    return { ok: true }
  }
  return { ok: false, message: `port ${port} is in use` }
}

export async function resolveAvailableKunPort(
  preferredPort: number
): Promise<{ port: number; changed: boolean; message?: string }> {
  if (preferredPort > 0) {
    // A temporarily unresponsive managed child still owns its configured
    // endpoint. Moving settings to another port here strands the live child
    // and makes every concurrent request launch/probe a port with no server.
    if (isKunChildRunning() && processController.childPort === preferredPort) {
      return { port: preferredPort, changed: false }
    }
    if (await canBindTcpPort(preferredPort, '127.0.0.1')) {
      return { port: preferredPort, changed: false }
    }
    // Prefer reclaiming the configured port from a stale kun left by a
    // crashed previous app run over silently moving to a new port.
    if (
      await killStaleKunOnPort(preferredPort) &&
      await canBindTcpPort(preferredPort, '127.0.0.1')
    ) {
      return { port: preferredPort, changed: false }
    }
    for (let port = preferredPort + 1; port <= MAX_TCP_PORT; port += 1) {
      if (await canBindTcpPort(port, '127.0.0.1')) {
        return {
          port,
          changed: true,
          message: `port ${preferredPort} is in use`
        }
      }
    }
  }
  const port = await allocateTcpPort('127.0.0.1')
  return {
    port,
    changed: true,
    ...(preferredPort > 0 ? { message: `port ${preferredPort} is in use` } : {})
  }
}

/**
 * Kill a stale kun serve process from a previous app run that is still
 * holding the configured port. Only processes whose command line looks
 * like our serve entry are touched; anything else keeps the port and we
 * fall back to allocating a different one.
 *
 * Safe by construction on every platform: any failure to positively
 * identify the holder as our own serve-entry leaves it untouched and the
 * caller allocates a different port instead.
 */
async function killStaleKunOnPort(port: number): Promise<boolean> {
  const pids = await listListeningPidsOnPort(port)
  let reclaimed = false
  for (const pid of pids) {
    if (isCurrentKunChildPid(pid)) continue
    let command = ''
    try {
      command = await processCommandLine(pid)
    } catch {
      continue
    }
    if (!command.includes('serve-entry')) continue
    void appendManagedLogLine(
      'kun',
      formatKunLogLine('lifecycle', pid, `killing stale kun process holding port ${port}`)
    )
    if (await terminateStalePid(pid)) reclaimed = true
  }
  return reclaimed
}

/**
 * PIDs listening on `port`, excluding our own process. Uses `lsof` on
 * macOS/Linux and `netstat -ano` on Windows.
 */
async function listListeningPidsOnPort(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano'], {
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 8 * 1024 * 1024
      })
      return parseListeningPidsFromNetstat(stdout, port)
    } catch {
      return []
    }
  }
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
    return stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  } catch {
    return []
  }
}

/**
 * Parse `netstat -ano` output into the PIDs holding a LISTENING TCP socket
 * on `port`. Columns are `Proto  Local  Foreign  State  PID`; UDP rows
 * (no State column) and non-matching ports are ignored. Matches both IPv4
 * (`127.0.0.1:<port>`) and IPv6 (`[::1]:<port>`) local addresses.
 */
export function parseListeningPidsFromNetstat(stdout: string, port: number): number[] {
  const pids = new Set<number>()
  for (const raw of stdout.split(/\r?\n/)) {
    const cols = raw.trim().split(/\s+/)
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue
    if (cols[3].toUpperCase() !== 'LISTENING') continue
    if (!cols[1].endsWith(`:${port}`)) continue
    const pid = Number(cols[cols.length - 1])
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid)
  }
  return [...pids]
}

/** Read a process's full command line (best effort, platform-specific). */
async function processCommandLine(pid: number): Promise<string> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`
      ],
      { windowsHide: true, timeout: 5_000 }
    )
    return stdout.trim()
  }
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='])
  return stdout.trim()
}

/** Terminate a positively-identified stale kun process. */
async function terminateStalePid(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5_000
      })
      return true
    } catch {
      // taskkill exits non-zero when the PID is already gone — treat the
      // port as reclaimed only if the process really is no longer alive.
      return await waitForPidExit(pid, 0)
    }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }
  if (!(await waitForPidExit(pid, 2_000))) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
    await waitForPidExit(pid, 1_000)
  }
  return true
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    if (Date.now() >= deadline) return false
    await sleep(100)
  }
}

function canBindTcpPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const server = createServer()
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      resolve(available)
    }
    server.unref()
    server.once('error', () => settle(false))
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => settle(true))
    })
  })
}

function allocateTcpPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const cleanup = (): void => {
      server.removeAllListeners('error')
      server.removeAllListeners('listening')
    }
    server.unref()
    server.once('error', (error) => {
      cleanup()
      reject(error)
    })
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        cleanup()
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('failed to allocate an available Kun port'))
      })
    })
  })
}
