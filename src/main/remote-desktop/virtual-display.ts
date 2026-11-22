import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { validateDesktopViewport, type DesktopViewport } from '@kun/remote-protocol'
import type { VirtualDisplayGeometry } from '@kun/control-runtime/desktop'
import { desktopHelperAvailable, desktopHelperPath } from './native-input'

const owners = new Map<number, NativeMobileDisplay>()
let supported: boolean | undefined
export function mobileDisplaySupported() {
  if (supported === undefined) {
    supported = process.platform === 'darwin' && process.arch === 'arm64' && desktopHelperAvailable() && spawnSync(desktopHelperPath(), ['--virtual-display-probe'],
      { encoding: 'utf8', timeout: 2500, maxBuffer: 1024 }).stdout?.trim() === 'kun-virtual-display-v1'
  }
  return supported
}
export const isKunMobileDisplay = (id: number) => owners.has(id)
export function expectedMobileDisplayChange(display: Electron.Display, metrics: string[]) {
  return owners.get(display.id)?.expects(display, metrics) === true
}

/** This process owns one secondary monitor. It has no command to name, resize or capture a physical display. */
export class NativeMobileDisplay {
  private child?: ChildProcessWithoutNullStreams
  private closed = false
  private done?: Promise<void>
  private id?: number
  private size?: DesktopViewport
  private scale?: number
  private pending?: { size: DesktopViewport; resolve(value: VirtualDisplayGeometry): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  constructor(private readonly lost: () => void) {}

  expects(display: Electron.Display, metrics: string[]) {
    if (display.rotation !== 0 || metrics.includes('rotation')) return false
    return Boolean(this.pending) || Boolean(this.size && display.size.width === this.size.width &&
      display.size.height === this.size.height && display.scaleFactor === this.scale)
  }
  open(size: DesktopViewport) {
    validateDesktopViewport(size)
    if (this.child || this.closed || !mobileDisplaySupported()) throw Error('DESKTOP_VIRTUAL_UNAVAILABLE')
    const child = spawn(desktopHelperPath(), ['--virtual-display'], { stdio: 'pipe' })
    this.child = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    const received = (line: string) => {
      const p = this.pending
      if (!p || this.closed) { child.kill(); return }
      const owned = /^owned (\d+)$/.exec(line)
      if (owned && !this.id && Number(owned[1]) > 0) { this.id = Number(owned[1]); owners.set(this.id, this); return }
      if (line === 'rejected' && this.size) {
        clearTimeout(p.timer); this.pending = undefined; p.reject(Error('DESKTOP_VIEWPORT_UNSUPPORTED')); return
      }
      const match = /^screen (\d+) (\d+) (\d+) (\d+) (\d+)$/.exec(line)
      if (!match) { child.kill(); return }
      const [id, w, h, pixelWidth, pixelHeight] = match.slice(1).map(Number)
      if (id !== this.id || w < 320 || h < 240 || w > 3840 || h > 3840 || w * h > 8294400 ||
        Math.abs(w / h / (p.size.width / p.size.height) - 1) > 0.005 ||
        ![1, 2].includes(pixelWidth / w) || pixelHeight / h !== pixelWidth / w) { child.kill(); return }
      this.size = { width: w, height: h }
      this.scale = pixelWidth / w
      clearTimeout(p.timer); this.pending = undefined; p.resolve({ id, pixelWidth, pixelHeight, logicalWidth: w, logicalHeight: h })
    }
    child.stdout.on('data', (part: string) => {
      buffer += part
      if (buffer.length > 256) { child.kill(); return }
      let end
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); received(line) }
    })
    child.stdin.on('error', () => { child.kill() })
    child.stderr.resume()
    this.done = new Promise<void>(resolve => {
      child.on('error', () => { /* close follows an unsuccessful spawn */ })
      child.once('close', () => {
        const stopping = this.closed
        const inRequest = Boolean(this.pending)
        this.closed = true; this.child = undefined
        if (this.id !== undefined && owners.get(this.id) === this) owners.delete(this.id)
        if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(Error('DESKTOP_VIRTUAL_UNAVAILABLE')); this.pending = undefined }
        resolve(); if (!stopping && !inRequest) this.lost()
      })
    })
    return this.resize(size)
  }
  resize(size: DesktopViewport) {
    validateDesktopViewport(size)
    const child = this.child
    if (!child || this.closed || this.pending) throw Error('DESKTOP_VIRTUAL_UNAVAILABLE')
    return new Promise<VirtualDisplayGeometry>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
      this.pending = { size, resolve, reject, timer }
      child.stdin.write(`size ${size.width} ${size.height}\n`)
    })
  }
  async stop() {
    this.closed = true
    const child = this.child
    if (!child) return
    child.stdin.end()
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 700)
    try { await this.done } finally { clearTimeout(timer) }
  }
}
