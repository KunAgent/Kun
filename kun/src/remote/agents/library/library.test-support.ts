import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileArtifactStore } from '../../../artifacts/artifact-store.js'
import { RoomRunRecordSchema, type RoomRunRecord } from '../../../contracts/room-runs.js'
import { RoomMessageSchema } from '../../../contracts/rooms.js'
import { artifactReference } from '../../../agents/agent-artifact-library.js'
import { putRoomDocument } from '../../../rooms/room-service.js'
import { agentHistoryFixture } from '../memory/history.test-support.js'
export async function agentLibraryFixture() {
  const f = await agentHistoryFixture()
  f.rooms.deps.artifacts = new FileArtifactStore(join(f.root, 'artifacts'))
  const now = new Date().toISOString(), member = f.room.members.find((item) => item.participantAgentId === f.agent.id)!
  async function run(id: string, patch: Partial<RoomRunRecord> = {}) {
    const value = RoomRunRecordSchema.parse({ id, roomId: f.room.id, memberId: member.id, memberLabel: 'Memory owner',
      participantAgentId: f.agent.id, phase: 'conversation', attempt: 1, clientRequestId: id,
      threadId: 'private-gui-thread', input: 'INTERNAL_SYSTEM_PROMPT', triggerMessageId: f.source.id,
      providerId: 'PRIVATE_PROVIDER', accountId: 'PRIVATE_CREDENTIAL', error: 'PRIVATE_EXCEPTION /secret/path',
      status: 'completed', outcome: 'published', createdAt: now, updatedAt: now, ...patch })
    await putRoomDocument(f.store, 'room_run', id, value.roomId, value, null)
    return value
  }
  const firstRun = await run('run-one'), file = join(f.root, 'native-report.txt')
  async function capture(version: number, sourceRunId = firstRun.id) {
    await writeFile(file, 'Immutable version ' + version)
    const artifact = await f.rooms.artifactLibrary.capture({ participantAgentId: f.agent.id, roomId: f.room.id,
      sourceRunId, sourceMessageId: 'reply-' + version, requestId: 'capture-' + version,
      workspaceRoot: await realpath(f.root), workspaceId: 'private-workspace', relativePath: 'native-report.txt', title: 'Public report' })
    const row = (await f.store.get<RoomRunRecord>('room_run', sourceRunId))!
    await putRoomDocument(f.store, 'room_run', row.id, row.value.roomId, { ...row.value, publishedMessageId: 'reply-' + version }, row)
    await putRoomDocument(f.store, 'message', 'reply-' + version, f.room.id, RoomMessageSchema.parse({
      id: 'reply-' + version, roomId: f.room.id, messageSeq: 10 + version, originRunId: sourceRunId,
      authorKind: 'member', authorMemberId: member.id, authorAgentId: f.agent.id, authorLabelSnapshot: 'Owner Agent',
      body: 'Public result 😀 '.repeat(1500) + version, bodyRevision: 0, references: [artifactReference(artifact)],
      mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: now }), null)
    return artifact
  }
  const first = await capture(1)
  return { ...f, run, capture, firstRun, first, member, now }
}
