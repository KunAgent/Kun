/**
 * [INPUT]: 依赖 research runtime、agents、verification 对 DeepResearch 状态和预算的共享契约
 * [OUTPUT]: 对外提供 ResearchRun、ResearchBudget、ResearchPlan、GapVerdict 等核心类型和默认预算
 * [POS]: research/core 的类型中心，被 runtime、agents、routes、renderer DTO 间接消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
  createdAt: string
}

export type ResearchScopeClarification = {
  id: string
  message: string
  createdAt: string
}

export type ResearchSourcePolicy = {
  allowedSourceTypes: ResearchSourceType[]
  minSourceCount?: number
  maxSourceCount?: number
  requireCitations?: boolean
}

export type ResearchBudget = {
  preset: ResearchPreset
  reasoningEffort: ResearchReasoningEffort
  maxWorkers: number
  maxSubagents: number
  maxRounds: number
  maxResearchRounds: number
  maxSynthesisRetries: number
  minSources: number
  targetSources: number
  maxSources: number
  timeoutMs: number
}

export type ResearchQuestion = {
  id: string
  text: string
  priority: ResearchPriority
  required: boolean
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
  maxResearchRounds: number
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
}

export type ResearchGapStatus = 'sufficient' | 'need_more' | 'budget_exhausted'

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
  model?: string
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
  blockingIssues: string[]
  warnings: string[]
  recommendedFixes: string[]
  judgedAt: string
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
  scope: ResearchScopeAssessment
  scopeClarifications: ResearchScopeClarification[]
  scopeConfirmation?: ScopeConfirmation
  brief: ResearchBrief
  frame: ResearchFrame
  briefHash: string
  approval?: BriefApproval
  budget: ResearchBudget
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
  artifacts: ResearchArtifactPaths
  createdAt: string
  updatedAt: string
}

export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = {
  preset: 'standard',
  reasoningEffort: 'high',
  maxWorkers: 4,
  maxSubagents: 5,
  maxRounds: 3,
  maxResearchRounds: 2,
  maxSynthesisRetries: 3,
  minSources: 15,
  targetSources: 30,
  maxSources: 45,
  timeoutMs: 10 * 60 * 1000
}
