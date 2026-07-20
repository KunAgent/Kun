/**
 * [INPUT]: 依赖 core/types 的 ResearchRun、ResearchFrame、ResearchReportContract、范围列表解析和独立 CoverageContract 构建器
 * [OUTPUT]: 对外提供 preflightResearchRun、同时生成完整保留显式维度的 Report/CoverageContract 的 buildReportContract 和 frameSanityCheck
 * [POS]: research/runtime 的轻量启动门，在 Plan 之前阻止坏 Frame；只有与 centralQuestion 一致的总问题才可作为中央问题，未明确的来源/用途等元数据不进入维度，单一细分章节继续承载中央问题，多个明确维度由各自正文章节承载且不被静默截断
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  ResearchBrief,
  ResearchCoverageContract,
  ResearchFrame,
  ResearchReportContract,
  ResearchReportContractSection,
  ResearchRun
} from '../core/types.js'
import { buildCoverageContract } from '../core/coverage.js'
import { isScopeMetadataText } from '../core/scope-metadata.js'
import { splitTopLevelScopeList } from '../core/scope-list.js'
import { isScopeClarificationPrompt } from './ResearchScopeInteraction.js'

export type ResearchPreflightCapabilities = {
  webSearchEnabled: boolean
  userFilesAvailable: boolean
}

export type ResearchPreflightResult = {
  frame: ResearchFrame
  reportContract: ResearchReportContract
  coverageContract: ResearchCoverageContract
  frameRepaired: boolean
  unavailableReason?: string
}

export function preflightResearchRun(input: {
  run: ResearchRun
  capabilities: ResearchPreflightCapabilities
  nowIso: string
}): ResearchPreflightResult {
  const frameCheck = frameSanityCheck(input.run.frame)
  const frame = frameCheck.ok ? input.run.frame : repairContaminatedFrame(input.run.brief, input.run.frame)
  const repairedCheck = frameSanityCheck(frame)
  if (!repairedCheck.ok) {
    throw new Error(`frame_contaminated: ${repairedCheck.reason}`)
  }

  const unavailableReason = capabilityUnavailableReason(input.run, input.capabilities)
  const reportContract = buildReportContract({
    brief: input.run.brief,
    frame,
    nowIso: input.nowIso
  })
  return {
    frame,
    frameRepaired: !frameCheck.ok,
    reportContract,
    coverageContract: buildCoverageContract({
      brief: input.run.brief,
      frame,
      reportContract,
      nowIso: input.nowIso
    }),
    unavailableReason
  }
}

export function frameSanityCheck(frame: ResearchFrame): { ok: true } | { ok: false; reason: string } {
  const fields = [
    ['centralQuestion', frame.centralQuestion],
    ['coreResearchThread', frame.coreResearchThread],
    ...frame.coreQuestions.map((question) => [`coreQuestions.${question.id}`, question.text] as const)
  ] as Array<readonly [string, string]>
  for (const [field, value] of fields) {
    if (containsScopePromptLeak(value)) {
      return { ok: false, reason: `${field} contains scope clarification prompt: ${value}` }
    }
  }
  return { ok: true }
}

export function buildReportContract(input: {
  brief: ResearchBrief
  frame: ResearchFrame
  nowIso: string
}): ResearchReportContract {
  const sections = genericSections(input.frame)
  return {
    requiredSections: dedupeSections(sections),
    createdAt: input.nowIso
  }
}

export function centralResearchQuestionId(frame: ResearchFrame): string | undefined {
  const central = normalizeQuestionText(frame.centralQuestion)
  const exact = frame.coreQuestions.find((question) => normalizeQuestionText(question.text) === central)
  if (exact) return exact.id
  const nonDimensionQuestions = frame.coreQuestions.filter((question) => !/^在「[^」]+」维度/u.test(question.text))
  return nonDimensionQuestions.find((question) => question.required && question.priority === 'high')?.id
    ?? nonDimensionQuestions.find((question) => question.required)?.id
    ?? nonDimensionQuestions.find((question) => question.priority === 'high')?.id
    ?? nonDimensionQuestions[0]?.id
}

function capabilityUnavailableReason(
  run: ResearchRun,
  capabilities: ResearchPreflightCapabilities
): string | undefined {
  if (run.budget.preset !== 'standard' && run.budget.preset !== 'deep') return undefined
  if (capabilities.webSearchEnabled || capabilities.userFilesAvailable) return undefined
  return `evidence_blocking: 当前 preset 为 ${run.budget.preset}，但没有可用联网搜索能力，也没有用户文件证据，不能进入 DeepResearch。`
}

function repairContaminatedFrame(brief: ResearchBrief, frame: ResearchFrame): ResearchFrame {
  const repairedQuestions = frame.coreQuestions
    .filter((question) => !containsScopePromptLeak(question.text))
  const centralQuestion = inferCentralQuestion(brief, repairedQuestions)
  const coreResearchThread = containsScopePromptLeak(frame.coreResearchThread)
    ? `围绕「${brief.topic}」，抓住最能改变最终判断的证据，回答：${centralQuestion}`
    : frame.coreResearchThread
  const dimensions = confirmedDimensions(brief, repairedQuestions)
  const dimensionQuestions = dimensions.map((dimension, index) => ({
    id: `q${index + 2}`,
    text: `在「${dimension}」维度上，关键事实、差距、优势和风险是什么？`,
    priority: 'high' as const,
    required: true
  }))
  return {
    ...frame,
    centralQuestion,
    coreResearchThread,
    coreQuestions: dedupeQuestions([{
      id: 'q1',
      text: centralQuestion,
      priority: 'high' as const,
      required: true
    }, ...dimensionQuestions, ...repairedQuestions.filter((question) => question.text !== centralQuestion)])
      .map((question, index) => ({ ...question, id: `q${index + 1}` }))
  }
}

function inferCentralQuestion(
  brief: ResearchBrief,
  repairedQuestions: ResearchFrame['coreQuestions']
): string {
  for (const clarification of brief.userClarifications ?? []) {
    const explicit = clarification.match(/(?:核心问题|核心是)\s*[:：]\s*([^\n]+)/u)?.[1]?.trim()
    if (explicit && !containsScopePromptLeak(explicit)) {
      return /[？?]$/u.test(explicit) ? explicit : `${explicit}？`
    }
  }
  const existing = repairedQuestions.find((question) => question.id === 'q1')
    ?? repairedQuestions.find((question) => question.required || question.priority === 'high')
  if (existing) return existing.text
  return `围绕「${brief.topic}」，最需要用证据回答的核心判断是什么？`
}

function confirmedDimensions(
  brief: ResearchBrief,
  repairedQuestions: ResearchFrame['coreQuestions']
): string[] {
  const dimensions = repairedQuestions
    .map((question) => question.text.match(/在「([^」]+)」维度/u)?.[1]?.trim())
    .filter((value): value is string => Boolean(value))
  for (const clarification of brief.userClarifications ?? []) {
    for (const line of clarification.split('\n')) {
      if (isScopeMetadataLine(line)) continue
      const answer = line.match(/(?:领域|方面|维度|范围)[^：:\n]{0,100}[？?]?\s*[:：]\s*(.+)$/u)?.[1]
      if (!answer) continue
      dimensions.push(...splitTopLevelScopeList(answer)
        .map((value) => value.replace(/[。？?]+$/u, '').trim())
        .filter((value) => value.length >= 2 && value.length <= 48 && !/^(?:无|不限|默认|全面对比)$/u.test(value)))
    }
  }
  return [...new Set(dimensions)]
}

function isScopeMetadataLine(value: string): boolean {
  return isScopeMetadataText(value)
}

function dedupeQuestions(questions: ResearchFrame['coreQuestions']): ResearchFrame['coreQuestions'] {
  const seen = new Set<string>()
  return questions.filter((question) => {
    const key = question.text.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function genericSections(frame: ResearchFrame): ResearchReportContractSection[] {
  const requiredQuestions = frame.coreQuestions.filter((question) => question.required || question.priority === 'high')
  const centralQuestionId = centralResearchQuestionId(frame)
  const detailQuestions = requiredQuestions.filter((question) => question.id !== centralQuestionId)
  const dimensionQuestions = detailQuestions.filter((question) => /^在「[^」]+」维度/u.test(question.text))
  if (dimensionQuestions.length > 0) {
    return dimensionQuestions.map((question) => section(
      question.id,
      titleFromQuestion(question.text),
      dimensionQuestions.length === 1 && centralQuestionId
        ? [centralQuestionId, question.id]
        : [question.id]
    ))
  }
  if (detailQuestions.length > 0) {
    return detailQuestions.map((question) => section(
      question.id,
      titleFromQuestion(question.text),
      detailQuestions.length === 1 && centralQuestionId
        ? [centralQuestionId, question.id]
        : [question.id]
    ))
  }
  return [section('overall', '综合判断', centralQuestionId ? [centralQuestionId] : [])]
}

function section(id: string, title: string, questionIds: string[]): ResearchReportContractSection {
  return {
    id,
    title,
    required: true,
    questionIds,
    limitationFallback: `该维度公开证据不足，当前只能做低置信判断；需要补充更强证据后再提高结论确定性。`
  }
}

function dedupeSections(sections: ResearchReportContractSection[]): ResearchReportContractSection[] {
  const sectionByTitle = new Map<string, ResearchReportContractSection>()
  const result: ResearchReportContractSection[] = []
  for (const section of sections) {
    const existing = sectionByTitle.get(section.title)
    if (existing) {
      existing.questionIds = [...new Set([...existing.questionIds, ...section.questionIds])]
      existing.required = existing.required || section.required
      continue
    }
    const copy = { ...section, questionIds: [...section.questionIds] }
    sectionByTitle.set(section.title, copy)
    result.push(copy)
  }
  return result
}

function titleFromQuestion(question: string): string {
  const dimension = question.match(/在「([^」]+)」维度/u)?.[1]
  if (dimension) return dimension
  if (/调研范围、关键概念和可比口径/.test(question)) return '调研范围与核心概念'
  if (/关键事实、指标、案例或时间线/.test(question)) return '关键事实与证据'
  if (/反例、替代解释|边界条件/.test(question)) return '边界条件与替代解释'
  if (/结论、风险和下一步行动/.test(question)) return '结论、风险与行动建议'
  return question
    .replace(/[？?。]\s*$/u, '')
    .replace(/^围绕「[^」]+」，/u, '')
    .replace(/「[^」]{24,}」/gu, '该主题')
    .slice(0, 40)
}

function containsScopePromptLeak(value: string): boolean {
  return isScopeClarificationPrompt(value)
}

function normalizeQuestionText(value: string): string {
  return value.replace(/[\s？?。.!！]+/gu, '').toLowerCase()
}
