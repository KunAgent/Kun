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
  providerKind: 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli'
  providerId: string
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
