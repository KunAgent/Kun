/**
 * [INPUT]: 依赖 research agents、core types、repository、citation 和 quality 接口
 * [OUTPUT]: 对外提供携带运行级模型选择的 ResearchRuntime 创建、确认、批准、主编/作者/编辑依赖注入和完成结果契约
 * [POS]: research/runtime 的公开类型边界，避免编排实现同时承担接口声明职责
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  CitationResolution,
  ConvergenceAnalyzer,
  CoverageEvaluator,
  EvidenceBinder,
  FrameRevisionGate,
  HypothesisAssessor,
  HypothesisProposer,
  PlanAgent,
  ReportArchitect,
  ResearchEditor,
  ResearchSupervisor,
  ResearchTaskWorker,
  SynthesisWriter,
  TestDesigner
} from '../agents/types.js'
import type {
  BriefApproval,
  ResearchBrief,
  ResearchBudget,
  ResearchFrame,
  ResearchRun,
  ResearchScopeAssessment,
  ScopeConfirmation
} from '../core/types.js'
import type { CitationResolver } from '../evidence/CitationResolver.js'
import type { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import type { QualityJudge } from '../verification/QualityJudge.js'
import type { QualityVerifier } from '../verification/QualityVerifier.js'

export type CreateResearchRunInput = {
  title?: string
  model?: string
  providerId?: string
  scope: ResearchScopeAssessment
  brief: ResearchBrief
  frame: ResearchFrame
  budget?: Partial<ResearchBudget>
  proposeBrief?: boolean
}

export type ConfirmScopeInput = {
  confirmedByUser: boolean
  confirmationMessageId?: string
  source: ScopeConfirmation['source']
}

export type AnswerScopeInput = {
  message: string
  scope: ResearchScopeAssessment
  brief: ResearchBrief
  frame: ResearchFrame
}

export type ApproveBriefInput = {
  approvedByUser: boolean
  briefHash: string
  approvalMessageId?: string
  source: BriefApproval['source']
}

export type ResearchRuntimeOptions = {
  repository: ResearchRunRepository
  planAgent?: PlanAgent
  supervisor?: ResearchSupervisor
  hypothesisProposer?: HypothesisProposer
  testDesigner?: TestDesigner
  evidenceBinder?: EvidenceBinder
  hypothesisAssessor?: HypothesisAssessor
  frameRevisionGate?: FrameRevisionGate
  convergenceAnalyzer?: ConvergenceAnalyzer
  coverageEvaluator?: CoverageEvaluator
  worker: ResearchTaskWorker
  reportArchitect?: ReportArchitect
  synthesisWriter?: SynthesisWriter
  researchEditor?: ResearchEditor
  citationResolver?: CitationResolver
  qualityVerifier?: QualityVerifier
  qualityJudge?: QualityJudge
  idGenerator?: () => string
  nowIso?: () => string
}

export type CompletedResearchRun = {
  run: ResearchRun
  resolvedReport: CitationResolution
}
