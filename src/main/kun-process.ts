import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  defaultKunTokenEconomySettings,
  isKunRuntimeInsecure,
  resolveKunRuntimeSettings,
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
  RuntimeTuningConfigSchema
} from '../../kun/src/config/kun-config.js'
import {
  AttachmentsCapabilityConfig,
  McpCapabilityConfig,
  MemoryCapabilityConfig,
  SkillsCapabilityConfig,
  SubagentsCapabilityConfig,
  WebCapabilityConfig
} from '../../kun/src/contracts/capabilities.js'
import {
  buildClawScheduleMcpArgs,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { defaultKunDataDir } from './runtime/kun-adapter'
import { appendManagedLogLine } from './logger'

let child: ChildProcess | null = null
let childLogCapture: KunChildLogCapture | null = null
let lastResolvedBinary: string | null = null
const KUN_READY_PREFIX = 'KUN_READY '
const KUN_STARTUP_TIMEOUT_MS = 15_000
const STDERR_TAIL_MAX_CHARS = 4_000
const GUI_SCHEDULE_MCP_TIMEOUT_MS = 5_000
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

type PortOwner = {
  pid: number
  command: string
  parentPid: number | null
  parentCommand: string | null
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

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

function kunDataDir(runtime: { dataDir: string }): string {
  const trimmed = runtime.dataDir?.trim()
  if (trimmed) return trimmed.startsWith('~') ? trimmed.replace(/^~/, homedir()) : trimmed
  return defaultKunDataDir()
}

export function isKunChildRunning(): boolean {
  return child !== null && child.exitCode === null
}

export async function startKunChild(settings: AppSettingsV1): Promise<void> {
  const runtime = resolveKunRuntimeSettings(settings)
  if (isKunChildRunning()) return
  if (!runtime.autoStart) return
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
  const dataDir = kunDataDir(runtime)
  await syncGuiManagedKunConfig(dataDir, runtime, {
    settings,
    launch: {
      appPath: app.getAppPath(),
      execPath: process.execPath,
      isPackaged: app.isPackaged
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
    model: runtime.model,
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    tokenEconomyMode: runtime.tokenEconomyMode,
    insecure: isKunRuntimeInsecure(runtime)
  })
  child = spawn(resolution.command, args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      KUN_RUNTIME_TOKEN: runtime.runtimeToken,
      DEEPSEEK_API_KEY: runtime.apiKey || process.env.DEEPSEEK_API_KEY || ''
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const startedChild = child
  const startedLogCapture = createKunChildLogCapture(startedChild.pid)
  childLogCapture = startedLogCapture
  startedLogCapture.logLifecycle(`spawned on port ${runtime.port} using data dir ${dataDir}`)
  startedChild.stdout?.on('data', startedLogCapture.captureStdout)
  startedChild.stderr?.on('data', startedLogCapture.captureStderr)
  child.on('exit', (code, signal) => {
    startedLogCapture.logLifecycle(
      signal
        ? `exited with signal ${signal}`
        : `exited with code ${code ?? 'unknown'}`
    )
    void startedLogCapture.close()
    if (child === startedChild) child = null
  })
  child.on('error', (error) => {
    startedLogCapture.logLifecycle(
      `process error: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  await waitForKunStartup(startedChild)
  startedLogCapture.logLifecycle(`ready marker received on port ${runtime.port}`)
}

export async function syncGuiManagedKunConfig(
  dataDir: string,
  runtime: Pick<
    KunRuntimeSettingsV1,
    'mcpSearch' | 'tokenEconomy' | 'storage' | 'contextCompaction' | 'runtimeTuning'
  >,
  scheduleMcp?: {
    settings: AppSettingsV1
    launch: ClawScheduleMcpLaunchConfig
  }
): Promise<void> {
  const configPath = join(dataDir, 'config.json')
  const existing = sanitizeKunConfigSections(await readJsonObjectIfExists(configPath))

  const serve = objectValue(existing?.serve)
  const existingTokenEconomy = objectValue(serve.tokenEconomy)
  const existingContextCompaction = objectValue(existing?.contextCompaction)
  const existingModels = objectValue(existing?.models)
  const existingRuntimeTuning = objectValue(existing?.runtime)
  const capabilities = objectValue(existing?.capabilities)
  const mcp = objectValue(capabilities.mcp)
  const search = objectValue(mcp.search)
  const attachments = objectValue(capabilities.attachments)
  const web = objectValue(capabilities.web)
  const storage = storageConfigForRuntime(runtime.storage)
  const mcpSearch = runtime.mcpSearch
  const next = {
    serve: {
      ...serve,
      storage,
      tokenEconomy: tokenEconomyConfigForRuntime(runtime.tokenEconomy, existingTokenEconomy)
    },
    models: modelConfigForRuntime(existingModels),
    contextCompaction: contextCompactionConfigForRuntime(runtime.contextCompaction, existingContextCompaction),
    runtime: runtimeTuningConfigForRuntime(runtime.runtimeTuning, existingRuntimeTuning),
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
      mcp: {
        ...mcp,
        ...(scheduleMcp || mcpSearch.enabled ? { enabled: mcp.enabled === false ? false : true } : {}),
        ...(scheduleMcp
          ? {
              servers: {
                ...objectValue(mcp.servers),
                [GUI_SCHEDULE_MCP_SERVER_NAME]: buildGuiScheduleKunMcpServer(scheduleMcp.settings, scheduleMcp.launch)
              }
            }
          : {}),
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
    }
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
    command: launch.execPath,
    args: buildClawScheduleMcpArgs(settings, launch),
    env: {},
    trustScope: 'user',
    timeoutMs: GUI_SCHEDULE_MCP_TIMEOUT_MS
  }
}

function modelConfigForRuntime(existing: Record<string, unknown>): Record<string, unknown> {
  const existingProfiles = objectValue(existing.profiles)
  const profiles: Record<string, unknown> = { ...DEFAULT_KUN_MODEL_PROFILES }
  for (const [modelId, profile] of Object.entries(existingProfiles)) {
    const defaultProfile = objectValue(DEFAULT_KUN_MODEL_PROFILES[modelId])
    const existingProfile = objectValue(profile)
    profiles[modelId] = {
      ...defaultProfile,
      ...existingProfile,
      contextCompaction: {
        ...objectValue(defaultProfile.contextCompaction),
        ...objectValue(existingProfile.contextCompaction)
      }
    }
  }
  return {
    ...existing,
    profiles
  }
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

function runtimeTuningConfigForRuntime(
  runtimeTuning: Pick<KunRuntimeSettingsV1, 'runtimeTuning'>['runtimeTuning'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const existingToolStorm = objectValue(existing.toolStorm)
  const existingToolArgumentRepair = objectValue(existing.toolArgumentRepair)
  return {
    ...existing,
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
  return next
}

function sanitizeKunConfigSections(
  existing: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!existing) return null
  return {
    serve: parseKunConfigSection(KunServeConfigSchema, existing.serve),
    models: parseKunConfigSection(ModelConfigSchema, existing.models),
    contextCompaction: parseKunConfigSection(
      ContextCompactionConfigSchema,
      existing.contextCompaction
    ),
    runtime: parseKunConfigSection(RuntimeTuningConfigSchema, existing.runtime),
    capabilities: sanitizeKunCapabilitiesConfig(existing.capabilities)
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
  const pid = child.pid
  const capture = childLogCapture
  child.kill('SIGTERM')
  for (let i = 0; i < 50; i += 1) {
    if (!isKunChildRunning()) {
      child = null
      if (capture) {
        childLogCapture = null
        await capture.close()
      }
      return
    }
    await sleep(100)
  }
  try {
    if (pid) process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
  child = null
  if (capture) {
    childLogCapture = null
    await capture.close()
  }
}

export async function reclaimKunPort(
  port: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (port <= 0) return { ok: true }
  try {
    await execFileText('lsof', ['-ti', `:${port}`])
    // Port has an owner; surface a soft failure so the GUI can decide.
    return { ok: false, message: `port ${port} is in use` }
  } catch {
    return { ok: true }
  }
}

async function waitForKunStartup(startedChild: ChildProcess): Promise<void> {
  if (startedChild.exitCode !== null) {
    throw new Error(describeKunExit(startedChild.exitCode, null))
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let stdoutBuffer = ''
    let stderrTail = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(describeKunStartupTimeout(stderrTail)))
    }, KUN_STARTUP_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timer)
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
      if (tryParseReady()) settleReady()
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
