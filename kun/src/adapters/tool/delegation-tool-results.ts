import type { ChildRunRecord, ChildRoutingMetadata, DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type {
  customSubagentProfile,
  SubagentRouteResult,
  SubagentRoutingDocument
} from '../../delegation/subagent-router.js'
import { proactiveRetryStatus } from '../../delegation/delegation-proactive-retry.js'
import { elapsedMs } from '../../delegation/delegation-runtime-support.js'

export type InlineProfile = {
  id: string
  profile: ReturnType<typeof customSubagentProfile>
  source?: 'builtin' | 'configured' | 'workspace' | 'custom' | 'generated'
}

export function childToolResult(
  runtime: DelegationRuntime,
  record: ChildRunRecord
): { output: Record<string, unknown>; isError: boolean } {
  return {
    output: {
      childId: record.id,
      parentThreadId: record.parentThreadId,
      parentTurnId: record.parentTurnId,
      status: record.status,
      detached: record.detached === true,
      launcher: record.launcher,
      terminationReason: record.terminationReason,
      resumable: record.resumable === true,
      resumeCount: record.resumeCount ?? 0,
      ...(record.failure ? { failure: record.failure } : {}),
      proactiveRetry: proactiveRetryStatus(
        record,
        runtime.proactiveRetryPolicy ?? { enabled: true, maxAttempts: 3 }
      ),
      summary: record.summary,
      summaryTruncated: record.summaryTruncated,
      resultRef: record.resultRef,
      resultUnavailableReason: record.resultUnavailableReason,
      error: record.error,
      evidence: record.evidence,
      usage: record.usage,
      returnFormat: record.returnFormat,
      ...(record.profile ? { profile: record.profile } : {}),
      ...(record.profileSnapshot?.name ? { profileName: record.profileSnapshot.name } : {}),
      ...(record.model ? { model: record.model } : {}),
      ...(record.providerFallback ? { providerFallback: record.providerFallback } : {}),
      ...(record.reasoningEffort ? { reasoningEffort: record.reasoningEffort } : {}),
      ...(record.routing ? { routing: routingToolOutput(record.routing) } : {}),
      ...(record.toolPolicy ? { toolPolicy: record.toolPolicy } : {}),
      ...(record.toolInvocations !== undefined ? { toolInvocations: record.toolInvocations } : {}),
      ...(record.startedAt ? {
        attemptStartedAt: record.startedAt,
        attemptDurationMs: elapsedMs(record.startedAt, record.updatedAt)
      } : {}),
      ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
      ...(record.queuedMs !== undefined ? { queuedMs: record.queuedMs } : {})
    },
    isError: record.status === 'failed' || record.status === 'aborted'
  }
}

export function explicitCustomMetadata(
  inlineProfile: InlineProfile,
  agentSurface: 'code' | 'write' | 'design'
): ChildRoutingMetadata {
  return {
    method: 'explicit-custom',
    selectedKind: 'custom',
    selectedId: inlineProfile.id,
    reason: 'The parent supplied a one-run standalone role.',
    agentSurface,
    candidates: [],
    customAgent: inlineProfile.profile
  }
}

export function selectExistingFallback(
  runtime: DelegationRuntime,
  documents: SubagentRoutingDocument[]
): SubagentRoutingDocument | undefined {
  const preferredIds = [runtime.defaultProfileName, 'general'].filter(
    (id): id is string => Boolean(id)
  )
  for (const id of preferredIds) {
    const match = documents.find((document) => document.id === id)
    if (match) return match
  }
  return documents[0]
}

export function existingRouteMetadata(
  route: SubagentRouteResult,
  agentSurface: 'code' | 'write' | 'design'
): ChildRoutingMetadata {
  return {
    method: route.source === 'llm-profile' ? 'bm25-llm-profile' : 'bm25-fallback-profile',
    selectedKind: 'profile',
    selectedId: route.profileId ?? 'general',
    agentSurface,
    reason: route.reason,
    ...(route.confidence !== undefined ? { confidence: route.confidence } : {}),
    candidates: route.candidates
  }
}

export function existingFallbackMetadata(
  route: SubagentRouteResult | undefined,
  selectedId: string,
  agentSurface: 'code' | 'write' | 'design'
): ChildRoutingMetadata {
  return {
    method: 'bm25-fallback-profile',
    selectedKind: 'profile',
    selectedId,
    agentSurface,
    reason: route
      ? `${route.reason} Reused the configured default agent because existing-agent mode is enabled.`
      : 'Reused the configured default agent because existing-agent mode is enabled.',
    ...(route?.confidence !== undefined ? { confidence: route.confidence } : {}),
    candidates: route?.candidates ?? []
  }
}

export function routingToolOutput(routing: ChildRoutingMetadata): Record<string, unknown> {
  return {
    method: routing.method,
    selectedKind: routing.selectedKind,
    selectedId: routing.selectedId,
    ...(routing.reason ? { reason: routing.reason } : {}),
    ...(routing.confidence !== undefined ? { confidence: routing.confidence } : {}),
    candidates: routing.candidates.map((candidate) => ({
      targetId: candidate.targetId,
      name: candidate.name,
      source: candidate.source,
      score: candidate.score
    })),
    ...(routing.generation ? { generation: routing.generation } : {}),
    ...(routing.customAgent ? {
      agent: {
        name: routing.customAgent.name,
        description: routing.customAgent.description,
        toolPolicy: routing.customAgent.toolPolicy
      }
    } : {})
  }
}
