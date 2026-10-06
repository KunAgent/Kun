import { createHash, randomUUID } from 'node:crypto'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../contracts/model-route-pool.js'
import { emptyUsageSnapshot, type GatewayUsageMetadata, type UsageSnapshot } from '../contracts/usage.js'
import { addUsage, diffUsage } from '../domain/usage.js'
import type { ModelStreamChunk } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { GatewayClientIdentity } from './gateway-credential-service.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { ThreadService } from './thread-service.js'
import type { UsageService } from './usage-service.js'

export const GATEWAY_SESSION_HEADER = 'x-kun-gateway-session-id'
export type GatewayUsageOutcome = GatewayUsageMetadata['status']

export type GatewayUsageRecorder = {
  attribution: { threadId: string; turnId: string }
  observe(chunk: ModelStreamChunk): void
  observeAttempt?(attempt: { attemptId: string; providerId: string; modelId: string; usage?: UsageSnapshot }): void
  finish(outcome: GatewayUsageOutcome): Promise<void>
}

type Dependencies = {
  workspace: string
  threadService: Pick<ThreadService, 'create' | 'getMetadata'>
  usageService: Pick<UsageService, 'record' | 'endTurn' | 'forThread'>
  events: Pick<RuntimeEventRecorder, 'record'>
  sessionStore: Pick<SessionStore, 'loadEventsSince' | 'highestSeq'>
  now?: () => number
}

/** A single ledger-only side thread per authenticated client, never per supplied session. */
export class GatewayUsageService {
  private readonly initializing = new Map<string, Promise<void>>()
  private readonly commits = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: Dependencies) {}

  async begin(input: {
    source?: 'public-gateway' | 'utility'
    client: GatewayClientIdentity
    sessionHeader: string | null
    requestedModelId: string
    resolved: { model: string; providerId?: string }
  }): Promise<GatewayUsageRecorder> {
    const sessionId = gatewaySessionId(input.client.clientId, input.sessionHeader)
    const threadId = gatewayAuditThreadId(input.client.clientId)
    await this.ensureAuditThread(threadId, input.client, input.source)
    if (!await this.deps.threadService.getMetadata(threadId)) throw new Error('Gateway usage record was removed. Restart the gateway to resume.')
    const turnId = `gateway_request_${randomUUID()}`
    const now = this.deps.now ?? Date.now
    const startedAt = now()
    let firstTokenAt: number | undefined
    let usage: UsageSnapshot | undefined
    let attemptUsage: UsageSnapshot | undefined
    const attempts: NonNullable<GatewayUsageMetadata['attempts']> = []
    let actualProviderId = input.resolved.providerId === LOCAL_MODEL_GATEWAY_PROVIDER_ID
      ? undefined : input.resolved.providerId
    let actualModelId = actualProviderId ? input.resolved.model : undefined
    let retryCount = 0
    let failoverCount = 0
    let httpStatus: number | undefined
    let failed = false
    let finished: Promise<void> | undefined
    return {
      attribution: { threadId, turnId },
      observeAttempt: (attempt) => {
        if (finished || attempts.some((entry) => entry.attemptId === attempt.attemptId)) return
        if (attempt.usage) attemptUsage = addUsage(attemptUsage ?? emptyUsageSnapshot(), attempt.usage)
        if (attempts.length < 16) attempts.push({ attemptId: attempt.attemptId, providerId: attempt.providerId,
          modelId: attempt.modelId, usageKnown: Boolean(attempt.usage), ...(attempt.usage ? {
            promptTokens: attempt.usage.promptTokens, completionTokens: attempt.usage.completionTokens } : {}) })
      },
      observe: (chunk) => {
        if (finished) return
        if (chunk.route) {
          actualProviderId = chunk.route.providerId
          actualModelId = chunk.route.modelId
        }
        if (chunk.kind === 'usage') {
          // Adapters emit a latest response snapshot, not an additive stream of deltas.
          usage = chunk.usage
          actualProviderId = chunk.usage.actualProviderId ?? actualProviderId
          actualModelId = chunk.usage.actualModelId ?? actualModelId
        }
        if ((chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta') && firstTokenAt === undefined) {
          firstTokenAt = now()
        }
        if (chunk.kind === 'retrying') retryCount += 1
        if (chunk.kind === 'route_switching') failoverCount += 1
        if (chunk.kind === 'error') {
          failed = true
          const status = chunk.failure?.httpStatus
          if (status && status >= 400 && status <= 599) httpStatus = status
        }
        if (chunk.kind === 'completed' && chunk.stopReason === 'error') failed = true
      },
      finish: (outcome) => {
        if (finished) return finished
        const endedAt = now()
        const delta: UsageSnapshot = {
          ...(attempts.length ? attemptUsage ?? emptyUsageSnapshot() : usage ?? emptyUsageSnapshot()),
          requestedModelId: input.requestedModelId,
          ...(actualProviderId ? { actualProviderId } : {}),
          ...(actualModelId ? { actualModelId } : {}),
          turns: 1,
          hasError: failed || outcome === 'failed',
          ...(firstTokenAt !== undefined ? {
            requestTtftMs: Math.max(0, firstTokenAt - startedAt),
            requestGenerationMs: Math.max(0, endedAt - firstTokenAt)
          } : {}),
          gateway: {
            clientId: input.client.clientId,
            requestId: turnId,
            ...(sessionId ? { sessionId } : {}),
            status: failed ? 'failed' : outcome,
            latencyMs: Math.max(0, endedAt - startedAt),
            retryCount,
            failoverCount,
            tokenUsage: (attempts.length ? attemptUsage : usage && (!usage.attemptAccounting || usage.attemptAccounting.usageKnown)) ? 'upstream' : 'unavailable',
            ...(attempts.length ? { attempts } : {}),
            costBasis: 'unverified',
            ...(httpStatus ? { httpStatus } : {})
          }
        }
        finished = this.commit(threadId, turnId, delta, input.source)
        return finished
      }
    }
  }

  async summary(clientId: string): Promise<{
    clientId: string
    usage: UsageSnapshot
    requests: Array<{ timestamp: string; usage: UsageSnapshot }>
  }> {
    const threadId = gatewayAuditThreadId(clientId)
    const highWater = await this.deps.sessionStore.highestSeq(threadId)
    const events = await this.deps.sessionStore.loadEventsSince(threadId, Math.max(0, highWater - 101))
    let previous = emptyUsageSnapshot()
    const requests = events.flatMap((event) => {
      if (event.kind !== 'usage' || event.source !== 'public-gateway') return []
      const usage = diffUsage(event.usage, previous)
      previous = event.usage
      return [{ timestamp: event.timestamp, usage }]
    }).slice(highWater > 101 ? 1 : 0).slice(-100)
    return { clientId, usage: this.deps.usageService.forThread(threadId), requests }
  }

  private async ensureAuditThread(threadId: string, client: GatewayClientIdentity, source = 'public-gateway'): Promise<void> {
    const active = this.initializing.get(threadId)
    if (active) return active
    const initialize = (async () => {
      if (await this.deps.threadService.getMetadata(threadId)) return
      await this.deps.threadService.create({
        title: `${source === 'utility' ? 'Model utility' : 'Gateway usage'}: ${client.name}`,
        workspace: this.deps.workspace,
        model: 'gateway-usage',
        mode: 'agent',
        modelRequestCaptureEnabled: false
      }, { id: threadId, relation: 'side', status: 'idle' })
    })()
    this.initializing.set(threadId, initialize)
    try { await initialize } catch (error) {
      this.initializing.delete(threadId)
      throw error
    }
  }

  private commit(threadId: string, turnId: string, delta: UsageSnapshot, source: 'public-gateway' | 'utility' = 'public-gateway'): Promise<void> {
    const previous = this.commits.get(threadId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      const cumulative = this.deps.usageService.record(threadId, delta, undefined, turnId)
      try {
        await this.deps.events.record({
          kind: 'usage', threadId, turnId,
          model: delta.actualModelId ?? delta.requestedModelId,
          ...(delta.actualProviderId ? { providerId: delta.actualProviderId } : {}),
          source,
          usage: {
            ...cumulative,
            // These describe this request, never the previous cumulative request.
            hasError: delta.hasError,
            actualProviderId: delta.actualProviderId,
            actualModelId: delta.actualModelId,
            requestedModelId: delta.requestedModelId,
            routePoolId: delta.routePoolId,
            routeTargetId: delta.routeTargetId,
            billingKind: delta.billingKind,
            serviceTier: delta.serviceTier,
            gateway: delta.gateway,
            requestTtftMs: delta.requestTtftMs,
            requestGenerationMs: delta.requestGenerationMs
          }
        })
      } finally {
        this.deps.usageService.endTurn(threadId, turnId)
      }
    })
    this.commits.set(threadId, next)
    void next.finally(() => {
      if (this.commits.get(threadId) === next) this.commits.delete(threadId)
    }).catch(() => undefined)
    return next
  }
}

export function gatewayAuditThreadId(clientId: string): string {
  if (clientId !== 'legacy' && !/^gc_[a-f0-9-]{36}$/.test(clientId)) throw new Error('Invalid gateway client identity.')
  return `gateway_audit_${clientId}`
}

export function gatewaySessionId(clientId: string, header: string | null): string | undefined {
  if (header === null) return undefined
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(header)) {
    throw new Error(`${GATEWAY_SESSION_HEADER} must contain 1-128 letters, digits, dots, underscores or hyphens.`)
  }
  const hash = createHash('sha256').update(`${clientId}\0${header}`).digest('hex')
  return `gs_${hash}`
}
