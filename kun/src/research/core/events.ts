/**
 * [INPUT]: 依赖 core/types 的 ResearchRunStatus、ResearchPlan、ResearchGapVerdict 等运行期类型
 * [OUTPUT]: 对外提供 ResearchEvent union 和 ResearchEventInput，驱动状态机与事件落盘
 * [POS]: research/core 的事件契约，被 ResearchRuntime、Repository 和 UI 轮询结果间接消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  BriefApproval,
  HypothesisTest,
  ResearchConvergenceVerdict,
  ResearchGapVerdict,
  ResearchHypothesis,
  HypothesisUpdate,
  QualityVerdict,
  ResearchPlan,
  ResearchRunStatus,
  ResearchScopeAssessment,
  ResearchScopeClarification,
  ResearchTask,
  ScopeConfirmation
} from './types.js'

export type ResearchEventType =
  | 'RUN_CREATED'
  | 'SCOPE_ASSESSED'
  | 'SCOPE_CLARIFICATION_ADDED'
  | 'SCOPE_CONFIRMED'
  | 'BRIEF_PROPOSED'
  | 'BRIEF_APPROVED'
  | 'HYPOTHESES_PROPOSED'
  | 'HYPOTHESIS_TESTS_DESIGNED'
  | 'PLAN_CREATED'
  | 'TASK_STARTED'
  | 'SOURCE_ADDED'
  | 'NOTE_ADDED'
  | 'TASK_COMPLETED'
  | 'WORKER_RESULT_RECORDED'
  | 'RESEARCH_COMPLETED'
  | 'HYPOTHESIS_BINDINGS_CREATED'
  | 'HYPOTHESIS_ASSESSED'
  | 'GAP_CHECK_COMPLETED'
  | 'CONVERGENCE_ANALYZED'
  | 'FOLLOW_UP_TASK_CREATED'
  | 'REPORT_DRAFTED'
  | 'CITATIONS_RESOLVED'
  | 'VERIFICATION_COMPLETED'
  | 'REPORT_WRITTEN'
  | 'RUN_FAILED'
  | 'RUN_CANCELLED'
  | 'RESEARCH_UNAVAILABLE'

export type BaseResearchEvent = {
  id: string
  runId: string
  type: ResearchEventType
  timestamp: string
}

export type ResearchEvent =
  | (BaseResearchEvent & { type: 'RUN_CREATED'; topic: string; status: Extract<ResearchRunStatus, 'scoping'> })
  | (BaseResearchEvent & { type: 'SCOPE_ASSESSED'; scope: ResearchScopeAssessment })
  | (BaseResearchEvent & { type: 'SCOPE_CLARIFICATION_ADDED'; clarification: ResearchScopeClarification })
  | (BaseResearchEvent & { type: 'SCOPE_CONFIRMED'; confirmation: ScopeConfirmation })
  | (BaseResearchEvent & { type: 'BRIEF_PROPOSED'; briefHash: string; briefVersion: number })
  | (BaseResearchEvent & { type: 'BRIEF_APPROVED'; version: number; briefHash: string; approval: BriefApproval })
  | (BaseResearchEvent & { type: 'HYPOTHESES_PROPOSED'; hypotheses: ResearchHypothesis[] })
  | (BaseResearchEvent & { type: 'HYPOTHESIS_TESTS_DESIGNED'; tests: HypothesisTest[] })
  | (BaseResearchEvent & { type: 'PLAN_CREATED'; planId: string; taskCount: number; plan?: ResearchPlan })
  | (BaseResearchEvent & { type: 'TASK_STARTED'; taskId: string })
  | (BaseResearchEvent & { type: 'SOURCE_ADDED'; sourceId: string })
  | (BaseResearchEvent & { type: 'NOTE_ADDED'; noteId: string })
  | (BaseResearchEvent & { type: 'TASK_COMPLETED'; taskId: string })
  | (BaseResearchEvent & {
      type: 'WORKER_RESULT_RECORDED'
      taskId: string
      sourceCount: number
      evidenceSpanCount: number
      claimCount: number
      noteCount: number
    })
  | (BaseResearchEvent & { type: 'RESEARCH_COMPLETED'; taskCount: number; roundIndex?: number })
  | (BaseResearchEvent & { type: 'HYPOTHESIS_BINDINGS_CREATED'; bindingCount: number; roundIndex: number })
  | (BaseResearchEvent & { type: 'HYPOTHESIS_ASSESSED'; updates: HypothesisUpdate[]; roundIndex: number })
  | (BaseResearchEvent & {
      type: 'GAP_CHECK_COMPLETED'
      verdict: ResearchGapVerdict
      roundIndex: number
      followUpTaskCount: number
    })
  | (BaseResearchEvent & { type: 'CONVERGENCE_ANALYZED'; verdict: ResearchConvergenceVerdict; roundIndex: number })
  | (BaseResearchEvent & { type: 'FOLLOW_UP_TASK_CREATED'; task: ResearchTask; roundIndex: number })
  | (BaseResearchEvent & { type: 'REPORT_DRAFTED'; draftId: string; claimCount: number; attempt?: number; maxAttempts?: number })
  | (BaseResearchEvent & { type: 'CITATIONS_RESOLVED'; citationCount: number; unresolvedCitationIds: string[]; attempt?: number; maxAttempts?: number })
  | (BaseResearchEvent & { type: 'VERIFICATION_COMPLETED'; verdict: QualityVerdict; attempt?: number; maxAttempts?: number; finalAttempt?: boolean })
  | (BaseResearchEvent & { type: 'REPORT_WRITTEN'; reportPath: string; artifactPaths: string[] })
  | (BaseResearchEvent & { type: 'RUN_FAILED'; reason: string })
  | (BaseResearchEvent & { type: 'RUN_CANCELLED'; reason?: string })
  | (BaseResearchEvent & { type: 'RESEARCH_UNAVAILABLE'; reason: string })

export type ResearchEventInput = ResearchEvent extends infer Event
  ? Event extends ResearchEvent
    ? Omit<Event, 'id' | 'runId' | 'timestamp'>
    : never
  : never
