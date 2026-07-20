/**
 * [INPUT]: 依赖 core/types 的 brief、frame、budget、plan、Report/CoverageContract、ReportBlueprint、SectionEvidenceMap 和 evidence/types 的证据记录
 * [OUTPUT]: 对外提供 Supervisor、携带当前时间与既有来源上下文的 Worker、CoverageEvaluator、ReportArchitect、Writer、分章 DraftReport、ResearchEditor 等 agent 接口
 * [POS]: research/agents 的接口边界，约束 runtime、WritableGate 与研究编辑流水线之间的数据形状
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  FrameRevision,
  HypothesisEvidenceBinding,
  HypothesisTest,
  HypothesisUpdate,
  QualityVerdict,
  ResearchConvergenceVerdict,
  ResearchCoverageContract,
  ResearchBrief,
  ResearchBudget,
  ResearchFrame,
  ResearchGapVerdict,
  ResearchHypothesis,
  ResearchExecutionControl,
  ResearchModelUsageRecord,
  ResearchPlan,
  ResearchReportBlueprint,
  ResearchReportContract,
  SectionEvidenceMapEntry,
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
  modelUsage?: ResearchModelUsageRecord[]
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

export type ResearchSupervisorInput = PlanAgentInput & {
  reportContract?: ResearchReportContract
}

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
  coverageContract?: ResearchCoverageContract
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
  nowIso?: string
  task: ResearchTask
  brief: ResearchBrief
  frame: ResearchFrame
  budget: ResearchBudget
  existingSourceUrls?: string[]
  execution?: ResearchExecutionControl
}

export type ResearchTaskWorker = {
  runTask(input: ResearchTaskWorkerInput): Promise<WorkerResult>
  recommendedConcurrency?(): number
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
  reportContract?: ResearchReportContract
  coverageContract?: ResearchCoverageContract
  reportBlueprint?: ResearchReportBlueprint
  sectionEvidenceMap?: SectionEvidenceMapEntry[]
  sources: SourceRecord[]
  evidenceSpans: EvidenceSpan[]
  claims: AtomicClaim[]
  notes: ResearchNote[]
  execution?: ResearchExecutionControl
  retryFeedback?: string
  revision?: {
    attempt: number
    /** @deprecated Compatibility-only hint; the synthesis loop has no fixed attempt limit. */
    maxAttempts?: number
    previousVerdict: QualityVerdict
    previousDraftMarkdown?: string
    targets?: {
      sectionIds: string[]
      rewriteClosing: boolean
    }
  }
  nowIso: string
}

export type DraftReport = {
  markdown: string
  claimIds: string[]
  generatedAt: string
  diagnostic?: boolean
  sectioned?: boolean
  modelUsage?: ResearchModelUsageRecord[]
}

export type SynthesisWriter = {
  writeDraft(input: SynthesisWriterInput): Promise<DraftReport>
}

export type ReportArchitectInput = Omit<SynthesisWriterInput, 'retryFeedback' | 'revision'>

export type ReportArchitect = {
  createBlueprint(input: ReportArchitectInput): Promise<ResearchReportBlueprint>
}

export type ResearchEditorInput = SynthesisWriterInput & {
  draft: DraftReport
}

export type ResearchEditor = {
  editDraft(input: ResearchEditorInput): Promise<DraftReport>
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
