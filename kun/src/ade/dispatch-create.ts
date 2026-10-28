/**
 * Durable dispatch creation + localized send reports, shared by
 * `worker_send`, `worker_create`'s first dispatch, and the GUI dispatch
 * route. Extracted from ManagerControls so every caller persists and
 * delivers through one code path.
 */
import type {
  DispatchRecord,
  WorkerRecord
} from '../contracts/ade.js'
import type { DeliverOutcome } from './dispatch-deliverer.js'
import type { ManagerRuntimeDeps } from './manager-runtime.js'
import type { ReportLanguage } from './user-report.js'

/** Persist + deliver one dispatch (worker_send and the GUI route share this). */
export async function createDispatch(
  deps: Pick<ManagerRuntimeDeps, 'dispatches' | 'deliverer' | 'ids' | 'nowIso'>,
  input: {
    teamId: string
    workerId: string
    parentTurnId: string
    title?: string
    task: string
    context?: DispatchRecord['context']
    mode?: 'queue' | 'interrupt'
  }
): Promise<{ dispatch: DispatchRecord; delivered: DeliverOutcome }> {
  const now = deps.nowIso()
  const title = input.title ?? input.task.split('\n', 1)[0]?.slice(0, 80) ?? 'dispatch'
  const dispatch: DispatchRecord = {
    dispatchId: deps.ids.next('dsp'),
    teamId: input.teamId,
    workerId: input.workerId,
    parentTurnId: input.parentTurnId,
    title: title.slice(0, 240),
    task: input.task,
    ...(input.context ? { context: input.context } : {}),
    mode: input.mode ?? 'queue',
    state: 'pending',
    // execution state and acceptance stay independent tracks.
    verdict: { status: 'pending', checks: [] },
    createdAt: now,
    updatedAt: now
  }
  await deps.dispatches.create(dispatch)
  const delivered = await deps.deliverer.tryDeliver(input.teamId, dispatch.dispatchId)
  const current = await deps.dispatches.get(input.teamId, dispatch.dispatchId)
  return { dispatch: current ?? dispatch, delivered }
}

/** Localized one-line report for a created dispatch. */
export function sendReport(
  worker: WorkerRecord,
  delivered: DeliverOutcome,
  language: ReportLanguage
): string {
  if (language === 'zh') {
    const base = `已向「${worker.label}」派活`
    if (delivered.accepted) return `${base}，已开始执行。`
    if (delivered.pendingReason === 'user-control') return '未派出：该 worker 已由用户接管。'
    if (delivered.pendingReason === 'worker-busy') return `${base}，当前任务结束后自动开始。`
    if (delivered.pendingReason === 'workspace') return `${base}，尚未启动；正在等待工作区准备完成。`
    return `未启动「${worker.label}」：${delivered.failureReason ?? '派发未被接收，请检查任务状态'}。`
  }
  const base = `Dispatched to "${worker.label}"`
  if (delivered.accepted) return `${base}; it started immediately.`
  if (delivered.pendingReason === 'user-control') {
    return 'Not dispatched: the worker is under user control.'
  }
  if (delivered.pendingReason === 'worker-busy') {
    return `${base}; it starts when the current task finishes.`
  }
  if (delivered.pendingReason === 'workspace') return `${base}; not started, waiting for workspace preparation.`
  return `Not started: "${worker.label}"; ${delivered.failureReason ?? 'dispatch was not accepted; check its status'}.`
}
