/**
 * [INPUT]: 依赖 ResearchTaskWorkerInput、中文书写体系归一、EvidenceEligibility 和当前 task 的 research relevance 文本
 * [OUTPUT]: 对外提供只接受连续原文或空格/标点/繁简等价文本且数字不增补、不从单词中间起截的网页证据 grounding、通用实体别名与研究主体核对、主句主体冲突拦截、仅对单一章节任务开放动态标记核验的跨语言归属、按用户问题动态排除定义/目录/地址类文档元数据的章节归属和关键词位置判断
 * [POS]: research/runtime 的网页证据文本纯函数层，被 SeededWebResearchTaskWorker 的抽取与原文补录复用；禁止任务内任一动态标记替多个章节背书，定义/多概念维度严格匹配，兄弟章节概念不能靠宽泛别名污染当前章节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchTaskWorkerInput } from '../agents/types.js'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'
import { comparisonTargetAliases } from '../core/comparison.js'
import { isIncidentalResearchFocusMention, isResearchEvidenceFocused, isResearchTextRelevant, researchDimensionFocusGroups, researchSignalTerms } from '../evidence/EvidenceEligibility.js'
import { unsupportedNumericTokens } from '../evidence/ClaimSupport.js'
import { normalizeStringArray, type WebExtractionCard } from './ResearchWebContent.js'
import { coreResearchRelevanceText, researchRelevanceText } from './ResearchWebSearchPolicy.js'
import { hasContradictoryPrimarySubject, sourceTextMatchesResearchSubject } from './ResearchWebQueryText.js'

export function isExtractedEvidenceGroundedInSource(evidenceText: string, sourceText: string): boolean {
  const normalizedEvidence = normalizeWhitespace(evidenceText).toLowerCase()
  const normalizedSource = normalizeWhitespace(sourceText).toLowerCase()
  if (normalizedEvidence.length < 24 || normalizedSource.length < 80) return false
  if (unsupportedNumericTokens(evidenceText, [sourceText]).length > 0) return false
  const exactIndex = normalizedSource.indexOf(normalizedEvidence)
  if (exactIndex >= 0) return startsAtExcerptBoundary(normalizedSource, exactIndex)
  const comparableEvidence = normalizeComparableExcerpt(evidenceText)
  const comparableSource = normalizeComparableExcerpt(sourceText)
  if (comparableEvidence.length >= 24 && comparableSource.includes(comparableEvidence)) return true
  return false
}

function startsAtExcerptBoundary(source: string, index: number): boolean {
  if (index === 0) return true
  const previous = source[index - 1] ?? ''
  return /[\s([{"'“‘:;。！？!?；：]/u.test(previous)
}

export function isExtractedClaimEntityGroundedInEvidence(claimText: string, evidenceText: string): boolean {
  const normalize = (value: string) => normalizeResearchChineseScript(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const normalizedEvidence = normalize(evidenceText)
  return comparisonTargetAliases(claimText)
    .map(normalize)
    .filter((alias) => alias.length >= 2)
    .some((alias) => normalizedEvidence.includes(alias))
}

export function hasResearchSignal(text: string, input?: ResearchTaskWorkerInput): boolean {
  if (input) {
    return isResearchTextRelevant(coreResearchRelevanceText(input), text)
      && isResearchTextRelevant(researchRelevanceText(input), text)
  }
  return /[\p{L}\p{N}]/u.test(text) && normalizeWhitespace(text).length >= 24
}

export function questionIdsForCard(
  card: WebExtractionCard,
  input: ResearchTaskWorkerInput,
  evidenceText: string,
  subjectAliases: string[] = [],
  focusAliasGroups: string[][] = [],
  sourceSubjectVerified = false
): string[] {
  if (subjectAliases.length > 0 && hasContradictoryPrimarySubject(evidenceText, subjectAliases)) return []
  if (!sourceSubjectVerified && subjectAliases.length > 0 &&
    !sourceTextMatchesResearchSubject(input.brief.topic, evidenceText, subjectAliases)) return []
  if (isUnrelatedDisclosureMetadata(input, evidenceText)) return []
  const frameQuestionIds = new Set(input.frame.coreQuestions.map((question) => question.id))
  const taskQuestionIds = new Set(input.task.questionIds)
  const ownedQuestionIds = researchQuestionIdsForTask(input)
  const ownedQuestionIdSet = new Set(ownedQuestionIds)
  const explicitTaskQuestionIds = normalizeStringArray(card.questionIds, Math.max(1, frameQuestionIds.size))
    .filter((questionId) => frameQuestionIds.has(questionId) && taskQuestionIds.has(questionId))
  const explicit = explicitTaskQuestionIds.filter((questionId) => ownedQuestionIdSet.has(questionId))
  const focusedTaskQuestions = ownedQuestionIds
    .filter((questionId) => evidenceMatchesQuestionFocus(input, questionId, evidenceText))
  const assignedToTask = explicit
    .filter((questionId) => evidenceMatchesQuestionFocus(input, questionId, evidenceText))

  const soleTaskQuestionId = ownedQuestionIds.length === 1 ? ownedQuestionIds[0] : undefined
  const soleTaskQuestion = input.frame.coreQuestions.find((question) => question.id === soleTaskQuestionId)
  const scopedFocusAliasGroups = soleTaskQuestionId
    ? focusAliasGroupsForQuestion(input, soleTaskQuestionId, focusAliasGroups)
    : focusAliasGroups
  const soleTaskIsAnalytical = Boolean(soleTaskQuestion && isAnalyticalApplicationQuestion(soleTaskQuestion.text))
  if (soleTaskQuestionId && soleTaskQuestion && soleTaskIsAnalytical &&
    isDirectAnalyticalApplicationEvidence(input, soleTaskQuestion.text, evidenceText, scopedFocusAliasGroups)) {
    return [soleTaskQuestionId]
  }
  if (soleTaskQuestionId && explicit.includes(soleTaskQuestionId) &&
    evidenceMatchesDynamicFocusAliases(evidenceText, scopedFocusAliasGroups)) {
    return [soleTaskQuestionId]
  }
  if (soleTaskQuestionId && soleTaskQuestion && explicit.includes(soleTaskQuestionId) &&
    !/在「[^」]+」维度/u.test(soleTaskQuestion.text)) {
    return [soleTaskQuestionId]
  }
  // A task owns only its assigned questions. Sibling assignments from the
  // extraction model are discarded so one subagent cannot contaminate another
  // section's evidence ledger.
  if (explicit.length > 0) {
    if (assignedToTask.length > 0) {
      return [...new Set([...assignedToTask, ...focusedTaskQuestions])].slice(0, 4)
    }
    return focusedTaskQuestions.slice(0, 4)
  }
  return questionIdsForEvidence(input, evidenceText, focusAliasGroups)
}

function evidenceMatchesQuestionFocus(
  input: ResearchTaskWorkerInput,
  questionId: string,
  evidenceText: string
): boolean {
  const question = input.frame.coreQuestions.find((candidate) => candidate.id === questionId)
  if (!question) return false
  const context = [
    input.brief.topic,
    input.brief.userIntent,
    input.frame.coreResearchThread,
    input.frame.centralQuestion
  ].join('\n')
  return isResearchEvidenceFocused(question.text, evidenceText, context)
}

export function questionIdsForEvidence(
  input: ResearchTaskWorkerInput,
  evidenceText: string,
  focusAliasGroups: string[][] = []
): string[] {
  if (isUnrelatedDisclosureMetadata(input, evidenceText)) return []
  const questions = researchQuestionIdsForTask(input)
    .map((questionId) => input.frame.coreQuestions.find((question) => question.id === questionId))
    .filter((question): question is NonNullable<typeof question> => Boolean(question))
  const directMatches = questions
    .filter((question) => evidenceMatchesQuestionFocus(input, question.id, evidenceText))
    .sort((left, right) => questionPriority(right) - questionPriority(left))
  if (directMatches.length > 0) return directMatches.map((question) => question.id).slice(0, 4)
  const scopedFocusAliasGroups = questions.length === 1
    ? focusAliasGroupsForQuestion(input, questions[0]!.id, focusAliasGroups)
    : focusAliasGroups
  if (questions.length === 1 && evidenceMatchesDynamicFocusAliases(evidenceText, scopedFocusAliasGroups)) {
    return [questions[0]!.id]
  }
  const broadMatches = questions
    .filter((question) => !/在「[^」]+」维度/u.test(question.text) && isResearchTextRelevant(question.text, evidenceText))
    .sort((left, right) => questionPriority(right) - questionPriority(left))
  if (broadMatches.length > 0) return broadMatches.map((question) => question.id).slice(0, 2)
  if (questions.length === 1 && isAnalyticalApplicationQuestion(questions[0]!.text) &&
    isDirectAnalyticalApplicationEvidence(input, questions[0]!.text, evidenceText, scopedFocusAliasGroups)) {
    return [questions[0]!.id]
  }
  if (input.frame.coreQuestions.length === 1 && questions.length === 1 &&
    !isAnalyticalApplicationQuestion(questions[0]!.text) && hasResearchSignal(evidenceText, input)) {
    return [questions[0]!.id]
  }
  return []
}

function focusAliasGroupsForQuestion(
  input: ResearchTaskWorkerInput,
  questionId: string,
  groups: string[][]
): string[][] {
  const siblingDimensions = input.frame.coreQuestions
    .filter((question) => question.id !== questionId)
    .map((question) => question.text.match(/在「([^」]+)」维度/u)?.[1]?.trim())
    .filter((dimension): dimension is string => Boolean(dimension))
    .map(normalizeComparableFocusText)
  if (siblingDimensions.length === 0) return groups
  return groups
    .map((group) => group.filter((alias) => {
      const normalizedAlias = normalizeComparableFocusText(alias)
      if (normalizedAlias.length < 2) return false
      return !siblingDimensions.some((dimension) =>
        dimension.includes(normalizedAlias) || normalizedAlias.includes(dimension)
      )
    }))
    .filter((group) => group.length > 0)
}

function normalizeComparableFocusText(value: string): string {
  return normalizeResearchChineseScript(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/^(?:主要|核心|关键|整体|总体|当前)+/u, '')
}

function isUnrelatedDisclosureMetadata(input: ResearchTaskWorkerInput, evidenceText: string): boolean {
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const ownedQuestions = researchQuestionIdsForTask(input)
    .map((questionId) => input.frame.coreQuestions.find((question) => question.id === questionId)?.text ?? '')
    .join('\n')
  const definitionOnly = /(?:\brefers?\s+to\b|\bis\s+defined\s+as\b|\bmeans?\b|定义为|是指|指的是)/iu.test(normalizedEvidence)
    && !/(?:\b(?:increased|decreased|grew|fell|reached|amounted|totaled)\b|同比|环比|增长|下降|达到|实现|录得)/iu.test(normalizedEvidence)
  if (definitionOnly && !/(?:定义|含义|口径|如何计算|\bdefinition\b|\bmeaning\b|\bmethodology\b)/iu.test(ownedQuestions)) {
    return true
  }
  const documentMetadata = /(?:目录|索引|目次|table of contents|document index)[^。！？.!?]{0,160}(?:页码|章节|附录|page|section|appendix)|(?:办事处|注册地址|注册办事处|办公地址|registered office|principal office|office address)[^。！？.!?]{0,100}(?:地址|位于|address|located)|\b[A-Z]{2,12}\s*\d+\b[^.!?]{0,160}(?:replace|amend|presentation|disclosure|classification|grouping|requirements?|no\s+impact)|(?:准则|标准|规范|规则)第?\s*\d+\s*号?[^。！？]{0,160}(?:影响|分类|计算|报告|披露|采用|采纳|取代|替代|修订)|(?:政策|方法|规则)[^。！？]{0,80}(?:载列如下|列示如下|如下)|(?:根据[^。！？]{0,40}(?:法|law)[^。！？]{0,100}(?:注册成立|incorporated)|(?:registered|incorporated)[^.!?]{0,100}(?:under|law))/iu.test(normalizedEvidence)
  if (!documentMetadata) return false
  return !/(?:定义|格式|标准|规范|分类|披露|政策|方法|规则|注册|成立|法律|地址|目录|索引|页码|章节|附录|\bdefinition\b|\bformat\b|\bstandard\b|\bspecification\b|\bclassification\b|\bdisclosure\b|\bpolicy\b|\bmethod\b|\brule\b|\bregistration\b|\blaw\b|\baddress\b|\btable of contents\b|\bdocument index\b|\bpage\b|\bsection\b|\bappendix\b)/iu.test(ownedQuestions)
}

function evidenceMatchesDynamicFocusAliases(evidenceText: string, groups: string[][]): boolean {
  if (groups.length === 0) return false
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const matchedAliases = groups.flat().filter((alias) => {
    const normalizedAlias = normalizeResearchChineseScript(alias).toLowerCase().trim()
    if (normalizedAlias.length < 2) return false
    if (!/^[a-z0-9+#.& -]+$/iu.test(normalizedAlias)) return normalizedEvidence.includes(normalizedAlias)
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/gu, '\\s+')
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'iu').test(normalizedEvidence)
  })
  return matchedAliases.length > 0 && !isIncidentalResearchFocusMention(evidenceText, matchedAliases)
}

export function isAnalyticalApplicationQuestion(questionText: string): boolean {
  const dimension = questionText.match(/在「([^」]+)」维度/u)?.[1]?.trim() ?? questionText
  return /场景|实际影响|实践影响|应用影响|决策意义|实务意义|\bscenario\b|\buse cases?\b|\bpractical (?:impact|application)\b/iu.test(dimension)
}

export function evidenceDirectlyMatchesAnalyticalApplicationQuestion(
  questionText: string,
  evidenceText: string
): boolean {
  if (!isAnalyticalApplicationQuestion(questionText)) return true
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const requiredGroups = analyticalApplicationFocusGroups(questionText)
  if (requiredGroups.length === 0) return false
  return requiredGroups.every((aliases) => aliases.some((alias) => {
    const normalizedAlias = normalizeResearchChineseScript(alias).toLowerCase()
    if (/^[a-z0-9 ]+$/u.test(normalizedAlias)) {
      const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'u').test(normalizedEvidence)
    }
    return normalizedEvidence.includes(normalizedAlias)
  }))
}

export function analyticalApplicationFocusAliases(questionText: string): string[] {
  return [...new Set(analyticalApplicationFocusGroups(questionText).flat())]
}

export function isDirectAnalyticalApplicationEvidence(
  input: ResearchTaskWorkerInput,
  questionText: string,
  evidenceText: string,
  focusAliasGroups: string[][] = []
): boolean {
  const dynamicDirectMatch = focusAliasGroups.length > 0 && focusAliasGroups.every((group) =>
    evidenceMatchesDynamicFocusAliases(evidenceText, [group])
  )
  return (evidenceDirectlyMatchesAnalyticalApplicationQuestion(questionText, evidenceText) || dynamicDirectMatch)
    && hasApplicationMainlineAnchor(input, questionText, evidenceText)
}

function analyticalApplicationFocusGroups(questionText: string): string[][] {
  if (!isAnalyticalApplicationQuestion(questionText)) return []
  const dimension = questionText.match(/在「([^」]+)」维度/u)?.[1]?.trim() ?? questionText
  return researchDimensionFocusGroups(dimension, questionText)
    .filter((group) => group.some((alias) => !/^(?:场景|应用|实践|影响|意义|scenario|application|practice|impact)$/iu.test(alias)))
}

function hasApplicationMainlineAnchor(
  input: ResearchTaskWorkerInput,
  questionText: string,
  evidenceText: string
): boolean {
  const minimumSignals = hasCompactApplicationScopePhrase(questionText, evidenceText) ? 1 : 2
  return hasMainlineResearchAnchor(input, evidenceText, minimumSignals)
}

function hasCompactApplicationScopePhrase(questionText: string, evidenceText: string): boolean {
  const groups = analyticalApplicationFocusGroups(questionText)
  if (groups.length < 2) return false
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const positionsByGroup = groups.map((aliases) => aliases.flatMap((alias) => {
    const normalizedAlias = normalizeResearchChineseScript(alias).toLowerCase()
    const positions: number[] = []
    let cursor = 0
    while (positions.length < 4) {
      const index = normalizedEvidence.indexOf(normalizedAlias, cursor)
      if (index < 0) break
      positions.push(index)
      cursor = index + Math.max(1, normalizedAlias.length)
    }
    return positions
  }))
  if (positionsByGroup.some((positions) => positions.length === 0)) return false
  const combinations = positionsByGroup.reduce<number[][]>(
    (current, positions) => current.flatMap((combination) => positions.map((position) => [...combination, position])),
    [[]]
  )
  return combinations.some((positions) => Math.max(...positions) - Math.min(...positions) <= 32)
}

function hasMainlineResearchAnchor(input: ResearchTaskWorkerInput, evidenceText: string, minimumSignals = 2): boolean {
  const researchText = [input.brief.topic, input.frame.centralQuestion, input.frame.coreResearchThread].join('\n')
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const genericSignals = new Set([
    'scenario', 'application', 'practice', 'impact', 'official', 'documentation', 'document', 'docs', 'source', 'sources',
    '场景', '应用', '实践', '影响', '机制', '分析', '官方', '文档', '网页', '来源', '资料'
  ])
  const matchedSignals = researchSignalTerms(researchText).filter((signal) => {
    const normalizedSignal = normalizeResearchChineseScript(signal).toLowerCase()
    if (genericSignals.has(normalizedSignal)) return false
    const isDistinctive = /[A-Z0-9+#.&-]/u.test(signal)
      || /^[a-z][a-z0-9+#.&-]{3,}$/u.test(normalizedSignal)
      || /[\u4e00-\u9fff]{3,}/u.test(signal)
    const morphologyStems = [
      ...(normalizedSignal.endsWith('ation') && normalizedSignal.length > 7 ? [normalizedSignal.slice(0, -5)] : []),
      ...(normalizedSignal.endsWith('ness') && normalizedSignal.length > 6 ? [normalizedSignal.slice(0, -4)] : []),
      ...(normalizedSignal.endsWith('ity') && normalizedSignal.length > 6 ? [normalizedSignal.slice(0, -3)] : [])
    ].filter((stem) => stem.length >= 4)
    return isDistinctive && [normalizedSignal, ...morphologyStems].some((term) => normalizedEvidence.includes(term))
  })
  return new Set(matchedSignals.map((signal) => normalizeResearchChineseScript(signal).toLowerCase())).size >= minimumSignals
}

export function researchQuestionIdsForTask(input: ResearchTaskWorkerInput): string[] {
  const taskQuestionIds = new Set(input.task.questionIds)
  const explicitReportQuestionIds = (input.task.reportQuestionIds ?? [])
    .filter((questionId) => taskQuestionIds.has(questionId))
    .filter((questionId) => input.frame.coreQuestions.some((question) => question.id === questionId))
  const legacyReportQuestionIds = explicitReportQuestionIds.length === 0
    ? (input.task.reportSectionIds ?? [])
      .filter((questionId) => taskQuestionIds.has(questionId))
      .filter((questionId) => input.frame.coreQuestions.some((question) => question.id === questionId))
    : []
  const reportQuestionIds = explicitReportQuestionIds.length > 0 ? explicitReportQuestionIds : legacyReportQuestionIds
  return reportQuestionIds.length > 0 ? reportQuestionIds : input.task.questionIds
}

function normalizeQuestion(value: string): string {
  return normalizeResearchChineseScript(value).toLowerCase().replace(/[\s？?。.!！]+/gu, '')
}

function questionPriority(question: ResearchTaskWorkerInput['frame']['coreQuestions'][number]): number {
  return (question.required ? 4 : 0) + (question.priority === 'high' ? 2 : question.priority === 'medium' ? 1 : 0)
}

export function researchEvidenceSignalKeywords(input: ResearchTaskWorkerInput): string[] {
  return [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.filter((question) => input.task.questionIds.includes(question.id)).map((question) => question.text),
    input.task.objective,
    ...input.task.expectedEvidence,
    ...input.task.searchHints
  ]
    .join(' ')
    .split(/[^\p{L}\p{N}+#&.+-]+/u)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length >= 2)
    .filter((keyword, index, all) => all.indexOf(keyword) === index)
    .slice(0, 80)
}

export function keywordIndexes(text: string, keyword: string): number[] {
  const lower = normalizeResearchChineseScript(text).toLowerCase()
  const normalizedKeyword = normalizeResearchChineseScript(keyword).toLowerCase()
  if (!normalizedKeyword) return []
  const indexes: number[] = []
  let cursor = 0
  while (indexes.length < 3) {
    const index = lower.indexOf(normalizedKeyword, cursor)
    if (index < 0) break
    indexes.push(index)
    cursor = index + normalizedKeyword.length
  }
  return indexes
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeComparableExcerpt(value: string): string {
  return normalizeResearchChineseScript(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, '')
}
