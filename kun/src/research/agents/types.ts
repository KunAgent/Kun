/**
 * [INPUT]: 依赖 core/types 的 brief、frame、budget、plan 和 evidence/types 的证据记录
 * [OUTPUT]: 对外提供 PlanAgent、ResearchSupervisor、CoverageEvaluator、Worker、Writer 等 agent 接口
 * [POS]: research/agents 的接口边界，约束 runtime 与各 agent 节点之间的数据形状
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  FrameRevision,
  HypothesisEvidenceBinding,
  HypothesisTest,
  HypothesisUpdate,
  QualityVerdict,
  ResearchConvergenceVerdict,
  ResearchBrief,
  ResearchBudget,
  ResearchFrame,
  ResearchGapVerdict,
  ResearchHypothesis,
  ResearchPlan,
  ResearchTask
} from '../core/types.js'
import type { AtomicClaim, CitationBinding, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'

export type ConflictCandidate = {
  id: string
  claimIds: string[]
  description: string
}

export type WorkerResult = {
  taskId: string
  questionIds: string[]
  sources: SourceRecord[]
  evidenceSpans: EvidenceSpan[]
  claims: AtomicClaim[]
  notes: ResearchNote[]
  unresolvedQuestions: string[]
  conflicts: ConflictCandidate[]
  suggestedNextQueries: string[]
}

export type PlanAgentInput = {
  runId: string
  brief: ResearchBrief
  frame: ResearchFrame
  budget: ResearchBudget
  nowIso: string
}

export type PlanAgent = {
  createPlan(input: PlanAgentInput): Promise<ResearchPlan>
}

export type ResearchSupervisorInput = PlanAgentInput

export type ResearchSupervisor = {
  createInitialPlan(input: ResearchSupervisorInput): Promise<ResearchPlan>
}

export type HypothesisProposerInput = {
  runId: string
  brief: ResearchBrief
  frame: ResearchFrame
  budget: ResearchBudget
  nowIso: string
}

export type HypothesisProposer = {
  propose(input: HypothesisProposerInput): Promise<ResearchHypothesis[]>
}

export type TestDesignerInput = HypothesisProposerInput & {
  hypotheses: ResearchHypothesis[]
}

export type TestDesigner = {
  design(input: TestDesignerInput): Promise<HypothesisTest[]>
}

export type EvidenceBinderInput = {
  runId: string
  hypotheses: ResearchHypothesis[]
  claims: AtomicClaim[]
  evidenceSpans: EvidenceSpan[]
  notes: ResearchNote[]
  nowIso: string
}

export type EvidenceBinder = {
  bind(input: EvidenceBinderInput): Promise<HypothesisEvidenceBinding[]>
}

export type HypothesisAssessorInput = {
  runId: string
  hypotheses: ResearchHypothesis[]
  bindings: HypothesisEvidenceBinding[]
  claims: AtomicClaim[]
  evidenceSpans: EvidenceSpan[]
  nowIso: string
}

export type HypothesisAssessment = {
  hypotheses: ResearchHypothesis[]
  updates: HypothesisUpdate[]
}

export type HypothesisAssessor = {
  assess(input: HypothesisAssessorInput): Promise<HypothesisAssessment>
}

export type FrameRevisionGateInput = {
  runId: string
  brief: ResearchBrief
  frame: ResearchFrame
  hypotheses: ResearchHypothesis[]
  updates: HypothesisUpdate[]
  bindings: HypothesisEvidenceBinding[]
  nowIso: string
}

export type FrameRevisionGate = {
  revise(input: FrameRevisionGateInput): Promise<{ frame: ResearchFrame; revision?: FrameRevision }>
}

export type CoverageEvaluatorInput = {
  runId: string
  brief: ResearchBrief
  frame: ResearchFrame
  plan: ResearchPlan
  budget: ResearchBudget
  roundIndex: number
  sources: SourceRecord[]
  evidenceSpans: EvidenceSpan[]
  claims: AtomicClaim[]
  notes: ResearchNote[]
  nowIso: string
}

export type CoverageEvaluator = {
  evaluate(input: CoverageEvaluatorInput): Promise<ResearchGapVerdict>
}

export type ConvergenceAnalyzerInput = CoverageEvaluatorInput & {
  hypotheses: ResearchHypothesis[]
  tests: HypothesisTest[]
  bindings: HypothesisEvidenceBinding[]
  updates: HypothesisUpdate[]
  gapVerdict: ResearchGapVerdict
}

export type ConvergenceAnalyzer = {
  analyze(input: ConvergenceAnalyzerInput): Promise<ResearchConvergenceVerdict>
}

export type ResearchTaskWorkerInput = {
  runId: string
  task: ResearchTask
  brief: ResearchBrief
  frame: ResearchFrame
  budget: ResearchBudget
}

export type ResearchTaskWorker = {
  runTask(input: ResearchTaskWorkerInput): Promise<WorkerResult>
  hasSearchCapability?(): boolean
  hasLocalEvidenceCapability?(): boolean
}

export type SynthesisWriterInput = {
  runId: string
  brief: ResearchBrief
  frame: ResearchFrame
  plan: ResearchPlan
  budget: ResearchBudget
  hypotheses?: ResearchHypothesis[]
  hypothesisTests?: HypothesisTest[]
  hypothesisEvidenceBindings?: HypothesisEvidenceBinding[]
  hypothesisUpdates?: HypothesisUpdate[]
  convergenceVerdicts?: ResearchConvergenceVerdict[]
  gapVerdicts?: ResearchGapVerdict[]
  sources: SourceRecord[]
  evidenceSpans: EvidenceSpan[]
  claims: AtomicClaim[]
  notes: ResearchNote[]
  revision?: {
    attempt: number
    maxAttempts: number
    previousVerdict: QualityVerdict
  }
  nowIso: string
}

export type DraftReport = {
  markdown: string
  claimIds: string[]
  generatedAt: string
}

export type SynthesisWriter = {
  writeDraft(input: SynthesisWriterInput): Promise<DraftReport>
}

export type CitationResolutionInput = {
  draft: DraftReport
  reportPath: string
  sources: SourceRecord[]
  evidenceSpans: EvidenceSpan[]
  claims: AtomicClaim[]
  nowIso: string
}

export type CitationResolution = {
  markdown: string
  bindings: CitationBinding[]
  unresolvedCitationIds: string[]
  generatedAt: string
}
