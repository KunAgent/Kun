export type GraphOrchestrationStrategy = 'direct' | 'graph'

export type GraphRunStatus =
  | 'draft'
  | 'validating'
  | 'ready'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'awaiting_supervision'
  | 'awaiting_human'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type GraphPlanningDraftStatus =
  | 'planning'
  | 'validating'
  | 'repairing'
  | 'needs_correction'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'host_error'

export type GraphPlanningIssue = {
  code: string
  path: Array<string | number>
  message: string
  repairHint: string
  validExample?: unknown
}

export type GraphPlanningDraft = {
  version: 1
  id: string
  reservedRunId: string
  threadId: string
  sourceTurnId: string
  projectId: string
  goal: string
  revision: number
  status: GraphPlanningDraftStatus
  candidateHash?: string
  issues: GraphPlanningIssue[]
  repairCount: number
  createdAt: string
  updatedAt: string
  committedRunId?: string
}

export type GraphPlanningDraftView = {
  draft: GraphPlanningDraft
  tasks: Array<{
    key: string
    kind: 'work' | 'review' | 'integration' | 'loop_gate'
    title: string
  }>
}

export type GraphPlanningLifecycleEvent = {
  version: 1
  event:
    | 'draft_created'
    | 'inspection_started'
    | 'validation_started'
    | 'repair_requested'
    | 'needs_correction'
    | 'run_committed'
    | 'draft_cancelled'
    | 'host_error'
  draftId: string
  reservedRunId: string
  sourceTurnId: string
  revision: number
  state: GraphPlanningDraftStatus
  issues: GraphPlanningIssue[]
  tasks: GraphPlanningDraftView['tasks']
  committedRunId?: string
}

export type GraphNodeStatus =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'queued'
  | 'running'
  | 'submitted'
  | 'reviewing'
  | 'accepted'
  | 'repair_required'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'superseded'

export type GraphPhase = {
  id: string
  title: string
  order: number
  description?: string
  collapsedByDefault?: boolean
}

export type GraphPlanNode = {
  id: string
  phaseId: string
  kind: 'work' | 'review' | 'integration' | 'loop_gate'
  title: string
  objective: string
  priority: number
  required: boolean
  riskClass: 'low' | 'medium' | 'high' | 'critical'
  assignment?:
    | {
        kind: 'existing'
        profileId: string
        profileVersion?: number
      }
    | {
        kind: 'ephemeral'
        name: string
        description?: string
        systemPrompt: string
        model?: string
        providerId?: string
        reasoningEffort?: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        toolPolicy?: 'readOnly' | 'inherit'
        allowedTools?: string[]
        blockedTools?: string[]
        allowedSkills?: string[]
        blockedSkills?: string[]
        allowedMcpServers?: string[]
        blockedMcpServers?: string[]
      }
  readScopes: string[]
  writeScopes: string[]
  completion?: {
    requiredResultFields: string[]
    acceptanceCriteria: string[]
    review: {
      kinds: Array<'deterministic' | 'peer' | 'lead' | 'human'>
      requireAll: boolean
      deterministicChecks: string[]
      humanReason?: string
    }
  }
  loopGate?: {
    maxIterations: number
    condition: {
      sourceNodeId: string
      outcomeIn: Array<'accepted' | 'repair_required' | 'failed' | 'skipped'>
    }
    continueTargetNodeId: string
    exitTargetNodeId: string
    exhaustionTargetNodeId?: string
  }
  timeoutMs?: number
  maxAttempts?: number
}

export type GraphPlanEdge = {
  id: string
  kind: 'control' | 'data' | 'message'
  from: string
  to: string
  label?: string
  artifactName?: string
}

export type GraphArtifactReference = {
  version?: 1
  artifactId: string
  contentHash?: string
  summary: string
  mimeType: string
  byteLength: number
  producerNodeId?: string
  producerAttemptId?: string
  visibility?: 'run' | 'dependency' | 'lead' | 'user'
  retention?: 'run' | 'thread' | 'project' | 'pinned'
  createdAt?: string
}

export type GraphAttempt = {
  id: string
  attemptNumber: number
  status: string
  childThreadId?: string
  queuedAt?: string
  startedAt?: string
  finishedAt?: string
  tokenUsage: number
  elapsedMs: number
  normalizedFailure?: string
  validation?: {
    valid: boolean
    issues: Array<{
      code: string
      path: Array<string | number>
      message: string
      severity: 'error' | 'warning'
    }>
  }
  assignment: {
    profileId: string
    profileVersion: number
    profileOrigin: 'builtin' | 'user' | 'ephemeral' | 'learned'
    requestedProfileId?: string
    requestedProfileVersion?: number
    routingReason?: string
    name: string
    systemPrompt: string
    model: string
    providerId: string
    allowedModelProviderIds: string[]
    allowedModels: string[]
    allowedProviderIds: string[]
    reasoningEffort: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    toolPolicy: 'readOnly' | 'inherit'
    allowedTools: string[]
    blockedTools: string[]
    allowedSkills: string[]
    blockedSkills: string[]
    allowedMcpServers: string[]
    blockedMcpServers: string[]
    approvalPolicy: string
    sandboxMode: string
    workspaceRoot: string
    readScopes: string[]
    writeScopes: string[]
    networkAllowed: boolean
    maxWallTimeMs: number
    capturedAt: string
  }
  result?: {
    summary: string
    artifactRefs: GraphArtifactReference[]
    changedFiles: string[]
    evidence: string[]
    risks: string[]
    checks?: Array<{ name: string; status: string; summary: string }>
    reportedChecks?: Array<{ name: string; status: string; summary: string }>
    verifiedChecks?: Array<{
      name: string
      status: string
      summary: string
      command: string[]
      exitCode: number | null
      workspaceRevision: string
      outputSummary: string
    }>
  }
}

export type GraphReview = {
  reviewId: string
  nodeId: string
  attemptId: string
  reviewerKind: 'deterministic' | 'peer' | 'lead' | 'human'
  outcome: 'pass' | 'fail' | 'revise' | 'needs_human'
  summary: string
  evidence?: string[]
  repairInstructions?: string
  createdAt: string
}

export type GraphNodeProjection = {
  node: GraphPlanNode
  status: GraphNodeStatus
  attempts: GraphAttempt[]
  acceptedAttemptId?: string
  loopIteration: number
  lastTransitionReason?: string
  lastProgress?: {
    percent?: number
    summary: string
    phase?: string
    createdAt: string
  }
}

export type GraphMessage = {
  id: string
  sender: { kind: string; nodeId?: string }
  recipients: Array<{ kind: string; nodeId?: string }>
  type: string
  priority: string
  summary: string
  details?: string
  status: string
  createdAt: string
}

export type GraphSupervisionLiveness =
  | 'idle'
  | 'waiting_for_lead'
  | 'active_review'
  | 'retry_scheduled'
  | 'needs_attention'

export type GraphSupervisionItem = {
  obligationId: string
  pendingAction:
    | 'review_required'
    | 'repair_required'
    | 'stall'
    | 'conflict'
    | 'budget'
    | 'help'
    | 'recovery'
    | 'completion'
    | 'user_steering'
    | 'worker_report'
    | 'scheduler_error'
  nodeIds: string[]
  liveness: Exclude<GraphSupervisionLiveness, 'idle'>
  retryCount: number
  noProgressCount: number
  nextWakeAt?: string
  lastWakeAt?: string
  lastError?: string
  attentionReason?: string
  canWake: boolean
}

export type GraphSupervisionProjection = {
  version: 1
  runId: string
  lastEventSeq: number
  leadActive: boolean
  liveness: GraphSupervisionLiveness
  pendingActions: GraphSupervisionItem[]
  peerReviewLeases?: Array<{
    nodeId: string
    attemptId: string
    leaseUntil: string
  }>
  canWake: boolean
  updatedAt: string
}

export type GraphRun = {
  version: 1
  id: string
  projectId: string
  threadId: string
  sourceTurnId: string
  status: GraphRunStatus
  currentRevision: number
  plans: Array<{
    version: 1
    revision: number
    title: string
    goal: string
    workspaceRoot: string
    phases: GraphPhase[]
    nodes: GraphPlanNode[]
    edges: GraphPlanEdge[]
    completionNodeIds: string[]
    strategy?: {
      kind: 'fanout_join' | 'pipeline' | 'bounded_loop' | 'state_machine' | 'hybrid'
      selectedBy: 'lead' | 'user' | 'host'
      rationale?: string
    }
    createdAt: string
  }>
  nodes: Record<string, GraphNodeProjection>
  reviews: GraphReview[]
  messages: GraphMessage[]
  artifacts: GraphArtifactReference[]
  cleanup: Array<{
    id: string
    attemptId?: string
    resourceKind: 'worker' | 'lease' | 'worktree' | 'artifact' | 'journal'
    resourceId: string
    state: 'pending' | 'running' | 'completed' | 'failed' | 'orphaned' | 'preserved'
    retryCount: number
    lastError?: string
    updatedAt: string
  }>
  steering: Array<{
    steeringId: string
    target: { kind: string; nodeId?: string; phaseId?: string; attemptId?: string }
    text: string
    status: string
    createdAt: string
  }>
  supervision?: GraphSupervisionProjection
  budget: {
    limits: {
      maxWallTimeMs: number
      maxAttemptsPerNode: number
    }
    attempts: number
    revisions: number
    loopIterations: number
    elapsedMs: number
    totalTokens: number
    messages: number
    artifactBytes: number
    warningKinds: string[]
    closed: boolean
  }
  summary?: {
    finalAnswer: string
    unresolvedRisks: string[]
    changedFiles: string[]
    totalTokens: number
    totalElapsedMs: number
    completedAt: string
  }
  lastEventSeq: number
  createdAt: string
  updatedAt: string
}

export type GraphEventEnvelope = {
  version: 1
  eventId: string
  runId: string
  threadId: string
  graphSeq: number
  graphRevision: number
  timestamp: string
  event: {
    type: string
    payload: Record<string, unknown>
  }
}

export type GraphChildActivity = {
  phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
  label: string
  toolName?: string
  startedAt: string
  updatedAt: string
}

export type GraphChildRuntime = {
  childId: string
  parentThreadId: string
  parentTurnId: string
  childSeq?: number
  eventSeq?: number
  label?: string
  profile?: string
  profileName?: string
  model?: string
  providerId?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  activity?: GraphChildActivity
  toolInvocations?: number
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
  startedAt?: string
  updatedAt: string
}

export type GraphDelegationDiagnostics = {
  enabled: boolean
  active: number
  childRuns: Array<{
    id: string
    parentThreadId: string
    parentTurnId: string
    childSeq?: number
    label?: string
    profile?: string
    profileSnapshot?: { name?: string }
    model?: string
    providerId?: string
    status: GraphChildRuntime['status']
    activity?: GraphChildActivity
    toolInvocations?: number
    durationMs?: number
    queuedMs?: number
    usage?: { totalTokens?: number }
    startedAt?: string
    updatedAt: string
  }>
}

export type GraphPatchOperation =
  | {
      op: 'rebind_node'
      nodeId: string
      assignment:
        | { kind: 'existing'; profileId: string; profileVersion?: number }
        | {
            kind: 'ephemeral'
            name: string
            description?: string
            systemPrompt: string
            model?: string
            providerId?: string
            reasoningEffort?: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
            toolPolicy?: 'readOnly' | 'inherit'
            allowedTools?: string[]
            blockedTools?: string[]
            allowedSkills?: string[]
            blockedSkills?: string[]
            allowedMcpServers?: string[]
            blockedMcpServers?: string[]
          }
    }
  | { op: 'add_node'; node: Record<string, unknown> }
  | {
      op: 'replace_node'
      nodeId: string
      replacement: Record<string, unknown>
      supersedesAcceptedWork?: boolean
    }
  | { op: 'add_edge'; edge: Record<string, unknown> }
  | { op: 'remove_edge'; edgeId: string }
  | { op: 'update_budget'; budget: Record<string, unknown> }
  | { op: 'update_review'; nodeId: string; review: Record<string, unknown> }

export type GraphArtifactPage = {
  reference: GraphRun['artifacts'][number]
  meta: {
    byteSize: number
    lineCount: number
    mimeType: string
  }
  content: string
  range: {
    offset?: number
    length?: number
    startLine?: number
    endLine?: number
  }
  truncated: boolean
  nextOffset?: number
  nextStartLine?: number
}

export type ProjectIdentity = {
  version: 1
  projectId: string
  canonicalWorkspaceRoot: string
  source: 'git_remote' | 'git_common_dir' | 'workspace_root'
  resolvedAt: string
}

export type GraphAgentProfile = {
  version: 1
  profileId: string
  profileVersion: number
  origin: 'builtin' | 'user' | 'ephemeral' | 'learned'
  lifecycle: 'candidate' | 'probation' | 'trusted' | 'dormant' | 'archived' | 'deleted'
  name: string
  description: string
  systemPrompt: string
  model: string
  providerId: string
  reasoningEffort: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  provenanceEpisodeIds: string[]
  aliasProfileIds?: string[]
  createdAt: string
  capabilities: {
    taskTypes: string[]
    capabilityTags: string[]
    toolPolicy: 'readOnly' | 'inherit'
    allowedTools: string[]
    blockedTools: string[]
    allowedSkills: string[]
    blockedSkills: string[]
    allowedMcpServers: string[]
    blockedMcpServers: string[]
    approvalPolicy: 'always' | 'on-request' | 'untrusted' | 'never' | 'auto' | 'suggest'
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' | 'external-sandbox'
    readScopes: string[]
    writeScopes: string[]
    networkAllowed: boolean
    maximumRiskClass: string
  }
}

export type GraphAgentEvidence = {
  evidenceId: string
  profileId: string
  source: string
  outcome: 'positive' | 'negative' | 'neutral'
  quality: number
  costTokens: number
  latencyMs: number
  taskFit: number
  summary: string
  createdAt: string
}

export type GraphAgentScore = {
  version: 1
  profileId: string
  profileVersion: number
  taskFit: number
  quality: number
  trust: number
  freshness: number
  efficiency: number
  confidence: number
  availability: number
  load: number
  aggregate: number
  evidenceCount: number
  missedOpportunities: number
  computedAt: string
}

export type GraphGovernanceAudit = {
  version: 1
  auditId: string
  projectId: string
  actor: 'user' | 'system' | 'learning'
  action: string
  targetKind: string
  targetId: string
  reason: string
  createdAt: string
}

export type GraphLearningCandidate = {
  candidateId: string
  kind: 'agent_profile' | 'skill' | 'graph_recipe'
  status: 'draft' | 'approved' | 'rejected' | 'probation' | 'promoted' | 'rolled_back' | 'merged' | 'deleted'
  name: string
  summary: string
  draft: Record<string, unknown>
  requestedCapabilities?: GraphAgentProfile['capabilities']
  provenanceEpisodeIds: string[]
  evaluationPlan: string[]
  rollback: {
    targetProfileId?: string
    targetVersion?: number
    instructions: string
  }
  updatedAt: string
}

export type GraphLearningJob = {
  jobId: string
  trigger: 'schedule' | 'run_count' | 'evidence_threshold' | 'manual'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  inputEpisodeIds: string[]
  outputCandidateIds: string[]
  error?: string
  createdAt: string
}
