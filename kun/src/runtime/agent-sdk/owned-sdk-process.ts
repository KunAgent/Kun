import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { spawnOwnedProcess, stopOwnedProcess } from '../../process/owned-process.js'

/**
 * The SDK requires a synchronous stream facade. Actual launch remains gated
 * and asynchronous; input is buffered until containment has acknowledged it.
 */
class OwnedSdkProcess extends EventEmitter implements SpawnedProcess {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  private child: ChildProcess | undefined
  private requestedSignal: NodeJS.Signals | undefined
  private resultCode: number | null = null
  private resultSignal: NodeJS.Signals | null = null
  private finished = false

  constructor(private readonly options: SpawnOptions) {
    super()
    this.stdin.on('error', (error) => this.emit('error', error))
    this.stdout.on('error', (error) => this.emit('error', error))
    const abort = () => this.kill('SIGTERM')
    options.signal.addEventListener('abort', abort, { once: true })
    this.once('exit', () => options.signal.removeEventListener('abort', abort))
    if (options.signal.aborted) this.requestedSignal = 'SIGTERM'
    void Promise.resolve().then(() => this.start()).catch((error: Error) => {
      this.emit('error', error)
      this.finish(null, null)
    })
  }

  get killed(): boolean { return this.requestedSignal !== undefined }
  get exitCode(): number | null { return this.resultCode }
  get signalCode(): NodeJS.Signals | null { return this.resultSignal }

  private async start(): Promise<void> {
    if (this.requestedSignal) { this.finish(null, this.requestedSignal); return }
    const child = await spawnOwnedProcess(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.on('error', (error) => this.emit('error', error))
    child.stdin?.on('error', (error) => this.emit('error', error))
    if (child.stdin) this.stdin.pipe(child.stdin)
    child.stdout?.pipe(this.stdout)
    // The SDK callback has no stderr stream contract. Drain without exposing
    // credentials or unbounded buffering; CLI failure still carries its code.
    child.stderr?.resume()
    child.once('exit', (code, signal) => {
      void stopOwnedProcess(child, { graceMs: 0 }).then(
        () => this.finish(code, signal),
        (error: Error) => { this.emit('error', error); this.finish(code, signal) }
      )
    })
    if (this.requestedSignal) this.kill(this.requestedSignal)
  }

  kill(signal: NodeJS.Signals): boolean {
    this.requestedSignal = signal
    if (this.child) {
      void stopOwnedProcess(this.child, { graceMs: signal === 'SIGKILL' ? 0 : 1000 })
        .catch((error: Error) => this.emit('error', error))
    }
    return true
  }

  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.finished) return
    this.finished = true
    this.resultCode = code
    this.resultSignal = signal
    this.stdin.destroy()
    this.stdout.end()
    this.emit('exit', code, signal)
  }
}

export function spawnOwnedSdkProcess(options: SpawnOptions): SpawnedProcess {
  return new OwnedSdkProcess(options)
}
