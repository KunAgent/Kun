import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { totalmem } from 'node:os'

/**
 * kun serve memory-pressure monitor.
 *
 * The feedback driving this: Kun being killed by OOM/compaction pressure is an
 * interruption the user has to manually explain afterwards. The runtime cannot
 * snapshot memory, but it can act before the kill:
 *
 * - Level 1 (warning): publish `memory_pressure_warning` to every active
 *   thread, evict rebuildable Session caches, compact a bounded number of idle
 *   histories, and cap new subagent admission at two.
 * - Level 2 (critical): publish `memory_pressure_critical`, cap new subagent
 *   admission at one, and request a graceful shutdown. `runtime.shutdown`
 *   parks running turns before closing stores, so restart recovery can resume
 *   them instead of misclassifying the stop as user cancellation.
 *
 * Thresholds default to sane values and can be tuned via config
 * (`runtime.memoryPressure`) or environment variables, so operators can tune
 * without code changes.
 */

export type MemoryPressureMonitorConfig = {
  enabled?: boolean
  pollIntervalMs?: number
  warnRssBytes?: number
  criticalRssBytes?: number
  /** Max idle threads compacted per warning sweep (bounds the cost). */
  maxCompactionsPerSweep?: number
}

export type MemoryPressureMonitorDeps = {
  config?: MemoryPressureMonitorConfig
  threadStore: ThreadStore
  sessionStore: Pick<SessionStore, 'resetMemory'>
  turnService: Pick<TurnService, 'compact'>
  events: Pick<RuntimeEventRecorder, 'record'>
  instanceId: string
  requestShutdown: (instanceId: string) => Promise<boolean>
  setSubagentParallelLimit?: (limit?: number) => void
  /** Clamp all root, child, and Graph turn admission while pressure is elevated. */
  setAdmissionParallelLimit?: (limit?: number) => void
  totalMemoryBytes?: () => number
  log?: (message: string) => void
}

export const DEFAULT_MEMORY_PRESSURE_POLL_INTERVAL_MS = 15_000
export const DEFAULT_MEMORY_PRESSURE_WARN_RSS_BYTES = 6_442_450_944 // 6 GiB
export const DEFAULT_MEMORY_PRESSURE_CRITICAL_RSS_BYTES = 10_737_418_240 // 10 GiB
export const DEFAULT_MEMORY_PRESSURE_MAX_COMPACTIONS_PER_SWEEP = 3
export const DEFAULT_MEMORY_PRESSURE_SUBAGENT_PARALLEL_LIMIT = 2
export const DEFAULT_MEMORY_PRESSURE_WARN_HOST_FRACTION = 0.65
export const DEFAULT_MEMORY_PRESSURE_CRITICAL_HOST_FRACTION = 0.8
const MEMORY_PRESSURE_RECOVERY_FRACTION = 0.85

export type MemoryPressureMonitor = {
  stop: () => void
}

type MemorySnapshot = {
  rssMiB: number
  heapTotalMiB: number
  heapUsedMiB: number
  externalMiB: number
  arrayBuffersMiB: number
}

type ActiveWork = {
  threadId: string
  turnIds: string[]
}

function toMiB(value: number): number {
  return Number.isFinite(value) ? Math.round(value / (1024 * 1024)) : 0
}

function memorySnapshot(): MemorySnapshot {
  const memory = process.memoryUsage()
  return {
    rssMiB: toMiB(memory.rss),
    heapTotalMiB: toMiB(memory.heapTotal),
    heapUsedMiB: toMiB(memory.heapUsed),
    externalMiB: toMiB(memory.external),
    arrayBuffersMiB: toMiB(memory.arrayBuffers)
  }
}

function envNumber(name: string): number | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function startMemoryPressureMonitor(deps: MemoryPressureMonitorDeps): MemoryPressureMonitor {
  const config = deps.config ?? {}
  const pollIntervalMs =
    config.pollIntervalMs ??
    envNumber('KUN_MEMORY_POLL_INTERVAL_MS') ??
    DEFAULT_MEMORY_PRESSURE_POLL_INTERVAL_MS
  const hostBytes = deps.totalMemoryBytes?.() ?? totalmem()
  const relativeWarn = Number.isFinite(hostBytes) && hostBytes > 0
    ? Math.floor(hostBytes * DEFAULT_MEMORY_PRESSURE_WARN_HOST_FRACTION)
    : DEFAULT_MEMORY_PRESSURE_WARN_RSS_BYTES
  const relativeCritical = Number.isFinite(hostBytes) && hostBytes > 0
    ? Math.floor(hostBytes * DEFAULT_MEMORY_PRESSURE_CRITICAL_HOST_FRACTION)
    : DEFAULT_MEMORY_PRESSURE_CRITICAL_RSS_BYTES
  const warnRssBytes =
    config.warnRssBytes ??
    envNumber('KUN_MEMORY_WARN_RSS_BYTES') ??
    Math.min(DEFAULT_MEMORY_PRESSURE_WARN_RSS_BYTES, relativeWarn)
  const criticalRssBytes = Math.max(warnRssBytes + 1,
    config.criticalRssBytes ??
    envNumber('KUN_MEMORY_CRITICAL_RSS_BYTES') ??
    Math.min(DEFAULT_MEMORY_PRESSURE_CRITICAL_RSS_BYTES, relativeCritical))
  const maxCompactionsPerSweep =
    config.maxCompactionsPerSweep ?? DEFAULT_MEMORY_PRESSURE_MAX_COMPACTIONS_PER_SWEEP

  let stopped = false
  let currentLevel: 'ok' | 'warn' | 'critical' = 'ok'
  let sweeping = false
  let warningHandling = false
  let criticalExitRequested = false
  const sweptIdleThreads = new Set<string>()

  const log = deps.log ?? ((message: string) => console.warn(`[kun] ${message}`))

  const poll = (): void => {
    if (stopped) return
    try {
      const rss = process.memoryUsage().rss
      const nextLevel = memoryPressureLevel({ rss, currentLevel, warnRssBytes, criticalRssBytes })
      const previous = currentLevel
      currentLevel = nextLevel
      if (nextLevel !== previous) {
        const limit = nextLevel === 'ok' ? undefined : nextLevel === 'critical'
          ? 1 : DEFAULT_MEMORY_PRESSURE_SUBAGENT_PARALLEL_LIMIT
        deps.setSubagentParallelLimit?.(limit)
        deps.setAdmissionParallelLimit?.(limit)
      }
      if (nextLevel === 'ok') {
        sweptIdleThreads.clear()
        return
      }

      const memory = memorySnapshot()
      if (nextLevel === 'critical') {
        if (!criticalExitRequested) {
          criticalExitRequested = true
          void handleCritical(memory)
        }
        return
      }

      // Keep reclaiming a bounded new batch on every warning poll. The
      // handler is single-flight and remembers already attempted threads.
      void handleWarning(memory, previous !== 'warn')
    } catch (error) {
      log(`memory pressure check failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const listActiveWork = async (): Promise<{
    active: ActiveWork[]
    summaries: Awaited<ReturnType<ThreadStore['list']>>
  }> => {
    const summaries = await deps.threadStore.list({ includeSide: true })
    const activeSummaries = summaries.filter((summary) => summary.status === 'running')
    const active = await Promise.all(activeSummaries.map(async (summary) => {
      const metadata = deps.threadStore.getMetadata
        ? await deps.threadStore.getMetadata(summary.id).catch(() => null)
        : null
      return {
        threadId: summary.id,
        turnIds: metadata?.turns
          .filter((turn) => turn.status === 'queued' || turn.status === 'running')
          .map((turn) => turn.id) ?? []
      }
    }))
    return { active, summaries }
  }

  const recordPressure = async (
    level: 'warning' | 'critical',
    memory: MemorySnapshot,
    active: ActiveWork[]
  ): Promise<void> => {
    const affectedThreadIds = active.map((work) => work.threadId)
    const affectedTurnIds = active.flatMap((work) => work.turnIds)
    const details = {
      event: level === 'critical' ? 'runtime_shutdown' : 'memory_pressure',
      reason: 'memory_pressure',
      level,
      instanceId: deps.instanceId,
      ...memory,
      affectedThreadIds,
      affectedTurnIds,
      timestamp: new Date().toISOString()
    }
    log(JSON.stringify(details))
    await Promise.allSettled(active.map((work) => deps.events.record({
      kind: 'error',
      threadId: work.threadId,
      ...(work.turnIds[0] ? { turnId: work.turnIds[0] } : {}),
      itemId: `runtime_memory_pressure_${level}_${deps.instanceId}`,
      message: level === 'critical'
        ? `Agent Runtime reached ${memory.rssMiB} MiB RSS. Active work is being suspended and the Runtime will restart automatically.`
        : `Agent Runtime memory usage reached ${memory.rssMiB} MiB RSS. New subagents are temporarily limited while memory is reclaimed.`,
      code: level === 'critical' ? 'memory_pressure_critical' : 'memory_pressure_warning',
      details,
      severity: level === 'critical' ? 'error' : 'warning'
    })))
  }

  const handleCritical = async (memory: MemorySnapshot): Promise<void> => {
    try {
      const { active } = await listActiveWork()
      await recordPressure('critical', memory, active)
    } catch (error) {
      log(`memory pressure critical diagnostics failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await deps.requestShutdown(deps.instanceId).catch(() => false)
    }
  }

  const handleWarning = async (memory: MemorySnapshot, announce: boolean): Promise<void> => {
    if (warningHandling || stopped) return
    warningHandling = true
    try {
      const { active, summaries } = await listActiveWork()
      if (announce) await recordPressure('warning', memory, active)
      await deps.sessionStore.resetMemory()
      await sweepIdleThreads(summaries)
    } catch (error) {
      log(`memory pressure warning handling failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      warningHandling = false
    }
  }

  const sweepIdleThreads = async (
    summaries: Awaited<ReturnType<ThreadStore['list']>>
  ): Promise<void> => {
    if (sweeping || stopped) return
    sweeping = true
    try {
      const idle = summaries
        .filter((summary) => summary.status !== 'running' && summary.relation !== 'side' &&
          !sweptIdleThreads.has(summary.id))
        .sort((left, right) => (left.updatedAt ?? '').localeCompare(right.updatedAt ?? ''))
        .slice(0, maxCompactionsPerSweep)
      let compacted = 0
      for (const summary of idle) {
        sweptIdleThreads.add(summary.id)
        try {
          const result = await deps.turnService.compact({
            threadId: summary.id,
            request: { reason: 'memory_pressure' },
            auto: true
          })
          if (result.replacedTokens > 0) compacted += 1
        } catch {
          // One unreadable/busy thread must not stop the sweep.
        }
      }
      if (compacted > 0) {
        log(`memory pressure sweep compacted ${compacted} thread(s)`)
      }
    } catch (error) {
      log(`memory pressure sweep failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      sweeping = false
    }
  }

  const handle = setInterval(poll, pollIntervalMs)
  if (typeof (handle as { unref?: () => void }).unref === 'function') {
    ;(handle as { unref: () => void }).unref()
  }

  return {
    stop: () => {
      stopped = true
      deps.setSubagentParallelLimit?.(undefined)
      deps.setAdmissionParallelLimit?.(undefined)
      clearInterval(handle)
    }
  }
}

function memoryPressureLevel(input: {
  rss: number
  currentLevel: 'ok' | 'warn' | 'critical'
  warnRssBytes: number
  criticalRssBytes: number
}): 'ok' | 'warn' | 'critical' {
  if (input.rss >= input.criticalRssBytes) return 'critical'
  if (
    input.currentLevel === 'critical' &&
    input.rss >= input.criticalRssBytes * MEMORY_PRESSURE_RECOVERY_FRACTION
  ) return 'critical'
  if (input.rss >= input.warnRssBytes) return 'warn'
  if (
    input.currentLevel !== 'ok' &&
    input.rss >= input.warnRssBytes * MEMORY_PRESSURE_RECOVERY_FRACTION
  ) return 'warn'
  return 'ok'
}
