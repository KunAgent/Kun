import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { bindRoomPeerStore } from '../rooms/room-peer-tools.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { TurnItem } from '../contracts/items.js'
import {
  assertNoGoogleHistorySdkExport, bindGmailThreadDataProtection, classifyBorrowedGoogleHistory,
  createGmailThreadDataPolicyOptions, inheritGoogleDataBeforeThreadWrite, resolveGmailThreadDataState
} from './thread-data-state.js'

const mailItem = (threadId = 'source', toolName = 'gmail_read', isError = false): Extract<TurnItem, { kind: 'tool_result' }> => ({
  id: 'mail-result', threadId, turnId: 'source-turn', kind: 'tool_result', role: 'tool',
  status: 'completed', createdAt: new Date().toISOString(), toolName, callId: 'mail-call',
  toolKind: 'tool_call', isError, output: { id: 'message-1', body: 'Private email', untrusted: true }
})
async function fixture() {
  const threads = new InMemoryThreadStore()
  const sensitive = new Set<string>()
  const grants = new Set<string>()
  const gmail = { hasGoogleData: vi.fn(async (id: string) => sensitive.has(id)),
    captureModelSharingFence: vi.fn(() => () => undefined),
    markGoogleData: vi.fn(async (id: string) => { sensitive.add(id) }),
    status: vi.fn(async (id?: string) => ({ configured: true, connected: true, reconnectRequired: false,
      scopes: [], allowModelSharing: Boolean(id && grants.has(id)) })) }
  const source = createThreadRecord({ id: 'source', title: 'Source', workspace: '/tmp', model: 'model' })
  await threads.upsert(source)
  const target = createThreadRecord({ id: 'target', title: 'Target', workspace: '/tmp', model: 'model', parentThreadId: 'source' })
  await threads.upsert(target)
  bindGmailThreadDataProtection(threads, gmail)
  bindRoomPeerStore(threads, { list: async () => [] } as unknown as RoomStore)
  return { threads, gmail, sensitive, grants, source, target }
}

describe('sticky Gmail history classification and consent', () => {
  it('does not classify ordinary conversations or a connection proposal as mail content', async () => {
    const f = await fixture()
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target', [mailItem('target', 'gmail_connect')]))
      .toEqual({ sensitive: false, sharingAllowed: false })
    expect(f.gmail.markGoogleData).not.toHaveBeenCalled()
  })

  it('propagates parent classification without inheriting model-sharing permission', async () => {
    const f = await fixture()
    f.sensitive.add('thread:source')
    f.grants.add('thread:source')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target')).toEqual({ sensitive: true, sharingAllowed: false })
    expect(f.sensitive.has('thread:target')).toBe(true)
    expect(f.grants.has('thread:target')).toBe(false)
    f.grants.add('thread:target')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target')).toEqual({ sensitive: true, sharingAllowed: true })
    f.grants.delete('thread:source')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target')).toEqual({ sensitive: true, sharingAllowed: false })
  })

  it('retains source classification after metadata deletion and protects a copied-history recipient', async () => {
    const f = await fixture()
    f.sensitive.add('thread:source')
    await f.threads.delete('source')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target')).toEqual({ sensitive: true, sharingAllowed: false })
    expect(f.sensitive.has('thread:target')).toBe(true)
  })

  it('uses a private Room’s own grant but requires an independent Code handoff grant', async () => {
    const f = await fixture()
    const roomThread = createThreadRecord({ id: 'room-thread', title: 'Room', workspace: '/tmp', model: 'model',
      roomContext: { kind: 'conversation', roomId: 'private-room', memberId: 'member-1', participantAgentId: 'agent-1',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
    await f.threads.upsert(roomThread)
    f.sensitive.add('room:private-room')
    f.grants.add('room:private-room')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, roomThread.id)).toEqual({ sensitive: true, sharingAllowed: true })
    const code = createThreadRecord({ id: 'handoff', title: 'Task', workspace: '/tmp', model: 'model',
      workbenchOrigin: { kind: 'bot', roomId: 'private-room', linkId: 'link-1', agentId: 'agent-1', agentName: 'Kun' } })
    await f.threads.upsert(code)
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, code.id)).toEqual({ sensitive: true, sharingAllowed: false })
    f.grants.add('thread:handoff')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, code.id)).toEqual({ sensitive: true, sharingAllowed: true })
  })

  it('blocks model replies for messaging origins and mirrored Rooms even with an old Gmail grant', async () => {
    const f = await fixture()
    f.sensitive.add('thread:target')
    f.grants.add('thread:target')
    f.target.turns.push(createTurnRecord({ id: 'im-turn', threadId: f.target.id, prompt: 'Read mail',
      status: 'running', clientSurface: 'im', imContext: true }))
    await f.threads.upsert(f.target)
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, f.target.id)).toEqual({ sensitive: true, sharingAllowed: false })
    const roomThread = createThreadRecord({ id: 'mirrored', title: 'Room', workspace: '/tmp', model: 'model',
      roomContext: { kind: 'conversation', roomId: 'private-room', memberId: 'member-1', participantAgentId: 'agent-1',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
    await f.threads.upsert(roomThread)
    f.sensitive.add('room:private-room')
    f.grants.add('room:private-room')
    bindRoomPeerStore(f.threads, { list: async () => [{ value: { enabled: true } }] } as unknown as RoomStore)
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, roomThread.id)).toEqual({ sensitive: true, sharingAllowed: false })
  })

  it('classifies before fork/resume persistence so deleting intermediate sources cannot bypass the fence', async () => {
    const f = await fixture()
    f.sensitive.add('thread:source')
    const first = createThreadRecord({ id: 'first-fork', title: 'Fork', workspace: '/tmp', model: 'model', forkedFromThreadId: 'source' })
    await inheritGoogleDataBeforeThreadWrite(f.threads, first)
    expect(f.sensitive.has('thread:first-fork')).toBe(true)
    await f.threads.upsert(first)
    const second = createThreadRecord({ id: 'second-fork', title: 'Fork', workspace: '/tmp', model: 'model', forkedFromThreadId: 'first-fork' })
    await inheritGoogleDataBeforeThreadWrite(f.threads, second)
    await f.threads.upsert(second)
    await f.threads.delete('source')
    await f.threads.delete('first-fork')
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, second.id)).toEqual({ sensitive: true, sharingAllowed: false })
    const resumed = createThreadRecord({ id: 'resumed', title: 'Resume', workspace: '/tmp', model: 'model' })
    await inheritGoogleDataBeforeThreadWrite(f.threads, resumed, [], ['source'])
    expect(f.sensitive.has('thread:resumed')).toBe(true)
  })

  it('marks borrowed history before output and refuses SDK exports without treating content as permission', async () => {
    const f = await fixture()
    const output = { turns: [{ items: [mailItem()] }] }
    await classifyBorrowedGoogleHistory(f.threads, 'target', output)
    expect(f.sensitive.has('thread:target')).toBe(true)
    expect(f.grants.has('thread:target')).toBe(false)
    expect(() => assertNoGoogleHistorySdkExport(output)).toThrow('cannot be exported')
    expect(() => assertNoGoogleHistorySdkExport({ text: 'Public ordinary history' })).not.toThrow()
    const source = { ...mailItem('target', 'read_source_history'), output: { text: 'Mail excerpt', googleWorkspaceData: true } }
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target', [source])).toEqual({ sensitive: true, sharingAllowed: false })
  })

  it('requires explicit consent for imported Google tool results but does not taint failures', async () => {
    const f = await fixture()
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target', [mailItem('target', 'gmail_read', true)]))
      .toEqual({ sensitive: false, sharingAllowed: false })
    expect(await resolveGmailThreadDataState(f.threads, f.gmail, 'target', [mailItem('target')]))
      .toEqual({ sensitive: true, sharingAllowed: false })
  })

  it('selects the actual admitted turn instead of a later queued turn or composer route', async () => {
    const f = await fixture()
    f.target.turns.push(createTurnRecord({ id: 'admitted', threadId: f.target.id, prompt: 'Mail', status: 'completed',
      model: 'admitted-model', providerId: 'admitted-provider' }), createTurnRecord({ id: 'queued', threadId: f.target.id,
      prompt: 'Later', status: 'queued', model: 'different-model', providerId: 'different-provider' }))
    await f.threads.upsert(f.target)
    const policy = createGmailThreadDataPolicyOptions(f.threads, f.gmail, () => ({ model: 'fallback' }))
    expect(await policy.selection('target')).toEqual({ model: 'admitted-model', providerId: 'admitted-provider' })
    expect(await policy.selection('missing')).toEqual({ model: 'fallback' })
  })

  it('fails closed when a lineage exceeds the verification bound', async () => {
    const f = await fixture()
    for (let i = 0; i < 130; i++) await f.threads.upsert(createThreadRecord({ id: `chain-${i}`, title: 'Chain',
      workspace: '/tmp', model: 'model', ...(i > 0 ? { parentThreadId: `chain-${i - 1}` } : {}) }))
    await expect(resolveGmailThreadDataState(f.threads, f.gmail, 'chain-129')).rejects.toThrow('fully verified')
  })
})
