import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { putRoomDocument } from '../rooms/room-service.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { createThreadRecord } from '../domain/thread.js'
import { acknowledgeConversationBridge, conversationBridgeId, freezeConversationBridge as freezeChunk, type ConversationBridge } from './agent-conversation-history.js'
import { agentHistoryPage } from './agent-history-tool.js'

async function freezeConversationBridge(...args: Parameters<typeof freezeChunk>): Promise<string> {
  for (let n = 0; n < 1000; n++) { const prompt = await freezeChunk(...args); if (prompt !== null) return prompt }
  throw new Error('preparation did not converge')
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-history-')), path = join(root, 'rooms.sqlite')
  let store = new SqliteRoomStore({ path })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const room = { id: 'private', defaultMemberId: 'member', privateEpoch: 0,
    members: [{ id: 'member', participantAgentId: 'agent' }] } as Room
  const thread = createThreadRecord({ id: 'execution-a', title: 'Execution', workspace: root, model: 'test' })
  const deps = { store } as unknown as RoomRuntimeDeps
  const message = async (id: string, text = id, options: Partial<RoomMessage> = {}) => {
    const value = { id, roomId: room.id, authorLabelSnapshot: 'You', authorKind: 'user',
      messageSeq: 1, body: text, status: 'final', bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
      createdAt: new Date().toISOString(), ...options } as RoomMessage
    await putRoomDocument(store, 'message', id, value.roomId, value, null)
    return (await store.get<RoomMessage>('message', id))!
  }
  const request = async (id: string, options: Partial<RoomRequestState> = {}) => {
    const value = { id, roomId: room.id, sourceMessageId: id + '-message', privateProtocol: 'direct-v1',
      roomSnapshot: room, threadId: thread.id, status: 'completed', turnId: id + '-turn',
      message: { body: id, clientRequestId: id, attachmentIds: [] }, ...options } as RoomRequestState
    await putRoomDocument(store, 'request', id, room.id, value, null)
    await message(value.sourceMessageId, id, { sourceRequestId: id })
    return value
  }
  return { deps, room, thread, message, request, get store() { return store }, reopen: async () => {
    await store.close(); store = new SqliteRoomStore({ path }); deps.store = store
  } }
}

it('covers a multi-page gap without deleting originals and bounds escaped long references', async () => {
  const f = await fixture()
  for (let n = 0; n < 300; n++) await f.message('history-' + n, `Decision ${n}: ` + '\u0001漢字"'.repeat(2000))
  const request = await f.request('current')
  const prompt = await freezeConversationBridge(f.deps, request, f.thread, 'client', 'CURRENT_ONLY')
  const saved = (await f.store.get<ConversationBridge>('context', conversationBridgeId(f.thread.id, 'client')))!.value
  expect(saved.referenceCount).toBe(300)
  expect(Buffer.byteLength(prompt)).toBeLessThan(12_000)
  expect(prompt.match(/CURRENT_ONLY/g)).toHaveLength(1)
  expect(prompt).toContain('history-0'); expect(prompt).toContain('history-299')
  const page = await agentHistoryPage(f.store, request, { messageId: 'history-150' })
  expect(page.messages[0].text).toContain('Decision 150')
  expect(page.messages[0].nextOffset).toBeGreaterThan(0)
  const second = await agentHistoryPage(f.store, request, { messageId: 'history-150', offset: page.messages[0].nextOffset })
  expect(second.messages[0].offset).toBe(page.messages[0].nextOffset)
  expect((await f.store.get<RoomMessage>('message', 'history-150'))!.value.body).toHaveLength(('Decision 150: ' + '\u0001漢字"'.repeat(2000)).length)
}, 15_000)

it('freezes a replayable bridge across restart and advances its receipt only once', async () => {
  const f = await fixture()
  await f.message('old', 'Keep the original constraint')
  const request = await f.request('current')
  const prompt = await freezeConversationBridge(f.deps, request, f.thread, 'client', 'Do this once')
  expect(await f.store.list('agent_conversation_cursor')).toHaveLength(0)
  await f.reopen()
  await f.message('later', 'Must not rewrite the frozen prompt')
  expect(await freezeConversationBridge(f.deps, request, f.thread, 'client', 'Do this once')).toBe(prompt)
  await acknowledgeConversationBridge(f.deps, request, f.thread, 'client')
  const cursor = (await f.store.list('agent_conversation_cursor'))[0]
  await f.reopen()
  await acknowledgeConversationBridge(f.deps, request, f.thread, 'client')
  expect((await f.store.list('agent_conversation_cursor'))[0]).toEqual(cursor)
  const next = await f.request('next')
  const follow = await freezeConversationBridge(f.deps, next, f.thread, 'next-client', 'New current prompt')
  expect(follow).not.toContain('Keep the original constraint')
  expect(follow).toContain('Must not rewrite the frozen prompt')
})

it('revisits streaming and future queued messages without leaking them into an earlier request', async () => {
  const f = await fixture()
  const older = await f.request('older', { threadId: 'execution-b' })
  await f.message('stream', 'Partial only', { sourceRequestId: older.id, authorKind: 'member', status: 'streaming' })
  const first = await f.request('first')
  const future = await f.request('future', { status: 'pending', threadId: 'execution-b', turnId: undefined })
  const initial = await freezeConversationBridge(f.deps, first, f.thread, 'first', 'Current first')
  expect(initial).not.toContain('Partial only'); expect(initial).not.toContain('future-message')
  await acknowledgeConversationBridge(f.deps, first, f.thread, 'first')
  const stream = (await f.store.get<RoomMessage>('message', 'stream'))!
  await putRoomDocument(f.store, 'message', stream.id, first.roomId, { ...stream.value, body: 'Final answer in B', status: 'final' }, stream)
  const queued = (await f.store.get<RoomRequestState>('request', future.id))!
  await putRoomDocument(f.store, 'request', future.id, first.roomId, { ...queued.value, turnId: 'future-turn', status: 'completed' }, queued)
  const next = await f.request('next')
  const prompt = await freezeConversationBridge(f.deps, next, f.thread, 'next', 'Current next')
  expect(prompt).toContain('Final answer in B'); expect(prompt).toContain('future-message')
  expect(prompt).not.toContain('Current first')
})

it('includes late earlier-run publications even when the next user message was queued first', async () => {
  const f = await fixture()
  const old = await f.request('old', { threadId: 'execution-b' })
  const next = await f.request('next')
  await f.message('late', 'Late result from the preceding run', { sourceRequestId: old.id, authorKind: 'member' })
  const prompt = await freezeConversationBridge(f.deps, next, f.thread, 'next', 'Proceed')
  expect(prompt).toContain('Late result from the preceding run')
})

it('fails closed across rooms and reset epochs and retains failed/cancelled provenance', async () => {
  const f = await fixture()
  await f.request('failed', { threadId: 'execution-b', status: 'failed' })
  await f.request('cancelled', { threadId: 'execution-b', status: 'cancelled' })
  await f.message('foreign', 'FOREIGN_SECRET', { roomId: 'another-room' })
  const current = await f.request('current')
  const prompt = await freezeConversationBridge(f.deps, current, f.thread, 'current', 'Proceed')
  expect(prompt).toContain('request failed'); expect(prompt).toContain('request cancelled')
  expect(prompt).not.toContain('FOREIGN_SECRET')
  await expect(agentHistoryPage(f.store, current, { messageId: 'foreign' })).rejects.toThrow('outside')
  const reset = await f.request('reset', { roomSnapshot: { ...f.room, privateEpoch: 1 }, threadId: 'fresh-thread' })
  await expect(agentHistoryPage(f.store, reset, { messageId: 'failed-message' })).rejects.toThrow('outside')
  expect(await freezeConversationBridge(f.deps, reset, { ...f.thread, id: 'fresh-thread' }, 'reset', 'Fresh')).not.toContain('failed-message')
})


it('pages every escaped message without skipping the first unconsumed row', async () => {
  const f = await fixture()
  for (let n = 0; n < 27; n++) await f.message('escaped-' + n, '\u0001'.repeat(6000) + '漢字🙂')
  const request = await f.request('current')
  const ids: string[] = []
  let beforeSeq: number | undefined
  for (let n = 0; n < 30; n++) {
    const page = await agentHistoryPage(f.store, request, { limit: 20, beforeSeq })
    ids.push(...page.messages.map((item) => item.id))
    if (page.nextBeforeSeq === undefined) break
    expect(page.nextBeforeSeq).toBeLessThan(beforeSeq ?? Infinity)
    beforeSeq = page.nextBeforeSeq
  }
  expect(ids).toEqual(Array.from({ length: 27 }, (_, n) => 'escaped-' + (26 - n)))
  let offset = 0, text = ''
  for (let n = 0; n < 50; n++) {
    const page = await agentHistoryPage(f.store, request, { messageId: 'escaped-0', offset })
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(6200)
    text += page.messages[0].text
    if (page.messages[0].nextOffset === undefined) break
    expect(page.messages[0].nextOffset).toBeGreaterThan(offset)
    offset = page.messages[0].nextOffset!
  }
  expect(text).toBe('\u0001'.repeat(6000) + '漢字🙂')
})

it('yields large preparation, resumes after restart, and stores no future-message ID queue', async () => {
  const f = await fixture()
  for (let n = 0; n < 180; n++) await f.message('past-' + n)
  const current = await f.request('current')
  for (let n = 0; n < 180; n++) await f.message('future-' + n)
  expect(await freezeChunk(f.deps, current, f.thread, 'resumable', 'Current')).toBeNull()
  const staging = (await f.store.list('agent_conversation_preparation'))[0]
  expect(staging).toBeDefined(); expect(Buffer.byteLength(JSON.stringify(staging))).toBeLessThan(16_000)
  expect(await f.store.list('agent_conversation_cursor')).toHaveLength(0)
  await f.reopen()
  const prompt = await freezeConversationBridge(f.deps, current, f.thread, 'resumable', 'Current')
  expect(prompt).toContain('past-179'); expect(prompt).not.toContain('future-')
  const snapshot = (await f.store.get<ConversationBridge>('context', conversationBridgeId(f.thread.id, 'resumable')))!.value
  expect(snapshot.referenceCount).toBe(180)
})

it('scales bridge bytes down for the selected provider model capacity', async () => {
  const f = await fixture()
  for (let n = 0; n < 12; n++) await f.message('past-' + n, 'Large reference '.repeat(1000))
  const request = await f.request('current', { privateModel: { model: 'tiny-custom', providerId: 'custom', accountId: 'account' } })
  f.deps.modelSnapshot = async () => ({ providers: [{ id: 'custom', accountId: 'account',
    modelCapabilities: { 'tiny-custom': { contextWindowTokens: 4096 } } }] }) as never
  const prompt = await freezeConversationBridge(f.deps, request, f.thread, 'tiny', 'CURRENT_UNCHANGED')
  expect(Buffer.byteLength(prompt)).toBeLessThan(650)
  expect(prompt.endsWith('CURRENT_UNCHANGED')).toBe(true)
})


it('uses the actual request-composer profile over catalog fallback metadata', async () => {
  const f = await fixture()
  for (let n = 0; n < 20; n++) await f.message('profile-' + n, 'Earlier constraint '.repeat(400))
  const request = await f.request('current', { privateModel: { model: 'private-4k', providerId: 'default' } })
  const providerIds: Array<string | undefined> = []
  f.deps.modelCapabilities = (_model, providerId) => {
    providerIds.push(providerId)
    return { id: 'private-4k', contextWindowTokens: 4096, inputModalities: ['text'], outputModalities: ['text'],
      supportsToolCalling: true, messageParts: ['text'] }
  }
  const prompt = await freezeConversationBridge(f.deps, request, f.thread, 'configured', 'CURRENT')
  expect(Buffer.byteLength(prompt)).toBeLessThan(640)
  expect(providerIds).toEqual([undefined])
})

it('marks a commitment list partial when count or byte budget omits any open entries', async () => {
  const f = await fixture()
  const source = await f.message('commitment-source')
  for (let n = 0; n < 7; n++) await putRoomDocument(f.store, 'agent_commitment', 'commitment-' + n, f.room.id,
    { participantAgentId: 'agent', sourceRoomId: f.room.id, sourceMessageId: source.id, status: 'open',
      objective: 'Important outcome '.repeat(70), acceptance: 'Evidence '.repeat(100), deadline: null, waitingOn: null }, null)
  const request = await f.request('current')
  const full = await freezeConversationBridge(f.deps, request, f.thread, 'full', 'CURRENT')
  const payload = JSON.parse(full.slice(full.indexOf('\n') + 1, full.lastIndexOf('\n\nCURRENT')))
  expect(payload.activeCommitments).toHaveLength(4)
  expect(payload.moreCommitments).toBe(true)
  f.deps.modelCapabilities = () => ({ id: 'tiny', contextWindowTokens: 1024, inputModalities: ['text'],
    outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'] })
  const tiny = await freezeConversationBridge(f.deps, request, f.thread, 'tiny', 'CURRENT')
  const omitted = JSON.parse(tiny.slice(tiny.indexOf('\n') + 1, tiny.lastIndexOf('\n\nCURRENT')))
  expect(omitted.activeCommitments).toHaveLength(0)
  expect(omitted.moreCommitments).toBe(true)
  expect(tiny).toContain('omitted status is unknown')
})

it('does not call a source-bounded commitment snapshot complete when newer work is omitted', async () => {
  const f = await fixture()
  const request = await f.request('older-request')
  const newer = await f.message('newer-source', 'FUTURE_PRIVATE_DECISION')
  await putRoomDocument(f.store, 'agent_commitment', 'newer-commitment', f.room.id,
    { participantAgentId: 'agent', sourceRoomId: f.room.id, sourceMessageId: newer.id, status: 'open',
      objective: 'FUTURE_PRIVATE_DECISION', acceptance: 'Evidence', deadline: null, waitingOn: null }, null)
  const prompt = await freezeConversationBridge(f.deps, request, f.thread, 'older-retry', 'CURRENT')
  const payload = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1, prompt.lastIndexOf('\n\nCURRENT')))
  expect(prompt).not.toContain('FUTURE_PRIVATE_DECISION')
  expect(payload.activeCommitments).toHaveLength(0)
  expect(payload.moreCommitments).toBe(true)
})
