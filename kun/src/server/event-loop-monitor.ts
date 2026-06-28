import { performance } from 'node:perf_hooks'

export type EventLoopMonitorHandle = { stop: () => void }

export type EventLoopMonitorOptions = {
  /** Heartbeat cadence; the smaller this is, the finer the stall resolution. */
  intervalMs?: number
  /** Log when a heartbeat fires this much later than its scheduled interval. */
  stallThresholdMs?: number
  /** Injectable monotonic clock (defaults to performance.now()). */
  now?: () => number
  /** Injectable log sink (defaults to console.warn → captured by the GUI). */
  log?: (line: string) => void
}

const DEFAULT_INTERVAL_MS = 1_000
const DEFAULT_STALL_THRESHOLD_MS = 2_000

/**
 * Logs when the runtime's (single) event loop stalls — i.e. a heartbeat timer
 * fires much later than scheduled because synchronous work blocked the loop in
 * between. A stall is exactly the window during which `/health` probes and SSE
 * time out, so this disambiguates the two failure modes behind a watchdog
 * restart (KunAgent/Kun#621):
 *
 *   - a stall is logged and the runtime keeps going → CPU starvation: a heavy
 *     synchronous step blocked the loop; the magnitude is how long `/health`
 *     was unanswerable.
 *   - the GUI reports the runtime unhealthy but NO stall is ever logged (the
 *     heartbeat never fires again) → a hard hang / deadlock: the loop is wedged,
 *     not merely busy.
 *
 * Cheap: a single `unref`'d timer that only logs above the threshold.
 */
export function startEventLoopMonitor(options: EventLoopMonitorOptions = {}): EventLoopMonitorHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
  const now = options.now ?? (() => performance.now())
  const log = options.log ?? ((line: string) => console.warn(line))

  let last = now()
  const timer = setInterval(() => {
    const current = now()
    const stall = current - last - intervalMs
    last = current
    if (stall >= stallThresholdMs) {
      log(
        `[kun] event loop stalled for ~${Math.round(stall)}ms — ` +
          `health checks and SSE were unanswerable during this window`
      )
    }
  }, intervalMs)
  // Never keep the process alive for the monitor alone.
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/** Resolve the stall-log threshold, overridable via `KUN_EVENT_LOOP_STALL_LOG_MS`. */
export function resolveEventLoopStallThresholdMs(env: NodeJS.ProcessEnv): number {
  const raw = env.KUN_EVENT_LOOP_STALL_LOG_MS
  if (raw && raw.trim()) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return DEFAULT_STALL_THRESHOLD_MS
}
