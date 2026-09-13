import { realpath, stat, readdir } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { Room } from '../contracts/rooms.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { agentWorkspace } from './agent-direct-runner.js'
import { agentStableId } from './agent-identity-service.js'

export async function privateWorkspace(rooms: RoomRuntime, room: Room) {
  if (room.conversationKind !== 'user_agent') throw new Error('Private conversation required')
  const agentId = room.members[0].participantAgentId!
  const candidate = room.privateWorkspace ?? agentWorkspace(rooms.deps.dataDir, agentId)
  const path = await realpath(candidate).catch(() => candidate)
  return { path, id: agentStableId('private-workspace', room.id, path) }
}
export async function directActivity(rooms: RoomRuntime, roomId: string) {
  const room = await rooms.service.get(roomId)
  const rows = await rooms.deps.store.list<RoomRequestState>('request', { roomId, limit: 20 })
  const activeRows = await rooms.deps.store.list<RoomRequestState>('request', { roomId, status: ['running', 'pending', 'stopping', 'recovery_required'], order: 'asc', limit: 1000 })
  const requestSummary = (row: typeof rows[number]) => ({ id: row.id, revision: row.revision, status: row.value.status, runId: row.value.privateRunId, threadId: row.value.turnId ? row.value.threadId : undefined, turnId: row.value.turnId, error: row.value.error })
  const requests = rows.filter((row) => row.value.privateProtocol).map((row) => ({ id: row.id, revision: row.revision,
    status: row.value.status, runId: row.value.privateRunId, threadId: row.value.turnId ? row.value.threadId : undefined,
    turnId: row.value.turnId, error: row.value.error }))
  const activeRow = activeRows.find((row) => row.value.privateProtocol)
  const active = activeRow ? requestSummary(activeRow) : undefined
  const workspace = await privateWorkspace(rooms, room)
  return { requests, active, pendingCount: activeRows.filter((row) => row.value.privateProtocol).length, workspace,
    approvals: active?.threadId ? rooms.deps.approvals.pending(active.threadId) : [],
    userInputs: active?.threadId ? rooms.deps.inputs.pending(active.threadId) : [] }
}
export async function updateDirectWorkspace(rooms: RoomRuntime, roomId: string, input: {
  clientRequestId: string; expectedRevision: number; action: 'workspace' | 'reset'; path?: string | null
}) {
  const store = rooms.deps.store, key = 'private-context:' + input.clientRequestId, hash = roomFingerprint(input)
  const old = await store.getRequest(key)
  if (old) { if (old.fingerprint !== hash) throw new RoomStoreConflictError('context request changed'); return rooms.service.get(roomId) }
  const room = await rooms.service.get(roomId)
  if (room.conversationKind !== 'user_agent') throw new Error('Private conversation required')
  let workspace = room.privateWorkspace
  if (input.action === 'workspace') {
    workspace = input.path ? await realpath(input.path) : undefined
    if (workspace && !(await stat(workspace)).isDirectory()) throw new Error('Choose an existing directory')
    const agent = await rooms.agents.active(room.members[0].participantAgentId!)
    if (workspace && agent.allowedRepositoryRoots && !agent.allowedRepositoryRoots.includes(workspace)) throw new Error('Project is outside this Agent\'s allowed directories')
    if (workspace) {
      const rel = relative(rooms.deps.dataDir, workspace)
      if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')) throw new Error('Select a project outside Kun private data')
    }
  }
  await store.commit({ requestId: key, fingerprint: hash, checks: [{ kind: 'room', id: roomId, expectedRevision: input.expectedRevision }],
    puts: [{ kind: 'room', id: roomId, roomId, value: { ...room, privateWorkspace: workspace,
      privateEpoch: (room.privateEpoch ?? 0) + 1, revision: room.revision + 1, updatedAt: new Date().toISOString() } }],
    events: [{ roomId, kind: 'room.updated', payload: { id: roomId } }] })
  return rooms.service.get(roomId)
}
export async function controlDirectRequest(rooms: RoomRuntime, roomId: string, requestId: string,
  input: { action: 'stop' | 'retry'; clientRequestId: string; expectedRevision: number }) {
  const store = rooms.deps.store, key = 'private-control:' + input.clientRequestId, fingerprint = roomFingerprint(input)
  const prior = await store.getRequest(key)
  if (prior) { if (prior.fingerprint !== fingerprint) throw new RoomStoreConflictError('request changed'); return prior.result }
  const row = await store.get<RoomRequestState>('request', requestId)
  if (!row || row.roomId !== roomId || !row.value.privateProtocol) throw new Error('Private request not found')
  const value = row.value
  const thread = await rooms.deps.threads.getMetadata(value.threadId)
  const turn = thread?.turns.find((turn) => turn.clientRequestId === 'private-' + value.id + '-' + (value.stepAttempt ?? 0))
  if (input.action === 'stop') {
    if (input.expectedRevision > row.revision) throw new RoomStoreConflictError('request revision is ahead of the original execution')
    if (['completed', 'failed', 'cancelled'].includes(value.status)) return { accepted: true, alreadyFinished: true }
    // Internal admission/status transitions do not change the user's cancellation target.
    // Serialize against the current record so a just-refreshed turn cannot reject Stop.
    await store.commit({ requestId: key, fingerprint, checks: [{ kind: 'request', id: requestId, expectedRevision: row.revision }],
      puts: [{ kind: 'request', id: requestId, roomId, value: { ...value, cancellationRequested: true, status: 'stopping' } }],
      events: [{ roomId, kind: 'request.updated', payload: { id: requestId } }] })
  } else {
    if (!['failed', 'cancelled'].includes(value.status) || value.admissionAttempted && (!turn || ['queued', 'running'].includes(turn.status))) throw new RoomStoreConflictError('Reconcile the original execution before retrying')
    const id = 'request-' + randomUUID(), snapshot = await rooms.agents.freeze(value.roomSnapshot)
    const request: RoomRequestState = { id, roomId, privateProtocol: 'direct-v1', status: 'pending', rootRequestId: id,
      sourceMessageId: value.sourceMessageId, roomSnapshot: snapshot, message: value.message, threadId: 'private-pending-' + id }
    await store.commit({ requestId: key, fingerprint, checks: [{ kind: 'request', id: requestId, expectedRevision: input.expectedRevision },
      { kind: 'request', id, expectedRevision: null }], puts: [{ kind: 'request', id, roomId, value: request }],
      events: [{ roomId, kind: 'request.updated', payload: { id } }], result: { id } })
  }
  rooms.wake()
  return { accepted: true }
}
export async function directFiles(rooms: RoomRuntime, roomId: string) {
  const room = await rooms.service.get(roomId), workspace = await privateWorkspace(rooms, room)
  let entries
  try { entries = await readdir(workspace.path, { withFileTypes: true }) } catch { return { files: [] } }
  const files = []
  for (const entry of entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.')).slice(0, 100)) {
    files.push({ kind: 'agent_file' as const, workspaceId: workspace.id, relativePath: entry.name, titleSnapshot: entry.name })
  }
  return { files }
}
