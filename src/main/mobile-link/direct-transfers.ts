import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { directBase64, directBytes, type RemoteApi } from '@kun/remote-protocol'
const MAX_FILE = 25 * 1024 * 1024, CHUNK = 64 * 1024
type Transfer = { id: string; peer: string; sender: 'host' | 'phone'; size: number; sha256: string; offset: number; complete: boolean; until: number }

/** Private temporary files shared by the direct phone API and the existing attachment dispatcher. */
export class DirectTransfers {
  static async pruneAbandoned(root: string, now = Date.now()) {
    for (const entry of (await readdir(root, { withFileTypes: true }).catch(() => [])).slice(0, 256)) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue
      const path = join(root, entry.name), info = await stat(path).catch(() => null)
      if (info && info.mtimeMs < now - 16 * 60000) await rm(path, { recursive: true, force: true }).catch(() => {})
    }
  }
  private transfers = new Map<string, Transfer>()
  private serial = new Map<string, Promise<unknown>>()
  private pending = new Set<Promise<unknown>>()
  private closed = false
  private timer: ReturnType<typeof setInterval>
  constructor(private root: string, private hostId: string) {
    this.timer = setInterval(() => { void this.prune() }, 60000); this.timer.unref()
  }
  forHost(peer: string): RemoteApi {
    return { request: (path: string, method = 'GET', body?: unknown) => this.request(peer, 'host', path, method, body) } as RemoteApi
  }
  async request(peer: string, side: 'host' | 'phone', path: string, method: string, body?: any): Promise<any> {
    if (this.closed) throw Error('DIRECT_NOT_RUNNING')
    const task = this.execute(peer, side, path, method, body)
    this.pending.add(task)
    try { return await task } finally { this.pending.delete(task) }
  }
  private async execute(peer: string, side: 'host' | 'phone', path: string, method: string, body?: any): Promise<any> {
    if (path === '/transfers' && method === 'POST') {
      if (!Number.isSafeInteger(body?.size) || body.size < 1 || body.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(body.sha256) ||
          body.recipientId !== (side === 'phone' ? this.hostId : peer)) throw Error('INVALID_TRANSFER')
      await this.prune()
      if (this.transfers.size >= 8 || [...this.transfers.values()].filter(item => item.peer === peer).length >= 2 ||
          [...this.transfers.values()].reduce((n, item) => n + item.size, 0) + body.size > 100 * 1024 * 1024) throw Error('BACKPRESSURE')
      const value: Transfer = { id: randomUUID(), peer, sender: side, size: body.size, sha256: body.sha256, offset: 0,
        complete: false, until: Date.now() + 15 * 60000 }
      this.transfers.set(value.id, value)
      try {
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        await writeFile(join(this.root, value.id), new Uint8Array(), { flag: 'wx', mode: 0o600 })
      } catch (error) { this.transfers.delete(value.id); throw error }
      return { id: value.id }
    }
    const match = /^\/transfers\/([a-f0-9-]{36})(?:\/(content|chunk|complete|received))?$/.exec(path)
    if (!match) throw Error('UNSUPPORTED_OPERATION')
    const id = match[1], previous = this.serial.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(() => this.file(peer, side, id, match[2] ?? '', method, body))
    this.serial.set(id, task)
    try { return await task } finally { if (this.serial.get(id) === task) this.serial.delete(id) }
  }
  private async file(peer: string, side: 'host' | 'phone', id: string, operation: string, method: string, body: any) {
    const value = this.transfers.get(id)
    if (!value || value.peer !== peer || value.until <= Date.now()) throw Error('FILE_UNAVAILABLE')
    const path = join(this.root, id), sender = value.sender === side
    if (operation === '' && method === 'DELETE' || operation === 'received' && method === 'POST' && !sender) {
      this.transfers.delete(id); await rm(path, { force: true }); return { ok: true }
    }
    if (operation === '' && method === 'GET') return { size: value.size, sha256: value.sha256, offset: value.offset, complete: value.complete }
    if (operation === 'content' && method === 'GET' && !sender && value.complete) {
      const bytes = await readFile(path)
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })
    }
    if (operation === 'content' && method === 'PUT' && sender && side === 'host') {
      if (!(body instanceof Uint8Array) || body.length !== value.size || createHash('sha256').update(body).digest('hex') !== value.sha256) throw Error('FILE_INTEGRITY')
      await writeFile(path, body, { mode: 0o600 }); value.offset = body.length; value.complete = true
      return { ok: true }
    }
    if (operation === 'complete' && method === 'POST' && sender) {
      if (value.offset !== value.size || createHash('sha256').update(await readFile(path)).digest('hex') !== value.sha256) throw Error('FILE_INTEGRITY')
      value.complete = true; return { ok: true }
    }
    if (operation !== 'chunk' || !Number.isSafeInteger(body?.offset) || body.offset < 0 || body.offset >= value.size) throw Error('INVALID_TRANSFER')
    const handle = await open(path, sender ? 'r+' : 'r')
    try {
      if (method === 'PUT' && sender) {
        const bytes = directBytes(body.data, CHUNK)
        if (!bytes.length || body.offset + bytes.length > value.size || body.offset > value.offset) throw Error('FILE_INTEGRITY')
        if (body.offset < value.offset) {
          if (body.offset + bytes.length > value.offset) throw Error('FILE_INTEGRITY')
          const held = Buffer.alloc(bytes.length); await handle.read(held, 0, held.length, body.offset)
          if (!held.equals(Buffer.from(bytes))) throw Error('FILE_INTEGRITY')
          return { offset: body.offset + bytes.length }
        }
        let written = 0
        while (written < bytes.length) written += (await handle.write(bytes, written, bytes.length - written, body.offset + written)).bytesWritten
        value.offset += bytes.length
        return { offset: value.offset }
      }
      if (method === 'POST' && !sender && value.complete) {
        const bytes = Buffer.alloc(Math.min(CHUNK, value.size - body.offset))
        const result = await handle.read(bytes, 0, bytes.length, body.offset)
        return { data: directBase64(bytes.subarray(0, result.bytesRead)) }
      }
      throw Error('INVALID_TRANSFER')
    } finally { await handle.close() }
  }
  async prune(peer?: string) {
    for (const [id, value] of this.transfers) if (value.until <= Date.now() || peer === value.peer) {
      this.transfers.delete(id); await rm(join(this.root, id), { force: true }).catch(() => {})
    }
  }
  async stop() {
    this.closed = true
    clearInterval(this.timer)
    await Promise.allSettled([...this.pending])
    this.transfers.clear()
    await rm(this.root, { recursive: true, force: true })
  }
}
