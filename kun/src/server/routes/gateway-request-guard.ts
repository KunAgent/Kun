import { createHash, timingSafeEqual } from 'node:crypto'
import type { GatewayCredentialService } from '../../services/gateway-credential-service.js'

const DEFAULT_CAPACITY = 20
const DEFAULT_REFILL_PER_SECOND = 1
const DEFAULT_CONCURRENCY = 2
const DEFAULT_TIMEOUT_MS = 120_000

export type GatewayLease = {
  signal: AbortSignal
  timedOut(): boolean
  release(): void
  cancel(): void
}

export class GatewayRequestGuard {
  private tokens: number
  private lastRefill: number
  private active = 0

  constructor(
    private readonly credentials: Pick<GatewayCredentialService, 'verify'>,
    private readonly options: {
      capacity?: number
      refillPerSecond?: number
      maxConcurrency?: number
      timeoutMs?: number
      now?: () => number
    } = {}
  ) {
    this.tokens = options.capacity ?? DEFAULT_CAPACITY
    this.lastRefill = this.now()
  }

  authorize(request: Request): boolean {
    const header = request.headers.get('authorization')
    const match = /^Bearer ([^\s]+)$/.exec(header ?? '')
    return this.credentials.verify(match?.[1] ?? null)
  }

  consumeToken(): boolean {
    const current = this.now()
    const elapsedSeconds = Math.max(0, current - this.lastRefill) / 1_000
    const capacity = this.options.capacity ?? DEFAULT_CAPACITY
    this.tokens = Math.min(capacity, this.tokens + elapsedSeconds * (this.options.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND))
    this.lastRefill = current
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  acquire(parentSignal: AbortSignal): GatewayLease | null {
    if (this.active >= (this.options.maxConcurrency ?? DEFAULT_CONCURRENCY)) return null
    this.active += 1
    const controller = new AbortController()
    let released = false
    let timeoutReached = false
    const onParentAbort = () => controller.abort(parentSignal.reason)
    parentSignal.addEventListener('abort', onParentAbort, { once: true })
    if (parentSignal.aborted) onParentAbort()
    const timer = setTimeout(() => {
      timeoutReached = true
      controller.abort(new Error('gateway request timed out'))
    }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    timer.unref?.()
    const release = () => {
      if (released) return
      released = true
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', onParentAbort)
      this.active -= 1
    }
    return {
      signal: controller.signal,
      timedOut: () => timeoutReached,
      release,
      cancel: () => {
        controller.abort(new Error('gateway request cancelled'))
        release()
      }
    }
  }

  activeCount(): number {
    return this.active
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

export function strictRuntimeTokenAuthorized(request: Request, expected: string): boolean {
  const header = request.headers.get('authorization')
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '')
  if (!match) return false
  const left = new TextEncoder().encode(match[1])
  const right = new TextEncoder().encode(expected)
  return constantTimeDigestEqual(left, right)
}

function constantTimeDigestEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}
