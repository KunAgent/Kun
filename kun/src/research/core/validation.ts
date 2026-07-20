/**
 * [INPUT]: 依赖 core/types 的 ResearchBrief、ResearchFrame、ResearchPlan、ResearchScopeAssessment
 * [OUTPUT]: 对外提供 DeepResearch scope、brief、frame、plan 的确定性校验函数
 * [POS]: research/core 的 schema 防线，阻止 runtime 接受缺核心主线或越预算计划
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchBrief, ResearchFrame, ResearchPlan, ResearchScopeAssessment } from './types.js'

export function validateResearchScopeAssessment(scope: ResearchScopeAssessment): void {
  requireNonEmpty(scope.summary, 'scope.summary')
  requireNonEmpty(scope.mainContradiction, 'scope.mainContradiction')
  if (scope.confirmationChecklist.length === 0) {
    throw new Error('ResearchScopeAssessment.confirmationChecklist must not be empty')
  }
  if (!scope.readyForBrief && scope.clarificationQuestions.length === 0) {
    throw new Error('ResearchScopeAssessment.clarificationQuestions must not be empty when scope is not ready')
  }
  const seenQuestionIds = new Set<string>()
  for (const question of scope.clarificationQuestions) {
    requireNonEmpty(question.id, 'scope.clarificationQuestions[].id')
    requireNonEmpty(question.question, 'scope.clarificationQuestions[].question')
    requireNonEmpty(question.why, 'scope.clarificationQuestions[].why')
    if (seenQuestionIds.has(question.id)) {
      throw new Error(`Duplicate ResearchScopeAssessment.clarificationQuestions id: ${question.id}`)
    }
    seenQuestionIds.add(question.id)
  }
}

export function validateResearchBrief(brief: ResearchBrief): void {
  requireNonEmpty(brief.id, 'brief.id')
  requirePositiveInteger(brief.version, 'brief.version')
  requireNonEmpty(brief.topic, 'brief.topic')
  requireNonEmpty(brief.userIntent, 'brief.userIntent')
  requireNonEmpty(brief.outputFormat, 'brief.outputFormat')
  if (brief.sourcePolicy.allowedSourceTypes.length === 0) {
    throw new Error('ResearchBrief.sourcePolicy.allowedSourceTypes must not be empty')
  }
  if (brief.successCriteria.length === 0) {
    throw new Error('ResearchBrief.successCriteria must not be empty')
  }
}

export function validateResearchFrame(frame: ResearchFrame): void {
  requireNonEmpty(frame.coreResearchThread, 'frame.coreResearchThread')
  requireNonEmpty(frame.centralQuestion, 'frame.centralQuestion')
  if (frame.coreQuestions.length === 0) {
    throw new Error('ResearchFrame.coreQuestions must not be empty')
  }
  const seenQuestionIds = new Set<string>()
  for (const question of frame.coreQuestions) {
    requireNonEmpty(question.id, 'frame.coreQuestions[].id')
    requireNonEmpty(question.text, 'frame.coreQuestions[].text')
    if (seenQuestionIds.has(question.id)) {
      throw new Error(`Duplicate ResearchFrame.coreQuestions id: ${question.id}`)
    }
    seenQuestionIds.add(question.id)
  }
  if (frame.evidenceNeeded.length === 0) {
    throw new Error('ResearchFrame.evidenceNeeded must not be empty')
  }
}

export function validateResearchPlan(plan: ResearchPlan, frame: ResearchFrame, maxSources: number): void {
  if (plan.tasks.length === 0) {
    throw new Error('ResearchPlan.tasks must not be empty')
  }
  const questionIds = new Set(frame.coreQuestions.map((question) => question.id))
  let plannedSources = 0
  const mappedHighPriorityQuestions = new Set<string>()
  for (const task of plan.tasks) {
    requireNonEmpty(task.id, 'ResearchTask.id')
    requireNonEmpty(task.objective, 'ResearchTask.objective')
    if (task.questionIds.length === 0) {
      throw new Error(`ResearchTask ${task.id} must reference at least one question`)
    }
    for (const questionId of task.questionIds) {
      if (!questionIds.has(questionId)) {
        throw new Error(`ResearchTask ${task.id} references unknown question ${questionId}`)
      }
      const question = frame.coreQuestions.find((candidate) => candidate.id === questionId)
      if (question?.priority === 'high' || question?.required) {
        mappedHighPriorityQuestions.add(questionId)
      }
    }
    if (task.expectedEvidence.length === 0) {
      throw new Error(`ResearchTask ${task.id} must declare expectedEvidence`)
    }
    if (task.sourceTypes.length === 0) {
      throw new Error(`ResearchTask ${task.id} must declare sourceTypes`)
    }
    if (!Number.isInteger(task.maxSources) || task.maxSources < 0) {
      throw new Error(`ResearchTask ${task.id} must have non-negative maxSources`)
    }
    if (task.status !== 'done' && task.maxSources <= 0) {
      throw new Error(`ResearchTask ${task.id} must have positive maxSources before completion`)
    }
    plannedSources += task.maxSources
  }
  for (const question of frame.coreQuestions) {
    if ((question.priority === 'high' || question.required) && !mappedHighPriorityQuestions.has(question.id)) {
      throw new Error(`High-priority question ${question.id} is not mapped to any task`)
    }
  }
  if (plannedSources > maxSources) {
    throw new Error(`ResearchPlan planned sources ${plannedSources} exceeds budget ${maxSources}`)
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`)
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }
}
