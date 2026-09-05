import { resolve, relative, isAbsolute } from 'node:path'
import { isPublicRuntimeEvent, type RuntimeEvent } from '../contracts/events.js'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ExtensionToolCatalogEpoch,
  ThreadRecord,
  ThreadSummary
} from '../contracts/threads.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadService } from './thread-service.js'
import { TurnConflictError, type TurnService } from './turn-service.js'
import type {
  ExtensionAgentProfileRegistry
} from './extension-agent-profile-registry.js'
import { type BufferedAgentEvent, type ExtensionAgentAuthorizer, type ExtensionAgentEvent, type ExtensionAuthorizationRequest, type ExtensionPrincipal, MAX_REPLAY_RECORD_BYTES } from './extension-agent-service-contracts.js'
import { ManagedSubscription } from './extension-agent-service-subscription.js'
import { normalizeOwnedWorkspace, projectEvent } from './extension-agent-service-projection.js'

export class ManifestExtensionAgentAuthorizer implements ExtensionAgentAuthorizer {
  authorize(principal: ExtensionPrincipal, request: ExtensionAuthorizationRequest): void {
    if (!principal.workspaceTrusted && request.workspace) {
      throw new ExtensionBrokerError('workspace_denied', 'Workspace is not trusted for this extension')
    }
    if (!principal.permissions.includes(request.permission)) {
      throw new ExtensionBrokerError('permission_denied', `Missing permission: ${request.permission}`)
    }
    if (request.workspace) normalizeOwnedWorkspace(principal, request.workspace)
    if (request.accountId && request.providerId) {
      const accountPermission = `accounts.use:${request.providerId}`
      if (!principal.permissions.includes(accountPermission)) {
        throw new ExtensionBrokerError('permission_denied', `Missing permission: ${accountPermission}`)
      }
    }
  }
}

export class ExtensionBrokerError extends Error {
  constructor(
    readonly code: 'validation_error' | 'permission_denied' | 'workspace_denied' | 'not_found' | 'conflict',
    message: string
  ) {
    super(message)
    this.name = 'ExtensionBrokerError'
  }
}

export async function* iterateSessionEventsSince(
  sessions: SessionStore,
  threadId: string,
  afterSeq: number
): AsyncIterable<RuntimeEvent> {
  if (!sessions.iterateEventsSince) {
    throw new ExtensionBrokerError(
      'conflict',
      'Bounded extension event replay is unavailable for this session store.'
    )
  }
  yield* sessions.iterateEventsSince(threadId, afterSeq, { maxRecordBytes: MAX_REPLAY_RECORD_BYTES })
}

export async function loadLatestUsageTokens(sessions: SessionStore, threadId: string): Promise<number> {
  if (sessions.loadLatestUsageSnapshots) {
    const snapshots = await sessions.loadLatestUsageSnapshots({ threadIds: [threadId] })
    const snapshot = snapshots.find((candidate) => candidate.threadId === threadId)
    if (snapshot) return snapshot.usage.totalTokens
  }
  let totalTokens = 0
  for await (const event of iterateSessionEventsSince(sessions, threadId, -1)) {
    if (event.kind === 'usage') totalTokens = event.usage.totalTokens
  }
  return totalTokens
}

export async function summarizeRunEvents(
  sessions: SessionStore,
  threadId: string,
  runId: string
): Promise<{
  usage?: UsageSnapshot
  budgetExhausted: boolean
  waitingState?: 'waiting-approval' | 'waiting-user-input'
}> {
  let baseline: UsageSnapshot | undefined
  let cumulativeUsage: UsageSnapshot | undefined
  const runUsageMetadata: RunUsageMetadata = {}
  let budgetExhausted = false
  let waitingState: 'waiting-approval' | 'waiting-user-input' | undefined
  let reachedRun = false
  for await (const event of iterateSessionEventsSince(sessions, threadId, -1)) {
    if (event.turnId !== runId) {
      if (!reachedRun && event.kind === 'usage') baseline = event.usage
      continue
    }
    reachedRun = true
    if (event.kind === 'usage') {
      cumulativeUsage = event.usage
      mergeRunUsageMetadata(runUsageMetadata, event.usage)
    }
    if (event.kind === 'approval_requested') waitingState = 'waiting-approval'
    if (event.kind === 'user_input_requested') waitingState = 'waiting-user-input'
    if (
      event.kind === 'approval_resolved' || event.kind === 'user_input_resolved' ||
      event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_aborted'
    ) waitingState = undefined
    if (
      event.kind === 'error' &&
      /budget|limit/i.test(`${event.code ?? ''} ${event.message ?? ''}`)
    ) {
      budgetExhausted = true
    }
  }
  const usage = cumulativeUsage
    ? subtractCumulativeUsage(cumulativeUsage, baseline, runUsageMetadata)
    : undefined
  return { ...(usage ? { usage } : {}), budgetExhausted, ...(waitingState ? { waitingState } : {}) }
}

export type RunUsageMetadata = Pick<
  UsageSnapshot,
  | 'cacheableTokenHitRate'
  | 'totalInputTokenHitRate'
  | 'cacheMissReasons'
  | 'cacheSuggestions'
  | 'hasError'
>

export function mergeRunUsageMetadata(target: RunUsageMetadata, usage: UsageSnapshot): void {
  if (usage.cacheableTokenHitRate !== undefined) {
    target.cacheableTokenHitRate = usage.cacheableTokenHitRate
  }
  if (usage.totalInputTokenHitRate !== undefined) {
    target.totalInputTokenHitRate = usage.totalInputTokenHitRate
  }
  if (usage.cacheMissReasons !== undefined) {
    target.cacheMissReasons = unionStrings(target.cacheMissReasons, usage.cacheMissReasons)
  }
  if (usage.cacheSuggestions !== undefined) {
    target.cacheSuggestions = unionStrings(target.cacheSuggestions, usage.cacheSuggestions)
  }
  if (usage.hasError) target.hasError = true
}

export function unionStrings(left: string[] | undefined, right: string[]): string[] {
  return [...new Set([...(left ?? []), ...right])]
}

/** Project one run from thread-cumulative counters without losing cost/cache provenance. */
export function subtractCumulativeUsage(
  current: UsageSnapshot,
  baseline: UsageSnapshot | undefined,
  runMetadata: RunUsageMetadata
): UsageSnapshot {
  const subtract = (value: number, prior: number | undefined) => Math.max(0, value - (prior ?? 0))
  const optional = (value: number | undefined, prior: number | undefined) =>
    value === undefined ? undefined : subtract(value, prior)
  const promptTokens = subtract(current.promptTokens, baseline?.promptTokens)
  const completionTokens = subtract(current.completionTokens, baseline?.completionTokens)
  const cacheHitTokens = optional(current.cacheHitTokens, baseline?.cacheHitTokens)
  const cacheMissTokens = optional(current.cacheMissTokens, baseline?.cacheMissTokens)
  const cacheTelemetryTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  const costByCurrency = current.costByCurrency
    ? Object.fromEntries(Object.entries(current.costByCurrency).map(([currency, cost]) => [
        currency,
        subtract(cost, baseline?.costByCurrency?.[currency])
      ]))
    : undefined
  const cacheableTokenHitRate = cacheTelemetryTotal > 0
    ? (cacheHitTokens ?? 0) / cacheTelemetryTotal
    : runMetadata.cacheableTokenHitRate
  const totalInputTokenHitRate = cacheTelemetryTotal > 0
    ? promptTokens > 0
      ? Math.min(1, (cacheHitTokens ?? 0) / promptTokens)
      : 0
    : runMetadata.totalInputTokenHitRate
  return {
    promptTokens,
    completionTokens,
    ...(current.reasoningTokens !== undefined
      ? { reasoningTokens: subtract(current.reasoningTokens, baseline?.reasoningTokens) }
      : {}),
    totalTokens: subtract(current.totalTokens, baseline?.totalTokens),
    ...(current.cachedTokens !== undefined
      ? { cachedTokens: subtract(current.cachedTokens, baseline?.cachedTokens) }
      : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    ...(current.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: subtract(current.cacheWriteTokens, baseline?.cacheWriteTokens) }
      : {}),
    cacheHitRate: cacheTelemetryTotal > 0 ? (cacheHitTokens ?? 0) / cacheTelemetryTotal : null,
    ...(cacheableTokenHitRate !== undefined ? { cacheableTokenHitRate } : {}),
    ...(totalInputTokenHitRate !== undefined ? { totalInputTokenHitRate } : {}),
    ...(runMetadata.cacheMissReasons !== undefined
      ? { cacheMissReasons: runMetadata.cacheMissReasons }
      : {}),
    ...(runMetadata.cacheSuggestions !== undefined
      ? { cacheSuggestions: runMetadata.cacheSuggestions }
      : {}),
    turns: subtract(current.turns, baseline?.turns),
    ...(current.costUsd !== undefined
      ? { costUsd: subtract(current.costUsd, baseline?.costUsd) }
      : {}),
    ...(current.costCny !== undefined
      ? { costCny: subtract(current.costCny, baseline?.costCny) }
      : {}),
    ...(costByCurrency ? { costByCurrency } : {}),
    ...(current.cacheSavingsUsd !== undefined
      ? { cacheSavingsUsd: subtract(current.cacheSavingsUsd, baseline?.cacheSavingsUsd) }
      : {}),
    ...(current.cacheSavingsCny !== undefined
      ? { cacheSavingsCny: subtract(current.cacheSavingsCny, baseline?.cacheSavingsCny) }
      : {}),
    ...(current.tokenEconomySavingsTokens !== undefined
      ? {
          tokenEconomySavingsTokens: subtract(
            current.tokenEconomySavingsTokens,
            baseline?.tokenEconomySavingsTokens
          )
        }
      : {}),
    ...(current.tokenEconomySavingsUsd !== undefined
      ? {
          tokenEconomySavingsUsd: subtract(
            current.tokenEconomySavingsUsd,
            baseline?.tokenEconomySavingsUsd
          )
        }
      : {}),
    ...(current.tokenEconomySavingsCny !== undefined
      ? {
          tokenEconomySavingsCny: subtract(
            current.tokenEconomySavingsCny,
            baseline?.tokenEconomySavingsCny
          )
        }
      : {}),
    ...(runMetadata.hasError ? { hasError: true } : {})
  }
}

export function compareBufferedEvents(left: BufferedAgentEvent, right: BufferedAgentEvent): number {
  return left.seq - right.seq
}

export function serializedEventBytes(event: ExtensionAgentEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

export function bufferEvent(
  principal: ExtensionPrincipal,
  runId: string,
  event: RuntimeEvent
): BufferedAgentEvent {
  const projected = projectEvent(principal, runId, event)
  if (!projected) {
    return { seq: event.seq, timestamp: event.timestamp, bytes: 0 }
  }
  return {
    seq: projected.seq,
    timestamp: projected.timestamp,
    event: projected,
    bytes: serializedEventBytes(projected)
  }
}

export function enqueueBufferedEvent(state: ManagedSubscription, entry: BufferedAgentEvent): void {
  if (entry.event) {
    state.enqueue(entry.event, entry.bytes)
  } else {
    state.advance(entry)
  }
}
