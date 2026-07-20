import type { CitationResolution, CitationResolutionInput } from '../agents/types.js'
import type { CitationBinding, EvidenceSpan, SourceRecord } from './types.js'

const CITATION_PLACEHOLDER_RE = /\[(claim|evidence):([^\]]+)\]/g

export class CitationResolver {
  resolve(input: CitationResolutionInput): CitationResolution {
    let index = 0
    const bindings: CitationBinding[] = []
    const unresolvedCitationIds: string[] = []
    const spansById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
    const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]))
    const sourcesById = new Map(input.sources.map((source) => [source.id, source]))

    const markdown = input.draft.markdown.replace(CITATION_PLACEHOLDER_RE, (placeholder, kind: string, rawId: string, offset: number) => {
      const targets = parseCitationTargets(kind, rawId)
      const reportClaimText = extractClaimText(input.draft.markdown, offset, placeholder)
      return targets.map((target) => {
        const spanIds = target.kind === 'claim'
          ? claimsById.get(target.id)?.supportSpanIds.filter((spanId) => spansById.has(spanId)) ?? []
          : spansById.has(target.id) ? [target.id] : []
        const citableSpanIds = spanIds.filter((spanId) => {
          const source = sourcesById.get(spansById.get(spanId)?.sourceId ?? '')
          return source ? canCiteSource(source) : false
        })

        if (citableSpanIds.length === 0) {
          unresolvedCitationIds.push(spanIds.length > 0 ? `model_fallback:${target.kind}:${target.id}` : `${target.kind}:${target.id}`)
          return ''
        }

        index += 1
        const bindingId = `cit_${index}`
        bindings.push({
          id: bindingId,
          reportPath: input.reportPath,
          reportAnchor: `${target.kind}:${target.id}:${offset}`,
          reportClaimText,
          claimId: target.kind === 'claim' ? target.id : undefined,
          evidenceSpanIds: citableSpanIds,
          status: 'verified',
          verifiedAt: input.nowIso
        })

        return renderInlineCitation(bindingId, citableSpanIds, spansById, sourcesById)
      }).join('')
    })

    return {
      markdown,
      bindings,
      unresolvedCitationIds,
      generatedAt: input.nowIso
    }
  }
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

function extractClaimText(markdown: string, placeholderOffset: number, placeholder: string): string {
  const lineStart = markdown.lastIndexOf('\n', placeholderOffset) + 1
  const lineEnd = markdown.indexOf('\n', placeholderOffset)
  const line = markdown.slice(lineStart, lineEnd === -1 ? markdown.length : lineEnd)
  return line.replace(placeholder, '').replace(/^[\s*-]+/, '').trim()
}

function renderInlineCitation(
  bindingId: string,
  spanIds: string[],
  spansById: Map<string, EvidenceSpan>,
  sourcesById: Map<string, SourceRecord>
): string {
  const spans = spanIds.map((spanId) => spansById.get(spanId)).filter((s): s is EvidenceSpan => Boolean(s))
  const sources = spans.map((span) => sourcesById.get(span.sourceId)).filter((s): s is SourceRecord => Boolean(s))
  const span = spans[0]
  const source = sources[0]
  const href = citationHref(span, source)
  const label = bindingId.replace(/^cit_/, '')
  const title = escapeHtmlAttribute(source?.title ?? span?.sourceId ?? bindingId)
  if (!href) {
    return `<sup data-citation-id="${escapeHtmlAttribute(bindingId)}" title="${title}">[${label}]</sup>`
  }
  return `<sup data-citation-id="${escapeHtmlAttribute(bindingId)}"><a href="${escapeHtmlAttribute(href)}" title="${title}" target="_blank" rel="noreferrer">[${label}]</a></sup>`
}

function citationHref(span: EvidenceSpan | undefined, source: SourceRecord | undefined): string {
  const value = span?.location.url ?? source?.canonicalUrl ?? source?.originalUrl ?? source?.path ?? ''
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return ''
}

function canCiteSource(source: SourceRecord): boolean {
  return !isModelFallbackSource(source)
}

function isModelFallbackSource(source: SourceRecord): boolean {
  return source.kind === 'model_fallback' ||
    source.sourcePolicyTags.includes('model_generated') ||
    source.sourcePolicyTags.includes('requires_external_verification')
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
