import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { Readable } from 'node:stream'
import { desktopHelperPath } from './native-input'
import type { DesktopInputPort } from '@kun/control-runtime/desktop'

export const PORTAL_DISPLAY = 2147483600
export const isWayland = () => process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY))
type Selection = { grantId: string; width: number; height: number; logicalWidth: number; logicalHeight: number; input: boolean }
type Reply = { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type FrameConsumer = (data: Buffer, consumed: () => void) => void

/** The chooser opens exclusively from the local host switch. The remote side gets an opaque display token. */
export class WaylandSession {
  selection?: Selection
  private child?: ChildProcess
  private pending?: Promise<void>
  private owner?: symbol
  private frame?: FrameConsumer
  private sequence = 0
  private replies = new Map<number, Reply>()
  constructor(private readonly lost: () => void) {}
  async prepare() {
    if (this.selection) return
    if (this.pending) return this.pending
    const child = spawn(desktopHelperPath(), ['--portal'], { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] })
    this.child = child
    const task = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(Error('SCREEN_PERMISSION_REQUIRED')); child.kill() }, 100_000)
      let lines = ''
      child.stdout!.setEncoding('utf8')
      child.stdout!.on('data', (data: string) => {
        if (child !== this.child) return
        lines += data
        if (lines.length > 65536) { child.kill(); return }
        for (let at; (at = lines.indexOf('\n')) >= 0;) {
          const line = lines.slice(0, at); lines = lines.slice(at + 1)
          try {
            const message = JSON.parse(line)
            if (message.event === 'portal' && !this.selection) {
              const value = message.value as Selection
              if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) ||
                  value.width < 8 || value.height < 2 || value.width > 1920 || value.height > 1080 ||
                  typeof value.input !== 'boolean') throw Error('DESKTOP_SOURCE_CHANGED')
              this.selection = { ...value, grantId: randomUUID() }; clearTimeout(timer); resolve()
            } else {
              const call = this.replies.get(message.id)
              if (call) {
                this.replies.delete(message.id); clearTimeout(call.timer)
                if (message.ok) call.resolve()
                else call.reject(Error(String(message.error ?? 'DESKTOP_INPUT_FAILED')))
              }
            }
          } catch { child.kill() }
        }
      })
      const ended = () => {
        clearTimeout(timer); reject(Error('SCREEN_PERMISSION_REQUIRED'))
        if (child !== this.child) return
        const active = Boolean(this.selection)
        this.reset()
        if (active) this.lost()
      }
      child.stdin!.on('error', () => child.kill())
      child.once('error', ended); child.once('exit', ended)
      this.readFrames(child, child.stdio[3] as Readable)
    })
    this.pending = task
    try { await task } finally { if (this.pending === task) this.pending = undefined }
  }
  private readFrames(child: ChildProcess, stream: Readable) {
    const header = Buffer.alloc(4)
    let used = 0, data: Buffer | undefined
    stream.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      let offset = 0
      while (offset < chunk.length) {
        const target = data ?? header, n = Math.min(target.length - used, chunk.length - offset)
        chunk.copy(target, used, offset, offset + n); used += n; offset += n
        if (used !== target.length) continue
        used = 0
        if (!data) {
          const length = header.readUInt32BE(0), size = this.selection
          if (!size || length !== size.width * size.height * 3 / 2) { child.kill(); return }
          data = Buffer.allocUnsafe(length)
        } else {
          const frame = data, consumer = this.frame; data = undefined
          consumer?.(frame, () => {
            if (this.child === child && this.frame === consumer && this.owner) void this.call('frame').catch(() => this.lost())
          })
        }
      }
    })
  }
  private call(operation: string, fields: Record<string, unknown> = {}) {
    const child = this.child
    if (!this.selection || !child?.stdin?.writable || this.replies.size >= 240) return Promise.reject(Error('DESKTOP_AUTHORITY_CHANGED'))
    const id = ++this.sequence
    return new Promise<void>((resolve,reject) => {
      const timer = setTimeout(() => { this.replies.delete(id); reject(Error('DESKTOP_INPUT_TIMEOUT')); child.kill() }, 1500)
      this.replies.set(id, { resolve, reject, timer })
      child.stdin!.write(JSON.stringify({ id, operation, ...fields }) + '\n')
    })
  }
  async video(consumer: FrameConsumer) {
    if (!this.owner) throw Error('DESKTOP_AUTHORITY_CHANGED')
    this.frame = consumer
    await this.call('video')
  }
  detach(consumer: FrameConsumer) { if (this.frame === consumer) this.frame = undefined }
  input(): DesktopInputPort {
    const token = Symbol('portal input')
    const owned = (op: string, fields?: Record<string, unknown>) =>
      this.owner === token ? this.call(op, fields) : Promise.reject(Error('DESKTOP_AUTHORITY_CHANGED'))
    return {
      start: async (displayId, capturePid, captureBirth) => {
        if (this.owner || displayId !== PORTAL_DISPLAY) throw Error('DESKTOP_BUSY')
        this.owner = token
        try { await owned('configure', { displayId, capturePid, captureBirth }) }
        catch (error) { if (this.owner === token) this.owner = undefined; throw error }
      },
      ready: () => owned('ready'), setupLease: remainingMs => owned('setupLease', { remainingMs }),
      lease: remainingMs => owned('lease', { remainingMs }),
      input: event => {
        const button = event.button === 'right' ? 2 : event.button === 'middle' ? 1 : 0
        return owned('input', { event: 'button' in event ? { ...event, button } : event })
      },
      release: () => this.owner === token ? owned('release') : Promise.resolve(),
      stop: async () => { if (this.owner === token) { await owned('stop'); this.owner = undefined; this.frame = undefined } }
    }
  }
  private reset() {
    this.child = undefined; this.owner = undefined; this.selection = undefined; this.frame = undefined
    for (const call of this.replies.values()) { clearTimeout(call.timer); call.reject(Error('DESKTOP_AUTHORITY_CHANGED')) }
    this.replies.clear()
  }
  close() {
    const child = this.child
    this.reset(); this.pending = undefined
    child?.stdin?.end()
    if (child && child.exitCode === null) child.kill()
  }
}
