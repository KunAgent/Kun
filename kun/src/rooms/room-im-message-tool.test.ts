import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { RoomMessageSchema, type RoomMessage } from '../contracts/rooms.js'
import { RoomRunRecordSchema, type RoomRunRecord } from '../contracts/room-runs.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { roomRunId } from './room-run-recording.js'
import { roomRunSegmentMessageId } from './room-run-segments.js'
import { bindImMessageService, roomImMessageTool, SEND_IM_MESSAGE_TOOL_NAME } from './room-im-message-tool.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture(options: { triggerMessageId?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'room-im-tool-'))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace, { recursive: true })
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const service = new RoomService(store, () => {})
  const threads = new InMemoryThreadStore()
  bindImMessageService(threads, service)
  const room = (await service.create({ clientRequestId: 'room', name: 'Bot', collaborationMode: 'directed' })).room
  const thread = createThreadRecord({ id: 'conv-thread', title: 'Bot', workspace, model: 'test',
    roomContext: { roomId: room.id, memberId: 'agent-member', participantAgentId: 'agent-1', kind: 'conversation',
      blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
  const turn = createTurnRecord({ id: 'turn-1', threadId: thread.id, prompt: 'hi', clientRequestId: 'req-1', status: 'running' })
  thread.turns.push(turn)
  await threads.upsert(thread)
  const runId = roomRunId(room.id, 'req-1')
  const now = new Date().toISOString()
  await putRoomDocument(store, 'room_run', runId, room.id, RoomRunRecordSchema.parse({
    id: runId, roomId: room.id, memberId: 'agent-member', memberLabel: 'Bot', phase: 'conversation',
    attempt: 1, clientRequestId: 'req-1', threadId: thread.id, turnId: turn.id, input: 'hi',
    attachmentIds: [], status: 'running', createdAt: now, updatedAt: now,
    ...(options.triggerMessageId ? { triggerMessageId: options.triggerMessageId } : {}) }), null)
  cleanup.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  const context: ToolHostContext = {
    threadId: thread.id, turnId: turn.id, workspace, sandboxMode: 'workspace-write', approvalPolicy: 'auto',
    threadMode: 'agent', roomStepKind: 'conversation', roomAgent: true, activeToolCallId: 'call-1',
    abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }
  return { store, service, threads, room, thread, turn, runId, workspace, context, tool: roomImMessageTool(threads) }
}

describe('send_im_message', () => {
  it('publishes a text bubble with deterministic run provenance', async () => {
    const f = await fixture()
    const result = await f.tool.execute({ text: ' Done. ' }, f.context)
    expect(result.isError).not.toBe(true)
    const output = result.output as { accepted: boolean; messageId: string; text: string }
    expect(output.accepted).toBe(true)
    expect(output.text).toBe('Done.')
    expect(output.messageId).toBe(roomRunSegmentMessageId(f.runId, 'call-1'))
    const message = (await f.store.get<RoomMessage>('message', output.messageId))!.value
    expect(message).toMatchObject({ roomId: f.room.id, authorKind: 'member', authorMemberId: 'agent-member',
      body: 'Done.', status: 'final', originItemId: 'call-1', originRunId: f.runId })
    const run = (await f.store.get<RoomRunRecord>('room_run', f.runId))!.value
    expect(run.publishedMessageId).toBe(output.messageId)
  })

  it('publishes an attachment-only bubble', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace, 'report.pdf'), 'pdf')
    const result = await f.tool.execute({ attachments: [{ path: 'report.pdf' }] }, f.context)
    expect(result.isError).not.toBe(true)
    const output = result.output as { messageId: string }
    const message = (await f.store.get<RoomMessage>('message', output.messageId))!.value
    expect(message.body).toBe('')
    expect(message.references).toEqual([
      { kind: 'agent_file', workspaceId: expect.any(String), relativePath: 'report.pdf', titleSnapshot: 'report.pdf' }
    ])
  })

  it('combines text with multiple attachments and dedupes resolved paths', async () => {
    const f = await fixture()
    await mkdir(join(f.workspace, 'out'), { recursive: true })
    await writeFile(join(f.workspace, 'a.png'), 'png')
    await writeFile(join(f.workspace, 'out', 'b.mp3'), 'mp3')
    const result = await f.tool.execute({ text: 'Files', attachments: [
      { path: 'a.png' }, { path: 'a.png', fileName: 'again.png' }, { path: 'out/b.mp3' }
    ] }, f.context)
    expect(result.isError).not.toBe(true)
    const message = (await f.store.get<RoomMessage>('message', (result.output as { messageId: string }).messageId))!.value
    expect(message.body).toBe('Files')
    expect(message.references?.map((reference) => reference.kind === 'agent_file' ? reference.relativePath : reference.kind))
      .toEqual(['a.png', 'out/b.mp3'])
    expect(message.references?.map((reference) => reference.titleSnapshot)).toEqual(['a.png', 'b.mp3'])
  })

  it('rejects paths that escape the workspace and non-file paths', async () => {
    const f = await fixture()
    const outside = await f.tool.execute({ attachments: [{ path: '../outside.txt' }] }, f.context)
    expect(outside.isError).toBe(true)
    const directory = await f.tool.execute({ attachments: [{ path: '.' }] }, f.context)
    expect(directory.isError).toBe(true)
    expect(await f.store.list('message')).toHaveLength(0)
  })

  it('rejects an empty message', async () => {
    const f = await fixture()
    const result = await f.tool.execute({}, f.context)
    expect(result.isError).toBe(true)
    expect(await f.store.list('message')).toHaveLength(0)
  })

  it('rejects publication outside the active conversation turn', async () => {
    const f = await fixture()
    const wrongTurn = await f.tool.execute({ text: 'x' }, { ...f.context, turnId: 'turn-other' })
    expect(wrongTurn.isError).toBe(true)
    const missingIdentity = await f.tool.execute({ text: 'x' }, { ...f.context, activeToolCallId: undefined })
    expect(missingIdentity.isError).toBe(true)
    const noScope = await f.tool.execute({ text: 'x' }, { ...f.context, threadId: 'plain-thread' })
    expect(noScope.isError).toBe(true)
    expect(await f.store.list('message')).toHaveLength(0)
  })

  it('is idempotent for a repeated tool call', async () => {
    const f = await fixture()
    const first = await f.tool.execute({ text: 'Done.' }, f.context)
    const again = await f.tool.execute({ text: 'Done.' }, f.context)
    expect(first.isError).not.toBe(true)
    expect(again.isError).not.toBe(true)
    expect((again.output as { messageId: string }).messageId).toBe((first.output as { messageId: string }).messageId)
    expect(await f.store.list('message')).toHaveLength(1)
  })

  it('carries the trigger reply display thread onto the bubble', async () => {
    const f = await fixture({ triggerMessageId: 'user-reply' })
    await putRoomDocument(f.store, 'message', 'user-reply', f.room.id, RoomMessageSchema.parse({
      id: 'user-reply', roomId: f.room.id, messageSeq: 1, authorKind: 'user', authorLabelSnapshot: 'You',
      body: 'follow up', bodyRevision: 0, status: 'final', createdAt: new Date().toISOString(),
      replyToMessageId: 'root-msg', displayThreadRootId: 'root-msg', mentionMemberIds: [], attachmentIds: [] }), null)
    const result = await f.tool.execute({ text: 'answer' }, f.context)
    expect(result.isError).not.toBe(true)
    const message = (await f.store.get<RoomMessage>('message', (result.output as { messageId: string }).messageId))!.value
    expect(message.displayThreadRootId).toBe('root-msg')
    expect(message.replyToMessageId).toBeUndefined()
  })

  it('returns a bridge payload without publishing on a remote IM turn', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace, 'a.png'), 'png')
    const plain = createThreadRecord({ id: 'im-thread', title: 'IM', workspace: f.workspace, model: 'test' })
    plain.turns.push(createTurnRecord({ id: 'im-turn', threadId: plain.id, prompt: 'hi', status: 'running' }))
    await f.threads.upsert(plain)
    const result = await f.tool.execute({ text: 'hello', attachments: [{ path: 'a.png' }] },
      { ...f.context, threadId: 'im-thread', turnId: 'im-turn', roomStepKind: undefined, roomAgent: undefined, imContext: true })
    expect(result.isError).not.toBe(true)
    expect(result.output).toMatchObject({ accepted: true, text: 'hello',
      files: [{ relativePath: 'a.png', fileName: 'a.png' }] })
    expect(await f.store.list('message')).toHaveLength(0)
  })

  it('advertises only on agent conversations and remote IM turns', async () => {
    const f = await fixture()
    expect(f.tool.name).toBe(SEND_IM_MESSAGE_TOOL_NAME)
    const advertised = f.tool.shouldAdvertise!
    expect(advertised({ ...f.context })).toBe(true)
    expect(advertised({ ...f.context, roomStepKind: undefined, roomAgent: undefined, imContext: true })).toBe(true)
    expect(advertised({ ...f.context, roomStepKind: 'discussion' })).toBe(false)
    expect(advertised({ ...f.context, roomAgent: false })).toBe(false)
  })
})
