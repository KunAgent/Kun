import type { ChildProcess } from 'node:child_process'
import { isKunHealthResponseBody } from '../kun-health'

const KUN_READY_PREFIX = 'KUN_READY '
const KUN_STARTUP_TIMEOUT_FLOOR_MS = 15_000
const KUN_STARTUP_TIMEOUT_CEILING_MS = 600_000
const STDERR_TAIL_MAX_CHARS = 32_768

export type KunStartupHealthOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  healthPollMs?: number
  healthRequestTimeoutMs?: number
  probeHealth?: (port: number) => Promise<boolean>
}

export type KunRuntimeHealthProbeResult = { healthy: boolean; error: string }

export type KunRuntimeHealthMonitorDeps<Settings> = {
  runtimeBaseUrl: (settings: Settings) => string
  runtimeHeaders: (settings: Settings) => HeadersInit
  warn: (source: string, message: string) => void
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/** Owns post-start/runtime watchdog health polling and per-endpoint single-flight probes. */
export class KunRuntimeHealthMonitor<Settings> {
  private readonly inFlight = new Map<string, Promise<KunRuntimeHealthProbeResult>>()

  constructor(private readonly deps: KunRuntimeHealthMonitorDeps<Settings>) {}

  async waitForHealthy(settings: Settings, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const base = this.deps.runtimeBaseUrl(settings)
    const deadline = performance.now() + timeoutMs
    let lastError = ''
    while (performance.now() <= deadline) {
      signal?.throwIfAborted()
      const remaining = Math.max(1, Math.ceil(deadline - performance.now()))
      const result = await this.probeOnce(settings, base, remaining, signal)
      signal?.throwIfAborted()
      if (result.healthy) return true
      if (result.error !== lastError) {
        lastError = result.error
        this.deps.warn('health-probe', `${base}/health: ${result.error}`)
      }
      await (this.deps.sleep ?? sleep)(150)
    }
    this.deps.warn('health-probe', `gave up after ${timeoutMs}ms, last error: ${lastError}`)
    return false
  }

  probeOnce(
    settings: Settings,
    base = this.deps.runtimeBaseUrl(settings),
    remainingMs = 1_000,
    signal?: AbortSignal
  ): Promise<KunRuntimeHealthProbeResult> {
    const existing = this.inFlight.get(base)
    if (existing) return existing
    let task: Promise<KunRuntimeHealthProbeResult>
    task = (async () => {
      try {
        const response = await (this.deps.fetch ?? fetch)(`${base}/health`, {
          headers: this.deps.runtimeHeaders(settings),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(1_000, remainingMs)))])
            : AbortSignal.timeout(Math.max(1, Math.min(1_000, remainingMs)))
        })
        const healthy = response.ok && isKunHealthResponseBody(await response.text())
        return { healthy, error: healthy ? '' : `unexpected status ${response.status}` }
      } catch (error) {
        return {
          healthy: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })().finally(() => {
      if (this.inFlight.get(base) === task) this.inFlight.delete(base)
    })
    this.inFlight.set(base, task)
    return task
  }
}

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

export async function waitForKunStartup(
  startedChild: ChildProcess,
  port?: number,
  options: KunStartupHealthOptions = {}
): Promise<void> {
  options.signal?.throwIfAborted()
  const timeoutMs = options.timeoutMs ?? resolveKunStartupTimeoutMs(process.platform, process.env)
  const healthPollMs = options.healthPollMs ?? 500
  const probeHealth = options.probeHealth ?? ((targetPort) => probeKunHealth(
    targetPort,
    options.healthRequestTimeoutMs ?? 1_000
  ))
  if (startedChild.exitCode !== null) {
    throw new Error(describeKunExit(startedChild.exitCode, null))
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let stdoutBuffer = ''
    let stderrTail = ''
    let healthProbeInFlight = false
    let healthConfirmed = false
    let readyMarkerSeen = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(describeKunStartupTimeout(timeoutMs, stderrTail, readyMarkerSeen && Boolean(port))))
    }, timeoutMs)
    const healthTimer = port
      ? setInterval(() => {
          if (settled || healthProbeInFlight) return
          healthProbeInFlight = true
          void probeHealth(port)
            .then((healthy) => {
              if (healthy) {
                healthConfirmed = true
                settleReady()
              }
            })
            .finally(() => {
              healthProbeInFlight = false
            })
        }, healthPollMs)
      : null
    const cleanup = (): void => {
      clearTimeout(timer)
      if (healthTimer) clearInterval(healthTimer)
      startedChild.removeListener('exit', onExit)
      startedChild.removeListener('error', onError)
      startedChild.stdout?.removeListener('data', onStdout)
      startedChild.stderr?.removeListener('data', onStderr)
      options.signal?.removeEventListener('abort', onAbort)
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
      readyMarkerSeen = true
      if (healthConfirmed || !healthTimer) settleReady()
    }
    const onStderr = (chunk: Buffer | string): void => {
      stderrTail = appendTail(stderrTail, String(chunk), STDERR_TAIL_MAX_CHARS)
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
    const onAbort = (): void => onError(options.signal!.reason)
    startedChild.stdout?.on('data', onStdout)
    startedChild.stderr?.on('data', onStderr)
    startedChild.once('exit', onExit)
    startedChild.once('error', onError)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
  })
}

export function describeKunExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail = ''
): string {
  const suffix = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
  if (signal) return `Kun exited during startup with signal ${signal}${suffix}`
  if (typeof code === 'number') return `Kun exited during startup with code ${code}${suffix}`
  return `Kun exited during startup${suffix}`
}

export function describeKunStartupTimeout(
  timeoutMs: number,
  stderrTail: string,
  sawReadyMarker = false
): string {
  const suffix = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
  if (sawReadyMarker) {
    return `Kun reported ready but did not pass health checks within ${timeoutMs}ms${suffix}`
  }
  return `Kun did not report ready within ${timeoutMs}ms${suffix}`
}

export async function probeKunHealth(port: number, timeoutMs = 1_000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return false
    return isKunHealthResponseBody(await response.text())
  } catch {
    return false
  }
}

function appendTail(current: string, nextChunk: string, maxChars: number): string {
  const combined = `${current}${nextChunk}`
  return combined.length > maxChars ? combined.slice(-maxChars) : combined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
