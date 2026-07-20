/**
 * [INPUT]: 依赖 research runtime、agents、verification 对 DeepResearch 状态和预算的共享契约
 * [OUTPUT]: 对外提供 ResearchRun、ResearchBudget、含指标焦点/时间窗的问题证据契约、含章节 ID/章节问题/定向对比对象所有权的 ResearchPlan、默认容纳完整必答章节拆分的研究预算、记录合格证据门槛与已穷尽问题的 GapVerdict、支持持久化章节排除 claim、硬范围代表 claim 与 evidence_gap 模式的 ReportBlueprint、SectionEvidenceMap、搜索/抓取/抽取 WebAudit、按阶段查询剩余额度和可释放模型预留等核心类型
 * [POS]: research/core 的类型中心，被 runtime、agents、routes、renderer DTO 间接消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { UsageSnapshot } from '../../contracts/usage.js'

export const RESEARCH_RUN_STATUSES = [
  'scoping',
  'awaiting_brief_confirm',
  'planning',
  'researching',
  'gap_checking',
  'synthesizing',
  'resolving_citations',
  'verifying',
  'writing',
  'done',
  'failed',
  'cancelled',
  'paused',
  'research_unavailable'
] as const

export type ResearchRunStatus = typeof RESEARCH_RUN_STATUSES[number]

export type ResearchSourceType = 'web' | 'local_file' | 'pdf' | 'lark_doc' | 'paper'
export type ResearchPriority = 'high' | 'medium' | 'low'
export type ResearchConfidence = 'high' | 'medium' | 'low'
export type ResearchReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'
export type ResearchPreset = 'quick' | 'standard' | 'deep'
export type ResearchComplexity = 'simple' | 'moderate' | 'complex'

export type ResearchScopeQuestion = {
  id: string
  question: string
  why: string
  options: string[]
  required: boolean
}

export type ResearchScopeAssessment = {
  understood: boolean
  coreQuestionsConfirmed: boolean
  readyForBrief: boolean
  assessmentSource?: 'model' | 'deterministic_fallback'
  assessmentModel?: string
  summary: string
  mainContradiction: string
  assumptions: string[]
  clarificationQuestions: ResearchScopeQuestion[]
  confirmationChecklist: string[]
  modelUsage?: ResearchModelUsageRecord[]
  createdAt: string
}

export type ResearchScopeClarification = {
  id: string
  message: string
  createdAt: string
}

export type ResearchSourcePolicy = {
  allowedSourceTypes: ResearchSourceType[]
  allowedDomains?: string[]
  allowedPublishers?: string[]
  preferredDomains?: string[]
  minSourceCount?: number
  maxSourceCount?: number
  requireCitations?: boolean
}

export type ResearchBudget = {
  preset: ResearchPreset
  reasoningEffort: ResearchReasoningEffort
  maxWorkers: number
  maxSubagents: number
  /** @deprecated Accepted from older clients but ignored by progress-driven research. */
  maxRounds?: number
  /** @deprecated Accepted from older clients but ignored by progress-driven research. */
  maxResearchRounds?: number
  /** @deprecated Accepted from older clients but ignored by progress-driven synthesis. */
  maxSynthesisRetries?: number
  minSources: number
  targetSources: number
  maxSources: number
  maxModelCalls: number
  maxTotalTokens: number
  timeoutMs: number
}

export type ResearchExecutionControl = {
  signal: AbortSignal
  model?: string
  providerId?: string
  canReserveModelCall(stage: ResearchModelUsageStage, estimatedTokens?: number): boolean
  reserveModelCall(stage: ResearchModelUsageStage, estimatedTokens?: number): ResearchModelCallReservation
  recordModelUsage(record: ResearchModelUsageRecord, reservation?: ResearchModelCallReservation): Promise<void>
  finishModelCall(reservation: ResearchModelCallReservation, options?: { chargeEstimateOnMissing?: boolean }): Promise<void>
  releaseModelCall?(reservation: ResearchModelCallReservation): Promise<void>
  remainingTokenBudget(stage?: ResearchModelUsageStage): number
  remainingModelCalls(stage?: ResearchModelUsageStage): number
  recordWebAudit(record: Omit<ResearchWebAuditRecord, 'id' | 'recordedAt'>): Promise<void>
}

export type ResearchModelCallReservation = {
  id: string
  stage: ResearchModelUsageStage
  estimatedTokens: number
}

export type ResearchModelBudgetUsage = {
  modelCalls: number
  totalTokens: number
  costUsd: number
  costCny: number
}

export type ResearchQuestion = {
  id: string
  text: string
  priority: ResearchPriority
  required: boolean
}

export type ResearchQuestionAnswerType =
  | 'fact'
  | 'comparison'
  | 'cause'
  | 'trend'
  | 'risk'
  | 'recommendation'
  | 'evaluation'

export type ResearchEvidenceRole = 'supports' | 'contradicts' | 'context'

export type ResearchQuestionContract = {
  questionId: string
  question: string
  answerType: ResearchQuestionAnswerType
  required: boolean
  binary: boolean
  requiresSupportingEvidence: boolean
  focusTerms?: string[]
  timeScope?: {
    direction: 'past' | 'future'
    startYear: number
    endYear: number
  }
}

export type ResearchEvidenceAssignment = {
  questionId: string
  claimId: string
  role: ResearchEvidenceRole
  relevance: number
  explanation: string
  source: 'deterministic' | 'model_validated'
}

export type ResearchBrief = {
  id: string
  version: number
  topic: string
  userIntent: string
  userClarifications?: string[]
  targetAudience?: string
  outputFormat: string
  sourcePolicy: ResearchSourcePolicy
  successCriteria: string[]
  constraints: string[]
  createdAt: string
  updatedAt?: string
}

export type ResearchFrame = {
  coreResearchThread: string
  centralQuestion: string
  decisionToSupport?: string
  targetUserOrActor?: string
  coreTask?: string
  currentPath?: string[]
  keyFriction?: string[]
  interventionHypothesis?: string
  alternativesToCompare?: string[]
  coreQuestions: ResearchQuestion[]
  investigationPath: string[]
  evidenceNeeded: string[]
  disconfirmingEvidenceNeeded: string[]
  nonGoals: string[]
}

export type ResearchReportContractSection = {
  id: string
  title: string
  required: boolean
  questionIds: string[]
  limitationFallback: string
}

export type ResearchReportContract = {
  requiredSections: ResearchReportContractSection[]
  createdAt: string
}

export type ResearchCoverageRequirement = {
  id: string
  kind: 'section' | 'dimension' | 'named_item' | 'comparison_target' | 'time_window' | 'forecast_horizon'
  label: string
  aliases: string[]
  required: boolean
  questionIds: string[]
  sectionIds: string[]
  minClaims: number
  minIndependentSources: number
  minStrongSources: number
  onMissing: 'repair' | 'block' | 'allow_limitation'
}

export type ResearchCoverageGroup = {
  id: string
  relation: 'all_of' | 'any_of'
  requirementIds: string[]
}

export type ResearchCoverageContract = {
  requirements: ResearchCoverageRequirement[]
  groups: ResearchCoverageGroup[]
  createdAt: string
}

export type ResearchReportType = 'explanatory' | 'comparison' | 'decision' | 'market' | 'investigation'

export type ResearchArgumentChain = {
  conclusion: string
  claimIds: string[]
  inference: string
  conditions: string[]
  counterClaimIds: string[]
}

export type ResearchReportBlueprintSection = {
  id: string
  title: string
  purpose: string
  questionIds: string[]
  claimIds: string[]
  coverageClaimIds?: string[]
  excludedClaimIds?: string[]
  contextClaimIds?: string[]
  evidenceMode?: 'direct' | 'conditional_application' | 'evidence_gap'
  sourceIds: string[]
  argument: ResearchArgumentChain
  limitations: string[]
  questionContracts?: ResearchQuestionContract[]
  evidenceAssignments?: ResearchEvidenceAssignment[]
  evidenceFingerprint?: string
}

export type ResearchReportBlueprint = {
  reportType: ResearchReportType
  title: string
  directAnswer: string
  thesis: string
  sections: ResearchReportBlueprintSection[]
  createdAt: string
  modelUsage?: ResearchModelUsageRecord[]
}

export type SectionEvidenceStatus = 'covered' | 'weak' | 'missing'

export type SectionEvidenceMapEntry = {
  sectionId: string
  title: string
  required: boolean
  questionIds: string[]
  claimIds: string[]
  coverageClaimIds?: string[]
  contextClaimIds?: string[]
  evidenceMode?: 'direct' | 'conditional_application' | 'evidence_gap'
  sourceIds: string[]
  status: SectionEvidenceStatus
  limitations: string[]
  questionContracts?: ResearchQuestionContract[]
  evidenceAssignments?: ResearchEvidenceAssignment[]
  evidenceFingerprint?: string
}

export type ResearchModelUsageStage = 'scope' | 'worker' | 'source_strategy' | 'web_search' | 'web_extraction' | 'architect' | 'writer' | 'editor' | 'judge'

export type ResearchModelUsageRecord = {
  stage: ResearchModelUsageStage
  model: string
  turnId: string
  taskId?: string
  attempt?: number
  estimated?: boolean
  usage: UsageSnapshot
}

export type ResearchWebAuditRecord = {
  id: string
  taskId: string
  phase: 'search' | 'fetch' | 'extract'
  status: 'success' | 'empty' | 'filtered' | 'fallback' | 'failed'
  provider?: string
  query?: string
  url?: string
  rawResultCount?: number
  acceptedResultCount?: number
  error?: string
  recordedAt: string
}

export type BriefApproval = {
  briefVersion: number
  approvedByUser: true
  approvedAt: string
  approvalMessageId?: string
  briefHash: string
  source: 'button' | 'explicit_message' | 'api'
}

export type ScopeConfirmation = {
  confirmedByUser: true
  confirmedAt: string
  confirmationMessageId?: string
  source: 'button' | 'explicit_message' | 'api'
}

export type ResearchTaskStatus = 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'cancelled'

export type ResearchHypothesisStatus = 'candidate' | 'leading' | 'weakened' | 'rejected' | 'merged'

export type ResearchHypothesis = {
  id: string
  statement: string
  explains: string[]
  assumptions: string[]
  predictions: string[]
  falsifiers: string[]
  discriminatingQuestions: string[]
  supportingClaims: string[]
  opposingClaims: string[]
  uncertainty: string[]
  status: ResearchHypothesisStatus
  confidence: ResearchConfidence
}

export type ResearchValueOfInformation = {
  uncertaintyImportance: number
  discriminativePower: number
  decisionImpact: number
  sourceFeasibility: number
  estimatedCost: number
  score: number
  decisionRelevanceQuestion: string
}

export type HypothesisTest = {
  id: string
  hypothesisId: string
  questionIds: string[]
  testQuestion: string
  expectedEvidenceIfTrue: string
  evidenceThatWouldWeakenIt: string
  preferredSources: ResearchSourceType[]
  priority: ResearchPriority
  valueOfInformation: ResearchValueOfInformation
}

export type HypothesisEvidenceBinding = {
  id: string
  hypothesisId: string
  evidenceSpanId: string
  claimId?: string
  relation: 'supports' | 'weakens' | 'qualifies' | 'irrelevant'
  strength: 'weak' | 'medium' | 'strong'
  reason: string
  createdAt: string
}

export type HypothesisUpdate = {
  hypothesisId: string
  previousStatus: ResearchHypothesisStatus
  newStatus: ResearchHypothesisStatus
  confidenceChange: 'up' | 'down' | 'same'
  updateReason: string
  keySupportingEvidenceIds: string[]
  keyOpposingEvidenceIds: string[]
  remainingUncertainty: string[]
  createdAt: string
}

export type FrameRevision = {
  previousCentralQuestion: string
  revisedCentralQuestion: string
  reason: string
  evidenceIds: string[]
  preservedUserConstraints: string[]
  changedInvestigationPath: string[]
  createdAt: string
}

export type ResearchConvergenceVerdict = {
  id: string
  roundIndex: number
  readyToWrite: boolean
  shouldFail: boolean
  reason: string
  leadingHypothesisIds: string[]
  unresolvedHighValueTestIds: string[]
  highValueOpenQuestions: string[]
  wouldFurtherResearchChangeConclusion: boolean
  recommendedNextTaskIds: string[]
  createdAt: string
}

export type ResearchTask = {
  id: string
  questionIds: string[]
  reportSectionIds?: string[]
  reportQuestionIds?: string[]
  comparisonTargets?: string[]
  hypothesisIds?: string[]
  testIds?: string[]
  objective: string
  expectedEvidence: string[]
  sourceTypes: ResearchSourceType[]
  searchHints: string[]
  maxSources: number
  priority: ResearchPriority
  valueOfInformation?: ResearchValueOfInformation
  status: ResearchTaskStatus
}

export type ResearchPlan = {
  id: string
  runId: string
  rationale: string
  supervisor?: ResearchSupervisorSummary
  tasks: ResearchTask[]
  createdAt: string
}

export type ResearchSupervisorSummary = {
  preset: ResearchPreset
  reasoningEffort: ResearchReasoningEffort
  complexity: ResearchComplexity
  parallelism: number
  /** @deprecated Present only when hydrating an older plan. */
  maxResearchRounds?: number
  targetSourceCount: number
  rationale: string
}

export type ResearchQuestionCoverage = {
  questionId: string
  question: string
  required: boolean
  priority: ResearchPriority
  covered: boolean
  requiredSourceCount: number
  requiredStrongWebSourceCount: number
  sourceCount: number
  strongWebSourceCount: number
  requiredClaimCount: number
  claimCount: number
  criticalClaimCount: number
  noteCount: number
  missingEvidence: string[]
}

export type ResearchCoverageMatrix = {
  totalSourceCount: number
  strongWebSourceCount: number
  requiredQuestionCount: number
  coveredRequiredQuestionCount: number
  disconfirmingEvidenceCovered: boolean
  comparisonTargets: Array<{
    target: string
    sourceCount: number
    covered: boolean
  }>
  explicitRequirements?: Array<{
    requirementId: string
    label: string
    kind: ResearchCoverageRequirement['kind']
    questionIds?: string[]
    sourceCount: number
    claimCount: number
    strongSourceCount?: number
    requiredSourceCount?: number
    requiredClaimCount?: number
    requiredStrongSourceCount?: number
    covered: boolean
    onMissing: ResearchCoverageRequirement['onMissing']
  }>
}

export type ResearchGapStatus =
  | 'sufficient'
  | 'ready_with_limitations'
  | 'need_more'
  | 'needs_research_repair'
  | 'budget_exhausted'
  | 'unanswerable'

export type ResearchGapVerdict = {
  id: string
  roundIndex: number
  status: ResearchGapStatus
  confidence: ResearchConfidence
  stopReason: string
  coverageByQuestion: ResearchQuestionCoverage[]
  coverageMatrix: ResearchCoverageMatrix
  missingEvidence: string[]
  followUpTasks: ResearchTask[]
  exhaustedQuestionIds?: string[]
  createdAt: string
}

export type ResolvedReport = {
  markdown: string
  citationBindingIds: string[]
  unresolvedCitationIds: string[]
  generatedAt: string
}

export type VerificationIssue = {
  code: string
  message: string
  severity: 'blocking' | 'warning'
}

export type QualityVerdict = {
  pass: boolean
  scores: {
    requirementsAlignment: number
    answersCoreQuestions: number
    followsCoreResearchThread: number
    reportCompleteness: number
    citationAccuracy: number
    evidenceCoverage: number
    sourceQuality: number
    conflictHandling: number
    uncertaintyCalibration: number
    writingQuality: number
    llmJudgeOverall: number
  }
  llmJudge?: QualityJudgeVerdict
  blockingIssues: string[]
  warnings: string[]
  recommendedFixes: string[]
  issues: VerificationIssue[]
  verifiedAt: string
}

export type QualityJudgeVerdict = {
  source: 'llm_judge' | 'heuristic_fallback'
  failureKind?: 'report_quality' | 'judge_unavailable'
  model?: string
  modelUsage?: ResearchModelUsageRecord[]
  pass: boolean
  scores: {
    requirementsAlignment: number
    answersConfirmedScope: number
    followsResearchFrame: number
    reportCompleteness: number
    evidenceUse: number
    citationFaithfulness: number
    uncertaintyCalibration: number
    writingQuality: number
    overall: number
  }
  rationale: string
  issues?: QualityJudgeIssue[]
  blockingIssues: string[]
  warnings: string[]
  recommendedFixes: string[]
  judgedAt: string
}

export type QualityJudgeIssue = {
  code: string
  category: 'scope' | 'evidence' | 'citation' | 'coverage' | 'writing'
  message: string
  severity: 'blocking' | 'warning'
  occurrenceId?: string
  claimId?: string
  unsupportedFragment?: string
  evidenceQuote?: string
}

export type ResearchArtifactPaths = {
  rootDir: string
  reportPath: string
  briefPath: string
  planPath: string
  sourcesPath: string
  notesPath: string
  machineDir: string
  runJsonPath: string
  evidenceJsonlPath: string
  claimsJsonlPath: string
  citationsJsonlPath: string
  eventsJsonlPath: string
}

export type ResearchRun = {
  id: string
  title: string
  slug: string
  status: ResearchRunStatus
  model?: string
  providerId?: string
  scope: ResearchScopeAssessment
  scopeClarifications: ResearchScopeClarification[]
  scopeConfirmation?: ScopeConfirmation
  brief: ResearchBrief
  frame: ResearchFrame
  reportContract?: ResearchReportContract
  coverageContract?: ResearchCoverageContract
  reportBlueprint?: ResearchReportBlueprint
  briefHash: string
  approval?: BriefApproval
  budget: ResearchBudget
  modelBudgetUsage: ResearchModelBudgetUsage
  attemptBudgetBaseline?: Pick<ResearchModelBudgetUsage, 'modelCalls' | 'totalTokens'>
  webAudit?: ResearchWebAuditRecord[]
  plan?: ResearchPlan
  hypotheses?: ResearchHypothesis[]
  hypothesisTests?: HypothesisTest[]
  hypothesisEvidenceBindings?: HypothesisEvidenceBinding[]
  hypothesisUpdates?: HypothesisUpdate[]
  frameRevisions?: FrameRevision[]
  convergenceVerdicts?: ResearchConvergenceVerdict[]
  gapVerdicts?: ResearchGapVerdict[]
  verification?: QualityVerdict
  draftReportAvailable?: boolean
  terminalReason?: string
  executionDeadlineAt?: string
  artifacts: ResearchArtifactPaths
  createdAt: string
  updatedAt: string
}

export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = {
  preset: 'standard',
  reasoningEffort: 'high',
  maxWorkers: 3,
  maxSubagents: 16,
  minSources: 1,
  targetSources: 15,
  maxSources: 100,
  maxModelCalls: 128,
  maxTotalTokens: 4_000_000,
  timeoutMs: 4 * 60 * 60 * 1000
}
