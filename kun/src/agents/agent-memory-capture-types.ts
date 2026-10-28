import type { MemoryRecord, MemorySourceEvidence } from '../contracts/memory.js'
import type { MemoryCandidate } from '../contracts/memory-distillation.js'
import type { UsageSnapshot } from '../contracts/usage.js'

export type AgentMemoryScrubFailure = {
  fingerprint: string; attempts: number; nextRetryAt?: number
}

export type AgentMemoryCapture = {
  id: string; phase: 'capture'; participantAgentId: string; roomId: string; rootRequestId: string;
  memberId: string; generation?: number; taskScopeId?: string; handoffId?: string; budgetRootRequestId?: string; budgetGeneration?: number; memoryConversationId?: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'deferred' | 'cancelled';
  attempts: number; reviewIds?: string[]; messageIds: string[]; taskIds: string[]; sourceSeq: number; capturedSeq?: number;
  runId?: string; snapshot?: AgentMemoryCaptureSnapshot; error?: string; scrubFailure?: AgentMemoryScrubFailure
}
export type AgentMemoryCaptureSnapshot = {
  sources: MemorySourceEvidence[]; comparisonRecords: MemoryRecord[]; input: string;
  messageIds: string[]; taskIds: string[]; reviewIds?: string[]; model: string; providerId?: string; accountId?: string; observedAt: string; sourceSeq: number
}
export type AgentMemoryCandidate = {
  id: string; phase: 'candidate'; participantAgentId: string; roomId: string; rootRequestId: string;
  status: 'pending' | 'completed' | 'skipped' | 'conflicted'; candidate: MemoryCandidate;
  action: 'create' | 'update' | 'supersede'; targetId?: string; targetFingerprint?: string;
  runId: string; sourceMessageIds: string[]; memoryId?: string; reason?: string; scrubFailure?: AgentMemoryScrubFailure
}
export type AgentMemoryCaptureResult = {
  candidates: Array<{ candidate: MemoryCandidate; action: 'create' | 'update' | 'supersede';
    targetId?: string; targetFingerprint?: string;
    /** When set, the coordinator must hold this candidate as a pending
     * review record with this reason instead of applying it automatically,
     * even when the decision action is 'create'. */
    reviewReason?: string }>;
  usage?: UsageSnapshot; error?: string; diagnostics?: string[]; elapsedMs: number
}
