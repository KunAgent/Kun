/** Portable subagent progress projected onto the parent conversation. */
export type CoreChildRunActivityJson = {
  phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
  label: string
  toolName?: string
  startedAt: string
  updatedAt: string
}

export type CoreChildLauncher =
  'delegate_task' | 'fast_context' | 'ppt_agent' | 'component_design' | 'graph' | 'manager-worker'
export type CoreChildRuntimeMetadataJson = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
  childLauncher?: CoreChildLauncher
  childTerminationReason?: 'user_stop' | 'manual_stop' | 'runtime_restart' | 'child_error'
  resumable?: boolean
  resumeCount?: number
  failure?: {
    source: 'model' | 'runtime' | 'contract'
    code?: string
    category?: string
    httpStatus?: number
    retryAfterMs?: number
  }
  proactiveRetry?: {
    enabled: boolean
    eligible: boolean
    count: number
    limit: number
    remaining: number
  }
  detached?: boolean
  childModel?: string
  childProviderId?: string
  childProfile?: string
  childProfileName?: string
  childToolPolicy?: 'readOnly' | 'inherit'
  prefixReused?: boolean
  inheritedHistoryItems?: number
  toolInvocations?: number
  attemptStartedAt?: string
  attemptDurationMs?: number
  durationMs?: number
  queuedMs?: number
  summaryTruncated?: boolean
  resultRef?: {
    artifactId: string
    byteSize: number
    lineCount: number
    mimeType: 'text/markdown'
  }
  resultUnavailableReason?: string
  totalTokens?: number
  cacheHitRate?: number | null
  costUsd?: number
  costCny?: number
  activity?: CoreChildRunActivityJson
}
