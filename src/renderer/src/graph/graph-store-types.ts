import type { RuntimeChildEventPayload } from '../agent/types'
import type { GraphChildReturnTarget } from './graph-child-runtime'
import type { GraphThreadSyncStatus } from './graph-thread-observer'
import type {
  GraphAgentEvidence,
  GraphAgentProfile,
  GraphAgentScore,
  GraphArtifactPage,
  GraphChildRuntime,
  GraphEventEnvelope,
  GraphGovernanceAudit,
  GraphLearningCandidate,
  GraphLearningJob,
  GraphPatchOperation,
  GraphPlanningDraftView,
  GraphPlanningLifecycleEvent,
  GraphRun,
  ProjectIdentity
} from './graph-types'

export type { GraphThreadSyncStatus } from './graph-thread-observer'

type GraphThreadRefreshOptions = {
  silent?: boolean
}

export type GraphViewState = {
  threadId: string | null
  workspace: string
  runs: GraphRun[]
  drafts: GraphPlanningDraftView[]
  childRuns: Record<string, GraphChildRuntime>
  childReturnTarget: GraphChildReturnTarget | null
  selectedRunId: string | null
  selectedNodeId: string | null
  identity: ProjectIdentity | null
  profiles: GraphAgentProfile[]
  evidence: GraphAgentEvidence[]
  scores: GraphAgentScore[]
  audit: GraphGovernanceAudit[]
  candidates: GraphLearningCandidate[]
  jobs: GraphLearningJob[]
  exportedProfile: string | null
  artifactPage: GraphArtifactPage | null
  artifactContent: string
  artifactLoading: boolean
  wakingObligationId: string | null
  loading: boolean
  error: string | null
  /** Graph-owned SSE / observer lifecycle (independent of chat busy). */
  syncStatus: GraphThreadSyncStatus
  /** Monotonic thread SSE cursor for the bound Graph panel thread. */
  threadEventSeq: number
  /**
   * Atomic thread ownership transition for the Graph panel. Switching to a
   * different thread clears all thread-scoped projection and resets the SSE
   * cursor to 0. Same-thread calls are no-ops (reconnect keeps the snapshot).
   */
  bindGraphThread: (threadId: string | null) => { switched: boolean }
  refreshThread: (threadId: string | null, options?: GraphThreadRefreshOptions) => Promise<void>
  refreshProject: (workspace: string) => Promise<void>
  refreshSelectedRun: () => Promise<void>
  selectRun: (runId: string | null) => void
  selectNode: (nodeId: string | null) => void
  setChildReturnTarget: (target: GraphChildReturnTarget) => void
  updateChildObserver: (status: GraphChildReturnTarget['observerStatus'], cursor?: number) => void
  updateChildSessionStatus: (status: GraphChildReturnTarget['childSessionStatus']) => void
  clearChildReturnTarget: () => void
  setSyncStatus: (status: GraphThreadSyncStatus, ownerThreadId?: string) => void
  advanceThreadEventSeq: (seq: number, ownerThreadId?: string) => void
  receiveChildRuntimeEvent: (event: RuntimeChildEventPayload) => void
  receiveEvent: (event: GraphEventEnvelope) => void
  receivePlanningEvent: (event: GraphPlanningLifecycleEvent) => void
  command: (action: 'start' | 'pause' | 'resume' | 'cleanup') => Promise<void>
  cancel: () => Promise<void>
  resumeDraft: (draftId: string) => Promise<void>
  cancelDraft: (draftId: string) => Promise<void>
  retryNode: (nodeId: string) => Promise<void>
  reviewNode: (nodeId: string, outcome: 'pass' | 'fail') => Promise<void>
  wakeLead: (obligationId?: string) => Promise<void>
  patch: (operations: GraphPatchOperation[], reason: string) => Promise<void>
  rebindNode: (nodeId: string, profileId: string) => Promise<void>
  steer: (text: string, nodeId?: string) => Promise<void>
  steerSourceTurn: (threadId: string, sourceTurnId: string, text: string) => Promise<boolean>
  loadArtifact: (artifactId: string) => Promise<void>
  loadNextArtifactPage: () => Promise<void>
  clearArtifact: () => void
  transitionProfile: (profileId: string, lifecycle: GraphAgentProfile['lifecycle']) => Promise<void>
  exportProfile: (profileId: string) => Promise<void>
  importProfile: (portableJson: string) => Promise<void>
  mergeProfiles: (sourceProfileIds: string[], targetProfileId: string, name: string) => Promise<void>
  governCandidate: (
    candidateId: string,
    action: 'approve' | 'reject' | 'start_probation' | 'promote' | 'rollback' | 'delete'
  ) => Promise<void>
  consolidate: () => Promise<void>
}
