import { afterEach, expect, it } from 'vitest'
import { join } from 'node:path'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import type { AgentArtifactVersion } from '../contracts/agent-artifacts.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { RoomMessageSchema, type Room } from '../contracts/rooms.js'
import { resolveRoomContent } from '../rooms/room-content-service.js'
import { putRoomDocument } from '../rooms/room-service.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { workbenchFixture } from '../workbench-bridge/workbench-test-support.js'
import { AgentArtifactLibrary, artifactReference } from './agent-artifact-library.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const f = await workbenchFixture(); cleanups.push(f.cleanup)
  f.deps.artifacts = new FileArtifactStore(join(f.directory, 'artifacts'))
  const library = new AgentArtifactLibrary(f.deps)
  const runtime = { rooms: { deps: f.deps, artifactLibrary: library } } as unknown as ServerRuntime
  const capture = async (overrides: Partial<Parameters<typeof library.capture>[0]> = {}) => {
    await f.writeFile(join(f.directory, 'report.txt'), overrides.title ?? 'Saved report')
    return library.capture({ participantAgentId: 'agent-1', roomId: f.room.id, sourceRunId: f.runId,
      requestId: 'capture', workspaceRoot: f.directory, workspaceId: 'workspace', relativePath: 'report.txt',
      title: 'Report', ...overrides })
  }
  const preview = (version: AgentArtifactVersion, room = f.room) => resolveRoomContent(runtime, room, artifactReference(version), 'preview')
  const message = async (version: AgentArtifactVersion, roomId = f.room.id, reference = artifactReference(version), originRunId = version.sourceRunId) => {
    await putRoomDocument(f.store, 'message', version.sourceMessageId!, roomId, RoomMessageSchema.parse({
      id: version.sourceMessageId, roomId, messageSeq: 1, originRunId,
      authorKind: 'member', authorMemberId: f.room.members[0].id, authorAgentId: 'agent-1', authorLabelSnapshot: 'Bot',
      body: 'Here is the file', bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], references: [reference],
      status: 'final', createdAt: new Date().toISOString() }), null)
  }
  const patchRun = async (patch: Partial<RoomRunRecord>) => {
    const row = (await f.store.get<RoomRunRecord>('room_run', f.runId))!
    const id = 'test-source-run'
    await putRoomDocument(f.store, 'room_run', id, patch.roomId ?? f.room.id, { ...row.value, ...patch, id }, null)
    return id
  }
  return { ...f, library, runtime, capture, preview, message, patchRun }
}

it('links each exact saved version to its own scoped conversation message and run', async () => {
  const f = await fixture()
  const first = await f.capture({ sourceMessageId: 'first-message' }); await f.message(first)
  const run = (await f.store.get<RoomRunRecord>('room_run', f.runId))!.value
  await putRoomDocument(f.store, 'room_run', 'second-run', f.room.id, { ...run, id: 'second-run' }, null)
  const second = await f.capture({ sourceMessageId: 'second-message', sourceRunId: 'second-run', requestId: 'second', title: 'Revised report' })
  await f.message(second)
  expect(await f.preview(first)).toMatchObject({ state: 'available', version: '1', sourceTarget: {
    roomId: f.room.id, participantAgentId: 'agent-1', runId: f.runId, messageId: 'first-message' } })
  expect(await f.preview(second)).toMatchObject({ state: 'available', version: '2', sourceTarget: {
    roomId: f.room.id, participantAgentId: 'agent-1', runId: 'second-run', messageId: 'second-message' } })
  expect((await f.preview(first)).openTarget).toBeUndefined()
})

it('keeps saved bytes available when the source is missing and falls back to a valid run for a missing message', async () => {
  const f = await fixture()
  const missing = await f.capture({ sourceRunId: 'missing-run' })
  expect(await f.preview(missing)).toMatchObject({ state: 'available', preview: { text: 'Saved report' } })
  expect((await f.preview(missing)).sourceTarget).toBeUndefined()
  const runOnly = await f.capture({ requestId: 'run-only', sourceMessageId: 'missing-message' })
  expect((await f.preview(runOnly)).sourceTarget).toEqual({ roomId: f.room.id, participantAgentId: 'agent-1', runId: f.runId })
})

it.each(['foreign-agent', 'foreign-room', 'group-run', 'foreign-member'] as const)('never links a %s source', async (scenario) => {
  const f = await fixture()
  const sourceRunId = await f.patchRun(scenario === 'foreign-agent' ? { participantAgentId: 'someone-else' }
    : scenario === 'foreign-room' ? { roomId: 'another-private-room' }
      : scenario === 'group-run' ? { phase: 'discussion' } : { memberId: 'another-member' })
  const version = await f.capture({ sourceRunId })
  expect((await f.preview(version)).state).toBe('available')
  expect((await f.preview(version)).sourceTarget).toBeUndefined()
})

it('rejects foreign artifact ownership and never follows an artifact into a different private or group room', async () => {
  const f = await fixture()
  const foreign = await f.capture({ participantAgentId: 'foreign-agent' })
  expect((await f.preview(foreign)).state).toBe('unavailable')
  for (const conversationKind of ['group', 'user_agent'] as const) {
    const roomId = 'other-' + conversationKind
    await putRoomDocument(f.store, 'room', roomId, roomId, { ...f.room, id: roomId, conversationKind } satisfies Room, null)
    const version = await f.capture({ roomId, requestId: roomId, workspaceId: roomId })
    expect((await f.preview(version)).sourceTarget).toBeUndefined()
  }
})

it.each(['foreign-room', 'wrong-version', 'foreign-run'] as const)('does not expose a %s message identifier', async (scenario) => {
  const f = await fixture(), version = await f.capture({ sourceMessageId: 'source-message' })
  await f.message(version, scenario === 'foreign-room' ? 'someone-elses-private-room' : f.room.id,
    scenario === 'wrong-version' ? { ...artifactReference(version), artifactVersion: 2 } as ReturnType<typeof artifactReference> : artifactReference(version),
    scenario === 'foreign-run' ? 'another-run' : version.sourceRunId)
  expect((await f.preview(version)).sourceTarget).toEqual({ roomId: f.room.id, participantAgentId: 'agent-1', runId: f.runId })
})
