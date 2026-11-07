import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { DirectApi, RemoteClient, pairDirect, parseDirectPairing, DIRECTORY_LIVE_CAPABILITY, type Frame, type Socket } from '@kun/remote-protocol'
import { remoteFixture } from '../../../kun/src/remote/testing/runtime.test-support'
import { registerRemoteRoutes } from '../../../kun/src/remote/routes'
import { ThreadActivityRegistry } from '../../../kun/src/services/thread-activity-registry'
import { startNodeHttpServer } from '../../../kun/src/server/node-http-server'
import { DirectHost } from './direct-host'
import { emptyDirectSettings } from './direct-registry'
import type { LinkDependencies } from './service-dependencies'

const hostId = '11111111-1111-4111-8111-111111111111', phone = '22222222-2222-4222-8222-222222222222'
const socket = (url: string) => { const ws = new WebSocket(url); ws.on('error', () => {}); return ws as unknown as Socket }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-test-')), runtime = await remoteFixture()
  const activity = new ThreadActivityRegistry(); runtime.runtime.threadActivity = activity; runtime.h.events.addObserver(activity)
  registerRemoteRoutes(runtime.router, runtime.runtime)
  const server = await startNodeHttpServer({ router: runtime.router, host: '127.0.0.1', port: 0 })
  const baseUrl = 'http://127.0.0.1:' + server.port
  const cloud = vi.fn(async () => { throw Error('CLOUD_MUST_NOT_BE_USED') })
  const terminal = { peerGone: vi.fn(), authorityChanged: vi.fn(), stopAll: async () => {}, descriptors: () => [], capabilities: () => [] }
  const fileBytes = Buffer.from('Attachment boundary fixture'), fileHash = createHash('sha256').update(fileBytes).digest('hex')
  const attachments = vi.fn(async (scope: any, call: any) => {
    let result: unknown
    if (call.method === 'attachment.receive') {
      const response = await scope.api.request('/transfers/' + call.params.transferId + '/content', 'GET', undefined, true)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(fileBytes)
      await scope.api.request('/transfers/' + call.params.transferId + '/received', 'POST')
      result = { attachment: { id: 'fixture-attachment' } }
    } else {
      const transfer = await scope.api.request('/transfers', 'POST', { recipientId: scope.peer, size: fileBytes.length, sha256: fileHash })
      await scope.api.request('/transfers/' + transfer.id + '/content', 'PUT', fileBytes, true)
      result = { transferId: transfer.id, name: 'fixture.txt', mimeType: 'text/plain', size: fileBytes.length, sha256: fileHash }
    }
    return { receipt: { status: 'applied', result } }
  })
  const deps = { name: 'Test computer', platform: 'macos', origin: 'https://cloud.invalid', account: {} as any,
    requireMembership: cloud, identity: async () => ({ id: hostId, credential: 'a'.repeat(64) }), socket: () => { throw Error('CLOUD_MUST_NOT_BE_USED') }, terminal: terminal as any, files: attachments,
    fetch: async (input: any, init: any) => { if (!String(input).startsWith(baseUrl)) return cloud(); return fetch(input, init) },
    lease: async () => ({ baseUrl, runtimeToken: 'token', request: async (path: string, method: string, body?: string) => {
      const response = await fetch(baseUrl + path, { method, body, headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } })
      return { ok: response.ok, status: response.status, body: await response.text() }
    } }) } as LinkDependencies
  let owner: string | null = 'owner', persisted = emptyDirectSettings()
  const direct = new DirectHost({ root, owner: () => owner, link: deps, read: async () => persisted,
    write: async (_owner, value) => { persisted = structuredClone(value) }, validate: input => input as any })
  await direct.configure({ enabled: true, bind: 'loopback', port: 0, addresses: [] })
  await direct.configure({ enabled: true, bind: 'loopback', port: direct.status().port, addresses: direct.status().localAddresses })
  const pairing = parseDirectPairing((await direct.pair(['personal'])).link)
  const profile = await pairDirect(pairing, phone, socket, { name: 'Test phone' })
  const api = new DirectApi(profile, { socket })
  const frames: Frame[] = []
  const client = new RemoteClient({ ticket: () => api.ticket(), renew: signal => api.renew(signal), socket: url => api.open(url), frame: frame => frames.push(frame) })
  client.start(); await vi.waitFor(() => expect(client.online).toBe(true))
  const invoke = (method: string, params: Record<string, unknown> = {}) => client.invoke<any>(hostId, { method, params, requestId: randomUUID(), expiresAt: Date.now() + 30000 })
  return { ...runtime, direct, api, client, profile, pairing, frames, invoke, cloud, terminal, attachments, fileBytes, fileHash, owner: (value: string | null) => { owner = value },
    close: async () => { client.stop(); await direct.endSession(); await runtime.close(); await server.close(); await rm(root, { recursive: true, force: true }) } }
}

it('pairs once, uses real encrypted sockets for catalog/history and pushes, and revokes the live phone without cloud calls', async () => {
  const f = await fixture()
  try {
    await expect(pairDirect(f.pairing, 'other-phone', socket)).rejects.toThrow()
    const catalog = await f.invoke('catalog.get')
    expect(catalog.capabilities).toContain(DIRECTORY_LIVE_CAPABILITY)
    const code = await f.code('Private direct session')
    const list = await f.invoke('code.list')
    expect(list.threads.some((row: any) => row.id === code.id)).toBe(true)
    expect((await f.invoke('code.history', { threadId: code.id })).error).toBeUndefined()
    f.client.send({ kind: 'subscribe', dst: hostId, id: randomUUID(), payload: { kind: 'directory', id: 'all', active: true } })
    await vi.waitFor(() => expect(f.frames.some(frame => frame.payload?.kind === 'subscribed')).toBe(true))
    await f.code('Created while subscribed')
    await vi.waitFor(() => expect(f.frames.some(frame => frame.payload?.kind === 'directory_changed')).toBe(true))
    await f.direct.revoke(f.profile.id)
    await vi.waitFor(() => expect(f.client.online).toBe(false))
    expect(f.cloud).not.toHaveBeenCalled()
    expect(f.direct.status().grants).toEqual([])
    expect(f.terminal.authorityChanged).toHaveBeenCalledWith(phone)
  } finally { await f.close() }
}, 20000)

it('upload chunks survive a socket replacement and remain private to the paired phone', async () => {
  const f = await fixture()
  try {
    const bytes = new Uint8Array(200000).fill(37), sha256 = createHash('sha256').update(bytes).digest('hex')
    const created = await f.api.request('/transfers', 'POST', { recipientId: hostId, size: bytes.length, sha256 })
    await f.api.request('/transfers/' + created.id + '/chunk', 'PUT', { offset: 0, data: Buffer.from(bytes.subarray(0, 65536)).toString('base64') })
    f.client.reconnect()
    await vi.waitFor(() => expect(f.client.online).toBe(true))
    expect((await f.api.request('/transfers/' + created.id)).offset).toBe(65536)
    await f.api.request('/transfers/' + created.id + '/content', 'PUT', bytes, true)
    expect((await f.api.request('/transfers/' + created.id)).complete).toBe(true)
    await expect(f.api.request('/transfers/' + created.id + '/chunk', 'POST', { offset: 0 })).rejects.toThrow('INVALID_TRANSFER')
    expect(f.cloud).not.toHaveBeenCalled()
  } finally { await f.close() }
}, 20000)

it('tries the next configured address when the first connection is refused', async () => {
  const f = await fixture()
  try {
    f.client.stop()
    const api = new DirectApi({ ...f.profile, addresses: ['http://127.0.0.1:1', ...f.profile.addresses] }, { socket })
    const client = new RemoteClient({ ticket: () => api.ticket(), renew: () => api.renew(), socket: url => api.open(url) })
    try {
      client.start(); await vi.waitFor(() => expect(client.online).toBe(true), { timeout: 8000 })
      const result = await client.invoke<any>(hostId, { method: 'catalog.get', params: {}, requestId: randomUUID(), expiresAt: Date.now() + 30000 })
      expect(result.capabilities).toBeDefined()
    } finally { client.stop() }
  } finally { await f.close() }
}, 20000)

it('transfers upload and download bytes through the existing attachment dispatcher without using a cloud API', async () => {
  const f = await fixture()
  try {
    const transfer = await f.api.request('/transfers', 'POST', { recipientId: hostId, size: f.fileBytes.length, sha256: f.fileHash })
    await f.api.request('/transfers/' + transfer.id + '/content', 'PUT', f.fileBytes, true)
    const uploaded = await f.invoke('attachment.receive', { transferId: transfer.id, name: 'fixture.txt', mimeType: 'text/plain', size: f.fileBytes.length, sha256: f.fileHash })
    expect(uploaded.receipt.result.attachment.id).toBe('fixture-attachment')
    const exported = await f.invoke('attachment.export', { attachmentId: 'fixture-attachment', threadId: 'thread' })
    const content = await f.api.request<Response>('/transfers/' + exported.receipt.result.transferId + '/content', 'GET', undefined, true)
    expect(Buffer.from(await content.arrayBuffer())).toEqual(f.fileBytes)
    expect(f.attachments).toHaveBeenCalledTimes(2); expect(f.cloud).not.toHaveBeenCalled()
  } finally { await f.close() }
}, 20000)
it('acknowledges self-revocation only after the grant is removed and fences queued work on an account switch', async () => {
  const f = await fixture()
  try {
    expect(await f.api.request('/grants/' + f.profile.id, 'DELETE')).toEqual({ ok: true })
    expect(f.direct.status().grants).toEqual([])
    const configuration = f.direct.configure({ enabled: true, bind: 'loopback', port: 0, addresses: [] })
    f.owner('other')
    await expect(configuration).rejects.toThrow('ACCOUNT_CHANGED')
    expect(f.direct.status()).toMatchObject({ ready: false, grants: [], addresses: [] })
  } finally { await f.close() }
}, 20000)
