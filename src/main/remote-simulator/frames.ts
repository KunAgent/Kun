import { SIMULATOR_LIMITS, type SimulatorFrame } from '@kun/remote-protocol'
import type { EncodeSimulatorFrame } from './adapter'

/** AXe raw output is a big-endian length followed by one JPEG, not an unbounded MJPEG accumulator. */
export class RawSimulatorFrames {
  private buffer = Buffer.alloc(0)
  private latest?: Omit<SimulatorFrame, 'sessionId'>
  private ended = false
  private waiters = new Set<(error?: Error) => void>()
  constructor(private readonly encode: EncodeSimulatorFrame) {}
  accept(bytes: Buffer) {
    if (this.ended) return
    if (bytes.length + this.buffer.length > 4 * 1024 * 1024) { this.end(); return }
    this.buffer = Buffer.concat([this.buffer, bytes])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (!length || length > 2 * 1024 * 1024) { this.end(); return }
      if (this.buffer.length < length + 4) break
      const jpeg = this.buffer.subarray(4, length + 4)
      this.buffer = this.buffer.subarray(length + 4)
      try {
        const frame = this.encode(jpeg)
        if (frame.image.length > SIMULATOR_LIMITS.frameBytes || frame.width <= 0 || frame.height <= 0) continue
        this.latest = { ...frame, capturedAt: Date.now() }
        for (const resolve of this.waiters) resolve()
        this.waiters.clear()
      } catch { /* Skip a corrupt frame without publishing bytes from an earlier capture. */ }
    }
  }
  async first() {
    if (this.latest) return
    if (this.ended) throw new Error('SIMULATOR_STREAM_ENDED')
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); this.waiters.delete(done); error ? reject(error) : resolve() }
      const timer = setTimeout(() => done(new Error('SIMULATOR_FRAME_TIMEOUT')), 15000)
      this.waiters.add(done)
    })
  }
  snapshot() {
    if (this.ended || !this.latest || Date.now() - this.latest.capturedAt > 5000) throw new Error('SIMULATOR_FRAME_STALE')
    return this.latest
  }
  end() {
    this.ended = true; this.latest = undefined; this.buffer = Buffer.alloc(0)
    for (const done of this.waiters) done(new Error('SIMULATOR_STREAM_ENDED'))
    this.waiters.clear()
  }
}
