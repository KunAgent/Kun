import { expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Jimp } from 'jimp'
import { FileAttachmentStore } from '../../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig, McpCapabilityConfig } from '../../contracts/capabilities.js'
import { agentHistoryFixture } from './memory/history.test-support.js'
import { RemoteAgentAvatar } from './avatar.js'
import { AgentAppearanceParams } from './appearance-contracts.js'
import { deviceAttachmentAdmissionKey } from '../files/device-admission.js'
import { attachmentAdmissionKey } from '../files/admissions.js'
import { transferReceipt } from '../files/transfer-receipts.js'
import type { Envelope } from '../contracts.js'
import { registerRemoteAvatarRoute } from './avatar-route.js'
import { shareFixture } from '../sharing/guest.test-support.js'
import { SharedTaskFiles } from '../sharing/files.js'
import { SharedTaskReceipts } from '../sharing/receipts.js'
import { hasOperation } from '@kun/remote-protocol'

async function fixture() {
  const f = await agentHistoryFixture(), attachments = new FileAttachmentStore({ rootDir: join(f.root, 'avatars'), config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
  f.runtime.attachmentStore = attachments
  const avatar = new RemoteAgentAvatar(f.runtime), image = await attachments.create({ name: 'PRIVATE_SOURCE.png',
    data: await new Jimp({ width: 20, height: 30, color: 0x5599ffff }).getBuffer('image/png'), mimeType: 'image/png' })
  let error: unknown
  const scope = { accountId: 'owner', deviceId: 'phone', authorizationId: 'connection' }
  async function receive(deviceId = 'phone', requestId = 'receive-' + deviceId) {
    const input = { ...scope, deviceId, requestId, method: 'attachment.receive', params: { transferId: 'fixture-transfer' } }
    await transferReceipt(f.rooms, { ...input, action: 'start' })
    return transferReceipt(f.rooms, { ...input, action: 'finish', result: { attachment: image } })
  }
  async function update(source: any, expectedRevision = 0, id = 'avatar', device = 'phone') {
    const p = AgentAppearanceParams['agent.avatar.update'].parse({ agentId: f.agent.id, expectedRevision, source })
    const envelope = { ...f.envelope('agent.avatar.update', p, id, device), scopes: ['personal'] } as Envelope
    error = undefined
    return f.receipts.execute(envelope, async () => { try { return await avatar.update(p, envelope) } catch (cause) { error = cause; throw cause } })
  }
  registerRemoteAvatarRoute(f.router, f.runtime)
  async function read(agentId = f.agent.id, revision = 1, authorization = 'Bearer token', extra = '') {
    const path = '/v1/remote/agents/' + agentId + '/avatar', route = f.router.match('GET', path)!
    const result = await route.handler(new Request('http://runtime' + path + '?revision=' + revision + extra, { headers: { Authorization: authorization } }), { params: route.params })
    return result instanceof Response ? result : new Response(result.body, { status: result.status, headers: result.headers })
  }
  const invoke = (method: string, params: unknown, requestId?: string, deviceId?: string) =>
    f.facade.execute(f.envelope(method, params, requestId, deviceId)) as Promise<any>
  return { ...f, attachments, avatar, image, scope, receive, update, read, invoke, failure: () => String(error) }
}
it('requires installation admission, normalizes inert local pixels, updates through native CAS and serves only the current exact avatar', async () => {
  const f = await fixture()
  try {
    expect((await f.update({ kind: 'received', attachmentId: f.image.id })).error?.code).toBe('ATTACHMENT_NOT_CONFIRMED')
    await f.receive()
    const value = await f.update({ kind: 'received', attachmentId: f.image.id }, 0, 'confirmed')
    expect(value, f.failure()).toMatchObject({ status: 'applied', result: { agentId: f.agent.id, revision: 1, avatar: { kind: 'uploaded' } } })
    const get = await f.avatar.get(f.agent.id)
    expect(get).toMatchObject({ rendering: 'image', uploadedImage: { width: 128, height: 128, mimeType: 'image/jpeg' } })
    const exported = await f.read()
    expect(exported.status).toBe(200); expect(exported.headers.get('X-Kun-File-Name')).toBe('avatar.jpg')
    expect(exported.headers.get('X-Kun-Content-SHA256')).toBe(get.uploadedImage?.sha256)
    expect((await exported.arrayBuffer()).byteLength).toBe(get.uploadedImage?.size)
    expect(JSON.stringify([get, value])).not.toContain('PRIVATE_SOURCE')
    expect((await f.read(f.agent.id, 0)).status).toBe(403)
    expect((await f.read('other-agent', 1)).status).toBe(403)
    expect((await f.read(f.agent.id, 1, 'Bearer wrong')).status).toBe(401)
    expect((await f.read(f.agent.id, 1, 'Bearer token', '&path=/private/file')).status).toBe(403)
    expect((await f.update({ kind: 'builtin', id: 'coder' }, 1, 'builtin')).status).toBe('applied')
    expect((await f.read(f.agent.id, 1)).status).toBe(403)
    expect((await f.update({ kind: 'clear' }, 2, 'clear')).result).toMatchObject({ revision: 3, avatar: null })
  } finally { await f.close() }
})
it('records independent same-byte receives per account/device without changing old account-wide send admission', async () => {
  const f = await fixture()
  try {
    await f.receive('phone-a')
    expect((await f.update({ kind: 'received', attachmentId: f.image.id }, 0, 'denied', 'phone-b')).error?.code).toBe('ATTACHMENT_NOT_CONFIRMED')
    await f.receive('phone-b')
    const before = (await f.store.list('remote_attachment_admission')).length
    await f.receive('phone-b')
    expect((await f.store.list('remote_attachment_admission')).length).toBe(before)
    for (const deviceId of ['phone-a', 'phone-b']) expect(await f.store.get('remote_attachment_admission', deviceAttachmentAdmissionKey({ accountId: 'owner', deviceId }, f.image.id))).not.toBeNull()
    expect((await f.store.get<any>('remote_attachment_admission', attachmentAdmissionKey(f.scope, f.image.id)))?.value.sourceDeviceId).toBe('phone-a')
    expect((await f.update({ kind: 'received', attachmentId: f.image.id }, 0, 'allowed', 'phone-b')).status).toBe('applied')
    const p = { agentId: f.agent.id, expectedRevision: 1, source: { kind: 'received', attachmentId: f.image.id } }
    await expect(f.avatar.preflight(p, { ...f.scope, accountId: 'foreign' })).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
  } finally { await f.close() }
})
it('accepts legacy admission only for its original source device and rejects corrupt bytes before profile writes', async () => {
  const f = await fixture()
  try {
    const key = attachmentAdmissionKey(f.scope, f.image.id)
    await f.store.commit({ requestId: 'legacy', checks: [{ kind: 'remote_attachment_admission', id: key, expectedRevision: null }],
      puts: [{ kind: 'remote_attachment_admission', id: key, value: { attachmentId: f.image.id, sourceDeviceId: 'phone', confirmedAt: Date.now() } }] })
    expect((await f.update({ kind: 'received', attachmentId: f.image.id }, 0, 'other', 'other-phone')).error?.code).toBe('ATTACHMENT_NOT_CONFIRMED')
    await writeFile(join(f.root, 'avatars', f.image.id + '.bin'), Buffer.from('not an image'))
    expect((await f.update({ kind: 'received', attachmentId: f.image.id }, 0, 'corrupt')).error?.code).toBe('INVALID_REQUEST')
    expect((await f.rooms.agents.get(f.agent.id)).revision).toBe(0)
  } finally { await f.close() }
})
it('recovers only the exact staged native update proof after acknowledgement loss and never reapplies', async () => {
  const f = await fixture()
  try {
    const original = f.store.commit.bind(f.store)
    const commit = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      const result = await original(input)
      if (input.requestId.startsWith('agent-update:')) throw new Error('native ACK lost')
      return result
    })
    const receipt = await f.update({ kind: 'builtin', id: 'coder' }, 0, 'once')
    commit.mockRestore()
    expect(receipt.status).toBe('reconciliation_required')
    expect(await f.avatar.recover(f.scope, receipt)).toMatchObject({ revision: 1, avatar: { kind: 'builtin', id: 'coder' } })
    expect(await f.avatar.recover({ ...f.scope, deviceId: 'other' }, receipt)).toBeUndefined()
    expect(await f.avatar.recover(f.scope, { ...receipt, params: { ...receipt.params, source: { kind: 'clear' } } })).toBeUndefined()
    expect((await f.update({ kind: 'builtin', id: 'coder' }, 0, 'once')).status).toBe('reconciliation_required')
    expect((await f.rooms.agents.get(f.agent.id)).revision).toBe(1)
  } finally { await f.close() }
})
it('shared export cannot route Agent avatar or mixed variants through its task-only read allowlist', async () => {
  const f = await shareFixture()
  try {
    const before = await f.store.list('shared_receipt')
    const files = new SharedTaskFiles(f.runtime, f.journal, new SharedTaskReceipts(f.runtime))
    for (const actor of [f.actor, { ...f.actor, shareId: 'foreign-share' }])
      for (const params of [{ agentId: 'private-agent', avatarRevision: 1 }, { threadId: f.task.id, agentId: 'private-agent', avatarRevision: 1 },
        { threadId: f.task.id, artifactId: 'artifact', agentId: 'private-agent' }]) {
        await expect(files.start(actor, f.call('attachment.export', params))).rejects.toThrow()
        await expect(files.content(actor, params)).rejects.toThrow()
      }
    expect(await f.store.list('shared_receipt')).toEqual(before)
  } finally { await f.close() }
})
it('serves all four installed SDK operations through the real facade, with reads outside the mutation journal', async () => {
  const f = await fixture()
  try {
    f.runtime.skills = async () => ({ enabled: true, skills: [], validationErrors: [] }) as any
    f.runtime.mcpConfig = () => McpCapabilityConfig.parse({ enabled: true })
    f.runtime.mcpOAuth = async () => []
    f.runtime.toolDiagnostics = async () => ({ providers: [], mcpServers: [] }) as any
    const catalog = await f.invoke('catalog.get', {})
    for (const method of ['agent.avatar.get', 'agent.avatar.update', 'agent.skills.list', 'agent.connections.list'])
      expect(hasOperation(catalog, method)).toBe(true)
    expect(await f.invoke('agent.avatar.get', { agentId: f.agent.id })).toMatchObject({ revision: 0, rendering: 'reference' })
    for (const method of ['agent.skills.list', 'agent.connections.list'])
      expect(await f.invoke(method, { agentId: f.agent.id })).toMatchObject({ editable: false, appliesTo: 'next_api_turn', items: [], hasMore: false })
    expect(await f.store.list('remote_receipt')).toEqual([])
    await f.receive()
    const params = { agentId: f.agent.id, expectedRevision: 0, source: { kind: 'received', attachmentId: f.image.id } }
    const first = await f.invoke('agent.avatar.update', params, 'facade-update')
    expect(first.receipt).toMatchObject({ status: 'applied', result: { revision: 1, avatar: { kind: 'uploaded' } } })
    expect((await f.invoke('agent.avatar.update', params, 'facade-update')).receipt).toEqual(first.receipt)
    expect((await f.invoke('request.get', { requestId: 'facade-update' })).receipt).toEqual(first.receipt)
    expect((await f.invoke('agent.avatar.get', { agentId: f.agent.id })).uploadedImage).toMatchObject({ mimeType: 'image/jpeg', width: 128, height: 128 })
    await expect(f.invoke('agent.avatar.update', { ...params, source: { kind: 'received', attachmentId: f.image.id, path: '/private/avatar' } }, 'unsafe')).rejects.toThrow('INVALID_REQUEST')
    const stale = await f.invoke('agent.avatar.update', params, 'stale')
    expect(stale.receipt.error).toMatchObject({ code: 'REVISION_CONFLICT', definitive: true })
    expect((await f.rooms.agents.get(f.agent.id)).revision).toBe(1)
  } finally { await f.close() }
})
it('reconciles a facade avatar acknowledgement loss only from the exact native proof', async () => {
  const f = await fixture()
  try {
    const original = f.store.commit.bind(f.store)
    const commit = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      const result = await original(input)
      if (input.requestId.startsWith('agent-update:')) throw new Error('native ACK lost')
      return result
    })
    const params = { agentId: f.agent.id, expectedRevision: 0, source: { kind: 'builtin', id: 'coder' } }
    expect((await f.invoke('agent.avatar.update', params, 'facade-once')).receipt.status).toBe('reconciliation_required')
    commit.mockRestore()
    expect((await f.invoke('request.get', { requestId: 'facade-once' })).receipt).toMatchObject({ status: 'applied', result: { revision: 1, avatar: { kind: 'builtin', id: 'coder' } } })
    expect((await f.invoke('request.get', { requestId: 'facade-once' }, undefined, 'other-phone')).receipt).toBeNull()
    expect((await f.rooms.agents.get(f.agent.id)).revision).toBe(1)
  } finally { await f.close() }
})
