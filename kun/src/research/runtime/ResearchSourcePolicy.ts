/**
 * [INPUT]: 依赖 ResearchSourcePolicy/ResearchBudget、用户主题/澄清/约束、范围列表解析和网页候选身份字段
 * [OUTPUT]: 对外提供显式来源域名/发布方策略派生、用户严格限定的具体 URL 提取、单一域名预算收敛、归一化、URL/发布方准入和 site 查询工具
 * [POS]: research/runtime 的来源政策边界，只把用户明确写出的域名、发布方名称或严格 URL 升级为运行时硬约束，不维护机构别名表或题材域名表
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { resolveResearchBudget } from '../core/presets.js'
import { splitTopLevelScopeList } from '../core/scope-list.js'
import type { ResearchBrief, ResearchBudget, ResearchSourcePolicy } from '../core/types.js'

const STRICT_SOURCE_SIGNAL_RE = /只(?:能)?(?:使用|基于)|仅(?:限)?(?:使用|基于)|来源(?:只|仅)?限于|限定来源|只看|仅看|必须来自|only\s+(?:use|from)|sources?\s+(?:only|must)/iu
const PREFERRED_SOURCE_SIGNAL_RE = /优先使用|优先参考|首选来源|prefer(?:red)?\s+sources?/iu

export function deriveResearchSourcePolicy(
  base: ResearchSourcePolicy,
  researchText: string
): ResearchSourcePolicy {
  const explicitDomains = normalizeDomains(base.allowedDomains ?? [])
  const preferredDomains = normalizeDomains(base.preferredDomains ?? [])
  const mentionedDomains = domainsMentionedInText(researchText)
  const strict = STRICT_SOURCE_SIGNAL_RE.test(researchText)
  const preferred = PREFERRED_SOURCE_SIGNAL_RE.test(researchText)
  const allowedPublishers = uniquePublisherNames([
    ...(base.allowedPublishers ?? []),
    ...(strict ? strictPublisherNamesMentionedInText(researchText) : [])
  ])
  return {
    ...base,
    ...(explicitDomains.length > 0 || (strict && mentionedDomains.length > 0)
      ? { allowedDomains: uniqueDomains([...explicitDomains, ...(strict ? mentionedDomains : [])]) }
      : {}),
    ...(preferredDomains.length > 0 || preferred || strict
      ? { preferredDomains: uniqueDomains([
          ...preferredDomains,
          ...((preferred || strict) ? mentionedDomains : [])
        ]) }
      : {}),
    ...(allowedPublishers.length > 0 ? { allowedPublishers } : {})
  }
}

export function adaptResearchBudgetToSourceBoundary(
  budget: ResearchBudget,
  brief: ResearchBrief,
  topic: string,
  overrides?: Partial<ResearchBudget>
): ResearchBudget {
  if (brief.sourcePolicy.allowedDomains?.length !== 1) return budget
  if (overrides?.minSources !== undefined) return budget
  const concise = /(?:简洁|简短|精炼|扼要|concise|brief)/iu.test(`${topic}\n${brief.outputFormat}`)
  const minSources = Math.min(budget.minSources, concise ? 2 : 4)
  const targetSources = Math.min(budget.targetSources, concise ? 4 : 8, budget.maxSources)
  const maxSources = concise && overrides?.maxSources === undefined
    ? Math.min(budget.maxSources, 8)
    : budget.maxSources
  return resolveResearchBudget({
    ...budget,
    minSources,
    targetSources: Math.max(minSources, targetSources),
    maxSources
  })
}

export function domainsMentionedInText(text: string): string[] {
  return normalizeDomains([...text.matchAll(/(?<![\w@])(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s，。；;]*)?/giu)]
    .map((match) => match[1] ?? '')
  )
}

export function strictSourceUrlsMentionedInText(text: string): string[] {
  if (!STRICT_SOURCE_SIGNAL_RE.test(text)) return []
  const urls = [...text.matchAll(/https?:\/\/[^\s<>"'，。！？；;、]+/giu)]
    .map((match) => (match[0] ?? '').replace(/[）)\]}>]+$/u, '').trim())
    .filter(Boolean)
  return [...new Set(urls)]
}

export function strictPublisherNamesMentionedInText(text: string): string[] {
  const signal = '(?:只(?:能)?(?:使用|基于)|仅(?:限)?(?:使用|基于)|来源(?:只|仅)?限于|限定来源(?:为|是)?|只看|仅看|必须来自)'
  const matches = [...text.matchAll(new RegExp(`${signal}\\s*([^，,。；;\\n]{1,120}?)(?:的)?官方(?:资料|文档|网页|网站|来源|数据|报告)`, 'giu'))]
  return uniquePublisherNames(matches.flatMap((match) => splitTopLevelScopeList(match[1] ?? '', {
    wordSeparators: ['以及', '或者', '和', '及', '或']
  })))
}

export function isResearchSourceUrlAllowed(policy: ResearchSourcePolicy, value: string): boolean {
  const allowed = normalizeDomains(policy.allowedDomains ?? [])
  if (allowed.length === 0) return true
  const host = sourceHostname(value)
  return Boolean(host && allowed.some((domain) => host === domain || host.endsWith(`.${domain}`)))
}

export function isResearchSourceUrlPreferred(policy: ResearchSourcePolicy, value: string): boolean {
  const preferred = normalizeDomains(policy.preferredDomains ?? [])
  if (preferred.length === 0) return false
  const host = sourceHostname(value)
  return Boolean(host && preferred.some((domain) => host === domain || host.endsWith(`.${domain}`)))
}

export function isResearchSourceCandidateAllowed(
  policy: ResearchSourcePolicy,
  candidate: { url?: string; title?: string; publisher?: string; snippet?: string }
): boolean {
  if (candidate.url && !isResearchSourceUrlAllowed(policy, candidate.url)) return false
  return isResearchSourcePublisherAllowed(policy, candidate)
}

export function isResearchSourcePublisherAllowed(
  policy: ResearchSourcePolicy,
  candidate: { url?: string; title?: string; publisher?: string; snippet?: string }
): boolean {
  const publishers = uniquePublisherNames(policy.allowedPublishers ?? [])
  if (publishers.length === 0) return true
  return publishers.some((publisher) => candidateMatchesPublisherName(candidate, publisher))
}

export function sourcePolicySiteQueries(policy: ResearchSourcePolicy, topic: string): string[] {
  const domains = uniqueDomains([...(policy.allowedDomains ?? []), ...(policy.preferredDomains ?? [])])
  return domains.slice(0, 4).map((domain) => `${topic} site:${domain}`)
}

export function normalizeDomains(values: string[]): string[] {
  return uniqueDomains(values.map((value) => {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return ''
    try {
      return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, '')
    } catch {
      return trimmed.replace(/^www\./, '').replace(/^\.+|\.+$/g, '')
    }
  }).filter((value) => /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(value)))
}

function sourceHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return undefined
  }
}

function uniqueDomains(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
}

function uniquePublisherNames(values: string[]): string[] {
  return [...new Set(values
    .map((value) => value
      .replace(/^[“”‘’'"「」【】\[\]()（）\s]+|[“”‘’'"「」【】\[\]()（）\s]+$/gu, '')
      .replace(/^(?:来自|由)\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim())
    .filter((value) => value.length >= 2 && value.length <= 80)
    .filter((value) => normalizeDomains([value]).length === 0)
    .filter((value) => !/^(?:公开|现有|可得|网络|互联网|权威|一手|原始|指定|上述|这些|相关)$/u.test(value)))]
}

function candidateMatchesPublisherName(
  candidate: { url?: string; title?: string; publisher?: string; snippet?: string },
  publisher: string
): boolean {
  const expected = normalizePublisherIdentity(publisher)
  if (expected.length < 2) return false
  const host = sourceHostname(candidate.url ?? '') ?? ''
  const hostLabels = host.split('.').filter(Boolean)
  const publisherIdentity = normalizePublisherIdentity(candidate.publisher ?? '')
  if (publisherIdentity.includes(expected) || expected.includes(publisherIdentity) && publisherIdentity.length >= 3) return true
  if (hostLabels.some((label) => normalizePublisherIdentity(label).includes(expected))) return true
  const titleSegments = (candidate.title ?? '')
    .split(/\s*(?:\||—|–|·|•|:)\s*|\s+-\s+/u)
    .map(normalizePublisherIdentity)
    .filter(Boolean)
  return titleSegments.some((segment) => segment === expected || segment.startsWith(`${expected}official`))
}

function normalizePublisherIdentity(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}
