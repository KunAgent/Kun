import { canonical } from '@kun/remote-protocol'
import type { RemoteFork } from '../contracts/remote-history.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ThreadService, ForkThreadOptions } from './thread-service-core.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import { PolicyMutationRejected } from '../domain/remote-policy-revision.js'

/** Symbols are internal capabilities; JSON/HTTP callers cannot set them. */
export const REMOTE_FORK = Symbol('host-remote-fork')
export const REMOTE_FORK_LOCKED = Symbol('host-remote-fork-locked')
export type RemoteForkOptions = ForkThreadOptions & { [REMOTE_FORK]?: { id: string; provenance: RemoteFork; assertIdle?: () => Promise<void> }; [REMOTE_FORK_LOCKED]?: true }
export async function remoteForkLocked(service: ThreadService, sourceId: string, options: RemoteForkOptions): Promise<ThreadRecord> {
  const target = options[REMOTE_FORK]!, store = service['threadStore'], sessions = service['sessionStore']
  return withManagerDataMutex(`thread:${sourceId}`, () => withThreadStoreMutation(store, sourceId, () =>
    withThreadStoreMutation(store, target.id, async () => {
      const old = await store.get(target.id)
      if (old) {
        if (old.parentThreadId !== sourceId || old.relation !== 'fork' || canonical(old.remoteFork) !== canonical(target.provenance))
          throw new Error('REMOTE_FORK_CONFLICT')
        return old
      }
      const source = await store.get(sourceId)
      if (!source) throw new PolicyMutationRejected('NOT_FOUND')
      if ((source.revision ?? 0) !== target.provenance.sourceRevision ||
        (await sessions.itemHistoryVersion?.(sourceId) ?? 'legacy') !== target.provenance.historyVersion)
        throw new PolicyMutationRejected('REVISION_CONFLICT')
      if (source.remoteRewind?.phase === 'pending' || source.goal?.status === 'active') throw new PolicyMutationRejected('TASK_BUSY')
      if (source.turns.some(turn => turn.status === 'running' || turn.status === 'queued')) throw new PolicyMutationRejected('TASK_BUSY')
      await target.assertIdle?.()
      if (source.roomContext || source.workspaceMode === 'ade' || source.executionUnit?.kind === 'worker' ||
        source.designProfile || source.agentSurface && source.agentSurface !== 'code' ||
        !source.turns.some(turn => turn.id === options.turnId)) throw new PolicyMutationRejected('INVALID_REQUEST')
      return service.fork(sourceId, { ...options, [REMOTE_FORK_LOCKED]: true } as RemoteForkOptions)
    })))
}
