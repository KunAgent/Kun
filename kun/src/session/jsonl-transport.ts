/**
 * Newline-delimited JSON transport over a spawned child's stdin/stdout
 * (P6-03): splits stream chunks into LF frames (UTF-8 safe across chunk
 * boundaries), rejects oversized/malformed frames into the diagnostic hook
 * instead of crashing, and fails every consumer when the stream closes.
 */
import { StringDecoder } from 'node:string_decoder'
import type { HarnessProcess } from './harness-process.js'
import { HarnessTransportError } from './harness-session.js'

export const JSONL_MAX_FRAME_BYTES = 8 * 1024 * 1024

export type JsonlFrameHandler = (value: unknown, raw: string) => void
export type JsonlDiagnostic = (summary: string) => void

export class JsonlTransport {
  private readonly decoder = new StringDecoder('utf8')
  private pendingText = ''
  private pendingBytes = 0
  private frameHandlers = new Set<JsonlFrameHandler>()
  private closeListeners = new Set<() => void>()
  private closedValue = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly proc: HarnessProcess,
    private readonly options: {
      maxFrameBytes?: number
      diagnostic?: JsonlDiagnostic
    } = {}
  ) {
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      this.pendingText +=
        typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
      this.drainFrames()
    })
    proc.stdout?.once('end', () => {
      this.pendingText += this.decoder.end()
      this.drainFrames()
      this.markClosed()
    })
    void proc.exit.then(() => this.markClosed())
  }

  get closed(): boolean {
    return this.closedValue
  }

  onFrame(handler: JsonlFrameHandler): () => void {
    this.frameHandlers.add(handler)
    return () => this.frameHandlers.delete(handler)
  }

  /** Fires when stdout ends or the process exits — never twice. */
  onClose(listener: () => void): () => void {
    if (this.closedValue) {
      queueMicrotask(listener)
      return () => undefined
    }
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /** Serialize a value as one LF-terminated frame; writes are ordered. */
  write(value: unknown): Promise<void> {
    if (this.closedValue) {
      return Promise.reject(
        new HarnessTransportError('connection_closed', 'transport is closed')
      )
    }
    const frame = JSON.stringify(value) + '\n'
    const task = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const stdin = this.proc.stdin
          if (!stdin || stdin.destroyed) {
            reject(
              new HarnessTransportError(
                'connection_closed',
                'process stdin is closed'
              )
            )
            return
          }
          stdin.write(frame, (error) => {
            if (error) {
              reject(
                new HarnessTransportError(
                  'connection_closed',
                  `write failed: ${error.message}`
                )
              )
              return
            }
            resolve()
          })
        })
    )
    this.writeChain = task.catch(() => undefined)
    return task
  }

  private drainFrames(): void {
    for (;;) {
      const newline = this.pendingText.indexOf('\n')
      if (newline < 0) {
        const max = this.options.maxFrameBytes ?? JSONL_MAX_FRAME_BYTES
        if (Buffer.byteLength(this.pendingText, 'utf8') > max) {
          this.options.diagnostic?.('oversized frame dropped (no newline)')
          this.pendingText = ''
        }
        return
      }
      const raw = this.pendingText.slice(0, newline)
      this.pendingText = this.pendingText.slice(newline + 1)
      if (!raw.trim()) continue
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        this.options.diagnostic?.(
          `malformed frame dropped: ${raw.slice(0, 120)}`
        )
        continue
      }
      for (const handler of [...this.frameHandlers]) {
        try {
          handler(value, raw)
        } catch (error) {
          this.options.diagnostic?.(
            `frame handler threw: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }
    }
  }

  private markClosed(): void {
    if (this.closedValue) return
    this.closedValue = true
    for (const listener of [...this.closeListeners]) {
      try {
        listener()
      } catch {
        // Close listeners never break the transport.
      }
    }
    this.closeListeners.clear()
  }
}
