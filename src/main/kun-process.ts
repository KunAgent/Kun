import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  defaultKunTokenEconomySettings,
  isKunRuntimeInsecure,
  getKunRuntimeSettings,
  getModelProviderSettings,
  resolveModelProviderProxyUrl,
  resolveKunRuntimeSettings,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1,
  type KunRuntimeSettingsV1,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildKunServeArgs,
  resolveKunExecutable
} from './resolve-kun-binary'
import {
  KunConfigSchema,
  KunServeConfigSchema,
  ModelConfigSchema,
  ContextCompactionConfigSchema,
  QualityConfigSchema,
  RuntimeTuningConfigSchema
} from '../../kun/src/config/kun-config.js'
import { HooksConfigSchema } from '../../kun/src/hooks/hook-config.js'
import {
  AttachmentsCapabilityConfig,
  ComputerUseCapabilityConfig,
  ImageGenCapabilityConfig,
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
  buildClawScheduleMcpArgs,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { defaultKunDataDir } from './runtime/kun-adapter'
import { isKunHealthResponseBody } from './kun-health'
import { appendManagedLogLine } from './logger'
import {
  comparableSkillRootPath,
  guiSkillManagedComparablePaths,
  guiSkillRootsForRuntime,
  normalizeSkillRootPath
} from './services/skill-service'

let child: ChildProcess | null = null
let childLogCapture: KunChildLogCapture | null = null
let lastResolvedBinary: string | null = null
let kunStartPromise: Promise<void> | null = null
let childStderrTail = ''
/** Children killed on purpose (stop/quit/settings restart) — their exit is not a crash. */
const intentionalStops = new WeakSet<ChildProcess>()
/** Children that completed the ready handshake — only their exits count as runtime crashes. */
const readyChildren = new WeakSet<ChildProcess>()

export type KunUnexpectedExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

let onUnexpectedKunExit: ((info: KunUnexpectedExitInfo) => void) | null = null

/**
 * Called when a READY kun child exits without the GUI asking for it.
 * Startup failures are excluded: those are already reported to the
 * caller of startKunChild via the thrown error.
 */
export function setKunUnexpectedExitHandler(
  handler: ((info: KunUnexpectedExitInfo) => void) | null
): void {
  onUnexpectedKunExit = handler
}

const execFileAsync = promisify(execFile)
const KUN_READY_PREFIX = 'KUN_READY '
const KUN_STARTUP_TIMEOUT_FLOOR_MS = 15_000
const KUN_STARTUP_TIMEOUT_CEILING_MS = 600_000

/**
 * How long to wait for a freshly spawned kun to report ready before giving
 * up and killing it. kun emits its ready marker only after the HTTP server
 * is actually listening, which it does only after sqlite opens, the thread
 * store finishes its backfill, usage carryover replays every thread's
 * events, and the MCP fast-connect race runs. On a slow disk (Windows +
 * antivirus scans) with a large history this routinely exceeds 45s, leaving
 * the runtime stuck in a "did not report ready within 45000ms" → SIGTERM →
 * respawn loop (#188, #544).
 *
 * A generous ceiling is free on fast machines: the parallel /health probe
 * in waitForKunStartup settles the moment the server responds, and a process
 * that actually crashes rejects immediately via its exit event rather than
 * waiting out the timeout. Only a slow-but-progressing boot uses the extra
 * runway. Windows gets the larger default; everything is overridable via the
 * KUN_STARTUP_TIMEOUT_MS env var (milliseconds, clamped to 15s–10min) for
 * extreme cases without a rebuild.
 */
export function resolveKunStartupTimeoutMs(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): number {
  const raw = env.KUN_STARTUP_TIMEOUT_MS
  if (raw && raw.trim()) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) {
      return Math.min(
        KUN_STARTUP_TIMEOUT_CEILING_MS,
        Math.max(KUN_STARTUP_TIMEOUT_FLOOR_MS, Math.floor(parsed))
      )
    }
  }
  return platform === 'win32' ? 90_000 : 60_000
}

const KUN_STARTUP_TIMEOUT_MS = resolveKunStartupTimeoutMs(process.platform, process.env)
const KUN_STARTUP_HEALTH_POLL_MS = 500
const KUN_STARTUP_HEALTH_REQUEST_TIMEOUT_MS = 1_000
const KUN_STOP_GRACE_MS = 5_000
const KUN_STOP_FORCE_MS = 1_000
const STDERR_TAIL_MAX_CHARS = 32_768
const GUI_SCHEDULE_MCP_TIMEOUT_MS = 5_000
const MAX_TCP_PORT = 65_535
const DEFAULT_KUN_MODEL_PROFILES: Record<string, Record<string, unknown>> = {
  'deepseek-v4-pro': {
    contextWindowTokens: 1_000_000,
    contextCompaction: {
      softThreshold: 980_000,
      hardThreshold: 990_000
    },
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text']
  },
  'deepseek-v4-flash': {
    aliases: ['deepseek-chat', 'deepseek-reasoner'],
    contextWindowTokens: 1_000_000,
    contextCompaction: {
      softThreshold: 980_000,
      hardThreshold: 990_000
    },
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text']
  }
}

type KunLogStream = 'stdout' | 'stderr' | 'lifecycle'
type KunChildLogCapture = {
  captureStdout: (chunk: Buffer | string) => void
  captureStderr: (chunk: Buffer | string) => void
  logLifecycle: (message: string) => void
  close: () => Promise<void>
}

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
  return child !== null && child.exitCode === null && child.signalCode === null
}

function isCurrentKunChildPid(pid: number): boolean {
  return Boolean(child?.pid === pid && isKunChildRunning())
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
  return kunStartPromise ? kunStartPromise.catch(() => undefined) : Promise.resolve()
}

export function startKunChild(settings: AppSettingsV1): Promise<void> {
  if (kunStartPromise) return kunStartPromise
  const runtime = resolveKunRuntimeSettings(settings)
  if (isKunChildRunning()) return Promise.resolve()
  if (!runtime.autoStart) return Promise.resolve()
  let promise: Promise<void>
  promise = startKunChildOnce(settings, runtime).finally(() => {
    if (kunStartPromise === promise) kunStartPromise = null
  })
  kunStartPromise = promise
  return promise
}

async function startKunChildOnce(
  settings: AppSettingsV1,
  runtime: KunRuntimeSettingsV1
): Promise<void> {
  if (childLogCapture) {
    await childLogCapture.close()
    childLogCapture = null
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
  lastResolvedBinary = resolution.command === process.execPath
    ? resolution.args.join(' ')
    : resolution.command
  const args = buildKunServeArgs({
    resolution,
    host: '127.0.0.1',
    port: runtime.port,
    dataDir,
    baseUrl: runtime.baseUrl,
    modelProxyUrl: resolveModelProviderProxyUrl(settings),
    endpointFormat: runtime.endpointFormat,
    model: runtime.model,
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    tokenEconomyMode: runtime.tokenEconomyMode,
    insecure: isKunRuntimeInsecure(runtime)
  })
  // On macOS, libnut links AppKit and calls `[NSApplication sharedApplication]`
  // on its first screen-grab/mouse/keyboard call. That promotes a pure-Node
  // (ELECTRON_RUN_AS_NODE) child to a regular Cocoa app and a second Kun icon
  // appears in the Dock. When computer-use is enabled we instead spawn kun as
  // a real Electron instance so it can call `app.dock.hide()` itself (see
  // kun/src/cli/serve-entry.ts). The extra Chromium overhead is only paid
  // when the user actually opted into host control.
  const runAsElectron = process.platform === 'darwin' && runtime.computerUse?.enabled === true
  const command = runAsElectron ? resolution.command : resolveNodeScriptCommand(resolution.command)
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    KUN_RUNTIME_TOKEN: runtime.runtimeToken,
    DEEPSEEK_API_KEY: runtime.apiKey || process.env.DEEPSEEK_API_KEY || ''
  }
  if (!runAsElectron) childEnv.ELECTRON_RUN_AS_NODE = '1'
  else delete childEnv.ELECTRON_RUN_AS_NODE
  child = spawn(command, args, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const startedChild = child
  const startedLogCapture = createKunChildLogCapture(startedChild.pid)
  childLogCapture = startedLogCapture
  childStderrTail = ''
  startedLogCapture.logLifecycle(`spawned on port ${runtime.port} using data dir ${dataDir}`)
  startedChild.stdout?.on('data', startedLogCapture.captureStdout)
  startedChild.stderr?.on('data', (chunk: Buffer | string) => {
    childStderrTail = appendTail(childStderrTail, normalizeCapturedChunk(chunk))
    startedLogCapture.captureStderr(chunk)
  })
  child.on('exit', (code, signal) => {
    startedLogCapture.logLifecycle(
      signal
        ? `exited with signal ${signal}`
        : `exited with code ${code ?? 'unknown'}`
    )
    void startedLogCapture.close()
    if (child === startedChild) child = null
    if (readyChildren.has(startedChild) && !intentionalStops.has(startedChild)) {
      onUnexpectedKunExit?.({
        code: code ?? null,
        signal: signal ?? null,
        stderrTail: childStderrTail
      })
    }
  })
  child.on('error', (error) => {
    startedLogCapture.logLifecycle(
      `process error: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  try {
    await waitForKunStartup(startedChild, runtime.port)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    startedLogCapture.logLifecycle(`startup failed before ready: ${message}`)
    if (child === startedChild) {
      await stopKunChildAndWait()
    }
    throw error
  }
  readyChildren.add(startedChild)
  startedLogCapture.logLifecycle(`ready marker received on port ${runtime.port}`)
}

export async function syncGuiManagedKunConfig(
  dataDir: string,
  runtime: Pick<
    KunRuntimeSettingsV1,
    | 'mcpSearch'
    | 'tokenEconomy'
    | 'storage'
    | 'contextCompaction'
    | 'runtimeTuning'
    | 'imageGeneration'
    | 'textToSpeech'
    | 'musicGeneration'
    | 'videoGeneration'
    | 'computerUse'
    | 'modelProfiles'
    | 'memoryEnabled'
    | 'quality'
  >,
  options?: {
    scheduleMcp?: {
      settings: AppSettingsV1
      launch: ClawScheduleMcpLaunchConfig
    }
    mcpConfigPath?: string
  }
): Promise<void> {
  const configPath = join(dataDir, 'config.json')
  const existing = sanitizeKunConfigSections(await readJsonObjectIfExists(configPath))
  const importedMcpServers = await readGuiManagedMcpServers(
    options?.mcpConfigPath ?? resolveKunMcpJsonPath()
  )
  const hasImportedEnabledMcpServer = Object.values(importedMcpServers).some(
    (server) => objectValue(server).enabled !== false
  )

  const serve = objectValue(existing?.serve)
  const existingTokenEconomy = objectValue(serve.tokenEconomy)
  const existingContextCompaction = objectValue(existing?.contextCompaction)
  const existingModels = objectValue(existing?.models)
  const existingRuntimeTuning = objectValue(existing?.runtime)
  const existingQuality = objectValue(existing?.quality)
  const capabilities = objectValue(existing?.capabilities)
  const mcp = objectValue(capabilities.mcp)
  const search = objectValue(mcp.search)
  const attachments = objectValue(capabilities.attachments)
  const memory = objectValue(capabilities.memory)
  const web = objectValue(capabilities.web)
  const skills = objectValue(capabilities.skills)
  const imageGen = objectValue(capabilities.imageGen)
  const speechGen = objectValue(capabilities.speechGen)
  const musicGen = objectValue(capabilities.musicGen)
  const videoGen = objectValue(capabilities.videoGen)
  const computerUse = objectValue(capabilities.computerUse)
  const storage = storageConfigForRuntime(runtime.storage)
  const mcpSearch = runtime.mcpSearch
  const skillCapability = await skillCapabilityConfigForRuntime(skills, options?.scheduleMcp?.settings)
  const workflowHookEntries = buildWorkflowHookEntries(options?.scheduleMcp?.settings.workflow)
  // Mirror every configured GUI provider (apiKey + baseUrl + endpointFormat)
  // into the kun config so the runtime's MultiProviderModelClient can route
  // per-request `providerId` overrides (workflow / scheduled task / IM
  // bridge) without restart. Empty when no GUI settings are reachable, in
  // which case the runtime stays single-provider.
  const providers = options?.scheduleMcp?.settings
    ? providersConfigForRuntime(options.scheduleMcp.settings)
    : undefined
  const next = {
    serve: {
      ...serve,
      storage,
      tokenEconomy: tokenEconomyConfigForRuntime(runtime.tokenEconomy, existingTokenEconomy),
      ...(providers && Object.keys(providers).length ? { providers } : {})
    },
    models: modelConfigForRuntime(existingModels, runtime.modelProfiles),
    contextCompaction: contextCompactionConfigForRuntime(runtime.contextCompaction, existingContextCompaction),
    runtime: runtimeTuningConfigForRuntime(runtime.runtimeTuning, existingRuntimeTuning),
    quality: qualityConfigForRuntime(runtime.quality, existingQuality),
    capabilities: {
      ...capabilities,
      attachments: {
        ...attachments,
        enabled: attachments.enabled === false ? false : true
      },
      web: {
        ...web,
        enabled: web.enabled === false ? false : true,
        fetchEnabled: web.fetchEnabled === false ? false : true
      },
      skills: skillCapability,
      imageGen: imageGenConfigForRuntime(runtime.imageGeneration, imageGen),
      speechGen: speechGenConfigForRuntime(runtime.textToSpeech, speechGen),
      musicGen: musicGenConfigForRuntime(runtime.musicGeneration, musicGen),
      videoGen: videoGenConfigForRuntime(runtime.videoGeneration, videoGen),
      computerUse: computerUseConfigForRuntime(runtime.computerUse, computerUse),
      memory: {
        ...memory,
        enabled: runtime.memoryEnabled
      },
      mcp: {
        ...mcp,
        ...(options?.scheduleMcp || mcpSearch.enabled || hasImportedEnabledMcpServer
          ? { enabled: mcp.enabled === false ? false : true }
          : {}),
        servers: {
          ...objectValue(mcp.servers),
          ...importedMcpServers,
          ...(options?.scheduleMcp
          ? {
              [GUI_SCHEDULE_MCP_SERVER_NAME]: buildGuiScheduleKunMcpServer(
                options.scheduleMcp.settings,
                options.scheduleMcp.launch
              )
            }
          : {})
        },
        search: {
          ...search,
          enabled: mcpSearch.enabled,
          mode: mcpSearch.mode,
          autoThresholdToolCount: mcpSearch.autoThresholdToolCount,
          topKDefault: mcpSearch.topKDefault,
          topKMax: mcpSearch.topKMax,
          minScore: mcpSearch.minScore
        }
      }
    },
    ...(workflowHookEntries.length ? { hooks: workflowHookEntries } : {})
  }
  const parsedNext = KunConfigSchema.safeParse(next)
  if (!parsedNext.success) {
    throw new Error(
      `Refusing to write invalid GUI-managed Kun config at ${configPath}: ${JSON.stringify(parsedNext.error.issues, null, 2)}`
    )
  }
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  if (existing && nextText === `${JSON.stringify(existing, null, 2)}\n`) return
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, nextText, 'utf8')
}

function buildGuiScheduleKunMcpServer(
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig
): Record<string, unknown> {
  return {
    enabled: true,
    transport: 'stdio',
    command: resolveClawScheduleMcpCommand(launch),
    args: buildClawScheduleMcpArgs(settings, launch),
    env: {
      ELECTRON_RUN_AS_NODE: '1'
    },
    trustScope: 'user',
    timeoutMs: GUI_SCHEDULE_MCP_TIMEOUT_MS
  }
}

async function skillCapabilityConfigForRuntime(
  existing: Record<string, unknown>,
  settings?: AppSettingsV1
): Promise<Record<string, unknown>> {
  // Carry over only the roots a user added by hand to the Kun config file.
  // Drop previously-persisted GUI-managed roots so disabling a directory in
  // settings actually removes it — otherwise a toggled-off root would stick
  // around forever via `existing.roots`.
  const managed = guiSkillManagedComparablePaths(settings)
  const manualExisting = stringArrayValue(existing.roots)
    .map(normalizeSkillRootPath)
    .filter((path) => path.length > 0 && !managed.has(comparableSkillRootPath(path)))
  const roots = uniqueStrings([
    ...manualExisting,
    ...(await guiSkillRootsForRuntime(settings)).map((root) => root.path)
  ])
  return {
    ...existing,
    // Auto-enable once we discover skill roots. There is no user-facing skills
    // enable toggle, so a persisted `enabled: false` is only ever the schema
    // default leaking onto disk — it must not permanently suppress discovered
    // skills. An explicit `true` still forces on even with no roots.
    enabled: roots.length > 0 || existing.enabled === true,
    roots,
    legacySkillMd: existing.legacySkillMd === false ? false : true
  }
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

async function readGuiManagedMcpServers(path: string): Promise<Record<string, unknown>> {
  const parsed = await readJsonObjectIfExists(path)
  if (!parsed) return {}

  const rawServers = mcpServersFromGuiConfig(parsed)
  const normalizedEntries = Object.entries(rawServers)
    .map(([serverId, server]) => {
      const normalized = normalizeGuiManagedMcpServer(server)
      return normalized ? [serverId, normalized] as const : null
    })
    .filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== null)

  return Object.fromEntries(normalizedEntries)
}

function mcpServersFromGuiConfig(config: Record<string, unknown>): Record<string, unknown> {
  const directServers = objectValue(config.servers)
  if (Object.keys(directServers).length > 0) return directServers

  const capabilities = objectValue(config.capabilities)
  const mcp = objectValue(capabilities.mcp)
  return objectValue(mcp.servers)
}

function normalizeGuiManagedMcpServer(server: unknown): Record<string, unknown> | null {
  const raw = objectValue(server)
  const command = scalarStringValue(raw.command)
  const url = scalarStringValue(raw.url)
  const args = stringArrayValue(raw.args)
  const headers = stringRecordValue(raw.headers)
  const env = stringRecordValue(raw.env)
  const transport = normalizeMcpTransport(raw.transport, command, url)
  if (!transport) return null

  const trustedWorkspaceRoots = stringArrayValue(raw.trustedWorkspaceRoots)
  const trustScope = normalizeMcpTrustScope(raw.trustScope, trustedWorkspaceRoots)
  if (trustScope === 'workspace' && trustedWorkspaceRoots.length === 0) return null

  const timeoutMs = positiveIntegerValue(raw.timeoutMs)
  const parsed = McpServerConfig.safeParse({
    enabled: raw.enabled === false || raw.disabled === true ? false : true,
    transport,
    ...(command ? { command } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(url ? { url } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    trustScope,
    ...(trustedWorkspaceRoots.length > 0 ? { trustedWorkspaceRoots } : {}),
    ...(timeoutMs ? { timeoutMs } : {})
  })

  return parsed.success ? objectValue(parsed.data) : null
}

function normalizeMcpTransport(
  value: unknown,
  command: string | undefined,
  url: string | undefined
): 'stdio' | 'streamable-http' | 'sse' | null {
  if (value === 'stdio' || value === 'streamable-http' || value === 'sse') return value
  if (command) return 'stdio'
  if (url) return 'streamable-http'
  return null
}

function normalizeMcpTrustScope(
  value: unknown,
  trustedWorkspaceRoots: string[]
): 'user' | 'workspace' {
  if (value === 'user' || value === 'workspace') return value
  return trustedWorkspaceRoots.length > 0 ? 'workspace' : 'user'
}

function scalarStringValue(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined
}

function stringRecordValue(value: unknown): Record<string, string> {
  const record = objectValue(value)
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    const normalized = scalarStringValue(item)
    if (normalized !== undefined) next[key] = normalized
  }
  return next
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function modelConfigForRuntime(
  existing: Record<string, unknown>,
  guiModelProfiles: Record<string, ModelProviderModelProfileV1> = {}
): Record<string, unknown> {
  const existingProfiles = objectValue(existing.profiles)
  const guiProfiles = modelConfigProfilesFromProviderProfiles(guiModelProfiles)
  const profileDefaults = {
    ...DEFAULT_KUN_MODEL_PROFILES,
    ...guiProfiles
  }
  const profiles: Record<string, unknown> = {}
  for (const modelId of new Set([
    ...Object.keys(profileDefaults),
    ...Object.keys(existingProfiles)
  ])) {
    const defaultProfile = objectValue(profileDefaults[modelId])
    const existingProfile = objectValue(existingProfiles[modelId])
    const guiProfile = objectValue(guiProfiles[modelId])
    profiles[modelId] = {
      ...defaultProfile,
      ...existingProfile,
      ...guiProfile,
      contextCompaction: {
        ...objectValue(defaultProfile.contextCompaction),
        ...objectValue(existingProfile.contextCompaction),
        ...objectValue(guiProfile.contextCompaction)
      }
    }
  }
  return {
    ...existing,
    profiles
  }
}

function modelConfigProfilesFromProviderProfiles(
  profiles: Record<string, ModelProviderModelProfileV1>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [modelId, profile] of Object.entries(profiles)) {
    const trimmed = modelId.trim()
    if (!trimmed) continue
    out[trimmed] = {
      ...(profile.aliases?.length ? { aliases: profile.aliases } : {}),
      ...(profile.contextWindowTokens ? { contextWindowTokens: profile.contextWindowTokens } : {}),
      inputModalities: profile.inputModalities,
      outputModalities: profile.outputModalities,
      supportsToolCalling: profile.supportsToolCalling,
      messageParts: profile.messageParts,
      ...(profile.reasoning ? { reasoning: profile.reasoning } : {}),
      ...(profile.endpointFormat ? { endpointFormat: profile.endpointFormat } : {})
    }
  }
  return out
}

/**
 * Mirror every configured GUI provider (apiKey + baseUrl + endpointFormat
 * + per-provider proxy) into the kun config's `serve.providers` map so the
 * runtime's MultiProviderModelClient can route a workflow / scheduled-task
 * / IM-bridge turn to a non-runtime provider per request. Skips entries
 * whose baseUrl is empty — those couldn't be reached anyway.
 *
 * The kun runtime's own bound provider is included too; the wrapper's
 * default client handles it identically, so duplicate entries are
 * idempotent.
 */
function providersConfigForRuntime(settings: AppSettingsV1): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const runtimeProviderId = getKunRuntimeSettings(settings).providerId.trim()
  const proxyUrl = resolveModelProviderProxyUrl(settings)
  for (const provider of getModelProviderSettings(settings).providers as ModelProviderProfileV1[]) {
    const id = provider.id?.trim()
    const baseUrl = provider.baseUrl?.trim()
    if (!id || !baseUrl) continue
    // The runtime's own provider is already wired via the default CLI args;
    // skipping it keeps the map smaller and avoids paying twice for one
    // provider that happens to be the active runtime binding.
    if (id === runtimeProviderId) continue
    out[id] = {
      apiKey: provider.apiKey?.trim() ?? '',
      baseUrl,
      ...(provider.endpointFormat ? { endpointFormat: provider.endpointFormat } : {}),
      ...(proxyUrl ? { modelProxyUrl: proxyUrl } : {})
    }
  }
  return out
}

function tokenEconomyConfigForRuntime(
  tokenEconomy: Pick<KunRuntimeSettingsV1, 'tokenEconomy'>['tokenEconomy'] | undefined,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const defaults = defaultKunTokenEconomySettings()
  const normalized = {
    ...defaults,
    ...(tokenEconomy ?? {}),
    historyHygiene: {
      ...defaults.historyHygiene,
      ...(tokenEconomy?.historyHygiene ?? {})
    }
  }
  const existingHistoryHygiene = objectValue(existing.historyHygiene)
  return {
    ...existing,
    enabled: normalized.enabled,
    compressToolDescriptions: normalized.compressToolDescriptions,
    compressToolResults: normalized.compressToolResults,
    conciseResponses: normalized.conciseResponses,
    historyHygiene: {
      ...existingHistoryHygiene,
      maxToolResultLines: normalized.historyHygiene.maxToolResultLines,
      maxToolResultBytes: normalized.historyHygiene.maxToolResultBytes,
      maxToolResultTokens: normalized.historyHygiene.maxToolResultTokens,
      maxToolArgumentStringBytes: normalized.historyHygiene.maxToolArgumentStringBytes,
      maxToolArgumentStringTokens: normalized.historyHygiene.maxToolArgumentStringTokens,
      maxArrayItems: normalized.historyHygiene.maxArrayItems
    }
  }
}

function storageConfigForRuntime(
  storage: Pick<KunRuntimeSettingsV1, 'storage'>['storage']
): Record<string, unknown> {
  const sqlitePath = storage.sqlitePath.trim()
  return {
    backend: storage.backend,
    ...(sqlitePath ? { sqlitePath } : {})
  }
}

function contextCompactionConfigForRuntime(
  contextCompaction: Pick<KunRuntimeSettingsV1, 'contextCompaction'>['contextCompaction'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    defaultSoftThreshold: contextCompaction.defaultSoftThreshold,
    defaultHardThreshold: contextCompaction.defaultHardThreshold,
    summaryMode: contextCompaction.summaryMode,
    summaryTimeoutMs: contextCompaction.summaryTimeoutMs,
    summaryMaxTokens: contextCompaction.summaryMaxTokens,
    summaryInputMaxBytes: contextCompaction.summaryInputMaxBytes
  }
}

function computerUseConfigForRuntime(
  computerUse: Pick<KunRuntimeSettingsV1, 'computerUse'>['computerUse'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  // GUI owns enabled/mode/limits. `existing` was already passed through the
  // strict ComputerUseCapabilityConfig sanitizer, so unknown hand-edited keys
  // were dropped before reaching here; the spread only carries known fields.
  return {
    ...existing,
    enabled: computerUse.enabled,
    mode: computerUse.mode,
    maxImageDimension: computerUse.maxImageDimension,
    maxActionsPerTurn: computerUse.maxActionsPerTurn
  }
}

function imageGenConfigForRuntime(
  imageGeneration: Pick<KunRuntimeSettingsV1, 'imageGeneration'>['imageGeneration'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  // GUI settings own these fields: cleared values must be removed from the
  // config (the zod schema rejects empty strings), while unknown hand-edited
  // keys like maxReferenceImages are preserved via the spread.
  const next: Record<string, unknown> = {
    ...existing,
    enabled: imageGeneration.enabled,
    timeoutMs: imageGeneration.timeoutMs
  }
  const fields = {
    protocol: imageGeneration.protocol,
    baseUrl: imageGeneration.baseUrl,
    apiKey: imageGeneration.apiKey,
    model: imageGeneration.model,
    defaultSize: imageGeneration.defaultSize
  }
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  return next
}

function speechGenConfigForRuntime(
  textToSpeech: Pick<KunRuntimeSettingsV1, 'textToSpeech'>['textToSpeech'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: textToSpeech.enabled,
    timeoutMs: textToSpeech.timeoutMs,
    format: textToSpeech.format
  }
  const fields = {
    protocol: textToSpeech.protocol,
    baseUrl: textToSpeech.baseUrl,
    apiKey: textToSpeech.apiKey,
    model: textToSpeech.model,
    voice: textToSpeech.voice
  }
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  return next
}

function musicGenConfigForRuntime(
  musicGeneration: Pick<KunRuntimeSettingsV1, 'musicGeneration'>['musicGeneration'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: musicGeneration.enabled,
    timeoutMs: musicGeneration.timeoutMs,
    format: musicGeneration.format
  }
  const fields = {
    protocol: musicGeneration.protocol,
    baseUrl: musicGeneration.baseUrl,
    apiKey: musicGeneration.apiKey,
    model: musicGeneration.model
  }
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  return next
}

function videoGenConfigForRuntime(
  videoGeneration: Pick<KunRuntimeSettingsV1, 'videoGeneration'>['videoGeneration'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: videoGeneration.enabled,
    defaultDuration: videoGeneration.defaultDuration,
    timeoutMs: videoGeneration.timeoutMs,
    pollIntervalMs: videoGeneration.pollIntervalMs
  }
  const fields = {
    protocol: videoGeneration.protocol,
    baseUrl: videoGeneration.baseUrl,
    apiKey: videoGeneration.apiKey,
    model: videoGeneration.model,
    defaultResolution: videoGeneration.defaultResolution
  }
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  return next
}

function runtimeTuningConfigForRuntime(
  runtimeTuning: Pick<KunRuntimeSettingsV1, 'runtimeTuning'>['runtimeTuning'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const existingToolStorm = objectValue(existing.toolStorm)
  const existingToolArgumentRepair = objectValue(existing.toolArgumentRepair)
  return {
    ...existing,
    streamIdleTimeoutMs: runtimeTuning.streamIdleTimeoutMs,
    toolStorm: {
      ...existingToolStorm,
      enabled: runtimeTuning.toolStorm.enabled,
      windowSize: runtimeTuning.toolStorm.windowSize,
      threshold: runtimeTuning.toolStorm.threshold
    },
    toolArgumentRepair: {
      ...existingToolArgumentRepair,
      maxStringBytes: runtimeTuning.toolArgumentRepair.maxStringBytes
    }
  }
}

function qualityConfigForRuntime(
  quality: Pick<KunRuntimeSettingsV1, 'quality'>['quality'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    enabled: quality.enabled,
    strictness: quality.strictness,
    ignoreRules: [...quality.ignoreRules],
    ignoreFiles: [...quality.ignoreFiles],
    maxFindings: quality.maxFindings
  }
}

async function readJsonObjectIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text) as unknown
    return objectValue(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof SyntaxError) return null
    throw error
  }
}

type SafeParseSchema = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | { success: false }
}

function parseKunConfigSection(
  schema: SafeParseSchema,
  value: unknown
): Record<string, unknown> {
  const parsed = schema.safeParse(objectValue(value))
  return parsed.success ? objectValue(parsed.data) : {}
}

function sanitizeKunCapabilitiesConfig(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const next: Record<string, unknown> = {}
  if ('mcp' in raw) next.mcp = parseKunConfigSection(McpCapabilityConfig, raw.mcp)
  if ('web' in raw) next.web = parseKunConfigSection(WebCapabilityConfig, raw.web)
  if ('skills' in raw) next.skills = parseKunConfigSection(SkillsCapabilityConfig, raw.skills)
  if ('subagents' in raw) {
    next.subagents = parseKunConfigSection(SubagentsCapabilityConfig, raw.subagents)
  }
  if ('attachments' in raw) {
    next.attachments = parseKunConfigSection(AttachmentsCapabilityConfig, raw.attachments)
  }
  if ('memory' in raw) next.memory = parseKunConfigSection(MemoryCapabilityConfig, raw.memory)
  if ('imageGen' in raw) next.imageGen = parseKunConfigSection(ImageGenCapabilityConfig, raw.imageGen)
  if ('speechGen' in raw) next.speechGen = parseKunConfigSection(SpeechGenCapabilityConfig, raw.speechGen)
  if ('musicGen' in raw) next.musicGen = parseKunConfigSection(MusicGenCapabilityConfig, raw.musicGen)
  if ('videoGen' in raw) next.videoGen = parseKunConfigSection(VideoGenCapabilityConfig, raw.videoGen)
  if ('computerUse' in raw) {
    next.computerUse = parseKunConfigSection(ComputerUseCapabilityConfig, raw.computerUse)
  }
  return next
}

/** Validate the GUI-managed `hooks` array (workflow + command entries). Array, not an object. */
function parseKunHooksSection(value: unknown): unknown[] {
  const parsed = HooksConfigSchema.safeParse(Array.isArray(value) ? value : [])
  return parsed.success ? parsed.data : []
}

/** Build kun `hooks` entries from the GUI's workflow hook triggers (workflow-backed hooks). */
function buildWorkflowHookEntries(workflow: AppSettingsV1['workflow'] | undefined): unknown[] {
  if (!workflow) return []
  const baseUrl = `http://127.0.0.1:${workflow.webhookPort}`
  const secret = workflow.webhookSecret.trim()
  return (workflow.hookTriggers ?? [])
    .filter((trigger) => trigger.enabled && trigger.workflowId)
    .map((trigger) => ({
      phase: trigger.phase,
      ...(trigger.toolNames.length ? { toolNames: trigger.toolNames } : {}),
      workflow: trigger.workflowId,
      mode: trigger.mode,
      baseUrl,
      ...(secret ? { secret } : {}),
      ...(trigger.timeoutMs > 0 ? { timeoutMs: trigger.timeoutMs } : {})
    }))
}

function sanitizeKunConfigSections(
  existing: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!existing) return null
  const hooks = parseKunHooksSection(existing.hooks)
  return {
    serve: parseKunConfigSection(KunServeConfigSchema, existing.serve),
    models: parseKunConfigSection(ModelConfigSchema, existing.models),
    contextCompaction: parseKunConfigSection(
      ContextCompactionConfigSchema,
      existing.contextCompaction
    ),
    runtime: parseKunConfigSection(RuntimeTuningConfigSchema, existing.runtime),
    quality: parseKunConfigSection(QualityConfigSchema, existing.quality),
    capabilities: sanitizeKunCapabilitiesConfig(existing.capabilities),
    ...(hooks.length ? { hooks } : {})
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function stopKunChildAndWait(): Promise<void> {
  if (!child) {
    if (childLogCapture) {
      const capture = childLogCapture
      childLogCapture = null
      await capture.close()
    }
    return
  }
  const stoppingChild = child
  intentionalStops.add(stoppingChild)
  const pid = child.pid
  const capture = childLogCapture
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
  if (child === stoppingChild) child = null
  if (capture) {
    childLogCapture = null
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

async function waitForKunStartup(startedChild: ChildProcess, port?: number): Promise<void> {
  if (startedChild.exitCode !== null) {
    throw new Error(describeKunExit(startedChild.exitCode, null))
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let stdoutBuffer = ''
    let stderrTail = ''
    let healthProbeInFlight = false
    let healthConfirmed = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(describeKunStartupTimeout(stderrTail)))
    }, KUN_STARTUP_TIMEOUT_MS)
    // The stdout ready marker can lag behind the actual server (pipe
    // buffering) or get lost in unusual spawn environments; the HTTP
    // health endpoint is the ground truth, so poll it in parallel.
    // A passing health probe alone is enough to settle (it proves the
    // server responds). The stdout marker alone is NOT enough — it only
    // proves the process started, not that the HTTP server can serve.
    const healthTimer = port
      ? setInterval(() => {
          if (settled || healthProbeInFlight) return
          healthProbeInFlight = true
          void probeKunHealth(port)
            .then((healthy) => {
              if (healthy) {
                healthConfirmed = true
                settleReady()
              }
            })
            .finally(() => {
              healthProbeInFlight = false
            })
        }, KUN_STARTUP_HEALTH_POLL_MS)
      : null
    const cleanup = (): void => {
      clearTimeout(timer)
      if (healthTimer) clearInterval(healthTimer)
      startedChild.removeListener('exit', onExit)
      startedChild.removeListener('error', onError)
      startedChild.stdout?.removeListener('data', onStdout)
      startedChild.stderr?.removeListener('data', onStderr)
    }
    const tryParseReady = (): boolean => {
      const markerIndex = stdoutBuffer.indexOf(KUN_READY_PREFIX)
      if (markerIndex < 0) return false
      const afterPrefix = stdoutBuffer.slice(markerIndex + KUN_READY_PREFIX.length)
      const newlineIndex = afterPrefix.indexOf('\n')
      if (newlineIndex < 0) return false
      const jsonLine = afterPrefix.slice(0, newlineIndex).trim()
      if (!jsonLine) return false
      try {
        const parsed = JSON.parse(jsonLine) as { service?: string; mode?: string; port?: number }
        return parsed.service === 'kun' && parsed.mode === 'serve' && typeof parsed.port === 'number'
      } catch {
        return false
      }
    }
    const settleReady = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const onStdout = (chunk: Buffer | string): void => {
      stdoutBuffer = appendTail(stdoutBuffer, String(chunk), STDERR_TAIL_MAX_CHARS * 2)
      if (!tryParseReady()) return
      if (healthConfirmed || !healthTimer) {
        settleReady()
      }
    }
    const onStderr = (chunk: Buffer | string): void => {
      stderrTail = appendTail(stderrTail, String(chunk))
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(describeKunExit(code, signal, stderrTail)))
    }
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    startedChild.stdout?.on('data', onStdout)
    startedChild.stderr?.on('data', onStderr)
    startedChild.once('exit', onExit)
    startedChild.once('error', onError)
  })
}

function describeKunExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail = ''
): string {
  const suffix = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
  if (signal) return `Kun exited during startup with signal ${signal}${suffix}`
  if (typeof code === 'number') return `Kun exited during startup with code ${code}${suffix}`
  return `Kun exited during startup${suffix}`
}

function describeKunStartupTimeout(stderrTail: string): string {
  const suffix = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
  return `Kun did not report ready within ${KUN_STARTUP_TIMEOUT_MS}ms${suffix}`
}

async function probeKunHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(KUN_STARTUP_HEALTH_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return false
    return isKunHealthResponseBody(await response.text())
  } catch {
    return false
  }
}
