import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RemoteApi, RequestBudget, type Socket } from '@kun/remote-protocol'
import { MobileShareHosts } from './share-host'
import { createSharedFileTransfer } from './share-files'
import { shareFixture } from '../../../kun/src/remote/sharing/guest.test-support'
import { registerSharedTaskRoutes } from '../../../kun/src/remote/sharing/routes'
import { FileAttachmentStore } from '../../../kun/src/attachments/attachment-store'
import { AttachmentsCapabilityConfig } from '../../../kun/src/contracts/capabilities'
import { png } from '../../../kun/tests/support/attachment-store-fixtures'
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
async function fixture() {
  const f = await shareFixture(), cloud = new Map<string, { metadata: any; data: Buffer }>(), seen: Array<{ path: string; method: string; body?: any }> = []
  f.runtime.attachmentStore = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'), config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
  f.h.turns['deps'].attachmentStore = () => f.runtime.attachmentStore
  registerSharedTaskRoutes(f.router, f.runtime)
  let failPut = false, failFinish = false, loseFinish = false, current = true
  const runtimeRequest = async (path: string, _method?: string, body?: string) => {
    if (failFinish && path.endsWith('/file-finish')) return { ok: false, status: 503, body: '{"code":"RESULT_UNKNOWN"}' }
    const route = f.router.match('POST', path)!
    const result = await route.handler(new Request('http://runtime' + path, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body }), { params: route.params })
    if (loseFinish && path.endsWith('/file-finish')) throw new Error('RESULT_UNKNOWN')
    return result instanceof Response ? { ok: result.ok, status: result.status, body: await result.text() } : { ok: result.status < 400, status: result.status, body: result.body }
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? 'GET'
    if (url.hostname === 'runtime') {
      const route = f.router.match(method, path)!
      return await route.handler(new Request(url, init), { params: route.params }) as Response
    }
    if (path.endsWith('/capabilities')) return Response.json({ sharing: { available: true } })
    if (path.endsWith('/relay-tickets')) return Response.json({ ticket: 'share-ticket', url: 'wss://relay.test/api/remote/v1/shares/share/ws' })
    if (path.endsWith('/shares')) return Response.json({ owned: [f.share], joined: [] })
    seen.push({ path, method, ...(init?.body && method !== 'PUT' ? { body: JSON.parse(String(init.body)) } : {}) })
    const id = path.split('/').at(path.endsWith('/content') || path.endsWith('/received') ? -2 : -1)!
    if (method === 'POST' && path.endsWith('/transfers')) {
      const body = JSON.parse(String(init?.body)), created = randomUUID(), metadata = { id: created, ...body, shareId: f.share.id,
        shareVersion: f.actor.shareVersion, memberId: f.actor.memberId, memberVersion: f.actor.memberVersion,
        senderId: f.actor.hostDeviceId, recipientId: body.recipientId, status: 'pending', expiresAt: Date.now() + 3600000 }
      cloud.set(created, { metadata, data: Buffer.alloc(0) }); return Response.json(metadata)
    }
    const transfer = cloud.get(id)
    if (!transfer) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (method === 'DELETE') { cloud.delete(id); return Response.json({ ok: true }) }
    if (method === 'PUT') {
      if (failPut) return Response.json({ error: 'UPLOAD_FAILED' }, { status: 503 })
      transfer.data = Buffer.from(init?.body as Uint8Array); transfer.metadata.status = 'ready'; return Response.json({ ok: true })
    }
    if (path.endsWith('/received')) { transfer.metadata.status = 'received'; return Response.json({ ok: true }) }
    if (path.endsWith('/content')) return new Response(new Uint8Array(transfer.data))
    return Response.json(transfer.metadata)
  }
  const api = new RemoteApi({ origin: 'https://relay.test', token: async () => 'test-owner-token', identity: async () => ({ id: 'host', credential: 'a'.repeat(64) }), fetch: fetcher })
  const lease = { runtimeToken: 'token', baseUrl: 'http://runtime', request: runtimeRequest }
  const upload = vi.fn(async (input: { path: string; name: string; mimeType: string; threadId: string }) => ({ attachment:
    await f.runtime.attachmentStore!.create({ data: await readFile(input.path), name: input.name, mimeType: input.mimeType, threadId: input.threadId, localFilePath: input.path }) }))
  const transfer = createSharedFileTransfer({ root: () => join(f.root, 'incoming'), fetch: fetcher, upload })
  const scope = { api, actor: f.actor, lease, current: () => current }
  const seed = (metadata: Record<string, unknown> = {}, data = png(2, 2)) => {
    const id = randomUUID(), value = { id, shareId: 'share', shareVersion: 1, memberId: 'member', memberVersion: 1,
      senderId: 'guestphone', recipientId: 'host', status: 'ready', size: data.length, sha256: digest(data), expiresAt: Date.now() + 3600000, ...metadata }
    cloud.set(id, { metadata: value, data }); return { id, data, metadata: value }
  }
  const receive = (file: ReturnType<typeof seed>, requestId: string = randomUUID()) => f.call('attachment.receive', { transferId: file.id, name: '共享图片.png', mimeType: 'image/png', size: file.metadata.size, sha256: file.metadata.sha256 }, requestId)
  return { ...f, scope, transfer, upload, api, lease, fetcher, seen, cloud, seed, receive, setPutFailure: () => { failPut = true },
    setFinishFailure: () => { failFinish = true }, loseFinishResponse: () => { loseFinish = true }, cancel: () => { current = false } }
}
describe('shared R2 bytes and native custody over the real local Runtime', () => {
  it('verifies, atomically receives and replays the same receipt without re-downloading or uploading', async () => {
    const f = await fixture()
    try {
      const source = f.seed(), call = f.receive(source), first: any = await f.transfer(f.scope, call)
      expect(first.receipt).toMatchObject({ status: 'applied', result: { attachment: { name: '共享图片.png', mimeType: 'image/png' } } })
      expect(JSON.stringify(first)).not.toContain('localFilePath')
      const downloads = f.seen.filter((r) => r.method === 'GET' && r.path.endsWith('/content')).length
      expect(await f.transfer(f.scope, { ...call, expiresAt: call.expiresAt + 1000 })).toEqual(first)
      expect(f.upload).toHaveBeenCalledOnce()
      expect(f.seen.filter((r) => r.method === 'GET' && r.path.endsWith('/content'))).toHaveLength(downloads)
      const attachmentId = first.receipt.result.attachment.id
      const sent = await f.invoke('code.turn.start', { threadId: f.task.id, text: 'use confirmed shared image', attachmentIds: [attachmentId] })
      expect(sent.receipt.status).toBe('applied')
      const history = await f.invoke('code.history', { threadId: f.task.id })
      expect(history.turns.some((turn: any) => turn.items.some((item: any) => item.attachmentIds?.includes(attachmentId)))).toBe(true)
      expect(f.seen.every((r) => r.path.startsWith('/api/remote/v1/shares/share/transfers'))).toBe(true)
    } finally { await f.close() }
  })
  it.each(['senderId', 'recipientId', 'memberId', 'memberVersion', 'shareId'] as const)('rejects authoritative %s mismatch before content download or native upload', async (field) => {
    const f = await fixture()
    try {
      const file = f.seed({ [field]: field === 'memberVersion' ? 2 : 'another' })
      await expect(f.transfer(f.scope, f.receive(file))).rejects.toThrow('FILE_CUSTODY')
      expect(f.upload).not.toHaveBeenCalled(); expect(f.seen.some((r) => r.path.endsWith('/content'))).toBe(false)
      expect(await f.store.list('shared_attachment')).toEqual([])
    } finally { await f.close() }
  })
  it('checks download size and checksum before native persistence', async () => {
    const f = await fixture()
    try {
      const source = f.seed(), file = f.cloud.get(source.id)!
      file.data = Buffer.from('corrupted bytes')
      await expect(f.transfer(f.scope, f.receive(source))).rejects.toThrow('FILE_INTEGRITY')
      expect(f.upload).not.toHaveBeenCalled()
    } finally { await f.close() }
  })
  it('exports only proven task attachments, cleans failed uploads and retains unknown finalization for receipt recovery', async () => {
    const f = await fixture()
    try {
      const incoming: any = await f.transfer(f.scope, f.receive(f.seed()))
      const id = incoming.receipt.result.attachment.id, call = f.call('attachment.export', { threadId: f.task.id, attachmentId: id })
      const exported: any = await f.transfer(f.scope, call)
      expect(exported.receipt).toMatchObject({ status: 'applied', result: { name: '共享图片.png', size: png(2, 2).length, sha256: digest(png(2, 2)) } })
      const created = f.seen.filter((r) => r.path.endsWith('/transfers') && r.method === 'POST')
      expect(Object.keys(created[0]!.body).sort()).toEqual(['recipientId', 'sha256', 'size'])
      f.setPutFailure()
      await expect(f.transfer(f.scope, f.call('attachment.export', { threadId: f.task.id, attachmentId: id }))).rejects.toThrow('UPLOAD_FAILED')
      expect(f.seen.some((r) => r.method === 'DELETE')).toBe(true)
    } finally { await f.close() }
  })
  it('keeps an uploaded object when the local finish ACK is lost and recovers the original result', async () => {
    const f = await fixture()
    try {
      const received: any = await f.transfer(f.scope, f.receive(f.seed()))
      f.loseFinishResponse()
      const call = f.call('attachment.export', { threadId: f.task.id, attachmentId: received.receipt.result.attachment.id }, 'export_lost_reply')
      await expect(f.transfer(f.scope, call)).rejects.toThrow('RESULT_UNKNOWN')
      const lookup = await f.invoke('request.get', { requestId: call.requestId })
      expect(lookup.receipt.status).toBe('applied')
      const transfer = f.cloud.get(lookup.receipt.result.transferId)!
      expect(transfer.metadata.status).toBe('ready'); expect(digest(transfer.data)).toBe(lookup.receipt.result.sha256)
      expect(f.seen.filter((r) => r.method === 'POST' && r.path.endsWith('/transfers'))).toHaveLength(1)
      expect(f.seen.some((r) => r.method === 'DELETE')).toBe(false)
    } finally { await f.close() }
  })
  it('runs verified receive then a single API attachment turn through the actual independent ShareClient', async () => {
    const f = await fixture(), frames: any[] = []; let socket!: Socket
    const peers = new Set<string>()
    const host = new MobileShareHosts({ origin: 'https://relay.test', fetch: f.fetcher, lease: async () => f.lease,
      budget: new RequestBudget(), totalBudget: new RequestBudget(), files: f.transfer,
      reserveFile: (peer) => { if (peers.has(peer)) throw new Error('BACKPRESSURE'); peers.add(peer); return () => { peers.delete(peer) } },
      socket: () => (socket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => {}, send: (raw) => frames.push(JSON.parse(raw)) }) })
    try {
      host.start({ api: f.api, ownerAccountId: 'owner', hostDeviceId: 'host', current: () => f.scope.current() })
      await vi.waitFor(() => expect(socket).toBeDefined())
      const lease = { shareId: 'share', ownerAccountId: 'owner', hostDeviceId: 'host', resourceHandle: f.share.resourceHandle, shareVersion: 1,
        userId: 'owner', deviceId: 'host', role: 'host', mode: 'write', expiresAt: Date.now() + 60000,
        peers: [{ deviceId: 'guestphone', accountId: 'guest', memberId: 'member', memberVersion: 1, mode: 'write' }] }
      socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello', payload: { version: 1, leaseExpiresAt: lease.expiresAt, share: lease } }) })
      await vi.waitFor(() => expect(frames.some((frame) => frame.kind === 'resync_required')).toBe(true))
      const invoke = (call: any) => socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'invoke', id: call.requestId, src: 'guestphone', dst: 'host',
        shared: { shareId: 'share', resourceHandle: f.share.resourceHandle, shareVersion: 1, accountId: 'guest', role: 'guest', memberId: 'member', memberVersion: 1, mode: 'write' }, payload: call }) })
      const receive = f.receive(f.seed(), 'real_socket_receive'); invoke(receive)
      await vi.waitFor(() => expect(frames.find((frame) => frame.kind === 'result' && frame.id === receive.requestId)?.payload.receipt?.status).toBe('applied'))
      const attachmentId = frames.find((frame) => frame.id === receive.requestId && frame.kind === 'result').payload.receipt.result.attachment.id
      const send = f.call('code.turn.start', { threadId: f.task.id, text: 'one verified file input', attachmentIds: [attachmentId] }, 'socket_turn'); invoke(send)
      await vi.waitFor(() => expect(frames.find((frame) => frame.kind === 'result' && frame.id === send.requestId)?.payload.receipt?.status).toBe('applied'))
      invoke({ ...send, expiresAt: send.expiresAt + 1000 })
      await vi.waitFor(() => expect(frames.filter((frame) => frame.kind === 'result' && frame.id === send.requestId)).toHaveLength(2))
      expect((await f.h.threads.get(f.task.id))!.turns).toMatchObject([{ clientSurface: 'api', attachmentIds: [attachmentId] }])
      expect(f.upload).toHaveBeenCalledOnce()
    } finally { f.cancel(); host.stop(); await new Promise((resolve) => setTimeout(resolve, 10)); await f.close() }
  })

  it('does not reveal a previous private filename when known bytes deduplicate in the native store', async () => {
    const f = await fixture()
    try {
      const privateMeta = await f.runtime.attachmentStore!.create({ data: png(2, 2), name: 'PRIVATE_CLIENT_CONTRACT.png',
        mimeType: 'image/png', threadId: f.other.id })
      const result: any = await f.transfer(f.scope, f.receive(f.seed()))
      expect(result.receipt.result.attachment).toMatchObject({ id: privateMeta.id, name: '共享图片.png' })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_CLIENT_CONTRACT')
      expect(result.receipt.result.attachment.createdAt).toBe(new Date(result.receipt.createdAt).toISOString())
    } finally { await f.close() }
  })

})
