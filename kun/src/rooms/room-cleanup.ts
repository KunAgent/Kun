import { lstat, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type { RoomCleanupPreview, RoomIntegration } from '../contracts/rooms-product.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace, RoomRequestState } from './room-runtime-types.js'
import { roomTaskActivity } from './room-task-activity.js'
import { RoomStoreConflictError, type RoomDocumentKind, type RoomStoreListOptions } from './room-store.js'
import { roomFingerprint } from './room-service.js'
import { assertRoomAncestor, roomGit, serializeRoomGitMutation } from './room-git.js'
import { observeRoomRepository, type RoomRepositoryObservation } from './task-workspace-service.js'
import { assertRoomDeliveryPin } from './room-delivery-service.js'
import { RoomIntegrationService } from './room-integration.js'
import { integrationDelivery } from './room-integration-git.js'

type PathSnapshot = { path: string; observation: RoomRepositoryObservation }
type CleanupRecord = { status: 'removing' | 'complete'; preview: RoomCleanupPreview;
  observations: PathSnapshot[]; removed: string[]; fingerprint: string }

async function all<T>(deps: RoomRuntimeDeps, kind: RoomDocumentKind, options: RoomStoreListOptions) {
  const rows = []
  let afterSeq: number | undefined
  for (;;) {
    const page = await deps.store.list<T>(kind, { ...options, limit: 1000, order: 'asc', afterSeq })
    rows.push(...page)
    if (page.length < 1000) return rows
    afterSeq = page.at(-1)!.seq
  }
}
async function size(path: string): Promise<number> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) return 0
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const entry of await readdir(path)) bytes += await size(resolve(path, entry))
  return bytes
}
async function inspectCleanup(deps: RoomRuntimeDeps, roomId: string, taskId: string) {
  const row = await deps.store.get<RoomTaskExecution>('task', taskId)
  if (!row || row.roomId !== roomId) throw new Error('task not found')
  const task = row.value.task
  const empty: RoomCleanupPreview = { taskId, eligible: false, revision: row.revision, paths: [], token: '', retainsDeliveryPins: true }
  const denied = (reason: string) => ({ preview: { ...empty, reason }, observations: [] as PathSnapshot[], workspace: undefined })
  if (!(task.applicationStatus === 'applied' || row.value.abandoned) ||
    (await roomTaskActivity(deps, row.value)).state !== 'idle') {
    return denied('Only applied or explicitly abandoned tasks with confirmed stopped execution can be cleaned.')
  }
  const integrations = await all<RoomIntegration>(deps, 'integration', { roomId, taskId })
  const service = new RoomIntegrationService(deps)
  for (const entry of integrations) {
    if (['preparing', 'validating'].includes(entry.value.status) || entry.value.applyIntent ||
      await service.activity(entry.value) !== 'idle') return denied('Integration execution must stop and reconcile first.')
    if (!row.value.abandoned && entry.value.candidateSha && entry.value.status !== 'applied' &&
      !(entry.value.status === 'failed' && entry.value.cancelRequested)) {
      return denied('An integration candidate has not been applied or explicitly abandoned.')
    }
  }
  const dependents = await all<RoomTaskExecution>(deps, 'task', { roomId })
  for (const entry of dependents) {
    if (entry.id === taskId || !entry.value.dependencyTaskIds.includes(taskId)) continue
    if (!['completed', 'cancelled'].includes(entry.value.task.status) || await roomTaskActivity(deps, entry.value).then((state) => state.state !== 'idle')) {
      return denied('Another unfinished task still depends on this task workspace.')
    }
  }
  const discussions = await all<RoomRequestState>(deps, 'request', { roomId })
  if (discussions.some((entry) => entry.value.referencedTask?.task.id === taskId &&
    ['pending', 'running'].includes(entry.value.status))) return denied('A discussion is still reading this task workspace.')
  const workspace = (await deps.store.get<RoomWorkspace>('workspace', task.workspaceId))?.value
  if (!workspace || workspace.taskId !== taskId || workspace.roomId !== roomId) return denied('Workspace ownership information is missing.')
  const source = await observeRoomRepository(workspace.repository.root, true)
  if (source.root !== workspace.repository.root || source.commonDir !== workspace.repository.commonDir) throw new Error('source repository identity changed')
  const deliveries = await all<RoomDelivery>(deps, 'delivery', { roomId, taskId })
  for (const delivery of deliveries) await assertRoomDeliveryPin(workspace.repository, delivery.value)
  const latest = deliveries.find((delivery) => delivery.id === task.latestDeliveryId)?.value
  if (!row.value.abandoned) {
    if (!latest) return denied('Applied delivery identity is missing; preserve task files.')
    const appliedHead = await roomGit(source.root, ['rev-parse', '--verify', workspace.repository.branch])
    await assertRoomAncestor(source.root, latest.versionHash, appliedHead)
  }
  for (const entry of integrations) for (const candidate of entry.value.candidates ?? []) {
    const original = deliveries.find((delivery) => delivery.id === entry.value.deliveryId)?.value
    if (!original) throw new Error('integration source delivery is missing')
    await assertRoomDeliveryPin(workspace.repository,
      integrationDelivery({ ...entry.value, candidateSha: candidate.sha, candidatePinId: candidate.pinId }, original))
  }
  const candidates: Array<{ path: string; branch: string; head?: string }> = [
    { path: workspace.path, branch: 'refs/heads/' + workspace.branch, head: row.value.abandoned ? undefined : latest?.versionHash },
    ...integrations.map((entry) => ({ path: entry.value.path, branch: 'refs/heads/' + entry.value.branch,
      head: row.value.abandoned ? undefined : entry.value.candidateSha })),
    ...deliveries.flatMap((entry) => ['reviews', 'discussions'].map((kind) =>
      ({ path: resolve(deps.dataDir, 'rooms', kind, entry.id), branch: '', head: entry.value.versionHash }))),
    ...integrations.flatMap((entry) => (entry.value.candidates ?? []).map((candidate) =>
      ({ path: resolve(deps.dataDir, 'rooms', 'reviews', candidate.pinId), branch: '', head: candidate.sha })))
  ]
  const paths: Array<{ path: string; bytes: number }> = []
  const observations: PathSnapshot[] = []
  const root = await realpath(resolve(deps.dataDir, 'rooms'))
  for (const candidate of candidates) {
    let path: string
    try {
      if ((await lstat(candidate.path)).isSymbolicLink()) throw new Error('cleanup path must not be a symlink')
      path = await realpath(candidate.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (paths.some((entry) => entry.path === path)) continue
    const rel = relative(root, path)
    if (!rel || rel === '..' || rel.startsWith('..' + sep)) throw new Error('cleanup target outside managed rooms directory')
    const repo = await observeRoomRepository(path, true)
    if (repo.root !== path || repo.root === source.root || repo.commonDir !== source.commonDir ||
      repo.branch !== candidate.branch || (candidate.head && candidate.head !== repo.head)) throw new Error('cleanup repository identity mismatch')
    if (repo.dirty || repo.operationInProgress) return denied('Workspace has uncommitted changes or an unfinished Git operation; preserve it before cleanup.')
    paths.push({ path, bytes: await size(path) })
    observations.push({ path, observation: repo })
  }
  return { preview: { ...empty, eligible: true, paths,
    token: roomFingerprint({ revision: row.revision, observations, paths }) }, observations, workspace }
}
export async function roomCleanupPreview(deps: RoomRuntimeDeps, roomId: string, taskId: string): Promise<RoomCleanupPreview> {
  return (await inspectCleanup(deps, roomId, taskId)).preview
}
export async function cleanupRoomTask(deps: RoomRuntimeDeps, roomId: string, taskId: string, input: {
  expectedRevision: number; token: string; clientRequestId: string
}) {
  return serializeRoomGitMutation('cleanup:' + roomId + ':' + taskId, async () => {
    await deps.assertOwnership()
    const requestKey = 'cleanup-' + roomFingerprint({ roomId, taskId, requestId: input.clientRequestId })
    let key = requestKey
    const fingerprint = roomFingerprint(input)
    const replay = await deps.store.getRequest(requestKey)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('cleanup request identity conflict')
      return replay.result
    }
    let pending = await deps.store.get<CleanupRecord>('cleanup', key)
    if (pending && pending.value.fingerprint !== fingerprint) throw new RoomStoreConflictError('cleanup request identity conflict')
    if (pending?.value.status === 'complete') return pending.value.preview
    const resumingOwnRequest = Boolean(pending)
    if (!pending) {
      const unfinished = await deps.store.list<CleanupRecord>('cleanup', { roomId, taskId, status: 'removing', limit: 2 })
      if (unfinished.length > 1) throw new RoomStoreConflictError('Multiple cleanup records require inspection.')
      pending = unfinished[0] ?? null
      if (pending) key = pending.id
    }
    const inspected = await inspectCleanup(deps, roomId, taskId)
    const { preview, workspace } = inspected
    if (!workspace || !preview.eligible || preview.revision !== input.expectedRevision ||
      (!resumingOwnRequest && preview.token !== input.token) || (pending &&
        (pending.roomId !== roomId || pending.taskId !== taskId))) {
      throw new RoomStoreConflictError(preview.reason ?? 'Cleanup preview changed; inspect again.')
    }
    if (!pending) {
      await deps.store.commit({ requestId: 'reserve-' + key, fingerprint,
        checks: [{ kind: 'cleanup', id: key, expectedRevision: null }, { kind: 'task', id: taskId, expectedRevision: preview.revision }],
        puts: [{ kind: 'cleanup', id: key, roomId, taskId, value: { status: 'removing', preview,
          observations: inspected.observations, removed: [], fingerprint } satisfies CleanupRecord }] })
      pending = (await deps.store.get<CleanupRecord>('cleanup', key))!
    }
    const record = structuredClone(pending.value)
    const expectedPaths = new Set(record.observations.map((item) => item.path))
    if (inspected.observations.some((item) => !expectedPaths.has(item.path))) throw new RoomStoreConflictError('New task paths appeared after cleanup started.')
    await serializeRoomGitMutation(workspace.repository.commonDir, async () => {
      for (const expected of record.observations) {
        await deps.assertOwnership()
        const refreshed = await inspectCleanup(deps, roomId, taskId)
        if (!refreshed.preview.eligible || refreshed.preview.revision !== input.expectedRevision) {
          throw new RoomStoreConflictError(refreshed.preview.reason ?? 'Task changed during cleanup.')
        }
        const current = refreshed.observations.find((item) => item.path === expected.path)
        if (current) {
          if (record.removed.includes(expected.path) || roomFingerprint(current.observation) !== roomFingerprint(expected.observation)) {
            throw new RoomStoreConflictError('Cleanup path changed or was recreated; preserve it for inspection.')
          }
          // Non-forced Git removal rejects newly dirty files and preserves all branches and pins.
          await deps.assertOwnership()
          await roomGit(workspace.repository.root, ['worktree', 'remove', '--', expected.path])
        }
        if (!record.removed.includes(expected.path)) {
          record.removed.push(expected.path)
          await deps.store.commit({ requestId: key + '-removed-' + roomFingerprint(expected.path).slice(0, 24),
            checks: [{ kind: 'cleanup', id: key, expectedRevision: pending!.revision }],
            puts: [{ kind: 'cleanup', id: key, roomId, taskId, value: structuredClone(record) }] })
          pending = (await deps.store.get<CleanupRecord>('cleanup', key))!
        }
      }
    })
    const result = { ...record.preview, paths: record.preview.paths }
    const saved = await deps.store.commit({ requestId: requestKey, fingerprint,
      checks: [{ kind: 'cleanup', id: key, expectedRevision: pending!.revision }],
      puts: [{ kind: 'cleanup', id: key, roomId, taskId, value: { ...record, status: 'complete' } }],
      events: [{ roomId, kind: 'task.cleaned', payload: { id: taskId } }], result })
    return saved.result
  })
}
