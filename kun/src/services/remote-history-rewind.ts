import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import type { RemoteRewind } from '../contracts/remote-history.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnService } from './turn-service-core.js'
import { PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
export async function remoteHistoryBusy(service: TurnService, thread: ThreadRecord): Promise<boolean> {
  return thread.goal?.status === 'active' || thread.turns.some(turn => turn.status === 'queued' || turn.status === 'running' ||
    service.isTurnExecutionActive(turn.id)) || Boolean(await service['deps'].executionLeases?.owner(thread.id))
}
export function rewindItemsHash(items: readonly TurnItem[]): string {
  const hash = createHash('sha256')
  for (const item of items) hash.update(canonical(JSON.parse(JSON.stringify(item)))).update('\n')
  return hash.digest('hex')
}
async function notify(service: TurnService, threadId: string, status: string) {
  try { await service['deps'].events.record({ kind: 'thread_updated', threadId, status }) }
  catch { console.warn('[kun] remote history notification unavailable') }
}
/** A durable Thread marker fences new admissions until the canonical rewrite and projection agree. */
export async function finishRemoteRewind(service: TurnService, threadId: string, plan: RemoteRewind) {
  return withManagerDataMutex(`thread:${threadId}`, () => service['withThreadMutation'](threadId, async () => {
    const deps = service['deps'], store = deps.threadStore, sessions = deps.sessionStore
    let thread = await store.get(threadId)
    if (!thread) throw new PolicyMutationRejected('NOT_FOUND')
    if (thread.remoteRewind?.operationKey === plan.operationKey &&
      canonical({ ...thread.remoteRewind, phase: 'pending' }) !== canonical({ ...plan, phase: 'pending' }))
      throw new Error('HISTORY_RECONCILIATION_REQUIRED')
    if (thread.remoteRewind?.operationKey === plan.operationKey && thread.remoteRewind.phase === 'applied') {
      await notify(service, threadId, thread.status)
      return thread
    }
    if (!thread.remoteRewind || thread.remoteRewind.operationKey !== plan.operationKey) {
      if (thread.remoteRewind?.phase === 'pending') throw new PolicyMutationRejected('TASK_BUSY')
      if ((thread.revision ?? 0) !== plan.sourceRevision || (await sessions.itemHistoryVersion?.(threadId) ?? 'legacy') !== plan.historyVersion)
        throw new PolicyMutationRejected('REVISION_CONFLICT')
      if (await remoteHistoryBusy(service, thread)) throw new PolicyMutationRejected('TASK_BUSY')
      const snapshot = await sessions.loadItemSnapshot(threadId)
      if (snapshot.revision !== plan.itemRevision || rewindItemsHash(snapshot.items) !== plan.beforeHash)
        throw new PolicyMutationRejected('REVISION_CONFLICT')
      if (!store.upsertIfRevision) throw new Error('CONDITIONAL_WRITE_UNAVAILABLE')
      const staged = await store.upsertIfRevision({ ...thread, remoteRewind: { ...plan, phase: 'pending' } }, thread.revision ?? 0)
      if (!staged.applied) throw new PolicyMutationRejected('REVISION_CONFLICT')
      thread = staged.thread ?? (await store.get(threadId))!
    }
    // From this point failures are uncertain; never label a staged rewrite as no-effect.
    if (await remoteHistoryBusy(service, thread)) throw new Error('HISTORY_RECONCILIATION_REQUIRED')
    const snapshot = await sessions.loadItemSnapshot(threadId), hash = rewindItemsHash(snapshot.items)
    const keep = new Set(plan.keepTurnIds)
    if (snapshot.revision === plan.itemRevision && hash === plan.beforeHash) {
      const result = await sessions.rewriteItemsIfRevision(threadId, snapshot.revision, snapshot.items.filter(item => keep.has(item.turnId)))
      if (!result.applied) throw new Error('HISTORY_RECONCILIATION_REQUIRED')
    } else if (hash !== plan.afterHash || (await sessions.itemHistoryVersion?.(threadId) ?? 'legacy') === plan.historyVersion) {
      throw new Error('HISTORY_RECONCILIATION_REQUIRED')
    }
    const current = await store.get(threadId)
    if (!current || current.remoteRewind?.operationKey !== plan.operationKey || !store.upsertIfRevision)
      throw new Error('HISTORY_RECONCILIATION_REQUIRED')
    const result = await store.upsertIfRevision({ ...current, turns: current.turns.filter(turn => keep.has(turn.id)),
      status: current.status === 'archived' ? 'archived' : 'idle', updatedAt: deps.nowIso(),
      remoteRewind: { ...plan, phase: 'applied' } }, current.revision ?? 0)
    if (!result.applied) throw new Error('HISTORY_RECONCILIATION_REQUIRED')
    // The committed projection is authoritative even if an observer cannot be notified.
    await notify(service, threadId, result.thread?.status ?? 'idle')
    return result.thread ?? (await store.get(threadId))!
  }))
}
