import { createHash } from 'node:crypto'
import type { AgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'

type IdSource = Pick<AgentDispatchIntent, 'startRequestId' | 'replacementCount'>

/**
 * Stable worker/dispatch ids for one card assignment. An assignment rerouted
 * after its worker failed (`fallback` 1) gets fresh ids so its siblings keep
 * theirs and a restarted start reconciles with the new worker.
 */
export function workerDispatchIds(intent: IdSource, index: number, fallback = 0) {
  const seed = `${intent.startRequestId}:${intent.replacementCount}:${index}${fallback ? `:fallback:${fallback}` : ''}`
  const key = createHash('sha256').update(seed).digest('hex').slice(0, 24)
  return { workerId: `child_dispatch_${key}`, dispatchId: `dsp_dispatch_${key}` }
}

/** Per-assignment fallback counts saved in a worker card payload (0 when absent). */
export function assignmentFallbacks(intent: Pick<AgentDispatchIntent, 'payload'>): number[] {
  const items = (intent.payload as { items?: unknown } | undefined)?.items
  return Array.isArray(items)
    ? items.map((item) => (item as { fallbackCount?: unknown })?.fallbackCount === 1 ? 1 : 0)
    : []
}

/** Workers this card replaced automatically; their failures are already handled. */
export function replacedWorkerIds(intent: AgentDispatchIntent): string[] {
  const whole = intent.replacementCount > 0 ? intent.previousTarget?.workerIds ?? [] : []
  const items = assignmentFallbacks(intent).flatMap((fallback, index) =>
    fallback ? [workerDispatchIds(intent, index).workerId] : [])
  return [...whole, ...items]
}
