import type { DelegatedRuntimeCapabilities } from '../delegated-turn-runtime.js'
import { utf8PrefixWithinBytes } from '../../shared/utf8-text-blocks.js'
import type { SdkMessage } from './sdk-protocol.js'
import type { SdkRuntimeDeps } from './agent-sdk-runtime-contracts.js'
import {
  SDK_ASSISTANT_DELTA_EVENT_MAX_BYTES,
  SDK_ASSISTANT_DELTA_EVENT_MAX_DELAY_MS,
  SDK_ITERATOR_CLOSE_TIMEOUT_MS,
  type SdkAssistantDeltaEvent
} from './agent-sdk-runtime-items.js'

export function agentSdkCapabilities(): DelegatedRuntimeCapabilities {
  return {
    nativeResume: true,
    structuredStreaming: true,
    kunTools: true,
    roomToolPolicy: true,
    externalApproval: true,
    liveSteering: false,
    nativeContextTelemetry: false,
    fork: false
  }
}

type PendingSdkAssistantDeltaEvent = Omit<SdkAssistantDeltaEvent, 'text'> & {
  parts: string[]
  bytes: number
}

/** Coalesces SDK token deltas into bounded persistence events without reordering signals. */
export class SdkAssistantDeltaEventCoalescer {
  private pending: PendingSdkAssistantDeltaEvent | undefined
  private timer: NodeJS.Timeout | undefined
  private writeTail: Promise<void> = Promise.resolve()
  private writeError: unknown
  private hasWriteError = false

  constructor(
    private readonly emit: (event: SdkAssistantDeltaEvent) => Promise<void>,
    private readonly maxBytes = SDK_ASSISTANT_DELTA_EVENT_MAX_BYTES,
    private readonly maxDelayMs = SDK_ASSISTANT_DELTA_EVENT_MAX_DELAY_MS
  ) {}

  async append(event: SdkAssistantDeltaEvent): Promise<void> {
    this.throwWriteError()
    if (!event.text) return
    if (
      this.pending &&
      (this.pending.kind !== event.kind || this.pending.itemId !== event.itemId)
    ) {
      await this.flush()
    }
    let offset = 0
    while (offset < event.text.length) {
      if (!this.pending) {
        this.pending = {
          kind: event.kind,
          itemId: event.itemId,
          textOffset: event.textOffset + offset,
          parts: [],
          bytes: 0
        }
        this.scheduleFlush()
      }
      const prefix = utf8PrefixWithinBytes(
        event.text,
        offset,
        this.maxBytes - this.pending.bytes
      )
      if (prefix.end === offset) {
        await this.flush()
        continue
      }
      this.pending.parts.push(event.text.slice(offset, prefix.end))
      this.pending.bytes += prefix.bytes
      offset = prefix.end
      if (this.pending.bytes >= this.maxBytes) await this.flush()
    }
  }

  async flush(): Promise<void> {
    this.cancelTimer()
    this.enqueuePending()
    await this.writeTail
    this.throwWriteError()
  }

  dispose(): void {
    this.cancelTimer()
  }

  private scheduleFlush(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.enqueuePending()
    }, this.maxDelayMs)
    this.timer.unref?.()
  }

  private cancelTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private enqueuePending(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    this.writeTail = this.writeTail.then(async () => {
      if (this.hasWriteError) return
      try {
        await this.emit({
          kind: pending.kind,
          itemId: pending.itemId,
          textOffset: pending.textOffset,
          text: pending.parts.join('')
        })
      } catch (error) {
        this.hasWriteError = true
        this.writeError = error
      }
    })
  }

  private throwWriteError(): void {
    if (this.hasWriteError) throw this.writeError
  }
}

export function sdkResultTurnCount(message: SdkMessage): number {
  if (message.type !== 'result') return 0
  const raw = Number((message as { num_turns?: unknown }).num_turns ?? 1)
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : 1
}

export function awaitAbortable<T>(operation: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(abortError(signal)))
    signal.addEventListener('abort', onAbort, { once: true })
    let started: PromiseLike<T>
    try {
      started = operation()
    } catch (error) {
      finish(() => reject(error))
      return
    }
    Promise.resolve(started).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })
}

export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('agent SDK operation aborted')
  error.name = 'AbortError'
  return error
}

export async function closeIterator(iterator: AsyncIterator<SdkMessage>, signal: AbortSignal): Promise<boolean> {
  if (!iterator.return) return true
  const closeAbort = new AbortController()
  const forwardAbort = (): void => closeAbort.abort(signal.reason)
  if (signal.aborted) forwardAbort()
  else signal.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => {
    closeAbort.abort(new Error('agent SDK iterator cleanup timed out'))
  }, SDK_ITERATOR_CLOSE_TIMEOUT_MS)
  timeout.unref?.()
  try {
    await awaitAbortable(() => iterator.return!(), closeAbort.signal)
    return true
  } catch (error) {
    if (signal.aborted) throw error
    return false
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', forwardAbort)
  }
}
