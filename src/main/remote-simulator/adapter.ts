import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { SimulatorBackend, SimulatorStream } from './service'
import type { SimulatorDevice, SimulatorInput } from '@kun/remote-protocol'
import { RawSimulatorFrames } from './frames'

export type EncodeSimulatorFrame = (bytes: Buffer) => { image: string; width: number; height: number }
const assertCurrent = (current: () => boolean) => { if (!current()) throw new Error('SIMULATOR_AUTHORITY_CHANGED') }
export class XcodeSimulatorBackend implements SimulatorBackend {
  private streams = new Set<() => Promise<void>>()
  constructor(private readonly encode: EncodeSimulatorFrame) {}
  supported() { return process.platform === 'darwin' }
  async executable() {
    for (const root of [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin']) {
      if (!root.startsWith('/')) continue
      const path = join(root, 'axe')
      if (await access(path, constants.X_OK).then(() => true, () => false)) return path
    }
    throw new Error('SIMULATOR_AXE_REQUIRED')
  }
  async available() { return this.executable().then(() => true, () => false) }
  private async run(binary: string, args: string[], current: () => boolean, timeout = 10000) {
    assertCurrent(current)
    const abort = new AbortController()
    const timer = setInterval(() => { if (!current()) abort.abort() }, 100)
    try {
      return await new Promise<string>((accept, reject) => execFile(binary, args,
        { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, signal: abort.signal },
        (error, stdout) => {
          if (!current()) reject(new Error('SIMULATOR_AUTHORITY_CHANGED'))
          else if (error) reject(new Error('SIMULATOR_COMMAND_FAILED', { cause: Object.assign(error, { diagnosticStdout: stdout }) }))
          else accept(stdout)
        }))
    } finally { clearInterval(timer) }
  }
  async list(current: () => boolean): Promise<SimulatorDevice[]> {
    const raw = JSON.parse(await this.run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '--json'], current))
    return Object.entries(raw.devices ?? {}).filter(([runtime]) => runtime.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-'))
      .flatMap(([runtime, devices]) => (Array.isArray(devices) ? devices : [])
      .filter(d => d.isAvailable && ['Booted', 'Shutdown'].includes(d.state) && /^[-A-Fa-f0-9]{36}$/.test(d.udid))
      .map(d => ({ udid: d.udid, name: String(d.name).slice(0, 200), state: d.state, runtime: runtime.slice(0, 200) }))).slice(0, 64)
  }
  async boot(udid: string, current: () => boolean) {
    await this.run('/usr/bin/xcrun', ['simctl', 'boot', udid], current)
    await this.run('/usr/bin/xcrun', ['simctl', 'bootstatus', udid, '-b'], current, 60000)
  }
  async stream(udid: string, current: () => boolean): Promise<SimulatorStream> {
    const binary = await this.executable(); assertCurrent(current)
    const parser = new RawSimulatorFrames(this.encode)
    const child = spawn(binary, ['stream-video', '--udid', udid, '--fps', '8', '--format', 'raw', '--quality', '50', '--scale', '0.5'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let exited = false, stopping: Promise<void> | undefined
    const ended = new Promise<void>(resolve => child.once('close', () => { exited = true; parser.end(); resolve() }))
    child.once('error', () => parser.end())
    child.stdout.on('data', bytes => { if (current()) parser.accept(bytes); else void stop() })
    const watch = setInterval(() => { if (!current()) void stop() }, 250)
    child.once('close', () => { clearInterval(watch); this.streams.delete(stop) })
    const stop = () => stopping ??= (async () => {
      clearInterval(watch); parser.end()
      if (exited) return
      child.kill('SIGTERM')
      const kill = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 1500)
      try { await ended } finally { clearTimeout(kill); this.streams.delete(stop) }
    })()
    this.streams.add(stop)
    try { await parser.first() } catch (failure) { await stop(); throw failure }
    return { frame: async () => { assertCurrent(current); return parser.snapshot() }, stop }
  }
  async stopAll() { await Promise.all([...this.streams].map(stop => stop())) }
  async input(udid: string, input: SimulatorInput, current: () => boolean) {
    const binary = await this.executable(); assertCurrent(current)
    if (input.kind === 'button') { await this.run(binary, ['button', input.button, '--udid', udid], current, 30000); return }
    if (input.kind === 'text') { await this.run(binary, ['type', '--udid', udid, '--', input.text], current, 30000); return }
    const raw = JSON.parse(await this.run(binary, ['--output', 'json', 'displays', '--udid', udid], current, 20000))
    const result = raw.data?.result
    const active = result?.activeScreen
    const width = active?.width, height = active?.height
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('SIMULATOR_DISPLAY_UNAVAILABLE')
    const x = (n: number) => String(Math.min(width - 1, Math.max(1, Math.round(n * width))))
    const y = (n: number) => String(Math.min(height - 1, Math.max(1, Math.round(n * height))))
    const args = input.kind === 'tap'
      ? ['tap', '-x', x(input.x), '-y', y(input.y), ...(input.holdMs ? ['--hold', String(input.holdMs / 1000)] : [])]
      : ['swipe', '--start-x', x(input.x), '--start-y', y(input.y), '--end-x', x(input.endX), '--end-y', y(input.endY), '--duration', String(input.durationMs / 1000)]
    await this.run(binary, [...args, '--udid', udid], current, 30000)
  }
}
