import type { AgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'
import type { WorkerCreateResult } from './manager-runtime.js'
import { assignmentFallbacks, workerDispatchIds } from './worker-dispatch-ids.js'

/** Reconstruct batch progress from durable assignments, never from the card's first target. */
export async function workerBatchResult(
  deps: ManagerRuntimeDeps, result: WorkerCreateResult, intent: AgentDispatchIntent | null | undefined,
  inputs: Array<{ label: string }>
) {
  const { workerId: _worker, dispatchId: _dispatch, dispatched: _dispatched, ...summary } = result
  let pending = 0, created = 0, failed = 0, skipped = 0, dispatched = 0
  const fallbacks = intent ? assignmentFallbacks(intent) : []
  const items = []
  for (const [index, input] of inputs.entries()) {
    const ids = intent ? workerDispatchIds(intent, index, fallbacks[index] ?? 0) : undefined
    const record = ids && intent ? await deps.dispatches.get(intent.source.threadId, ids.dispatchId) : null
    const worker = ids && intent ? await deps.teams.worker(intent.source.threadId, ids.workerId) : null
    // Older skipped records have only the host-authored failure message.
    const isSkipped = record?.prelaunchDisposition === 'skipped' ||
      (!record?.prelaunchDisposition && record?.failureReason?.startsWith('Skipped after dispatch refusal:'))
    const wasDispatched = Boolean(record && (record.turnId || record.outcome || record.state === 'accepted' || record.state === 'completed'))
    const waiting = !record && intent && !['failed', 'cancelled', 'completed'].includes(intent.state)
    if (worker) created++
    else if (isSkipped) skipped++
    else if (waiting) pending++
    else failed++
    if (wasDispatched) dispatched++
    const itemResult: WorkerCreateResult | 'skipped' = isSkipped ? 'skipped' : {
      ok: worker ? !['failed', 'cancelled'].includes(record?.state ?? '') : Boolean(waiting),
      capacity: result.capacity, dispatchIntentId: result.dispatchIntentId,
      ...(!record && result.refusal ? { refusal: result.refusal } : {}),
      ...(worker ? { workerId: worker.workerId, route: worker.route } : {}),
      ...(record ? { dispatchId: record.dispatchId } : {}),
      dispatched: wasDispatched,
      userReport: record?.failureReason ?? (record ? `Dispatch ${record.state}.` : result.userReport)
    }
    items.push({ index, label: input.label, ...(record ? { dispatchId: record.dispatchId } : {}),
      state: isSkipped ? 'skipped' : record?.state ?? (waiting ? 'pending' : intent?.state ?? 'refused'), result: itemResult })
  }
  return { ...summary, pending, requested: inputs.length, created, failed, refused: failed, skipped, dispatched, items }
}
