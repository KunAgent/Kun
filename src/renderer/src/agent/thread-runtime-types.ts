import type { HarnessCapabilities } from '@shared/harness-capabilities'
import type { AdeDelegatedTransport } from '@shared/ade-harnesses'

/** Cumulative usage/cost for a Kun thread. */
export type ThreadUsageSnapshot = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  tokenEconomySavingsTokens: number
  turns: number
  /** Cacheable-token hit rate of the most recent request. */
  cacheableTokenHitRate?: number | null
  /** Total-input hit rate of the most recent request. */
  totalInputTokenHitRate?: number | null
  /** Cache miss reasons for the most recent request. */
  cacheMissReasons?: string[]
  /** Cache improvement suggestions for the most recent request. */
  cacheSuggestions?: string[]
  /** Hit rate of the single request that produced this live snapshot. */
  lastRequestCacheHitRate?: number | null
  /** Thread-cumulative average time-to-first-token across model calls (ms). */
  avgTtftMs: number | null
  /** Thread-cumulative average tokens-per-second across model calls. */
  avgTokensPerSecond: number | null
  /** Average TTFT across model calls of the current turn (null = no data). */
  turnAvgTtftMs: number | null
  /** Average tokens-per-second across model calls of the current turn. */
  turnAvgTokensPerSecond: number | null
  /** Turn this snapshot was emitted for (for per-turn metric attribution). */
  turnId?: string
}

export type RequestContextSnapshot = {
  threadId: string
  turnId?: string
  model: string
  providerId?: string
  stepIndex: number
  contextWindowTokens: number
  softThresholdTokens: number
  hardThresholdTokens: number
  estimatedInputTokens: number
  breakdown: {
    tools: number
    system: number
    skills: number
    messages: number
    other: number
  }
  toolCount: number
  activeSkillIds: string[]
  contextManagement?: 'kun-managed' | 'sdk-managed'
  nativeHistory?: 'known' | 'unknown' | 'none'
}

export type DelegatedRuntimeState = {
  threadId: string
  turnId?: string
  providerKind: AdeDelegatedTransport
  providerId: string
  /** Explicit harness identity when the event carries it. */
  harnessId?: string
  /**
   * Capability v2 snapshot for the route. When absent on the wire it is
   * derived from the legacy boolean bag so consumers can rely on it.
   */
  capabilitiesV2?: HarnessCapabilities
  phase: 'portable' | 'resumed' | 'rebased'
  reason?:
    | 'new'
    | 'route_changed'
    | 'capabilities_changed'
    | 'history_changed'
    | 'native_state_unavailable'
  capabilities: {
    nativeResume: boolean
    structuredStreaming: boolean
    kunTools: boolean
    externalApproval: boolean
    liveSteering: boolean
    nativeContextTelemetry: boolean
    fork: boolean
  }
}

/** Native-loop analogue of DelegatedRuntimeState, from `harness_runtime` events. */
export type HarnessRuntimeState = {
  threadId: string
  turnId?: string
  harnessId: string
  capabilitiesV2: HarnessCapabilities
}

/** `handoff_injected` event metadata (docs/ade/08 §4). */
export type HandoffEventPayload = {
  threadId: string
  turnId?: string
  reason: 'harness-switch' | 'rebase' | 'worker-dispatch' | 'context-overflow'
  mode: 'full' | 'delta'
  toHarnessName: string
  toModel?: string
  recentTurns: number
  files: number
  briefDigest: string
  createdAt?: string
}
