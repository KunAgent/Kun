/**
 * [INPUT]: 依赖 agents/types 的 CitationResolutionInput、claim/structured-claim/evidence 占位符和 EvidenceEligibility 的证据准入判断
 * [OUTPUT]: 对外提供 CitationResolver，先清除模型自带的未绑定数字引用，再把同句相邻普通或结构化 claim 合成一个 occurrence，生成句末标点在前、引用在后的 Markdown 引用、唯一文末定义和句子级 CitationBinding，并修复引用标记后正文粘连；来源标题误为 URL 时生成域名加文件名的人类可读标题
 * [POS]: research/evidence 的引用绑定器，位于 SynthesisWriter draft 与 QualityVerifier 之间；每个 occurrence 保留全部 claim/span，不再把复合句错误绑定给单个 claim
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CitationResolution, CitationResolutionInput } from '../agents/types.js'
import type { CitationBinding, EvidenceSpan, SourceRecord } from './types.js'
import { canCiteEvidenceSpan, normalizeSourceUrl } from './EvidenceEligibility.js'
import { citationSentenceAtOffset } from './CitationProximity.js'

const CITATION_PLACEHOLDER_RE = /\[(structured-claim|claim|evidence):([^\]]+)\]/g

export class CitationResolver {
  resolve(input: CitationResolutionInput): CitationResolution {
    let index = 0
    const bindings: CitationBinding[] = []
    const unresolvedCitationIds: string[] = []
    const citationDefinitionsByDisplayId = new Map<string, string>()
    const displayIdBySourceKey = new Map<string, string>()
    const spansById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
    const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]))
    const sourcesById = new Map(input.sources.map((source) => [source.id, source]))

    const draftMarkdown = coalesceAdjacentCitationPlaceholders(stripUnboundNumericCitations(input.draft.markdown))
    const markdown = draftMarkdown.replace(CITATION_PLACEHOLDER_RE, (placeholder, kind: string, rawId: string, offset: number) => {
      const targets = parseCitationTargets(kind, rawId)
      const reportClaimText = extractClaimText(draftMarkdown, offset)
      const resolvedTargets = targets.flatMap((target) => {
        const spanIds = target.kind === 'claim'
          ? claimsById.get(target.id)?.supportSpanIds.filter((spanId) => spansById.has(spanId)) ?? []
          : spansById.has(target.id) ? [target.id] : []
        const citableSpanIds = spanIds.filter((spanId) => {
          const span = spansById.get(spanId)
          const source = sourcesById.get(spansById.get(spanId)?.sourceId ?? '')
          return canCiteEvidenceSpan(span, source)
        })

        if (citableSpanIds.length === 0) {
          unresolvedCitationIds.push(spanIds.length > 0 ? `model_fallback:${target.kind}:${target.id}` : `${target.kind}:${target.id}`)
          return []
        }
        return [{ target, citableSpanIds }]
      })
      if (resolvedTargets.length === 0) return ''

      index += 1
      const bindingId = `cit_occ_${index}`
      const claimIds = [...new Set(resolvedTargets
        .filter(({ target }) => target.kind === 'claim')
        .map(({ target }) => target.id))]
      const allSpanIds = [...new Set(resolvedTargets.flatMap(({ citableSpanIds }) => citableSpanIds))]
      const spansBySourceKey = new Map<string, string[]>()
      for (const { citableSpanIds } of resolvedTargets) {
        const sourceKey = citationSourceKey(citableSpanIds, spansById, sourcesById)
        const grouped = spansBySourceKey.get(sourceKey) ?? []
        grouped.push(...citableSpanIds)
        spansBySourceKey.set(sourceKey, [...new Set(grouped)])
      }
      const renderedMarkers: string[] = []
      const displayIds: string[] = []
      for (const [sourceKey, sourceSpanIds] of spansBySourceKey) {
        let displayId = displayIdBySourceKey.get(sourceKey)
        if (!displayId) {
          displayId = `cit_${displayIdBySourceKey.size + 1}`
          displayIdBySourceKey.set(sourceKey, displayId)
        }
        displayIds.push(displayId)
        const rendered = renderMarkdownCitation(displayId, sourceSpanIds, spansById, sourcesById)
        if (!citationDefinitionsByDisplayId.has(displayId)) {
          citationDefinitionsByDisplayId.set(displayId, rendered.definition)
        }
        renderedMarkers.push(rendered.marker)
      }
      bindings.push({
        id: bindingId,
        displayId: displayIds[0],
        displayIds,
        reportPath: input.reportPath,
        reportAnchor: `${targets.map((target) => `${target.kind}:${target.id}`).join(',')}:${offset}`,
        reportClaimText,
        ...(claimIds.length === 1 ? { claimId: claimIds[0] } : {}),
        ...(claimIds.length > 0 ? { claimIds } : {}),
        evidenceSpanIds: allSpanIds,
        status: 'verified',
        verifiedAt: input.nowIso
      })
      return [...new Set(renderedMarkers)].join('')
    })

    return {
      markdown: appendCitationDefinitions(
        normalizeResolvedSentenceBoundaries(normalizeResolvedCitationPlacement(collapseAdjacentDuplicateMarkers(markdown))),
        [...citationDefinitionsByDisplayId.values()]
      ),
      bindings,
      unresolvedCitationIds,
      generatedAt: input.nowIso
    }
  }
}

function coalesceAdjacentCitationPlaceholders(markdown: string): string {
  let result = markdown
  while (true) {
    const combined = result.replace(
      /\[(structured-claim|claim|evidence):([^\]]+)\]\s*\[\1:([^\]]+)\]/gu,
      (_match, kind: string, left: string, right: string) => `[${kind}:${left},${right}]`
    )
    if (combined === result) return result
    result = combined
  }
}

function stripUnboundNumericCitations(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*\[\d+\]:\s*/u.test(line))
    .join('\n')
    .replace(/\[\d+\](?!\s*\()/gu, '')
}

function citationSourceKey(
  spanIds: string[],
  spansById: Map<string, EvidenceSpan>,
  sourcesById: Map<string, SourceRecord>
): string {
  const sourceIds = [...new Set(spanIds
    .map((spanId) => spansById.get(spanId)?.sourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId)))]
  return sourceIds.map((sourceId) => {
    const source = sourcesById.get(sourceId)
    const url = source?.canonicalUrl ?? source?.originalUrl
    return url ? normalizeSourceUrl(url) : source?.path ?? sourceId
  }).sort().join('|')
}

function collapseAdjacentDuplicateMarkers(markdown: string): string {
  return markdown.replace(/(\[(\d+)\])(?:\s*\[\2\])+/gu, '$1')
}

function normalizeResolvedCitationPlacement(markdown: string): string {
  return markdown.replace(
    /\s*((?:\[\d+\]\s*)+)([。！？!?；;])/gu,
    (_match, markers: string, punctuation: string) => `${punctuation} ${markers.replace(/\s+/gu, '')}`
  )
}

function normalizeResolvedSentenceBoundaries(markdown: string): string {
  return markdown.replace(
    /((?:\[\d+\]\s*)+)(?=[\p{L}\p{N}])/gu,
    (_match, markers: string) => `${markers.replace(/\s+/gu, '')}\n\n`
  )
}

type CitationTarget = { kind: 'claim' | 'evidence'; id: string }

function parseCitationTargets(defaultKind: string, rawId: string): CitationTarget[] {
  const fallbackKind: 'claim' | 'evidence' = defaultKind === 'evidence' ? 'evidence' : 'claim'
  return rawId
    .split(/[,，;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map<CitationTarget>((part) => {
      const match = part.match(/^(claim|evidence):(.+)$/)
      if (!match) return { kind: fallbackKind, id: part.trim() }
      return { kind: match[1] === 'evidence' ? 'evidence' : 'claim', id: match[2]?.trim() ?? '' }
    })
    .filter((target) => target.id.length > 0)
}

function extractClaimText(markdown: string, placeholderOffset: number): string {
  return citationSentenceAtOffset(markdown, placeholderOffset)
    .replace(CITATION_PLACEHOLDER_RE, '')
    .replace(/^[\s*-]+/, '')
    .trim()
}

function renderMarkdownCitation(
  bindingId: string,
  spanIds: string[],
  spansById: Map<string, EvidenceSpan>,
  sourcesById: Map<string, SourceRecord>
): { marker: string; definition: string } {
  const spans = spanIds.map((spanId) => spansById.get(spanId)).filter((s): s is EvidenceSpan => Boolean(s))
  const sources = spans.map((span) => sourcesById.get(span.sourceId)).filter((s): s is SourceRecord => Boolean(s))
  const span = spans[0]
  const source = sources[0]
  const href = citationHref(span, source)
  const label = bindingId.replace(/^cit_/, '')
  const title = escapeMarkdownTitle(readableCitationTitle(source?.title, href, span?.sourceId ?? bindingId))
  const destination = href ? `<${href.replace(/>/g, '%3E')}>` : `#citation-${label}`
  return {
    marker: `[${label}]`,
    definition: `[${label}]: ${destination} "${title}"`
  }
}

function appendCitationDefinitions(markdown: string, definitions: string[]): string {
  if (definitions.length === 0) return markdown
  return `${markdown.trim()}\n\n${definitions.join('\n')}\n`
}

function citationHref(span: EvidenceSpan | undefined, source: SourceRecord | undefined): string {
  const value = span?.location.url ?? source?.canonicalUrl ?? source?.originalUrl ?? source?.path ?? ''
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return ''
}

function escapeMarkdownTitle(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim()
}

function readableCitationTitle(title: string | undefined, href: string, fallback: string): string {
  const candidate = title?.trim() ?? ''
  if (candidate && !/^https?:\/\//iu.test(candidate)) return candidate
  const urlText = href || candidate
  try {
    const url = new URL(urlText)
    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
    return filename ? `${url.hostname} - ${filename}` : url.hostname
  } catch {
    return fallback
  }
}
