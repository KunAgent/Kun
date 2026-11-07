import { createHash } from 'node:crypto'
import { canonical, parseFrame, Reassembler, type Frame } from '@kun/remote-protocol'

/** Authenticate the immutable business envelope before handing transport policy to the child. */
export class RelayAuthority {
  private assembly = new Reassembler()
  private frames = new Map<string, { count: number; size: number; expires: number }>()
  private bytes = 0
  private hello = false
  expiresAt = 0
  observe(raw: string) {
    const frame = this.assembly.accept(parseFrame(raw))
    if (!frame) return
    if (frame.kind === 'hello') { this.hello = true; this.renew(frame.payload?.leaseExpiresAt); return }
    if (['pong', 'ack', 'result', 'error'].includes(frame.kind) || frame.kind === 'event' && frame.src === undefined) return
    for (const [key, item] of this.frames) if (Date.now() >= item.expires) { this.bytes -= item.size * item.count; this.frames.delete(key) }
    const value = canonical(frame), size = Buffer.byteLength(value)
    if (this.frames.size >= 64 || this.bytes + size > 8388608) throw Error('BACKPRESSURE')
    const key = createHash('sha256').update(value).digest('hex'), previous = this.frames.get(key)
    this.frames.set(key, { count: (previous?.count ?? 0) + 1, size, expires: Date.now() + 30000 }); this.bytes += size
  }
  consume(frame: Frame) {
    const key = createHash('sha256').update(canonical(frame)).digest('hex'), record = this.frames.get(key)
    if (!this.online() || !record || Date.now() >= record.expires) return false
    this.bytes -= record.size
    if (--record.count === 0) this.frames.delete(key)
    return true
  }
  online() { return this.hello && Date.now() < this.expiresAt }
  renew(value: unknown) { this.expiresAt = Number.isSafeInteger(value) ? Math.min(value as number, Date.now() + 300000) : Date.now() + 60000 }
  clear() { this.assembly.clear(); this.frames.clear(); this.bytes = 0; this.hello = false; this.expiresAt = 0 }
}
