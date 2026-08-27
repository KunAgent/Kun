import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TurnService, TurnServiceDeps } from './turn-service-core.js'
import { TurnConflictError, isActiveTurn } from './turn-service-core.js'
import type {
  PrunePreviewRequest,
  PrunePreviewResponse,
  PruneThreadRequest,
  PruneThreadResponse,
  RestoreSnapshotResponse,
  ThreadSnapshotsResponse
} from '../contracts/turns.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { selectRetentionCutoff } from './thread-retention-service.js'
import { ThreadSnapshotStore } from './thread-snapshot-store.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

export const turnServicePruneOperations = {
  async previewThreadPrune(this: TurnService, input: {
    threadId: string
    request: PrunePreviewRequest
  }): Promise<PrunePreviewResponse> {
    const thread = await this['deps'].threadStore.get(input.threadId)
    if (!thread) {
      return {
        threadId: input.threadId,
        prunableTurns: 0, prunableItems: 0, retainedTurns: 0, retainedItems: 0,
        contextEstimateBefore: 0, contextEstimateAfter: 0, snapshotRequiredBytes: 0,
        blockedBy: ['thread_missing']
      }
    }
    if (thread.turns.some(isActiveTurn)) {
      return {
        threadId: input.threadId,
        prunableTurns: 0, prunableItems: 0,
        retainedTurns: thread.turns.length,
        retainedItems: thread.turns.reduce((count, turn) => count + turn.items.length, 0),
        contextEstimateBefore: 0, contextEstimateAfter: 0, snapshotRequiredBytes: 0,
        blockedBy: ['active_turn']
      }
    }
    const cutoffTurnId = selectRetentionCutoff(thread, input.request, this['deps'].nowIso())
    const snapshotBytes = await estimateSnapshotBytes(this['deps'], input.threadId)
    if (!cutoffTurnId) {
      return {
        threadId: input.threadId,
        prunableTurns: 0, prunableItems: 0,
        retainedTurns: thread.turns.length,
        retainedItems: thread.turns.reduce((count, turn) => count + turn.items.length, 0),
        contextEstimateBefore: 0, contextEstimateAfter: 0,
        snapshotRequiredBytes: snapshotBytes,
        blockedBy: ['nothing_to_prune']
      }
    }
    const cutoffIndex = thread.turns.findIndex((turn) => turn.id === cutoffTurnId)
    const prunableTurns = Math.max(0, cutoffIndex + 1)
    const prunableItems = thread.turns
      .slice(0, prunableTurns)
      .reduce((count, turn) => count + turn.items.length, 0)
    const retainedItems = thread.turns
      .slice(prunableTurns)
      .reduce((count, turn) => count + turn.items.length, 0)
    const before = await this['deps'].sessionStore.loadItems(input.threadId)
    const contextEstimateBefore = this['deps'].compactor.estimate(before)
    const contextEstimateAfter = this['deps'].compactor.estimate(
      before.filter((item) => thread.turns
        .slice(prunableTurns)
        .some((turn) => turn.id === item.turnId))
    )
    return {
      threadId: input.threadId,
      cutoffTurnId,
      prunableTurns,
      prunableItems,
      retainedTurns: thread.turns.length - prunableTurns,
      retainedItems,
      contextEstimateBefore,
      contextEstimateAfter,
      snapshotRequiredBytes: snapshotBytes,
      blockedBy: [],
      threadRevision: thread.revision ?? 0
    }
  },

  async pruneThread(this: TurnService, input: {
    threadId: string
    request: PruneThreadRequest & { expectedThreadRevision?: number }
  }): Promise<PruneThreadResponse> {
    return withManagerDataMutex(`thread:${input.threadId}`, async () => {
      const policy = input.request
      const cutoffTurnId = await this['withThreadMutation'](input.threadId, async () => {
        const current = await this['deps'].threadStore.get(input.threadId)
        if (!current) throw new Error(`thread not found: ${input.threadId}`)
        if (current.turns.some(isActiveTurn)) throw new TurnConflictError('thread has an active turn')
        if (
          input.request.expectedThreadRevision !== undefined &&
          (current.revision ?? 0) !== input.request.expectedThreadRevision
        ) {
          throw new TurnConflictError('thread changed since the prune preview')
        }
        return selectRetentionCutoff(current, policy, this['deps'].nowIso())
      })
      // 1. Complete pre-rewrite snapshot (unless explicitly declined).
      let snapshotId: string | undefined
      const snapshots = snapshotStoreFor(this['deps'])
      if (snapshots && policy.archiveBeforePrune !== false && cutoffTurnId) {
        const thread = await this['deps'].threadStore.get(input.threadId)
        const itemSnapshot = await this['deps'].sessionStore.loadItemSnapshot(input.threadId)
        const manifest = await snapshots.capture({
          threadId: input.threadId,
          reason: 'prune',
          threadRevision: thread?.revision ?? 0,
          itemRevision: itemSnapshot.revision,
          eventHighWaterSeq: await this['deps'].sessionStore.highestSeq(input.threadId)
        })
        snapshotId = manifest.snapshotId
      }
      // 2. Archive + rewrite messages through the existing compact(cutoff) path.
      // The pre-prune snapshot above supersedes the legacy per-item archive.
      const compacted = cutoffTurnId
        ? await this.compact({
            threadId: input.threadId,
            request: {
              cutoffTurnId,
              reason: 'thread retention policy',
              archiveBeforePrune: false
            }
          })
        : undefined
      // 3. Drop the pruned turn skeletons from ThreadRecord.turns.
      let removedTurns = 0
      let committedPolicy = false
      await this['withThreadMutation'](input.threadId, async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const latest = await this['deps'].threadStore.get(input.threadId)
          if (!latest) throw new Error(`thread not found: ${input.threadId}`)
          if (latest.turns.some(isActiveTurn)) throw new TurnConflictError('thread has an active turn')
          const conditionalWrite = this['deps'].threadStore.upsertIfRevision
          if (!conditionalWrite) throw new Error('thread store does not support conditional writes')
          const cutoffIndex = cutoffTurnId
            ? latest.turns.findIndex((turn) => turn.id === cutoffTurnId)
            : -1
          const next = cutoffIndex >= 0
            ? {
                ...latest,
                turns: latest.turns.slice(cutoffIndex + 1),
                retentionPolicy: policy,
                updatedAt: this['deps'].nowIso()
              }
            : { ...latest, retentionPolicy: policy, updatedAt: this['deps'].nowIso() }
          if (cutoffIndex >= 0) removedTurns = cutoffIndex + 1
          const committed = await conditionalWrite.call(this['deps'].threadStore, next, latest.revision ?? 0)
          if (committed.applied) { committedPolicy = true; break }
        }
      })
      if (!committedPolicy) {
        throw new TurnConflictError('thread changed while retention policy was being committed')
      }
      // Re-project session items onto the trimmed turn skeleton so the UI
      // mirror drops, rather than retains, the removed turns' items.
      // Outside withThreadMutation: syncFromSession takes the same lock.
      await this['threadItems'].syncFromSession(input.threadId)
      // 4. Trim the durable event log prefix up to the prune event boundary.
      let eventReplayFloorSeq: number | undefined
      if (cutoffTurnId && this['deps'].sessionStore.trimEventsFromSeq) {
        const highWater = await this['deps'].sessionStore.highestSeq(input.threadId)
        // Keep the final event of the pruned window plus everything newer;
        // clients with older cursors must re-sync via the floor protocol.
        const floor = Math.max(0, highWater - 1)
        if (floor > 0) {
          await this['deps'].sessionStore.trimEventsFromSeq(input.threadId, floor)
          eventReplayFloorSeq = floor
        }
      }
      await this['deps'].events.record({
        kind: 'thread_pruned',
        threadId: input.threadId,
        ...(cutoffTurnId ? { turnId: cutoffTurnId } : {}),
        title: `pruned ${removedTurns} turn(s)${snapshotId ? ` (snapshot ${snapshotId})` : ''}`
      } as never)
      return {
        threadId: input.threadId,
        policy,
        pruned: Boolean(compacted),
        ...(cutoffTurnId ? { cutoffTurnId } : {}),
        archivedItems: compacted?.archivedItems ?? 0,
        retainedItems: compacted?.retainedItems ?? (await this['deps'].sessionStore.loadItems(input.threadId)).length,
        ...(compacted?.archivePath ? { archivePath: compacted.archivePath } : {}),
        ...(snapshotId ? { snapshotId } : {}),
        removedTurns,
        ...(eventReplayFloorSeq !== undefined ? { eventReplayFloorSeq } : {})
      }
    })
  },

  async listThreadSnapshots(this: TurnService, input: {
    threadId: string
  }): Promise<ThreadSnapshotsResponse> {
    const store = snapshotStoreFor(this['deps'])
    if (!store) return { threadId: input.threadId, snapshots: [] }
    const manifests = await store.list(input.threadId)
    const snapshots = await Promise.all(manifests.map(async (manifest) => ({
      snapshotId: manifest.snapshotId,
      createdAt: manifest.createdAt,
      reason: manifest.reason,
      threadRevision: manifest.threadRevision,
      bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
      verified: await store.verify(input.threadId, manifest.snapshotId)
    })))
    return { threadId: input.threadId, snapshots }
  },

  async restoreThreadSnapshot(this: TurnService, input: {
    threadId: string
    snapshotId: string
  }): Promise<RestoreSnapshotResponse> {
    return withManagerDataMutex(`thread:${input.threadId}`, async () => {
      const store = snapshotStoreFor(this['deps'])
      if (!store) throw new Error('thread snapshot store is unavailable')
      const current = await this['deps'].threadStore.get(input.threadId)
      if (!current) throw new Error(`thread not found: ${input.threadId}`)
      if (current.turns.some(isActiveTurn)) throw new TurnConflictError('thread has an active turn')
      if (!(await store.verify(input.threadId, input.snapshotId))) {
        throw new Error(`snapshot verification failed: ${input.snapshotId}`)
      }
      // Safety snapshot first: a bad restore must itself be recoverable.
      const itemSnapshot = await this['deps'].sessionStore.loadItemSnapshot(input.threadId)
      const safety = await store.capture({
        threadId: input.threadId,
        reason: 'restore',
        threadRevision: current.revision ?? 0,
        itemRevision: itemSnapshot.revision,
        eventHighWaterSeq: await this['deps'].sessionStore.highestSeq(input.threadId)
      })
      const messages = await store.readFile(input.threadId, input.snapshotId, 'messages.jsonl')
      const metadata = await store.readFile(input.threadId, input.snapshotId, 'metadata.jsonl')
      if (messages) {
        const lines = messages.toString('utf-8').split('\n').filter((line) => line.trim())
        const items = lines.map((line) => JSON.parse(line) as unknown)
        await this['deps'].sessionStore.rewriteItems(input.threadId, items as never[])
      }
      if (metadata) {
        // Metadata restore re-applies the snapshotted thread record through
        // the store so caches and the index stay coherent.
        const lines = metadata.toString('utf-8').split('\n').filter((line) => line.trim())
        const last = lines.at(-1)
        if (last) {
          const parsed = JSON.parse(last) as { thread?: ThreadRecord }
          if (parsed.thread) {
            await this['deps'].threadStore.upsert({
              ...parsed.thread,
              revision: undefined,
              updatedAt: this['deps'].nowIso()
            })
          }
        }
      }
      await this['threadItems'].syncFromSession(input.threadId)
      return {
        threadId: input.threadId,
        snapshotId: input.snapshotId,
        restored: true,
        safetySnapshotId: safety.snapshotId
      }
    })
  }
}

function snapshotStoreFor(deps: TurnServiceDeps): ThreadSnapshotStore | undefined {
  return (deps as TurnServiceDeps & { snapshots?: ThreadSnapshotStore }).snapshots
}

async function estimateSnapshotBytes(deps: TurnServiceDeps, threadId: string): Promise<number> {
  const dataDir = (deps as TurnServiceDeps & { dataDir?: string }).dataDir
  if (!dataDir) return 0
  let total = 0
  for (const name of ['messages.jsonl', 'metadata.jsonl', 'events.jsonl', 'session.json']) {
    const info = await stat(join(dataDir, 'threads', threadId, name)).catch(() => null)
    if (info) total += info.size
  }
  return total
}
