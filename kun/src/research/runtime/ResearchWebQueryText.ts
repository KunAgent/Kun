/**
 * [INPUT]: 依赖 ResearchTaskWorkerInput、comparison 实体别名、中文书写体系归一和 EvidenceEligibility 信号词
 * [OUTPUT]: 对外提供繁简体一致且去除资料前缀/研究动作/写作意图尾缀的短主题锚点、研究主体正文复核、主句属于其他对象而目标仅在列表中偶然出现的冲突识别、短分面查询、直接对比识别与本地化官方词
 * [POS]: research/runtime 的领域查询文本纯函数层，被 ResearchWebSearchPolicy 组合排序；从研究动作后的属格短语提取主体，不执行搜索、不维护题目或行业词典
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchTaskWorkerInput } from '../agents/types.js'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'
import { comparisonTargetAliases } from '../core/comparison.js'
import { researchSignalTerms } from '../evidence/EvidenceEligibility.js'

export function focusedSubjectSearchQueries(input: ResearchTaskWorkerInput, focusedQuery: string): string[] {
  const topic = conciseTopicAnchor(input.brief.topic)
  const terms = conciseFocusTerms(focusedQuery)
    .filter((term) => !topic.toLowerCase().includes(term.toLowerCase()))
    .slice(0, 6)
  if (terms.length === 0) return [`${topic} ${localizedOfficialTerm(topic)}`]
  const groups = [terms.slice(0, 3), terms.slice(3, 6)].filter((group) => group.length > 0)
  const queries = groups.map((group) => `${topic} ${group.join(' ')}`)
  if (queries.length === 1) queries.push(`${queries[0]} ${localizedOfficialTerm(`${topic} ${focusedQuery}`)}`)
  return queries.map(normalizeConciseQuery)
}

export function conciseFocusTerms(value: string): string[] {
  const normalized = normalizeResearchChineseScript(value)
    .replace(/^在[「"]|[」"]维度上.*$/gu, '')
    .replace(/(?:关键事实|作用机制|适用边界|是什么|如何|怎么|哪些|什么)/gu, ' ')
  const terms = normalized
    .split(/[()[\]{}【】「」“”'"、,，:：;；/|+]|(?:与|和|及)/gu)
    .map((term) => term.replace(/^[的在于\s]+|[的在于\s？?。！!]+$/gu, '').trim())
    .filter((term) => term.length >= 2 && term.length <= 20)
  if (terms.length > 0) return [...new Set(terms)]
  return researchSignalTerms(value).filter((term) => (
    /\p{Script=Han}/u.test(term) ? term.length >= 3 : term.length >= 5
  )).slice(0, 6)
}

export function conciseTopicAnchor(value: string): string {
  const normalized = normalizeResearchChineseScript(value)
    .replace(/^(?:请|帮我|请帮我)?\s*(?:调研|研究|分析|解释|评估|比较|对比|调查|梳理)\s*/u, '')
  const explicitSubject = normalized.match(
    /(?:^|[,，])\s*(?:请\s*)?(?:(?:全面|综合|系统|深入|重点)\s*)?(?:调研|研究|分析|解释|评估|比较|对比|调查|梳理)\s*([^，,。；;\n]{2,60}?)(?=\s*的[\p{L}\p{N}（(])/u
  )?.[1]?.trim().replace(/中$/u, '')
  if (explicitSubject && explicitSubject.length >= 2) return explicitSubject.slice(0, 72)
  const instructionBoundary = normalized.match(/^(.+?)[,，]\s*(?=(?:基于|覆盖|输出|产出|生成|撰写|时间范围|要求|用于|面向|重点|必要时))/u)?.[1]
  const firstClause = (instructionBoundary ?? normalized)
    .split(/[。！？!?；;\n]/u)[0]
    ?.replace(/(?:请)?(?:输出|产出|生成|撰写|时间范围|要求|用于|面向).+$/u, '')
    .trim()
  const withoutResearchIntent = firstClause
    ?.replace(/\s*(?:的)?(?:(?:基本面|现状|趋势|发展(?:情况)?|表现|实力)\s*(?:分析|研究|评估|比较|对比|调查|调研)|(?:分析|研究|调查|调研|报告))\s*$/u, '')
    .trim()
  const anchor = withoutResearchIntent && withoutResearchIntent.length >= 2
    ? withoutResearchIntent
    : firstClause
  return (anchor || value.trim()).slice(0, 72).trim()
}

export function sourceTextMatchesResearchSubject(topic: string, sourceText: string, aliases: string[] = []): boolean {
  const normalizedSource = normalizeResearchChineseScript(sourceText).toLowerCase()
  const verifiedAliases = aliases
    .map((alias) => normalizeResearchChineseScript(alias).toLowerCase().trim())
    .filter((alias) => alias.length >= 2 && !/^\d{4}$/u.test(alias))
  if (verifiedAliases.some((alias) => normalizedSource.includes(alias))) return true

  const anchor = conciseTopicAnchor(topic)
    .replace(/(?:19|20)\d{2}(?:年)?/gu, ' ')
    .replace(/(?:基本面|现状|趋势|发展|情况|概况|影响|能力|表现|分析|研究|评估|比较|对比|报告)/gu, ' ')
  const cjkRuns = anchor.match(/[\u4e00-\u9fff]{2,}/gu) ?? []
  for (const run of cjkRuns) {
    if (normalizedSource.includes(run.toLowerCase())) return true
    const pairs = characterPairs(run)
    const hitCount = pairs.filter((pair) => normalizedSource.includes(pair.toLowerCase())).length
    const requiredHits = run.length <= 4 ? 1 : Math.min(3, Math.ceil(pairs.length * 0.34))
    if (hitCount >= requiredHits) return true
  }

  const latinTerms = researchSignalTerms(anchor)
    .filter((term) => /^[A-Za-z][A-Za-z0-9+#.&-]{2,}$/u.test(term))
    .filter((term) => !/^(?:official|primary|source|data|current|latest)$/iu.test(term))
  const latinHits = latinTerms.filter((term) => normalizedSource.includes(term.toLowerCase()))
  if (latinHits.some((term) => /[A-Z0-9+#.&-]/u.test(term))) return true
  return latinHits.length >= Math.min(2, latinTerms.length) && latinTerms.length > 0
}

export function hasContradictoryPrimarySubject(evidenceText: string, aliases: string[]): boolean {
  const normalized = normalizeResearchChineseScript(evidenceText).toLowerCase().replace(/\s+/gu, ' ').trim()
  const normalizedAliases = aliases
    .map((alias) => normalizeResearchChineseScript(alias).toLowerCase().trim())
    .filter((alias) => alias.length >= 3)
  const targetIndex = normalizedAliases
    .map((alias) => normalized.indexOf(alias))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  if (targetIndex === undefined) return false
  const separatorIndex = Math.max(normalized.lastIndexOf(':', targetIndex), normalized.lastIndexOf('：', targetIndex))
  if (separatorIndex < 0 || targetIndex - separatorIndex > 120) return false
  const primaryClause = normalized.slice(0, separatorIndex)
  if (normalizedAliases.some((alias) => primaryClause.includes(alias))) return false
  const explicitPrimarySubject = /\b(?:growth|decline|cost|revenue|performance|risk|outlook|trend|forecast)\s+of\s+(?:the\s+)?[^:]{2,80}\b(?:market|industry|company|system|technology|service|product)\b|\b[^:]{2,80}\b(?:market|industry|company|system|technology|service|product)\b[^:]{0,40}\b(?:growth|decline|cost|revenue|performance|risk|outlook|trend|forecast)\b|[^：:]{2,40}(?:市场|行业|公司|系统|技术|服务|产品)(?:的)?(?:增长|下降|成本|收入|表现|风险|前景|趋势|预测)/iu.test(primaryClause)
  const listIntroduction = /(?:following|factors?|drivers?|include|including|such as|如下|因素|驱动|包括|例如)[^:：]{0,120}$/iu.test(primaryClause)
  return explicitPrimarySubject && listIntroduction
}

export function hasSourceEvidenceSubjectConflict(sourceTitle: string, evidenceText: string): boolean {
  const normalizedTitle = normalizeResearchChineseScript(sourceTitle).toLowerCase().replace(/\s+/gu, ' ').trim()
  const englishSubject = normalizedTitle.match(/(?:^|[-–—:])\s*([a-z][a-z0-9&+.-]*(?:\s+[a-z][a-z0-9&+.-]*){0,5})\s+(?:market|industry|company|system|technology|service|product)\b/iu)?.[1] ?? ''
  const chineseSubject = normalizedTitle.match(/(?:^|[-–—:：])\s*([^\s，,。；;：:]{2,24}?)(?:市场|行业|公司|系统|技术|服务|产品)(?:\b|[-–—:：\s])/u)?.[1] ?? ''
  const generic = new Set([
    'global', 'official', 'annual', 'current', 'latest', 'outlook', 'forecast', 'report', 'research',
    '市场', '行业', '公司', '系统', '技术', '服务', '产品', '全球', '官方', '年度', '报告', '研究'
  ])
  const aliases = [englishSubject, chineseSubject]
    .flatMap((subject) => [
      subject,
      ...subject.split(/[^\p{L}\p{N}+#&.-]+/u)
    ])
    .map((alias) => alias.trim())
    .filter((alias) => alias.length >= 3 && !generic.has(alias))
  return aliases.length > 0 && hasContradictoryPrimarySubject(evidenceText, aliases)
}

export function isDirectComparisonResearch(input: ResearchTaskWorkerInput): boolean {
  const targets = (input.frame.alternativesToCompare ?? []).map((target) => target.trim()).filter(Boolean)
  if (targets.length < 2) return false
  const topic = normalizeResearchChineseScript(input.brief.topic).toLowerCase()
  return targets.every((target) => comparisonTargetAliases(target).some((alias) => (
    topic.includes(normalizeResearchChineseScript(alias).toLowerCase())
  )))
}

export function localizedOfficialTerm(value: string): string {
  return /\p{Script=Han}/u.test(value) ? '官方' : 'official'
}

function normalizeConciseQuery(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 160).trim()
}

function characterPairs(value: string): string[] {
  const pairs: string[] = []
  for (let index = 0; index < value.length - 1; index += 1) pairs.push(value.slice(index, index + 2))
  return [...new Set(pairs)]
}
