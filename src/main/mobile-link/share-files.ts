import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { z } from 'zod'
import type { Call, RemoteApi } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { SharedFileWorkPool, type SharedFileWork } from './share-file-work'
export { SharedFileNotStarted } from './share-file-work'
const MAX = 25 * 1024 * 1024, Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), Hash = z.string().regex(/^[a-f0-9]{64}$/)
const Receive = z.object({ transferId: z.string().uuid(), name: z.string().min(1).max(180), mimeType: z.string().min(1).max(120),
  size: z.number().int().positive().max(MAX), sha256: Hash }).strict()
const Export = z.union([z.object({ threadId: Id, attachmentId: z.string().regex(/^att_[a-f0-9]{24}$/) }).strict(),
  z.object({ threadId: Id, artifactId: Id }).strict()])
const Metadata = z.object({ id: z.string().uuid(), shareId: Id, shareVersion: z.number().int().positive(), memberId: Id,
  memberVersion: z.number().int().positive(), senderId: Id, recipientId: Id, size: z.number().int().positive().max(MAX),
  sha256: Hash, status: z.string().max(32), expiresAt: z.number().int().positive() })
export type SharedFileActor = { ownerAccountId: string; hostDeviceId: string; resourceHandle: string; shareId: string; shareVersion: number;
  guestAccountId: string; deviceId: string; memberId: string; memberVersion: number; mode: 'read' | 'write'; expiresAt: number; sessionId: string }
export type SharedFileScope = { api: RemoteApi; actor: SharedFileActor; lease: ProtectedRuntimeRequestLease; current(): boolean }
export type SharedFileTransfer = (scope: SharedFileScope, call: Call) => Promise<unknown>
export type SharedFileServices = { root(actor: SharedFileActor): string; fetch: typeof fetch;
  upload(input: { path: string; name: string; mimeType: string; sha256: string; threadId: string }, lease: ProtectedRuntimeRequestLease): Promise<{ attachment: { id: string } }> }
async function runtimeStage(work: SharedFileWork, lease: ProtectedRuntimeRequestLease, path: string, value: unknown, signal: AbortSignal): Promise<any> {
  const response = await work.limited(() => lease.request('/v1/remote/shares/' + path, 'POST', JSON.stringify(value)), signal, 15000)
  let result: any
  try { result = JSON.parse(response.body) } catch { throw new Error('RUNTIME_REJECTED') }
  if (!response.ok) throw new Error(typeof result.code === 'string' ? result.code : 'RUNTIME_REJECTED')
  return result
}
async function bytes(response: Response, max: number, signal: AbortSignal, current: () => boolean, work: SharedFileWork) {
  if (!response.body) throw new Error('FILE_UNAVAILABLE')
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let cancelled = false
  const cancel = () => { if (!cancelled) { cancelled = true; work.cleanup(() => reader.cancel()) } }
  signal.addEventListener('abort', cancel, { once: true })
  let count = 0
  try {
    while (!signal.aborted && current()) {
      const next = await work.run(() => reader.read(), signal)
      if (next.done) break
      count += next.value.byteLength
      if (count > max) throw new Error('FILE_LIMIT')
      chunks.push(Buffer.from(next.value))
    }
    if (signal.aborted || !current()) throw new Error('TRANSFER_CANCELLED')
    return Buffer.concat(chunks, count)
  } finally { signal.removeEventListener('abort', cancel); cancel() }
}
/** Independently scoped R2 transport. Names and task IDs never enter cloud metadata or a personal transfer endpoint. */
export function createSharedFileTransfer(services: SharedFileServices): SharedFileTransfer {
  const pool = new SharedFileWorkPool()
  return async (scope, call) => {
    const work = pool.acquire(), actor = scope.actor, runtime = scope.lease, control = new AbortController()
    const deadline = setTimeout(() => control.abort(), 120000)
    const watch = setInterval(() => { if (!scope.current()) control.abort() }, 250)
    const current = () => !control.signal.aborted && scope.current(), prefix = '/shares/' + actor.shareId + '/transfers'
    const run = <T>(start: () => Promise<T>) => work.run(() => {
      if (!scope.current()) throw new Error('ACCOUNT_CHANGED')
      return start()
    }, control.signal)
    let temporary: string | undefined, saved: string | undefined, complete = false, finalizing = false, outgoing: string | undefined
    try {
      if (!current()) throw new Error('ACCOUNT_CHANGED')
      if (call.method === 'attachment.receive' && actor.mode !== 'write') throw new Error('SHARE_READ_ONLY')
      const params = call.method === 'attachment.receive' ? Receive.parse(call.params) : Export.parse(call.params)
      const started = await runtimeStage(work, runtime, 'file-start', { actor, call }, control.signal)
      if (started.receipt) return started
      if (!current()) throw new Error('ACCOUNT_CHANGED')
      if (!started.started || typeof started.threadId !== 'string') throw new Error('RECEIPT_REQUIRED')
      let result: unknown
      if (call.method === 'attachment.export') {
        if (!runtime.baseUrl) throw new Error('RUNTIME_UNAVAILABLE')
        const response = await run(() => services.fetch(runtime.baseUrl + '/v1/remote/shares/file-content', { method: 'POST',
          headers: { Authorization: 'Bearer ' + runtime.runtimeToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ actor, params }), signal: control.signal }).then((reply) => {
            if (!current()) { work.cleanup(async () => reply.body?.cancel()); throw new Error('ACCOUNT_CHANGED') }
            return reply
          }))
        if (!response.ok) throw new Error('FILE_NOT_ALLOWED')
        const data = await bytes(response, MAX, control.signal, current, work)
        if (!data.length) throw new Error('FILE_EMPTY')
        const sha256 = createHash('sha256').update(data).digest('hex')
        const transfer = Metadata.parse(await run(() => scope.api.request(prefix, 'POST', { recipientId: actor.deviceId, size: data.length, sha256 }, false, control.signal)))
        outgoing = transfer.id
        if (transfer.shareId !== actor.shareId || transfer.memberId !== actor.memberId || transfer.memberVersion !== actor.memberVersion ||
            transfer.senderId !== actor.hostDeviceId || transfer.recipientId !== actor.deviceId || transfer.size !== data.length || transfer.sha256 !== sha256) throw new Error('FILE_METADATA')
        const uploaded = await run(() => scope.api.request<Response>(prefix + '/' + transfer.id + '/content', 'PUT', new Uint8Array(data), true, control.signal))
        work.cleanup(async () => uploaded.body?.cancel())
        if (!current()) throw new Error('ACCOUNT_CHANGED')
        result = { transferId: transfer.id, size: data.length, sha256,
          name: basename(decodeURIComponent(response.headers.get('X-Kun-File-Name') ?? 'attachment')),
          mimeType: response.headers.get('Content-Type') ?? 'application/octet-stream' }
      } else {
        const p = Receive.parse(params)
        const metadata = Metadata.parse(await run(() => scope.api.request(prefix + '/' + p.transferId, 'GET', undefined, false, control.signal)))
        if (metadata.id !== p.transferId || metadata.shareId !== actor.shareId || metadata.memberId !== actor.memberId || metadata.memberVersion !== actor.memberVersion ||
            metadata.senderId !== actor.deviceId || metadata.recipientId !== actor.hostDeviceId || metadata.status !== 'ready' ||
            metadata.expiresAt <= Date.now() || metadata.size !== p.size || metadata.sha256 !== p.sha256) throw new Error('FILE_CUSTODY')
        const response = await run(() => scope.api.request<Response>(prefix + '/' + p.transferId + '/content', 'GET', undefined, true, control.signal))
        const data = await bytes(response, p.size, control.signal, current, work)
        if (data.length !== p.size || createHash('sha256').update(data).digest('hex') !== p.sha256) throw new Error('FILE_INTEGRITY')
        if (!current()) throw new Error('ACCOUNT_CHANGED')
        const root = services.root(actor), name = basename(p.name).replace(/[\u0000-\u001f]/g, '_') || 'attachment'
        await run(() => mkdir(root, { recursive: true, mode: 0o700 }))
        const extension = extname(name).toLowerCase(), suffix = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.blob'
        saved = join(root, p.sha256 + '-' + randomUUID() + suffix); temporary = join(root, '.incoming-' + randomUUID() + '.tmp')
        const writing = temporary, target = saved
        await run(() => writeFile(writing, data, { mode: 0o600 }).finally(() => {
          if (!current()) work.cleanup(() => rm(writing, { force: true }))
        }))
        await run(() => rename(writing, target).finally(() => {
          if (!current()) work.cleanup(() => rm(target, { force: true }))
        })); temporary = undefined
        const uploaded = await run(() => services.upload({ path: target, name, mimeType: p.mimeType, sha256: p.sha256, threadId: started.threadId }, runtime))
        if (!current()) throw new Error('ACCOUNT_CHANGED')
        result = { attachment: { id: uploaded.attachment.id } }
      }
      finalizing = true
      const finished = await runtimeStage(work, runtime, 'file-finish', { actor, call, result }, control.signal)
      if (finished.receipt?.status !== 'applied') throw new Error('RESULT_UNKNOWN')
      complete = true
      if (!current()) throw new Error('ACCOUNT_CHANGED')
      if (call.method === 'attachment.receive') await run(() => scope.api.request(prefix + '/' + Receive.parse(params).transferId + '/received', 'POST', undefined, false, control.signal)).catch(() => {})
      return finished
    } finally {
      clearTimeout(deadline); clearInterval(watch)
      control.abort()
      if (temporary) { const path = temporary; work.cleanup(() => rm(path, { force: true })) }
      if (saved && !complete) { const path = saved; work.cleanup(() => rm(path, { force: true })) }
      if (outgoing && !complete && !finalizing) work.cleanup(() => scope.api.request(prefix + '/' + outgoing, 'DELETE'))
      work.finish()
    }
  }
}
