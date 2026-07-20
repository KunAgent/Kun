/**
 * [INPUT]: 依赖 core/events 的 ResearchEvent 和 core/types 的 ResearchRunStatus
 * [OUTPUT]: 对外提供 transitionResearchStatus 与 assertCanStartResearch 状态守卫
 * [POS]: research/core 的确定性状态机，约束 scope、research、gap、write 全流程转移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchEvent } from './events.js'
import type { ResearchRunStatus } from './types.js'

const TERMINAL_STATUSES = new Set<ResearchRunStatus>(['done', 'failed', 'cancelled', 'research_unavailable'])

export function transitionResearchStatus(status: ResearchRunStatus, event: ResearchEvent): ResearchRunStatus {
  if (event.type === 'RUN_FAILED') {
    if (TERMINAL_STATUSES.has(status)) {
      throw illegalTransition(status, event.type)
    }
    return 'failed'
  }
  if (event.type === 'RUN_CANCELLED') {
    if (TERMINAL_STATUSES.has(status)) {
      throw illegalTransition(status, event.type)
    }
    return 'cancelled'
  }
  if (event.type === 'RESEARCH_UNAVAILABLE') {
    if (TERMINAL_STATUSES.has(status)) {
      throw illegalTransition(status, event.type)
    }
    return 'research_unavailable'
  }

  switch (status) {
    case 'scoping':
      if (event.type === 'RUN_CREATED') return 'scoping'
      if (event.type === 'SCOPE_ASSESSED') return 'scoping'
      if (event.type === 'SCOPE_CLARIFICATION_ADDED') return 'scoping'
      if (event.type === 'SCOPE_CONFIRMED') return 'scoping'
      if (event.type === 'BRIEF_PROPOSED') return 'awaiting_brief_confirm'
      break
    case 'awaiting_brief_confirm':
      if (event.type === 'BRIEF_APPROVED') return 'planning'
      break
    case 'planning':
      if (event.type === 'HYPOTHESES_PROPOSED') return 'planning'
      if (event.type === 'HYPOTHESIS_TESTS_DESIGNED') return 'planning'
      if (event.type === 'PLAN_CREATED') return 'researching'
      break
    case 'researching':
      if (
        event.type === 'TASK_STARTED'
        || event.type === 'SOURCE_ADDED'
        || event.type === 'NOTE_ADDED'
        || event.type === 'TASK_COMPLETED'
        || event.type === 'WORKER_RESULT_RECORDED'
      ) return 'researching'
      if (event.type === 'FOLLOW_UP_TASK_CREATED') return 'researching'
      if (event.type === 'CONVERGENCE_ANALYZED') return 'researching'
      if (event.type === 'RESEARCH_COMPLETED') return 'gap_checking'
      break
    case 'gap_checking':
      if (event.type === 'HYPOTHESIS_BINDINGS_CREATED') return 'gap_checking'
      if (event.type === 'HYPOTHESIS_ASSESSED') return 'gap_checking'
      if (event.type === 'CONVERGENCE_ANALYZED') return 'gap_checking'
      if (event.type === 'GAP_CHECK_COMPLETED') {
        return event.verdict.status === 'need_more' ? 'researching' : 'synthesizing'
      }
      break
    case 'synthesizing':
      if (event.type === 'CONVERGENCE_ANALYZED') return 'synthesizing'
      if (event.type === 'FOLLOW_UP_TASK_CREATED') return 'researching'
      if (event.type === 'REPORT_DRAFTED') return 'resolving_citations'
      break
    case 'resolving_citations':
      if (event.type === 'CITATIONS_RESOLVED') return 'verifying'
      break
    case 'verifying':
      if (event.type === 'VERIFICATION_COMPLETED') {
        if (event.verdict.pass) return 'writing'
        return event.finalAttempt === false ? 'synthesizing' : 'failed'
      }
      break
    case 'writing':
      if (event.type === 'REPORT_WRITTEN') return 'done'
      break
    case 'done':
    case 'failed':
    case 'cancelled':
    case 'research_unavailable':
      break
    case 'paused':
      throw new Error('Research paused resume is deferred')
    default:
      assertNever(status)
  }

  throw illegalTransition(status, event.type)
}

export function assertCanStartResearch(status: ResearchRunStatus): void {
  if (status !== 'planning') {
    throw new Error(`Research cannot start before brief approval; current status is ${status}`)
  }
}

function illegalTransition(status: ResearchRunStatus, eventType: ResearchEvent['type']): Error {
  return new Error(`Illegal research transition: ${status} -> ${eventType}`)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled research status: ${String(value)}`)
}
