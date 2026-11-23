import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { once } from 'node:events'
import { desktopHelperPath } from './native-input'

/** Interleaved 48 kHz stereo PCM from the approved display's system playback source. */
export class SystemOutput {
  private child?: ChildProcess
  constructor(private samples: (data: Uint8Array) => void, private lost: () => void) {}
  async start(display: number, identity: { pid: number; birth: string }) {
    const child = spawn(desktopHelperPath(), ['--system-audio', String(display), String(identity.pid), identity.birth],
      { stdio: ['ignore', 'pipe', 'ignore', 'pipe'] })
    this.child = child
    let remainder = Buffer.alloc(0)
    child.stdout!.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
      const end = data.length - data.length % 8
      if (end) this.samples(new Uint8Array(data.subarray(0, end)))
      remainder = Buffer.from(data.subarray(end))
    })
    child.once('exit', () => { if (this.child === child) this.lost() })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(Error('DESKTOP_AUDIO_UNAVAILABLE')); child.kill() }, 5500)
      const failure = () => { clearTimeout(timer); reject(Error('DESKTOP_AUDIO_UNAVAILABLE')) }
      child.once('error', failure); child.once('exit', failure)
      const handshake = child.stdio[3] as Readable
      handshake.once('data', (data: Buffer) => {
        clearTimeout(timer)
        if (this.child !== child || data.toString() !== 'R') { failure(); return }
        resolve()
      })
    })
  }
  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) { this.child = undefined; return }
    if (!child.pid) { this.child = undefined; return }
    const exit = once(child, 'exit')
    this.child = undefined
    child.kill('SIGKILL')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('DESKTOP_CLEANUP_UNCONFIRMED')), 1500) })])
    } catch (error) { this.child = child; throw error }
    finally { clearTimeout(timer) }
  }
}
