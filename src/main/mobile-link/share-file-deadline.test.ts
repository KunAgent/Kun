import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Call, RemoteApi } from '@kun/remote-protocol'
import { createSharedFileTransfer, SharedFileNotStarted, type SharedFileActor, type SharedFileServices } from './share-files'
import { SharedFileWorkPool } from './share-file-work'

const actor: SharedFileActor = { ownerAccountId: 'owner', hostDeviceId: 'host', resourceHandle: 'opaque', shareId: 'share',
  shareVersion: 1, guestAccountId: 'guest', deviceId: 'phone', memberId: 'member', memberVersion: 1,
  mode: 'write', expiresAt: Date.now() + 3600000, sessionId: 'session' }
const data = Buffer.from('verified shared bytes'), sha256 = createHash('sha256').update(data).digest('hex')
function fixture(root: string, overrides: Partial<SharedFileServices> = {}) {
  let current = true
  const transferId = randomUUID(), request = vi.fn(async (path: string) => ({ ok: true, status: 200,
    body: JSON.stringify(path.endsWith('/file-start') ? { started: true, threadId: 'thread' } : { receipt: { status: 'applied' } }) }))
  const api = { request: vi.fn(async (path: string) => path.endsWith('/content') ? new Response(new Uint8Array(data)) : {
    id: transferId, shareId: 'share', shareVersion: 1, memberId: 'member', memberVersion: 1, senderId: 'phone',
    recipientId: 'host', size: data.length, sha256, status: 'ready', expiresAt: Date.now() + 3600000 }) } as unknown as RemoteApi
  const transfer = createSharedFileTransfer({ root: () => root, fetch: vi.fn(), upload: async () => ({ attachment: { id: 'att_' + 'a'.repeat(24) } }), ...overrides })
  const scope = { api, actor, lease: { runtimeToken: 'synthetic', baseUrl: 'http://runtime', request }, current: () => current }
  const call = (): Call => ({ method: 'attachment.receive', requestId: randomUUID(), expiresAt: Date.now() + 60000,
    params: { transferId, name: 'shared.txt', mimeType: 'text/plain', size: data.length, sha256 } })
  return { transfer, scope, request, api, call, cancel: () => { current = false } }
}

afterEach(() => vi.useRealTimers())
describe('shared file deadlines and bounded unfinished native work', () => {
  it('ends an ignored read and ignored cancel at the deadline without admitting unlimited native readers', async () => {
    vi.useFakeTimers()
    const f = fixture('/unused'), read = vi.fn(() => new Promise<never>(() => {})), cancel = vi.fn(() => new Promise<void>(() => {}))
    vi.mocked(f.api.request).mockImplementation(async (path) => path.endsWith('/content') ?
      { body: { getReader: () => ({ read, cancel }) } } : {
        id: (f.call().params as any).transferId, shareId: 'share', shareVersion: 1, memberId: 'member', memberVersion: 1,
        senderId: 'phone', recipientId: 'host', size: data.length, sha256, status: 'ready', expiresAt: Date.now() + 3600000 })
    for (let i = 0; i < 2; i++) {
      const check = expect(f.transfer(f.scope, f.call())).rejects.toThrow('TRANSFER_CANCELLED')
      await vi.advanceTimersByTimeAsync(120000); await check
    }
    expect(read).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledTimes(2)
    await expect(f.transfer(f.scope, f.call())).rejects.toBeInstanceOf(SharedFileNotStarted)
    expect(f.request.mock.calls.filter(([path]) => path.endsWith('/file-start'))).toHaveLength(2)
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/file-finish'))).toBe(false)
  })

  it('fences a native upload which ignores abort, and a late upload cannot settle the durable receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-file-deadline-'))
    let resolveUpload!: (value: { attachment: { id: string } }) => void
    const upload = vi.fn(() => new Promise<{ attachment: { id: string } }>((resolve) => { resolveUpload = resolve }))
    const f = fixture(root, { upload })
    try {
      vi.useFakeTimers()
      const check = expect(f.transfer(f.scope, f.call())).rejects.toThrow('TRANSFER_CANCELLED')
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(120000); await check
      resolveUpload({ attachment: { id: 'att_' + 'b'.repeat(24) } })
      await vi.advanceTimersByTimeAsync(0)
      expect(f.request.mock.calls.some(([path]) => path.endsWith('/file-finish'))).toBe(false)
    } finally { vi.useRealTimers(); await rm(root, { recursive: true, force: true }) }
  })

  it('cancels an unresponsive native fetch after authority changes without waiting for the read deadline', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => new Promise<Response>(() => {})), f = fixture('/unused', { fetch: fetcher })
    const call: Call = { ...f.call(), method: 'attachment.export', params: { threadId: 'thread', attachmentId: 'att_' + 'a'.repeat(24) } }
    const check = expect(f.transfer(f.scope, call)).rejects.toThrow('TRANSFER_CANCELLED')
    await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledOnce()
    f.cancel(); await vi.advanceTimersByTimeAsync(250); await check
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/file-finish'))).toBe(false)
  })

  it('also bounds actual local runtime requests which ignore their caller deadline', async () => {
    vi.useFakeTimers()
    const f = fixture('/unused')
    f.request.mockImplementation(() => new Promise<never>(() => {}))
    for (let i = 0; i < 2; i++) {
      const check = expect(f.transfer(f.scope, f.call())).rejects.toThrow('TRANSFER_CANCELLED')
      await vi.advanceTimersByTimeAsync(15000); await check
    }
    await expect(f.transfer(f.scope, f.call())).rejects.toBeInstanceOf(SharedFileNotStarted)
    expect(f.request).toHaveBeenCalledTimes(2)
  })

  it('retains timed-out native slots until work really settles and then releases them', async () => {
    const pool = new SharedFileWorkPool(), first = pool.acquire(), second = pool.acquire(), abort = new AbortController()
    let settle!: () => void
    const rejected = expect(first.run(() => new Promise<void>((resolve) => { settle = resolve }), abort.signal)).rejects.toThrow('TRANSFER_CANCELLED')
    await Promise.resolve(); abort.abort(); first.finish(); await rejected
    expect(() => pool.acquire()).toThrow(SharedFileNotStarted)
    settle(); await Promise.resolve(); await Promise.resolve()
    const next = pool.acquire(); next.finish(); second.finish()
  })
})
