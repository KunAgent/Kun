/**
 * [INPUT]: 依赖 CitationBinding，接收已解析引用的最终 Markdown
 * [OUTPUT]: 对外提供 reportPublicationSafetyIssues，复用已有近义句算法并检测主要发现中的跨章重复证据、乱码、空引用句、内部标记泄漏和破损 Markdown
 * [POS]: research/verification 的低成本发布格式安全门，只处理确定性缺陷，不评价篇幅、文风或研究深度
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CitationBinding } from '../evidence/types.js'
import { repeatedFindingSentenceAcrossSections } from '../evidence/CitationProximity.js'

type FindingSection = {
  title: string
  body: string
}

export function reportPublicationSafetyIssues(
  markdown: string,
  citations: CitationBinding[] = []
): string[] {
  const issues: string[] = []
  if (containsGarbledText(markdown)) {
    issues.push('报告包含乱码、非法控制字符或错误编码残片。')
  }
  if (/\[(?:claim|structured-claim|evidence):[^\]]+\]/iu.test(markdown)) {
    issues.push('报告泄漏了内部 claim/evidence 协议标记。')
  }
  if (containsCitationOnlyFragment(markdown)) {
    issues.push('报告包含只剩标点和引用的空句。')
  }
  if (hasBrokenMarkdownStructure(markdown)) {
    issues.push('报告包含未闭合代码块、粘连标题或未闭合引用 HTML，Markdown 结构不完整。')
  }

  const findings = findingSections(markdown)
  const repeatedEvidence = repeatedFindingEvidence(findings, citations)
  if (repeatedEvidence) issues.push(repeatedEvidence)
  const repeatedSentence = repeatedFindingSentenceAcrossSections(markdown)
  if (repeatedSentence) {
    issues.push(`报告在不同主要发现章节重复发布了相同或近义证据句：${repeatedSentence.slice(0, 120)}`)
  }
  const repeatedParagraph = repeatedFindingParagraph(findings)
  if (repeatedParagraph) issues.push(repeatedParagraph)

  return issues
}

function containsCitationOnlyFragment(markdown: string): boolean {
  return markdown.split('\n').some((line) => {
    if (!/(?:data-citation-id=|\[\d+\](?!:))/iu.test(line)) return false
    return line
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
      .replace(/\[\d+\](?!:)/gu, '')
      .replace(/<[^>]+>/gu, '')
      .replace(/[\s，。；：！？、,.!?:;()（）\[\]{}*_`~>-]+/gu, '')
      .length === 0
  })
}

function containsGarbledText(markdown: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/u.test(markdown) ||
    /(?:ï»¿|â(?:€|€™|€œ|€|€“|€”|€¦)|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|ðŸ)/u.test(markdown)
}

function hasBrokenMarkdownStructure(markdown: string): boolean {
  const fenceCount = markdown.split('\n').filter((line) => /^\s*```/u.test(line)).length
  if (fenceCount % 2 !== 0) return true
  if (markdown.split('\n').some((line) => /^#{1,6}\s+.+\s+#{1,6}\s+\S/u.test(line.trim()))) return true
  return countMatches(markdown, /<sup\b/giu) !== countMatches(markdown, /<\/sup>/giu) ||
    countMatches(markdown, /<a\b/giu) !== countMatches(markdown, /<\/a>/giu)
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length
}

function findingSections(markdown: string): FindingSection[] {
  const sections: FindingSection[] = []
  let inFindings = false
  let currentTitle = ''
  let bodyLines: string[] = []
  const flush = (): void => {
    if (inFindings && currentTitle) {
      sections.push({ title: currentTitle, body: bodyLines.join('\n').trim() })
    }
    currentTitle = ''
    bodyLines = []
  }

  for (const line of markdown.split('\n')) {
    const secondLevel = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.trim()
    if (secondLevel) {
      flush()
      inFindings = isFindingsTitle(secondLevel)
      continue
    }
    const thirdLevel = line.trim().match(/^###\s+(.+?)\s*$/u)?.[1]?.trim()
    if (thirdLevel && inFindings) {
      flush()
      currentTitle = thirdLevel
      continue
    }
    if (inFindings && currentTitle) bodyLines.push(line)
  }
  flush()
  return sections
}

function isFindingsTitle(title: string): boolean {
  return ['主要发现', 'Findings'].some((candidate) =>
    title === candidate || title.startsWith(`${candidate}：`) || title.startsWith(`${candidate}:`)
  )
}

function repeatedFindingEvidence(
  sections: FindingSection[],
  citations: CitationBinding[]
): string | undefined {
  const firstSectionByEvidence = new Map<string, string>()
  for (const section of sections) {
    const evidenceKeys = evidenceKeysUsedBySection(section.body, citations)
    for (const key of evidenceKeys) {
      const firstSection = firstSectionByEvidence.get(key)
      if (firstSection && firstSection !== section.title) {
        return `主要发现的「${firstSection}」与「${section.title}」重复使用了同一条 claim 证据；应只保留一次，并在另一章写新的分析或证据。`
      }
      firstSectionByEvidence.set(key, section.title)
    }
  }
  return undefined
}

function evidenceKeysUsedBySection(body: string, citations: CitationBinding[]): Set<string> {
  const keys = new Set<string>()
  const normalizedBody = normalizeEvidenceText(body)
  for (const citation of citations) {
    if (!sectionUsesCitation(body, normalizedBody, citation)) continue
    const claimIds = citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])
    claimIds.forEach((claimId) => keys.add(`claim:${claimId}`))
    const normalizedClaim = normalizeEvidenceText(citation.reportClaimText)
    if (normalizedClaim.length >= 16) keys.add(`text:${normalizedClaim}`)
  }
  return keys
}

function sectionUsesCitation(
  body: string,
  normalizedBody: string,
  citation: CitationBinding
): boolean {
  if (containsCitationId(body, citation.id)) return true
  const normalizedClaim = normalizeEvidenceText(citation.reportClaimText)
  if (normalizedClaim.length < 8 || !normalizedBody.includes(normalizedClaim)) return false
  return (citation.displayIds ?? (citation.displayId ? [citation.displayId] : []))
    .some((displayId) => containsCitationId(body, displayId))
}

function containsCitationId(body: string, citationId: string): boolean {
  const escaped = escapeRegExp(citationId)
  return new RegExp(`data-citation-id=["']${escaped}["']`, 'iu').test(body) ||
    new RegExp(`\\[\\^?${escaped}\\](?!:)`, 'iu').test(body)
}

function repeatedFindingParagraph(sections: FindingSection[]): string | undefined {
  const firstSectionByParagraph = new Map<string, string>()
  for (const section of sections) {
    const paragraphs = section.body.split(/\n{2,}/u)
    for (const paragraph of paragraphs) {
      const normalized = normalizeEvidenceText(paragraph)
      if (normalized.length < 30) continue
      const firstSection = firstSectionByParagraph.get(normalized)
      if (firstSection && firstSection !== section.title) {
        return `主要发现的「${firstSection}」与「${section.title}」重复发布了相同段落。`
      }
      firstSectionByParagraph.set(normalized, section.title)
    }
  }
  return undefined
}

function normalizeEvidenceText(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/giu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\^?[^\]]+\](?!:)/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/[^\p{L}\p{N}%]+/gu, '')
    .toLowerCase()
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
