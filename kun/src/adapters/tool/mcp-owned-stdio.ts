import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import type { Transport } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, type StdioServerParameters } from '@modelcontextprotocol/client/stdio'
import { spawnOwnedProcess, stopOwnedProcess } from '../../process/owned-process.js'

type Message = Parameters<NonNullable<Transport['onmessage']>>[0]

/** MCP stdio with the same process containment as runtime-owned commands. */
export class OwnedStdioClientTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: Message) => void
  private child: ChildProcess | undefined
  private starting: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed = false
  private notified = false
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private readonly stderrStream = new PassThrough()

  // The SDK's disposable stdio negotiation probe reconstructs this concrete
  // transport from these parameters and invokes its own _dispose method.
  constructor(readonly _serverParams: StdioServerParameters) {}

  get pid(): number | null { return this.child?.pid ?? null }
  get stderr(): PassThrough { return this.stderrStream }

  start(): Promise<void> {
    if (this.starting || this.closed) return Promise.reject(new Error('MCP stdio transport already started or closed'))
    this.starting = this.spawn()
    return this.starting
  }

  private async spawn(): Promise<void> {
    const params = this._serverParams
    const child = await spawnOwnedProcess(params.command, params.args ?? [], {
      cwd: params.cwd,
      env: { ...getDefaultEnvironment(), ...params.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', params.stderr ?? 'inherit']
    })
    this.child = child
    child.on('error', (error) => this.onerror?.(error))
    child.stdin?.on('error', (error) => this.onerror?.(error))
    child.stdout?.on('error', (error) => this.onerror?.(error))
    child.stdout?.on('data', (chunk: Buffer) => this.receive(chunk))
    child.stderr?.pipe(this.stderrStream)
    child.once('exit', () => {
      // A wrapper may exit with helpers still holding stdout. Reap the group
      // independently of the stdio close event before announcing completion.
      void stopOwnedProcess(child, { graceMs: 0 }).then(
        () => this.notifyClosed(),
        (error: Error) => { this.onerror?.(error); this.notifyClosed() }
      )
    })
    if (this.closed) await stopOwnedProcess(child)
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > (this._serverParams.maxBufferSize ?? 10 * 1024 * 1024)) {
      this.onerror?.(new Error('MCP stdio message exceeded its read buffer limit'))
      void this.close().catch((error: Error) => this.onerror?.(error))
      return
    }
    for (;;) {
      const end = this.buffer.indexOf(10)
      if (end < 0) return
      const line = this.buffer.subarray(0, end).toString('utf8').replace(/\r$/, '')
      this.buffer = this.buffer.subarray(end + 1)
      try {
        const message = JSON.parse(line) as Message
        if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
          throw new Error('Invalid MCP JSON-RPC message')
        }
        this.onmessage?.(message)
      } catch (error) { this.onerror?.(error instanceof Error ? error : new Error(String(error))) }
    }
  }

  send(message: Message): Promise<void> {
    const input = this.child?.stdin
    if (!input || this.closed) return Promise.reject(new Error('MCP stdio transport is not connected'))
    return new Promise((resolve, reject) => {
      input.write(`${JSON.stringify(message)}\n`, (error) => error ? reject(error) : resolve())
    })
  }

  close(): Promise<void> {
    this.closed = true
    this.closing ??= (async () => {
      await this.starting?.catch(() => undefined)
      if (this.child) {
        this.child.stdin?.end()
        await stopOwnedProcess(this.child)
        this.child.stdin?.destroy()
        this.child.stdout?.destroy()
        this.child.stderr?.destroy()
      }
      this.buffer = Buffer.alloc(0)
      this.notifyClosed()
    })()
    return this.closing
  }

  /** SDK-owned disposable negotiation sibling uses the same awaited cleanup. */
  _dispose(): Promise<void> { return this.close() }

  private notifyClosed(): void {
    if (this.notified) return
    this.notified = true
    this.onclose?.()
  }
}
