import { artifactId as contentId } from '../artifacts/artifact-summary.js'
import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomArtifactSourceTarget, RoomContentReference } from '../contracts/room-content.js'
import { AgentArtifactSchema, AgentArtifactVersionSchema, AgentArtifactQuery, AgentArtifactVersionQuery,
  type AgentArtifact, type AgentArtifactVersion } from '../contracts/agent-artifacts.js'
import { readRoomRepositoryFile } from '../rooms/room-file-content.js'
import { MAX_IM_ATTACHMENT_BYTES } from '../adapters/tool/im-attachment-tool.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { retryRoomInteraction } from '../rooms/room-interaction-store.js'
import { agentStableId } from './agent-identity-service.js'

const bindings = new WeakMap<ThreadStore, AgentArtifactLibrary>()
export const bindAgentArtifactLibrary = (threads: ThreadStore, library: AgentArtifactLibrary) => bindings.set(threads, library)
export const agentArtifactLibraryBinding = (threads: ThreadStore) => bindings.get(threads)
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const mimeTypes: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.html': 'text/html', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' }
export function artifactReference(value: AgentArtifact | AgentArtifactVersion): RoomContentReference {
  return { kind: 'agent_file', workspaceId: value.workspaceId, relativePath: value.relativePath,
    titleSnapshot: value.title, artifactId: value.artifactId, artifactVersion: value.version }
}

/** Immutable file snapshots use the shared ArtifactStore; RoomStore indexes identity and versions. */
export class AgentArtifactLibrary {
  constructor(readonly deps: RoomRuntimeDeps) {}
  get available() { return Boolean(this.deps.artifacts) }

  async agentForRoom(roomId: string) {
    const row = await this.deps.store.get<Room>('room', roomId)
    if (!row || row.value.conversationKind !== 'user_agent' || !row.value.members[0]?.participantAgentId) {
      throw new Error('private artifact conversation not found')
    }
    return row.value.members[0].participantAgentId
  }

  async get(agentId: string, id: string, version?: number) {
    const row = await this.deps.store.get<AgentArtifact | AgentArtifactVersion>('agent_artifact',
      version === undefined ? id : `${id}:v${version}`)
    if (!row || row.value.participantAgentId !== agentId || row.value.artifactId !== id) throw new Error('agent artifact not found')
    if (version !== undefined && row.value.version !== version) throw new Error('artifact version not found')
    return { ...row.value, revision: row.revision }
  }

  /** Resolve only this saved version's durable source in the caller's exact private conversation. */
  async sourceTarget(roomId: string, meta: AgentArtifact | AgentArtifactVersion): Promise<RoomArtifactSourceTarget | undefined> {
    if (meta.roomId !== roomId) return
    const room = await this.deps.store.get<Room>('room', roomId)
    const member = room?.value.members[0]
    if (room?.value.id !== roomId || room.value.conversationKind !== 'user_agent' || room.value.deletedAt ||
      member?.participantAgentId !== meta.participantAgentId) return
    const source = await this.deps.store.get<RoomRunRecord>('room_run', meta.sourceRunId)
    if (!source || source.roomId !== roomId || source.value.roomId !== roomId || source.value.id !== meta.sourceRunId ||
      source.value.participantAgentId !== meta.participantAgentId || source.value.memberId !== member.id ||
      source.value.phase !== 'conversation') return
    const target: RoomArtifactSourceTarget = { roomId, participantAgentId: meta.participantAgentId, runId: source.id }
    const messageId = meta.sourceMessageId ?? source.value.publishedMessageId
    const message = messageId ? await this.deps.store.get<RoomMessage>('message', messageId) : undefined
    // A corrupt/missing message must not prevent inspecting a correctly scoped saved run.
    if (message?.roomId === roomId && message.value.roomId === roomId && message.value.id === messageId &&
      message.value.authorKind === 'member' && message.value.authorMemberId === member.id &&
      (!message.value.authorAgentId || message.value.authorAgentId === meta.participantAgentId) &&
      message.value.originRunId === source.id && message.value.references?.some((ref) => ref.kind === 'agent_file' &&
        ref.artifactId === meta.artifactId && ref.artifactVersion === meta.version &&
        ref.workspaceId === meta.workspaceId && ref.relativePath === meta.relativePath)) target.messageId = messageId
    return target
  }

  async list(agentId: string, raw: unknown = {}) {
    const input = AgentArtifactQuery.parse(raw)
    const rows = await this.deps.store.list<AgentArtifact>('agent_artifact', { participantAgentId: agentId,
      status: input.archived === 'true' ? 'archived' : 'active', search: input.search,
      beforeSeq: input.cursor, limit: input.limit + 1 })
    return { artifacts: rows.slice(0, input.limit).map((row) => ({ ...row.value, revision: row.revision })),
      ...(rows.length > input.limit ? { nextCursor: String(rows[input.limit - 1].seq) } : {}) }
  }

  async versions(agentId: string, id: string, raw: unknown = {}) {
    await this.get(agentId, id)
    const input = AgentArtifactVersionQuery.parse(raw)
    const rows = await this.deps.store.list<AgentArtifactVersion>('agent_artifact', {
      participantAgentId: agentId, taskId: id, status: 'version', beforeSeq: input.cursor, limit: input.limit + 1 })
    return { versions: rows.slice(0, input.limit).map((row) => row.value),
      ...(rows.length > input.limit ? { nextCursor: String(rows[input.limit - 1].seq) } : {}) }
  }

  async capture(input: { participantAgentId: string; roomId: string; sourceRunId: string; sourceMessageId?: string;
    requestId: string; workspaceRoot: string; workspaceId: string; relativePath: string; title: string }): Promise<AgentArtifactVersion> {
    const blobs = this.deps.artifacts
    if (!blobs) throw new Error('artifact storage unavailable')
    const id = agentStableId('agent-artifact', input.participantAgentId, input.workspaceId, input.relativePath)
    const receipt = 'artifact-capture:' + agentStableId('receipt', input.requestId, id)
    const fingerprint = roomFingerprint(input)
    const replay = await this.deps.store.getRequest(receipt)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('artifact capture changed')
      return AgentArtifactVersionSchema.parse(replay.result)
    }
    // Use the same canonical-path + open-descriptor validation as content previews.
    const file = await readRoomRepositoryFile({ canonicalRoot: input.workspaceRoot }, input.relativePath, MAX_IM_ATTACHMENT_BYTES + 1)
    if (file.size > MAX_IM_ATTACHMENT_BYTES || file.data.length !== file.size) throw new Error('artifact file is too large or changed')
    const hash = sha256(file.data), mimeType = mimeTypes[extname(input.relativePath).toLowerCase()] ?? 'application/octet-stream'
    return retryRoomInteraction(async () => {
      const duplicate = await this.deps.store.getRequest(receipt)
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint) throw new RoomStoreConflictError('artifact capture changed')
        return AgentArtifactVersionSchema.parse(duplicate.result)
      }
      const prior = await this.deps.store.get<AgentArtifact>('agent_artifact', id)
      const version = (prior?.value.version ?? 0) + 1, versionId = `${id}:v${version}`
      // Ordinary retention protects snapshots even if an interrupted metadata commit is retried.
      // Archive is reversible; no automatic release can delete a published historical version.
      const blobIds: string[] = []
      // Chunk before base64 encoding to stay below Manager transport limits even for a 50 MiB file.
      for (let offset = 0; offset < Math.max(file.data.length, 1); offset += 4 * 1024 * 1024) {
        const blob = await blobs.put({ content: file.data.subarray(offset, offset + 4 * 1024 * 1024).toString('base64'),
          source: 'attachment', mimeType: 'text/plain;base64', origin: `agent-artifact:${id}`, maxInlineChars: 0 })
        blobIds.push(blob.meta.id)
      }
      const now = new Date().toISOString()
      const value = AgentArtifactVersionSchema.parse({ schemaVersion: 1, id: versionId, artifactId: id, version,
        participantAgentId: input.participantAgentId, roomId: input.roomId, workspaceId: input.workspaceId,
        relativePath: input.relativePath, title: input.title, sourceRunId: input.sourceRunId,
        sourceMessageId: input.sourceMessageId, blobId: blobIds[0], blobIds, sha256: hash, byteSize: file.size,
        mimeType, encoding: 'base64', status: 'version', createdAt: now })
      const latest = AgentArtifactSchema.parse({ ...value, id, status: 'active', retention: 'keep', updatedAt: now })
      await this.deps.store.commit({ requestId: receipt, fingerprint,
        checks: [{ kind: 'agent_artifact', id, expectedRevision: prior?.revision ?? null },
          { kind: 'agent_artifact', id: versionId, expectedRevision: null }],
        puts: [{ kind: 'agent_artifact', id, roomId: input.roomId, value: latest },
          { kind: 'agent_artifact', id: versionId, roomId: input.roomId, taskId: id, value }],
        events: [{ roomId: input.roomId, kind: 'agent.artifact.updated', payload: { artifactId: id, version } }], result: value })
      return value
    })
  }

  async read(agentId: string, id: string, version?: number) {
    const meta = await this.get(agentId, id, version)
    const chunks: Buffer[] = []
    for (const blobId of meta.blobIds ?? [meta.blobId]) {
      const encoded = await this.deps.artifacts?.get(blobId)
      if (encoded === null || encoded === undefined) throw new Error('artifact content not found')
      if (contentId(encoded) !== blobId) throw new Error('artifact content integrity check failed')
      chunks.push(Buffer.from(encoded, 'base64'))
    }
    const data = Buffer.concat(chunks)
    if (data.length !== meta.byteSize || sha256(data) !== meta.sha256) throw new Error('artifact content integrity check failed')
    return { meta, data }
  }

  async export(agentId: string, id: string, input: { version?: number; offset?: number; length?: number } = {}) {
    const meta = await this.get(agentId, id, input.version)
    const offset = Math.max(0, Math.min(input.offset ?? 0, meta.byteSize))
    const end = Math.min(meta.byteSize, offset + Math.min(Math.max(input.length ?? 1024 * 1024, 1), 1024 * 1024))
    const chunks: Buffer[] = []
    if (!meta.blobIds) chunks.push((await this.read(agentId, id, input.version)).data.subarray(offset, end))
    else for (let index = Math.floor(offset / (4 * 1024 * 1024)); index * 4 * 1024 * 1024 < end; index++) {
      const blobId = meta.blobIds[index], encoded = blobId ? await this.deps.artifacts?.get(blobId) : undefined
      if (encoded === null || encoded === undefined) throw new Error('artifact content not found')
      if (contentId(encoded) !== blobId) throw new Error('artifact content integrity check failed')
      const data = Buffer.from(encoded, 'base64'), start = index * 4 * 1024 * 1024
      if (data.length !== Math.min(4 * 1024 * 1024, meta.byteSize - start)) throw new Error('artifact content integrity check failed')
      chunks.push(data.subarray(Math.max(0, offset - start), end - start))
    }
    return { artifactId: id, version: meta.version, fileName: meta.title, mimeType: meta.mimeType,
      sha256: meta.sha256, byteSize: meta.byteSize, offset, dataBase64: Buffer.concat(chunks).toString('base64'),
      ...(end < meta.byteSize ? { nextOffset: end } : {}) }
  }

  async archive(agentId: string, id: string, input: { expectedRevision: number; clientRequestId: string; archived: boolean }) {
    const receipt = 'artifact-retain:' + id + ':' + input.clientRequestId, fingerprint = roomFingerprint({ agentId, input })
    const replay = await this.deps.store.getRequest(receipt)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('artifact retention request changed')
      return replay.result
    }
    const current = await this.get(agentId, id)
    if (current.revision !== input.expectedRevision) throw new RoomStoreConflictError('artifact changed', current.revision)
    const now = new Date().toISOString()
    const { revision: _revision, ...prior } = current
    const value = AgentArtifactSchema.parse({ ...prior,
      status: input.archived ? 'archived' : 'active', archivedAt: input.archived ? now : undefined, updatedAt: now })
    const result = { ...value, revision: current.revision + 1 }
    await this.deps.store.commit({ requestId: receipt, fingerprint,
      checks: [{ kind: 'agent_artifact', id, expectedRevision: current.revision }],
      puts: [{ kind: 'agent_artifact', id, roomId: value.roomId, value }],
      events: [{ roomId: value.roomId, kind: 'agent.artifact.updated', payload: { artifactId: id } }], result })
    return result
  }
}
