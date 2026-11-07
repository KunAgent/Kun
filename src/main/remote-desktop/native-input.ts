import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { release as osRelease } from 'node:os'
import { app } from 'electron'

export function desktopHelperPath() {
  return app.isPackaged ? join(process.resourcesPath, 'native/remote-desktop-input') : join(app.getAppPath(), 'resources/native/remote-desktop-input')
}
export const desktopHelperAvailable = () => process.platform === 'darwin' && process.arch === 'arm64' && Number.parseInt(osRelease(), 10) >= 22 && existsSync(desktopHelperPath())
const exec = promisify(execFile)
// A freshly signed/notarized helper can spend several seconds in macOS trust
// evaluation on its first launch. This is a startup-only probe, before input.
const IDENTITY_START_TIMEOUT_MS = 5000
export async function desktopProcessBirth(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('DESKTOP_CAPTURE_NOT_ISOLATED')
  const { stdout } = await exec(desktopHelperPath(), ['--identity', String(pid)], { timeout: IDENTITY_START_TIMEOUT_MS, maxBuffer: 4096 })
    .catch(() => { throw new Error('DESKTOP_CAPTURE_NOT_ISOLATED') })
  const value = stdout.trim()
  if (!/^\d+:\d+$/.test(value)) throw new Error('DESKTOP_CAPTURE_NOT_ISOLATED')
  return value
}
export async function terminateDesktopProcess(pid: number, birth: string) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !/^\d+:\d+$/.test(birth)) throw new Error('DESKTOP_CAPTURE_NOT_ISOLATED')
  await exec(desktopHelperPath(), ['--terminate', String(pid), birth], { timeout: 2000, maxBuffer: 4096 })
    .catch(() => { throw new Error('DESKTOP_CLEANUP_UNCONFIRMED') })
}
/** NDJSON only; credentials and input text are never passed in process arguments or logs. */
export class NativeDesktopInput {
  private process?: ChildProcessWithoutNullStreams
  private sequence = 0
  private generation = 0
  private stopping = false
  private fallback: Promise<void> = Promise.resolve()
  private keys = new Set<string>()
  private buttons = new Set<number>()
  private pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly lost: () => void, private readonly path = desktopHelperPath()) {}
  async start(displayId: number, capturePid: number, captureBirth: string) {
    const generation = ++this.generation
    await this.fallback
    if (generation !== this.generation || this.stopping) throw new Error('DESKTOP_INPUT_LOST')
    if (this.process) throw new Error('DESKTOP_BUSY')
    if (!desktopHelperAvailable()) throw new Error('DESKTOP_UNSUPPORTED')
    const child = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.process = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > 65536) { child.kill(); return }
      for (let at; (at = buffer.indexOf('\n')) >= 0;) {
        const raw = buffer.slice(0, at); buffer = buffer.slice(at + 1)
        try {
          const result = JSON.parse(raw), call = this.pending.get(result.id)
          if (!call) continue
          this.pending.delete(result.id); clearTimeout(call.timer)
          if (result.ok === true) call.resolve()
          else call.reject(new Error(typeof result.error === 'string' ? result.error : 'DESKTOP_INPUT_FAILED'))
        } catch { child.kill() }
      }
    })
    // Native stderr is deliberately not forwarded: it must not become a second input log.
    child.stderr.resume()
    child.once('error', () => this.closed(child))
    child.once('exit', () => this.closed(child))
    await this.command('configure', { displayId, capturePid, captureBirth })
  }
  private closed(child: ChildProcessWithoutNullStreams) {
    if (this.process !== child) return
    this.process = undefined
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('DESKTOP_INPUT_LOST')) }
    this.pending.clear()
    this.fallback = this.releaseFallback()
    // Cleanup callers await fallback; suppress only an unhandled promise notification here.
    void this.fallback.catch(() => {})
    if (!this.stopping) this.lost()
  }
  private command(operation: string, fields: Record<string, unknown> = {}) {
    const child = this.process
    if (!child || child.exitCode !== null || child.stdin.destroyed) return Promise.reject(new Error('DESKTOP_INPUT_LOST'))
    if (this.pending.size >= 240 || child.stdin.writableLength > 65536) return Promise.reject(new Error('DESKTOP_INPUT_BACKPRESSURE'))
    const id = ++this.sequence
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('DESKTOP_INPUT_TIMEOUT')); child.kill() }, 1500)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, operation, ...fields }) + '\n', error => {
        if (error) { const call = this.pending.get(id); if (call) { clearTimeout(timer); this.pending.delete(id); reject(new Error('DESKTOP_INPUT_LOST')) } }
      })
    })
  }
  setupLease(ms: number) { return this.command('setupLease', { remainingMs: Math.min(15000, Math.max(0, ms)) }) }
  lease(ms: number) { return this.command('lease', { remainingMs: Math.min(6000, Math.max(0, ms)) }) }
  ready() { return this.command('ready') }
  input(event: Record<string, unknown>) {
    const normalized = event.type === 'pointer.button' ? { ...event, button: event.button === 'right' ? 2 : event.button === 'middle' ? 1 : 0 } : event
    if (normalized.type === 'key' && normalized.pressed === true && typeof normalized.code === 'string') this.keys.add(normalized.code)
    if (normalized.type === 'pointer.button' && normalized.pressed === true) this.buttons.add(normalized.button as number)
    return this.command('input', { event: normalized }).then(() => {
      if (normalized.type === 'key' && normalized.pressed === false) this.keys.delete(normalized.code as string)
      if (normalized.type === 'pointer.button' && normalized.pressed === false) this.buttons.delete(normalized.button as number)
    })
  }
  release() { return this.command('release').then(() => { this.keys.clear(); this.buttons.clear() }) }
  private async releaseFallback() {
    if (!this.keys.size && !this.buttons.size) return
    const payload = JSON.stringify({ keys: [...this.keys], buttons: [...this.buttons] }) + '\n'
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.path, ['--release-only'], { stdio: ['pipe', 'ignore', 'ignore'] })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('DESKTOP_CLEANUP_UNCONFIRMED')) }, 1500)
      child.once('error', () => { clearTimeout(timer); reject(new Error('DESKTOP_CLEANUP_UNCONFIRMED')) })
      child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('DESKTOP_CLEANUP_UNCONFIRMED')) })
      child.stdin.on('error', () => {})
      child.stdin.end(payload)
    })
    this.keys.clear(); this.buttons.clear()
  }
  async stop() {
    ++this.generation
    this.stopping = true
    const child = this.process
    if (!child) {
      // A direct stop fallback can fail before the child's exit callback runs.
      // Never let an older resolved promise hide a retained key/button ledger.
      try { await this.fallback } catch { /* retry the owned ledger below */ }
      this.fallback = this.releaseFallback()
      await this.fallback
      return
    }
    let releaseError: unknown
    try { await this.release() } catch {
      try { await this.releaseFallback() } catch (error) { releaseError = error }
    }
    await this.command('stop').catch(() => {})
    this.process = undefined
    await new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      const timer = setTimeout(() => child.kill('SIGKILL'), 500)
      const deadline = setTimeout(() => { clearTimeout(timer); reject(new Error('DESKTOP_CLEANUP_UNCONFIRMED')) }, 2000)
      child.once('exit', () => { clearTimeout(timer); clearTimeout(deadline); resolve() })
      child.stdin.end()
    })
    await this.fallback
    if (releaseError) throw releaseError
  }
}
