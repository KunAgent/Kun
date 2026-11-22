import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { desktopHelperAvailable, desktopHelperPath } from './native-input'

type VideoSize = { width: number; height: number }
let available: boolean | undefined
export function macPrivacyScreenSupported(): boolean {
  if (available === undefined) {
    available = process.platform === 'darwin' && desktopHelperAvailable() &&
      spawnSync(desktopHelperPath(), ['--privacy-screen-probe'], { encoding: 'utf8', timeout: 2000 })
        .stdout?.trim() === 'kun-privacy-screen-v1'
  }
  return available
}

export class MacPrivacyScreen {
  visible = false
  private child?: ChildProcess
  private exited?: Promise<void>
  private closing = false
  private size?: VideoSize
  private buffer?: Buffer
  private offset = 0
  private pending?: { accept(line: string): void; reject(error: Error): void }
  constructor(private readonly displayId: number, private readonly identity: { pid: number; birth: string },
    private readonly virtual: boolean, private readonly frame: (data: Buffer, size: VideoSize) => void,
    private readonly lost: (localExit: boolean) => void) {}

  async open(): Promise<VideoSize> {
    const child = spawn(desktopHelperPath(), ['--privacy-screen', String(this.displayId), String(this.identity.pid),
      this.identity.birth, this.virtual ? 'virtual' : 'physical'], { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] })
    this.child = child
    const lines = createInterface({ input: child.stdio[3] as Readable })
    lines.on('line', line => this.pending?.accept(line))
    child.stdout!.on('data', (chunk: Buffer) => this.pixels(chunk))
    child.stdin!.on('error', () => { if (!this.closing) child.kill() })
    this.exited = new Promise<void>(resolve => child.once('close', code => {
      const wasVisible = this.visible
      this.visible = false; this.buffer = undefined
      this.pending?.reject(Error('DESKTOP_PRIVACY_UNAVAILABLE'))
      if (!this.closing && wasVisible) this.lost(code === 5)
      resolve()
    }))
    child.once('error', () => this.pending?.reject(Error('DESKTOP_PRIVACY_UNAVAILABLE')))
    const match = /^ready (\d+) (\d+)$/.exec(await this.response(4500))
    if (!match) throw Error('DESKTOP_PRIVACY_UNAVAILABLE')
    const width = Number(match[1]), height = Number(match[2])
    if (this.virtual ? width !== 0 || height !== 0 : width < 2 || height < 2 || width % 2 || height % 2 || width * height > 1920 * 1080)
      throw Error('DESKTOP_PRIVACY_UNAVAILABLE')
    return this.size = { width, height }
  }
  private response(timeout: number): Promise<string> {
    if (this.closing || !this.child?.pid || this.child.exitCode !== null || this.child.signalCode !== null)
      return Promise.reject(Error('DESKTOP_PRIVACY_UNAVAILABLE'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => failed(Error('DESKTOP_PRIVACY_UNAVAILABLE')), timeout)
      const clear = () => { clearTimeout(timer); this.pending = undefined }
      const failed = (error: Error) => { clear(); reject(error) }
      this.pending = { accept(line) { clear(); resolve(line) }, reject: failed }
    })
  }
  requestFrame(): void {
    if (this.closing || this.buffer || !this.size?.width) return
    this.buffer = Buffer.allocUnsafe(this.size.width * this.size.height * 3 / 2)
    this.offset = 0
    this.child?.stdin?.write('frame\n')
  }
  private pixels(chunk: Buffer): void {
    const buffer = this.buffer
    if (this.closing) return
    if (!buffer || !this.size || chunk.length > buffer.length - this.offset) { this.child?.kill(); return }
    this.offset += chunk.copy(buffer, this.offset)
    if (this.offset === buffer.length) {
      this.buffer = undefined
      this.frame(buffer, this.size)
    }
  }
  async show(): Promise<void> {
    const shown = this.response(1500)
    this.child?.stdin?.write('show\n')
    if (await shown !== 'shown' || this.closing) throw Error('DESKTOP_PRIVACY_UNAVAILABLE')
    this.visible = true
  }
  lease(ms: number): void {
    if (!this.closing && Number.isFinite(ms)) this.child?.stdin?.write(`lease ${Math.max(0, Math.min(6000, Math.floor(ms)))}\n`)
  }
  async stop(): Promise<void> {
    this.closing = true
    this.pending?.reject(Error('DESKTOP_CAPTURE_CLOSED'))
    this.buffer = undefined
    const child = this.child
    if (!child || !this.exited) return
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('DESKTOP_CLEANUP_UNCONFIRMED')), 1500)
      })])
    } finally { clearTimeout(timer) }
  }
}
