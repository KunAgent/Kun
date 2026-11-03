import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { FileAttachmentStore } from '../../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig } from '../../contracts/capabilities.js'
import { png } from '../../../tests/support/attachment-store-fixtures.js'
import { RemoteAttachmentAdmissions, attachmentAdmissionKey } from './admissions.js'
import { transferReceipt } from './transfer-receipts.js'
import { receiptKey } from '../requests/receipts.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { makeUserItem } from '../../domain/item.js'
async function fixture() {
  const f = await remoteFixture(), attachments = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'),
    config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
  f.runtime.attachmentStore = attachments
  f.h.turns['deps'].attachmentStore = () => attachments
  const attachment = await attachments.create({ name: 'phone.png', data: png(2, 2), mimeType: 'image/png' })
  const scope = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant' }
  const admissions = new RemoteAttachmentAdmissions(f.runtime)
  return { ...f, attachments, attachment, scope, admissions }
}
describe('remote attachment admissions use local durable proofs', () => {
  it('rejects guessed existing ids for every new input before any canonical task/message side effect', async () => {
    const f = await fixture()
    try {
      const thread = await f.code(), agent = (await f.rooms.agents.create({ clientRequestId: 'agent', name: 'Agent' })).agent
      const calls = [
        ['code.turn.start', { threadId: thread.id, text: 'text' }],
        ['agent.message.send', { agentId: agent.id, text: 'text' }],
        ['execution.queue.enqueue', { threadId: thread.id, text: 'text' }]
      ] as const
      for (const [method, params] of calls) {
        const receipt = (await f.call(method, { ...params, attachmentIds: [f.attachment.id] })).receipt
        expect(receipt.error).toEqual({ code: 'ATTACHMENT_NOT_CONFIRMED', definitive: true })
      }
      const active = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'existing', clientSurface: 'api' } })
      const queued = await f.h.turns.enqueueTurn({ threadId: thread.id, request: { prompt: 'existing queued', clientSurface: 'api' } })
      const queue = await f.call('execution.queue.list', { threadId: thread.id })
      for (const [method, params] of [
        ['execution.queue.update', { threadId: thread.id, turnId: queued.turnId, text: 'edit', expectedRevision: queue.revision }],
        ['execution.steer', { threadId: thread.id, turnId: active.turnId, text: 'steer' }]
      ] as const) {
        expect((await f.call(method, { ...params, attachmentIds: [f.attachment.id] })).receipt.error?.code).toBe('ATTACHMENT_NOT_CONFIRMED')
      }
      expect((await f.h.threads.get(thread.id))?.turns).toHaveLength(2)
      expect((await f.h.threads.get(thread.id))?.turns[0].steeringDeliveries).toBeUndefined()
      expect((await f.call('execution.queue.list', { threadId: thread.id })).items[0].text).toBe('existing queued')
      expect(await f.store.list('remote_attachment_admission')).toEqual([])
    } finally { await f.close() }
  })
  it('atomically confirms receive with its receipt, permits another authorized phone in the account, rejects another account', async () => {
    const f = await fixture()
    try {
      const input = { ...f.scope, requestId: 'receive_once', method: 'attachment.receive', params: { transferId: 'transfer' } }
      expect(await transferReceipt(f.rooms, { ...input, action: 'start' })).toEqual({ started: true })
      await expect(f.admissions.assert(f.scope, 'code.turn.start', { attachmentIds: [f.attachment.id] })).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const before = f.store.commit.bind(f.store), commits = vi.spyOn(f.store, 'commit')
      const seen: any[] = []
      commits.mockImplementation(async (value, fence) => { seen.push(value); return before(value, fence) })
      const finished = await transferReceipt(f.rooms, { ...input, action: 'finish', result: { attachment: f.attachment } })
      expect(finished.receipt?.status).toBe('applied')
      expect(seen.at(-1).puts.map((put: any) => put.kind)).toEqual(['remote_receipt', 'remote_attachment_admission', 'remote_attachment_admission'])
      const proof = await f.store.get<any>('remote_attachment_admission', attachmentAdmissionKey(f.scope, f.attachment.id))
      expect(proof?.value).toMatchObject({ attachmentId: f.attachment.id, sourceDeviceId: 'phone', receiptId: 'receive_once' })
      const thread = await f.code(), result = (await f.call('code.turn.start', { threadId: thread.id,
        text: 'using confirmed file', attachmentIds: [f.attachment.id] }, 'send_confirmed', 'other_phone')).receipt
      expect(result.status).toBe('applied')
      await expect(f.admissions.assert({ ...f.scope, accountId: 'another_owner' }, 'code.turn.start',
        { attachmentIds: [f.attachment.id] })).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const replay = f.envelope('code.turn.start', { threadId: thread.id, text: 'using confirmed file', attachmentIds: [f.attachment.id] }, 'replay')
      const checking = vi.spyOn(f.runtime.attachmentStore!, 'get')
      const a = await f.facade.execute(replay) as any
      const count = checking.mock.calls.length
      expect((await f.facade.execute(replay) as any).receipt).toEqual(a.receipt)
      expect(checking.mock.calls.length).toBe(count)
    } finally { await f.close() }
  })
  it('lazily migrates a 0.1.3 receive receipt only when its stable account/device key matches', async () => {
    const f = await fixture()
    try {
      const key = receiptKey(f.scope, 'old_receive')
      await f.store.commit({ requestId: 'seed-old-receipt', checks: [{ kind: 'remote_receipt', id: key, expectedRevision: null }],
        puts: [{ kind: 'remote_receipt', id: key, value: { requestId: 'old_receive', method: 'attachment.receive',
          fingerprint: 'a'.repeat(64), status: 'applied', createdAt: Date.now(), result: { attachment: f.attachment } } }] })
      await expect(f.admissions.assert({ ...f.scope, deviceId: 'other_phone' }, 'code.turn.start',
        { attachmentIds: [f.attachment.id] })).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      await f.admissions.assert(f.scope, 'code.turn.start', { attachmentIds: [f.attachment.id] })
      expect(await f.store.get('remote_attachment_admission', attachmentAdmissionKey(f.scope, f.attachment.id))).not.toBeNull()
      await f.admissions.assert({ ...f.scope, deviceId: 'other_phone' }, 'code.turn.start', { attachmentIds: [f.attachment.id] })
    } finally { await f.close() }
  })
  it('reuses an attachment actually referenced in the selected personal Agent conversation', async () => {
    const f = await fixture()
    try {
      const agent = (await f.rooms.agents.create({ clientRequestId: 'history-agent', name: 'History Agent' })).agent
      const other = (await f.rooms.agents.create({ clientRequestId: 'other-agent', name: 'Other Agent' })).agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      await f.rooms.service.send(room.id, { clientRequestId: 'historical-attachment', body: 'Previously received', attachmentIds: [f.attachment.id] })
      await expect(f.admissions.assert(f.scope, 'agent.message.send', { agentId: other.id, attachmentIds: [f.attachment.id] }))
        .rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      await f.admissions.assert({ ...f.scope, deviceId: 'second-phone' }, 'agent.message.send', { agentId: agent.id, attachmentIds: [f.attachment.id] })
      expect(await f.store.get('remote_attachment_admission', attachmentAdmissionKey(f.scope, f.attachment.id))).not.toBeNull()
    } finally { await f.close() }
  })
  it('permits real authorized Code history reuse, ignores workspace-only scopes and excludes hidden Room/ADE sources', async () => {
    const f = await fixture()
    try {
      const thread = await f.code()
      await f.attachments.bindScopes([f.attachment.id], { threadId: thread.id, workspace: thread.workspace })
      await expect(f.admissions.assert(f.scope, 'code.turn.start', { threadId: thread.id, attachmentIds: [f.attachment.id] }))
        .rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const item = makeUserItem({ id: 'historic_input', threadId: thread.id, turnId: 'historic_turn', text: 'file', attachmentIds: [f.attachment.id] })
      await f.h.sessionStore.appendItem(thread.id, item)
      await f.admissions.assert({ ...f.scope, deviceId: 'other_phone' }, 'code.turn.start', { threadId: thread.id, attachmentIds: [f.attachment.id] })
      expect(await f.store.get('remote_attachment_admission', attachmentAdmissionKey(f.scope, f.attachment.id))).not.toBeNull()
      const ade = await f.h.threads.create({ workspace: f.root, model: 'fake', mode: 'agent', workspaceMode: 'ade' })
      const another = await f.attachments.create({ name: 'hidden.png', data: png(3, 3), mimeType: 'image/png' })
      await f.h.sessionStore.appendItem(ade.id, makeUserItem({ id: 'hidden_input', threadId: ade.id, turnId: 'hidden_turn', text: 'file', attachmentIds: [another.id] }))
      await expect(f.admissions.assert(f.scope, 'code.turn.start', { threadId: ade.id, attachmentIds: [another.id] })).rejects.toThrow('NOT_A_CODE_TASK')
    } finally { await f.close() }
  })
})
