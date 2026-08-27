import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution,
  UserInputResolutionClaim,
  UserInputResolveResult
} from '../ports/user-input-gate.js'

type PendingResolver = {
  resolve: (resolution: UserInputResolution) => void
  reject: (error: Error) => void
}

/**
 * In-memory user-input gate. The agent loop awaits `request`; the GUI
 * resolves it through the HTTP user-input route. Pending requests stay
 * addressable by id so reconnecting renderers can submit or cancel.
 */
export class InMemoryUserInputGate implements UserInputGate {
  private readonly requests = new Map<string, UserInputRequest>()
  private readonly resolvers = new Map<string, PendingResolver>()
  private readonly resolutionClaims = new Set<string>()

  request(input: UserInputRequest): Promise<UserInputResolution> {
    this.requests.set(input.id, input)
    return new Promise<UserInputResolution>((resolve, reject) => {
      this.resolvers.set(input.id, { resolve, reject })
    })
  }

  get(inputId: string): UserInputRequest | undefined {
    return this.requests.get(inputId)
  }

  claimResolution(inputId: string): UserInputResolutionClaim | undefined {
    const request = this.requests.get(inputId)
    if (!request || this.resolutionClaims.has(inputId)) return undefined
    this.resolutionClaims.add(inputId)
    let closed = false
    return {
      request,
      resolve: (resolution) => {
        if (closed) return false
        closed = true
        if (!this.resolutionClaims.delete(inputId)) return false
        return this.settle(inputId, resolution) === 'settled'
      },
      release: () => {
        if (closed) return false
        closed = true
        if (!this.resolutionClaims.delete(inputId)) return false
        this.settleExpiredDeadline(inputId)
        return true
      }
    }
  }

  resolve(inputId: string, resolution: UserInputResolution): UserInputResolveResult {
    if (this.resolutionClaims.has(inputId)) return 'claimed'
    return this.settle(inputId, resolution)
  }

  private settleExpiredDeadline(inputId: string): void {
    const request = this.requests.get(inputId)
    if (request?.deadlineAtMs !== undefined && Date.now() >= request.deadlineAtMs) {
      this.settle(inputId, { status: 'timeout' })
    }
  }

  private settle(inputId: string, resolution: UserInputResolution): UserInputResolveResult {
    const request = this.requests.get(inputId)
    if (!request) return 'missing'
    this.requests.delete(inputId)
    const resolver = this.resolvers.get(inputId)
    this.resolvers.delete(inputId)
    resolver?.resolve(resolution)
    return 'settled'
  }

  pending(threadId?: string): UserInputRequest[] {
    return [...this.requests.entries()].flatMap(([inputId, request]) =>
      this.resolutionClaims.has(inputId) || (threadId && request.threadId !== threadId)
        ? []
        : [request]
    )
  }

  reset(): void {
    for (const resolver of this.resolvers.values()) {
      resolver.reject(new Error('user input gate reset'))
    }
    this.requests.clear()
    this.resolvers.clear()
    this.resolutionClaims.clear()
  }
}
