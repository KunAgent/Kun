import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { JsonSettingsStore } from './settings-store'
import type { PowerSaveControllerLike } from './schedule-runtime-helpers'
import type {
  AppSettingsV1,
  DaemonActionResult,
  DaemonLogPage,
  DaemonProcessState,
  DaemonRuntimeItemStatus,
  DaemonRuntimeStatus,
  SessionDaemonV1
} from '../shared/app-settings'

const DEFAULT_RESTART_BACKOFF_MS = [5_000, 30_000, 120_000] as const
const MAX_CONSECUTIVE_RESTARTS = 5
const STOP_GRACE_MS = 5_000
const SILENCE_MONITOR_INTERVAL_MS = 10_000
const HEALTHY_RESET_MS = 10 * 60_000
const DAEMON_LOG_MAX_BYTES = 1_000_000
const MAX_PUSH_TEXT_LENGTH = 2_000
const MAX_PUSHES_PER_MINUTE = 10

export type DaemonPushTextFn = (input: {
  daemon: SessionDaemonV1
  text: string
}) => Promise<{ ok: boolean; message?: string }>

export type DaemonRuntimeDeps = {
  store: JsonSettingsStore
  logError: (category: string, message: string, detail?: unknown) => void
  logDir: string
  powerSaveController?: PowerSaveControllerLike
  /** Optional outbound WeChat push. Wired from main; absent means push frames are logged but not sent. */
  pushText?: DaemonPushTextFn
  /** Test seam: backoff schedule before the daemon is marked errored. */
  restartBackoffMs?: readonly number[]
  /** Test seam: how long a healthy run takes before the restart counter resets. */
  healthyResetMs?: number
  /** Test seam: process-tree killer for Windows (taskkill /T /F). */
  killProcessTree?: (pid: number) => void
  /** Test seam: process spawner (defaults to node:child_process spawn). */
  spawnProcess?: typeof spawn
}

type RunningDaemon = {
  daemon: SessionDaemonV1
  child: ChildProcess | null
  state: DaemonProcessState
  pid?: number
  startedAt?: number
  lastHeartbeatAt?: number
  lastOutputAt?: number
  restartCount: number
  lastError?: string
  generation: number
  restartTimer: NodeJS.Timeout | null
  stopTimer: NodeJS.Timeout | null
  exitPromise: Promise<void>
  pushTimestamps: number[]
  lastPushAt?: string
  lastPushStatus?: 'sent' | 'failed'
  lastPushMessage?: string
}

function resolveInterpreter(interpreter: SessionDaemonV1['interpreter'], scriptPath: string): string {
  if (interpreter === 'python') return 'python'
  if (interpreter === 'node') return 'node'
  const ext = extname(scriptPath).toLowerCase()
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'node'
  return 'python'
}

export class DaemonRuntime {
  private readonly deps: DaemonRuntimeDeps
  private readonly running = new Map<string, RunningDaemon>()
  private readonly restartBackoff: readonly number[]
  private readonly healthyResetMs: number
  private silenceTimer: NodeJS.Timeout | null = null
  private keepAwakeHeld = false
  private stopped = false
  private stopPromise: Promise<void> | null = null

  constructor(deps: DaemonRuntimeDeps) {
    this.deps = deps
    this.restartBackoff = deps.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS
    this.healthyResetMs = deps.healthyResetMs ?? HEALTHY_RESET_MS
  }

  /** Reconcile running daemons with the settings. */
  sync(settings: AppSettingsV1): void {
    if (this.stopped) return
    const desired = new Map<string, SessionDaemonV1>()
    if (settings.schedule.daemons.enabled) {
      for (const daemon of settings.schedule.daemons.items) {
        if (daemon.enabled) desired.set(daemon.id, daemon)
      }
    }
    for (const [id, daemon] of desired) {
      const entry = this.running.get(id)
      if (!entry) {
        this.startDaemon(daemon)
        continue
      }
      if (this.configKey(entry.daemon) !== this.configKey(daemon)) {
        entry.daemon = daemon
        this.restartEntry(entry, 'config changed')
      } else {
        entry.daemon = daemon
      }
    }
    for (const [id, entry] of [...this.running]) {
      if (!desired.has(id)) {
        this.stopEntry(entry)
        this.running.delete(id)
      }
    }
    this.syncPowerSave()
  }

  async status(): Promise<DaemonRuntimeStatus> {
    const items: DaemonRuntimeItemStatus[] = [...this.running.values()].map((entry) => {
      const item: DaemonRuntimeItemStatus = {
        id: entry.daemon.id,
        state: entry.state,
        pid: entry.pid,
        startedAt: entry.startedAt ? new Date(entry.startedAt).toISOString() : undefined,
        lastHeartbeatAt: entry.lastHeartbeatAt
          ? new Date(entry.lastHeartbeatAt).toISOString()
          : undefined,
        lastOutputAt: entry.lastOutputAt ? new Date(entry.lastOutputAt).toISOString() : undefined,
        restartCount: entry.restartCount,
        lastError: entry.lastError,
        logPath: this.logPath(entry.daemon.id)
      }
      if (entry.lastPushAt) {
        item.lastPush = {
          status: entry.lastPushStatus ?? 'sent',
          at: entry.lastPushAt,
          ...(entry.lastPushMessage ? { message: entry.lastPushMessage } : {})
        }
      }
      return item
    })
    return {
      items,
      powerSaveBlockerActive: this.deps.powerSaveController?.isActive() ?? false
    }
  }

  async restart(id: string): Promise<DaemonActionResult> {
    if (this.stopped) return { ok: false, message: 'Daemon runtime stopped.' }
    const entry = this.running.get(id)
    if (!entry) return { ok: false, message: 'Daemon is not running.' }
    if (entry.state === 'restarting') return { ok: false, message: 'Daemon is already restarting.' }
    this.restartEntry(entry, 'manual restart')
    return { ok: true }
  }

  async readLogs(
    id: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<DaemonLogPage> {
    const filePath = this.logPath(id)
    let text = ''
    try {
      text = readFileSync(filePath, 'utf8')
    } catch {
      return { lines: [], eof: true }
    }
    const lines = text.split('\n')
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const limit = Math.max(1, Math.min(Number(options.limit) || 200, 2_000))
    const parsedCursor = Number(options.cursor)
    const start = Number.isFinite(parsedCursor) && parsedCursor >= 0
      ? Math.min(parsedCursor, lines.length)
      : Math.max(0, lines.length - limit)
    const slice = lines.slice(start, start + limit)
    const nextCursor = start + slice.length
    return { lines: slice, nextCursor: String(nextCursor), eof: nextCursor >= lines.length }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopped = true
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer)
      this.silenceTimer = null
    }
    const entries = [...this.running.values()]
    for (const entry of entries) this.stopEntry(entry)
    this.running.clear()
    this.releasePowerSave()
    this.stopPromise = Promise.allSettled(entries.map((entry) => entry.exitPromise)).then(() => undefined)
    return this.stopPromise
  }

  // ---------------------------------------------------------------------------
  // Process lifecycle
  // ---------------------------------------------------------------------------

  private startDaemon(daemon: SessionDaemonV1): void {
    const entry: RunningDaemon = {
      daemon,
      child: null,
      state: 'starting',
      restartCount: 0,
      generation: 0,
      restartTimer: null,
      stopTimer: null,
      exitPromise: Promise.resolve(),
      pushTimestamps: []
    }
    this.running.set(daemon.id, entry)
    this.startEntry(entry)
    this.ensureSilenceMonitor()
  }

  private startEntry(entry: RunningDaemon): void {
    if (this.stopped) return
    const daemon = entry.daemon
    const scriptPath = this.resolveScriptPath(daemon)
    if (!scriptPath) {
      this.failEntry(entry, 'Script not found. Expected at workspaceRoot/scriptPath.')
      return
    }
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer)
      entry.restartTimer = null
    }
    const interpreter = resolveInterpreter(daemon.interpreter, daemon.scriptPath)
    entry.generation += 1
    entry.state = 'starting'
    entry.lastError = undefined
    entry.lastOutputAt = Date.now()
    this.appendLog(daemon.id, `[kun] starting daemon interpreter=${interpreter} script=${scriptPath}\n`)
    const generation = entry.generation
    let exitResolve: () => void = () => undefined
    entry.exitPromise = new Promise((resolve) => { exitResolve = resolve })
    const child = this.deps.spawnProcess
      ? this.deps.spawnProcess(interpreter, [scriptPath], this.spawnOptions(daemon, scriptPath))
      : spawn(interpreter, [scriptPath], this.spawnOptions(daemon, scriptPath))
    entry.child = child
    child.once('error', (error) => {
      if (entry.generation !== generation) return
      exitResolve()
      this.appendLog(daemon.id, `[kun] spawn error: ${error.message}\n`)
      this.failEntry(entry, `Failed to start: ${error.message}`)
    })
    child.once('spawn', () => {
      if (entry.generation !== generation) return
      entry.pid = child.pid
      entry.startedAt = Date.now()
      entry.state = 'running'
      this.appendLog(daemon.id, `[kun] daemon started pid=${child.pid ?? 'unknown'}\n`)
      this.syncPowerSave()
    })
    child.stdout?.on('data', (chunk: Buffer) => this.handleOutput(entry, chunk, generation))
    child.stderr?.on('data', (chunk: Buffer) => this.handleOutput(entry, chunk, generation))
    child.once('exit', (code, signal) => {
      exitResolve()
      if (entry.generation !== generation) return
      entry.child = null
      if (entry.stopTimer) {
        clearTimeout(entry.stopTimer)
        entry.stopTimer = null
      }
      if (this.stopped || entry.state === 'paused') return
      this.appendLog(daemon.id, `[kun] daemon exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`)
      this.scheduleRestart(entry, `exited with code ${code ?? 'null'}`)
    })
  }

  private stopEntry(entry: RunningDaemon): void {
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer)
      entry.restartTimer = null
    }
    entry.state = 'paused'
    this.stopChild(entry)
  }

  private stopChild(entry: RunningDaemon): void {
    const child = entry.child
    entry.child = null
    if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) return
    const generation = entry.generation
    const pid = child.pid
    const force = (): void => {
      if (entry.generation !== generation) return
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      this.deps.killProcessTree?.(pid)
    }
    try {
      child.kill('SIGTERM')
    } catch {
      force()
      return
    }
    const timer = setTimeout(force, STOP_GRACE_MS)
    timer.unref?.()
    entry.stopTimer = timer
  }

  private restartEntry(entry: RunningDaemon, reason: string): void {
    this.stopChild(entry)
    this.appendLog(entry.daemon.id, `[kun] restart requested: ${reason}\n`)
    entry.state = 'restarting'
    this.startEntry(entry)
  }

  private scheduleRestart(entry: RunningDaemon, reason: string): void {
    entry.restartCount += 1
    this.appendLog(entry.daemon.id, `[kun] restart #${entry.restartCount}: ${reason}\n`)
    if (!entry.daemon.restartOnFailure) {
      this.failEntry(entry, reason)
      return
    }
    if (entry.restartCount > MAX_CONSECUTIVE_RESTARTS) {
      this.failEntry(entry, `Too many consecutive restarts (${reason}).`)
      return
    }
    const backoff = this.restartBackoff[Math.min(entry.restartCount - 1, this.restartBackoff.length - 1)] ?? 120_000
    entry.state = 'restarting'
    entry.lastError = reason
    this.appendLog(entry.daemon.id, `[kun] will restart in ${Math.round(backoff / 1000)}s\n`)
    const timer = setTimeout(() => {
      entry.restartTimer = null
      this.startEntry(entry)
    }, backoff)
    timer.unref?.()
    entry.restartTimer = timer
    this.syncPowerSave()
  }

  private failEntry(entry: RunningDaemon, message: string): void {
    entry.state = 'error'
    entry.lastError = message
    this.appendLog(entry.daemon.id, `[kun] daemon error: ${message}\n`)
    this.syncPowerSave()
  }

  // ---------------------------------------------------------------------------
  // Output, control frames, silence
  // ---------------------------------------------------------------------------

  private handleOutput(entry: RunningDaemon, chunk: Buffer, generation: number): void {
    if (entry.generation !== generation) return
    const text = chunk.toString('utf8')
    this.appendLog(entry.daemon.id, text)
    entry.lastOutputAt = Date.now()
    if (entry.restartCount > 0 && entry.startedAt && Date.now() - entry.startedAt > this.healthyResetMs) {
      entry.restartCount = 0
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('[kun-heartbeat]')) {
        entry.lastHeartbeatAt = Date.now()
        continue
      }
      if (trimmed.startsWith('[kun-push]')) {
        this.handlePushFrame(entry, trimmed.slice('[kun-push]'.length).trim())
      }
    }
  }

  private handlePushFrame(entry: RunningDaemon, raw: string): void {
    let payload: { text?: unknown } | null = null
    try {
      payload = JSON.parse(raw) as { text?: unknown }
    } catch {
      this.appendLog(entry.daemon.id, '[kun] push frame is not valid JSON; ignored.\n')
      return
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (!text) {
      this.appendLog(entry.daemon.id, '[kun] push frame has no text; ignored.\n')
      return
    }
    if (text.length > MAX_PUSH_TEXT_LENGTH) {
      this.appendLog(entry.daemon.id, `[kun] push frame text too long (max ${MAX_PUSH_TEXT_LENGTH}); ignored.\n`)
      return
    }
    if (!this.rateLimitAllow(entry)) {
      this.appendLog(entry.daemon.id, `[kun] push rate limit exceeded (max ${MAX_PUSHES_PER_MINUTE}/min); ignored.\n`)
      return
    }
    const pushText = this.deps.pushText
    if (!pushText) {
      this.appendLog(entry.daemon.id, '[kun] push target unavailable; frame ignored.\n')
      return
    }
    void pushText({ daemon: entry.daemon, text }).then((result) => {
      entry.lastPushStatus = result.ok ? 'sent' : 'failed'
      entry.lastPushAt = new Date().toISOString()
      entry.lastPushMessage = result.ok ? undefined : result.message
      this.appendLog(entry.daemon.id, `[kun] push ${result.ok ? 'sent' : 'failed'}${result.message ? `: ${result.message}` : ''}\n`)
    })
  }

  private rateLimitAllow(entry: RunningDaemon): boolean {
    const now = Date.now()
    entry.pushTimestamps = entry.pushTimestamps.filter((at) => now - at < 60_000)
    if (entry.pushTimestamps.length >= MAX_PUSHES_PER_MINUTE) return false
    entry.pushTimestamps.push(now)
    return true
  }

  private ensureSilenceMonitor(): void {
    if (this.silenceTimer || this.stopped) return
    this.silenceTimer = setInterval(() => this.checkSilence(), SILENCE_MONITOR_INTERVAL_MS)
    this.silenceTimer.unref?.()
  }

  private checkSilence(): void {
    const now = Date.now()
    for (const entry of this.running.values()) {
      if (entry.state !== 'running' || !entry.child) continue
      const timeoutMs = entry.daemon.silenceTimeoutSeconds * 1000
      const last = entry.lastOutputAt ?? entry.startedAt ?? now
      if (now - last > timeoutMs) {
        this.appendLog(entry.daemon.id, '[kun] silence timeout; restarting.\n')
        this.restartEntry(entry, 'silence timeout')
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private configKey(daemon: SessionDaemonV1): string {
    return [
      daemon.workspaceRoot,
      daemon.scriptPath,
      daemon.interpreter,
      daemon.heartbeatIntervalSeconds,
      daemon.silenceTimeoutSeconds
    ].join('|')
  }

  private resolveScriptPath(daemon: SessionDaemonV1): string | null {
    const script = daemon.scriptPath.trim()
    if (!script) return null
    const candidate = this.isAbsolutePath(script)
      ? script
      : join(daemon.workspaceRoot.trim() || '.', script)
    return existsSync(candidate) ? candidate : null
  }

  private isAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
  }

  private spawnOptions(daemon: SessionDaemonV1, scriptPath: string): {
    cwd: string
    env: NodeJS.ProcessEnv
    windowsHide: boolean
  } {
    const workspaceRoot = daemon.workspaceRoot.trim() || '.'
    return {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        KUN_DAEMON_ID: daemon.id,
        KUN_WORKSPACE: workspaceRoot,
        KUN_THREAD_ID: daemon.threadId,
        KUN_DAEMON_INTERVAL: String(daemon.heartbeatIntervalSeconds),
        KUN_DAEMON_LOG: this.logPath(daemon.id),
        KUN_DAEMON_SILENCE_TIMEOUT: String(daemon.silenceTimeoutSeconds)
      },
      windowsHide: true
    }
  }

  private logPath(daemonId: string): string {
    return join(this.deps.logDir, 'daemons', `${daemonId}.log`)
  }

  private appendLog(daemonId: string, text: string): void {
    const filePath = this.logPath(daemonId)
    try {
      if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true })
      const size = existsSync(filePath) ? statSync(filePath).size : 0
      if (size > DAEMON_LOG_MAX_BYTES) {
        try { renameSync(filePath, `${filePath}.old`) } catch { /* keep current */ }
      }
      appendFileSync(filePath, text, 'utf8')
    } catch (error) {
      this.deps.logError('daemon-log', 'Failed to write daemon log', {
        daemonId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private syncPowerSave(): void {
    const anyActive = [...this.running.values()].some(
      (entry) => entry.state === 'starting' || entry.state === 'running' || entry.state === 'restarting'
    )
    const controller = this.deps.powerSaveController
    if (!controller) return
    if (anyActive) {
      if (!this.keepAwakeHeld) {
        this.keepAwakeHeld = controller.acquire()
      }
    } else if (this.keepAwakeHeld) {
      controller.release()
      this.keepAwakeHeld = false
    }
  }

  private releasePowerSave(): void {
    if (!this.keepAwakeHeld) return
    this.deps.powerSaveController?.release()
    this.keepAwakeHeld = false
  }
}

export function createDaemonRuntime(deps: DaemonRuntimeDeps): DaemonRuntime {
  return new DaemonRuntime(deps)
}
