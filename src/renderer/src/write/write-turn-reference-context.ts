import {
  ComposerContextAttachmentSchema,
  MAX_COMPOSER_CONTEXT_ATTACHMENTS,
  type ComposerContextAttachment,
  type JsonObject
} from '@kun/extension-api'
import type { WriteRetrievalContext, WriteRetrievalSnippet } from '@shared/write-retrieval'
import {
  normalizeWriteQuotedSelections,
  type WriteOfficeDocumentContext,
  type WriteQuotedSelection
} from './quoted-selection'
import type { WritePaperReference } from './write-paper-reference'

export const MAX_WRITE_OFFICE_EXCERPT_BYTES = 5_000
const MAX_OFFICE_EXCERPT_SEGMENTS = 3
const MAX_OFFICE_EXCERPT_SEGMENT_CHARS = 1_800
const MAX_RETRIEVAL_SNIPPETS = 4
const MAX_RETRIEVAL_SNIPPET_CHARS = 450
const MAX_RETRIEVAL_KEYWORDS = 4
const MAX_RETRIEVAL_KEYWORD_CHARS = 64

type WorkReferenceKind =
  | 'work-reference-resource'
  | 'work-reference-quotes'
  | 'work-reference-retrieval'
  | 'work-reference-office'
  | 'work-reference-whiteboard'
  | 'work-reference-paper'

export type WriteActiveResourceReference = {
  sourceName: string
  locator: string
  resourceKind: 'text' | 'code' | 'image' | 'pdf' | 'office'
  access: 'read-write' | 'read-only'
  sourceFormat?: string
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function clipUnicode(value: string, maxChars: number): string {
  const clipped = value.slice(0, Math.max(0, maxChars))
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped
}

function clipUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (utf8Bytes(value) <= maxBytes) return value
  const chars = Array.from(value)
  let low = 0
  let high = chars.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (utf8Bytes(chars.slice(0, middle).join('')) <= maxBytes) low = middle
    else high = middle - 1
  }
  return chars.slice(0, low).join('')
}

function compactText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : character
    })
    .join('')
    .replace(/[\t ]+/g, ' ')
    .trim()
}

const VERBATIM_EXCERPT_PREFIX = '[verbatim excerpt]\n'

/**
 * ComposerContext rejects path-shaped string values so first-party metadata
 * cannot smuggle filesystem locations. Evidence can legitimately begin with a
 * path (for example a quoted shell command), so mark that value as readable
 * verbatim content instead of changing or encoding away its meaning.
 */
function pathSafeEvidenceText(value: string): string {
  const trimmed = value.trim()
  return /^(?:file:|\/|\\\\|[A-Za-z]:[\\/])/i.test(trimmed)
    ? `${VERBATIM_EXCERPT_PREFIX}${value}`
    : value
}

function pathFreeSourceName(value: string): string {
  const normalized = value.replaceAll('\\', '/').trim()
  const pathFree = normalized.split('/').filter(Boolean).at(-1) ?? 'document'
  return clipUnicode(pathFree || 'document', 128)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function createAttachment(input: {
  workspaceRoot: string
  kind: WorkReferenceKind
  title: string
  summary: string
  reference: JsonObject
  provenance: 'workspace-selection' | 'workspace-view'
  now: number
}): Promise<ComposerContextAttachment> {
  const workspaceId = await sha256Hex(input.workspaceRoot.trim() || '__default__')
  const identity = await sha256Hex(JSON.stringify({
    workspaceId,
    kind: input.kind,
    reference: input.reference
  }))
  const prefix = input.provenance === 'workspace-selection'
    ? 'workspace-selection-context'
    : 'workspace-view-context'
  return ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `${input.kind}-${identity.slice(0, 24)}`,
    title: clipUnicode(input.title.trim(), 128),
    summary: clipUnicode(input.summary.trim(), 1_024),
    reference: input.reference,
    revision: Math.max(0, Math.floor(input.now)),
    generation: 0,
    attachmentId: `${prefix}:${identity}`,
    provenance: { source: input.provenance, workspaceId }
  })
}

function quoteReference(selection: WriteQuotedSelection): JsonObject {
  const reference: JsonObject = {
    sourceName: pathFreeSourceName(selection.sourceTitle),
    sourceKind: selection.sourceKind ?? 'text',
    charCount: selection.charCount,
    text: pathSafeEvidenceText(selection.text)
  }
  if (selection.sourceFormat) reference.sourceFormat = selection.sourceFormat
  if (selection.lineStart != null) reference.lineStart = selection.lineStart
  if (selection.lineEnd != null) reference.lineEnd = selection.lineEnd
  if (selection.pageStart != null) reference.pageStart = selection.pageStart
  if (selection.pageEnd != null) reference.pageEnd = selection.pageEnd
  if (selection.slide != null) reference.slide = selection.slide
  if (selection.sheetName) {
    reference.sheetName = pathSafeEvidenceText(clipUnicode(selection.sheetName, 128))
  }
  if (selection.cellRange) {
    reference.cellRange = pathSafeEvidenceText(clipUnicode(selection.cellRange, 128))
  }
  if (selection.formulas?.length) {
    reference.formulas = selection.formulas.map((formula) => (
      pathSafeEvidenceText(clipUnicode(formula, 2_000))
    ))
  }
  return reference
}

function paperReference(paper: WritePaperReference): JsonObject {
  const text = (value: string, max: number): string => pathSafeEvidenceText(clipUnicode(compactText(value), max))
  const locator = (value: string): string => pathSafeEvidenceText(clipUnicode(value, 1_024))
  return {
    kind: 'work-reference-paper',
    schemaVersion: 1,
    title: text(paper.title, 300),
    ...(paper.authors.length ? { authors: paper.authors.slice(0, 8).map((author) => text(author, 80)) } : {}),
    ...(paper.year ? { year: text(paper.year, 16) } : {}),
    ...(paper.venue ? { venue: text(paper.venue, 160) } : {}),
    ...(paper.arxivId ? { arxivId: text(paper.arxivId, 64) } : {}),
    ...(paper.doi ? { doi: text(paper.doi, 160) } : {}),
    unitLocator: locator(paper.unitLocator),
    ...(paper.textLocator ? { textLocator: locator(paper.textLocator) } : {}),
    ...(paper.notesLocator ? { notesLocator: locator(paper.notesLocator) } : {}),
    ...(paper.pdfLocator ? { pdfLocator: locator(paper.pdfLocator) } : {}),
    ...(paper.page ? { page: paper.page } : {}),
    ...(paper.pageCount ? { pageCount: paper.pageCount } : {})
  }
}

function retrievalLocation(snippet: WriteRetrievalSnippet): JsonObject {
  return snippet.location.kind === 'pdf'
    ? { kind: 'pdf', pageStart: snippet.location.pageStart, pageEnd: snippet.location.pageEnd }
    : { kind: 'text', lineStart: snippet.location.lineStart, lineEnd: snippet.location.lineEnd }
}

function normalizedEvidence(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function filterWriteRetrievalAgainstQuotes(
  retrieval: WriteRetrievalContext | null,
  selections: readonly WriteQuotedSelection[]
): WriteRetrievalContext | null {
  if (!retrieval || selections.length === 0) return retrieval
  const quoteTexts = selections.map((selection) => normalizedEvidence(selection.text)).filter(Boolean)
  const snippets = retrieval.snippets.filter((snippet) => {
    const snippetText = normalizedEvidence(snippet.text)
    if (!snippetText) return false
    return !quoteTexts.some((quoteText) => (
      quoteText === snippetText ||
      (Math.min(quoteText.length, snippetText.length) >= 32 &&
        (quoteText.includes(snippetText) || snippetText.includes(quoteText)))
    ))
  })
  return snippets.length > 0 ? { ...retrieval, snippets } : null
}

function queryTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLowerCase()
  const terms: string[] = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (const segment of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = Array.from(segment)
    if (chars.length <= 4) terms.push(segment)
    else {
      for (let index = 0; index < chars.length - 1 && terms.length < 32; index += 1) {
        terms.push(chars.slice(index, index + 2).join(''))
      }
    }
  }
  return [...new Set(terms)].slice(0, 32)
}

function sentenceChunks(paragraph: string): string[] {
  if (paragraph.length <= MAX_OFFICE_EXCERPT_SEGMENT_CHARS) return [paragraph]
  const sentences = paragraph.split(/(?<=[。！？!?])\s+/u).map(compactText).filter(Boolean)
  if (sentences.length <= 1) {
    return Array.from({ length: Math.ceil(paragraph.length / MAX_OFFICE_EXCERPT_SEGMENT_CHARS) }, (_, index) => (
      paragraph.slice(
        index * MAX_OFFICE_EXCERPT_SEGMENT_CHARS,
        (index + 1) * MAX_OFFICE_EXCERPT_SEGMENT_CHARS
      )
    )).filter(Boolean)
  }
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > MAX_OFFICE_EXCERPT_SEGMENT_CHARS) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current} ${sentence}` : sentence
  }
  if (current) chunks.push(current)
  return chunks
}

function officeParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/u)
    .map((paragraph) => compactText(paragraph))
    .filter(Boolean)
    .flatMap(sentenceChunks)
}

function representativeParagraphs(paragraphs: string[]): string[] {
  if (paragraphs.length <= MAX_OFFICE_EXCERPT_SEGMENTS) return paragraphs
  const indexes = [0, Math.floor((paragraphs.length - 1) / 2), paragraphs.length - 1]
  return [...new Set(indexes)].map((index) => paragraphs[index]).filter(Boolean) as string[]
}

export function selectWriteOfficeExcerpt(
  text: string,
  query: string
): { segments: string[]; strategy: 'query-matched' | 'representative'; excerptChars: number } {
  const paragraphs = officeParagraphs(text)
  const terms = queryTerms(query)
  const ranked = paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: terms.reduce((score, term) => score + (paragraph.toLowerCase().includes(term) ? 1 : 0), 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_OFFICE_EXCERPT_SEGMENTS)
    .sort((left, right) => left.index - right.index)
  const strategy = ranked.length > 0 ? 'query-matched' as const : 'representative' as const
  const candidates = ranked.length > 0
    ? ranked.map((entry) => entry.paragraph)
    : representativeParagraphs(paragraphs)
  const segments: string[] = []
  let remainingBytes = MAX_WRITE_OFFICE_EXCERPT_BYTES
  for (const candidate of candidates) {
    const segment = clipUtf8(
      clipUnicode(candidate, MAX_OFFICE_EXCERPT_SEGMENT_CHARS),
      remainingBytes
    ).trim()
    if (!segment) continue
    segments.push(segment)
    remainingBytes -= utf8Bytes(segment)
    if (segments.length === MAX_OFFICE_EXCERPT_SEGMENTS || remainingBytes <= 0) break
  }
  return {
    segments,
    strategy,
    excerptChars: segments.reduce((total, segment) => total + Array.from(segment).length, 0)
  }
}

export async function createWriteTurnReferenceAttachments(input: {
  workspaceRoot: string
  activeResource?: WriteActiveResourceReference | undefined
  selections: readonly WriteQuotedSelection[]
  retrieval: WriteRetrievalContext | null
  officeDocument: WriteOfficeDocumentContext | null
  query: string
  /** The open paper: its identity and where its text lives. */
  paper?: WritePaperReference
  now?: number
}): Promise<ComposerContextAttachment[]> {
  const now = input.now ?? Date.now()
  const selections = normalizeWriteQuotedSelections(input.selections)
  const retrieval = filterWriteRetrievalAgainstQuotes(input.retrieval, selections)
  const attachments: ComposerContextAttachment[] = []
  if (input.activeResource) {
    const resource = input.activeResource
    attachments.push(await createAttachment({
      workspaceRoot: input.workspaceRoot,
      kind: 'work-reference-resource',
      title: `Current Work resource · ${pathFreeSourceName(resource.sourceName)}`,
      summary: resource.access === 'read-write'
        ? 'Active workspace-relative editing target'
        : 'Active read-only resource',
      reference: {
        kind: 'work-reference-resource',
        schemaVersion: 1,
        sourceName: pathFreeSourceName(resource.sourceName),
        locator: pathSafeEvidenceText(clipUnicode(resource.locator, 1_024)),
        resourceKind: resource.resourceKind,
        access: resource.access,
        ...(resource.sourceFormat
          ? { sourceFormat: clipUnicode(resource.sourceFormat, 32) }
          : {})
      },
      provenance: 'workspace-view',
      now
    }))
  }
  if (input.paper) {
    attachments.push(await createAttachment({
      workspaceRoot: input.workspaceRoot,
      kind: 'work-reference-paper',
      title: `Current paper · ${clipUnicode(compactText(input.paper.title), 96)}`,
      summary: 'The open paper; read its text from the workspace-relative locators',
      reference: paperReference(input.paper),
      provenance: 'workspace-view',
      now
    }))
  }
  if (selections.length > 0) {
    attachments.push(await createAttachment({
      workspaceRoot: input.workspaceRoot,
      kind: 'work-reference-quotes',
      title: `Work references (${selections.length})`,
      summary: 'Exact user-selected passages for this turn',
      reference: {
        kind: 'work-reference-quotes',
        schemaVersion: 1,
        quotes: selections.map(quoteReference)
      },
      provenance: 'workspace-selection',
      now
    }))
  }
  if (retrieval?.snippets.length) {
    attachments.push(await createAttachment({
      workspaceRoot: input.workspaceRoot,
      kind: 'work-reference-retrieval',
      title: 'Related Work context',
      summary: `${Math.min(retrieval.snippets.length, MAX_RETRIEVAL_SNIPPETS)} bounded retrieval snippets`,
      reference: {
        kind: 'work-reference-retrieval',
        schemaVersion: 1,
        source: retrieval.source,
        keywords: retrieval.keywords
          .slice(0, 8)
          .map((keyword) => pathSafeEvidenceText(
            clipUnicode(compactText(keyword), MAX_RETRIEVAL_KEYWORD_CHARS)
          )),
        snippets: retrieval.snippets.slice(0, MAX_RETRIEVAL_SNIPPETS).map((snippet) => ({
          sourceName: pathFreeSourceName(snippet.path),
          title: pathSafeEvidenceText(clipUnicode(compactText(snippet.title), 128)),
          text: pathSafeEvidenceText(
            clipUnicode(compactText(snippet.text), MAX_RETRIEVAL_SNIPPET_CHARS)
          ),
          keywords: snippet.keywords
            .slice(0, MAX_RETRIEVAL_KEYWORDS)
            .map((keyword) => pathSafeEvidenceText(
              clipUnicode(compactText(keyword), MAX_RETRIEVAL_KEYWORD_CHARS)
            )),
          location: retrievalLocation(snippet)
        }))
      },
      provenance: 'workspace-view',
      now
    }))
  }
  if (input.officeDocument?.text.trim()) {
    const excerpt = selectWriteOfficeExcerpt(input.officeDocument.text, input.query)
    if (excerpt.segments.length > 0) {
      const originalChars = Array.from(input.officeDocument.text).length
      attachments.push(await createAttachment({
        workspaceRoot: input.workspaceRoot,
        kind: 'work-reference-office',
        title: pathFreeSourceName(input.officeDocument.sourceTitle),
        summary: `${excerpt.strategy === 'query-matched' ? 'Relevant' : 'Representative'} Office excerpt · ${excerpt.excerptChars}/${originalChars} characters`,
        reference: {
          kind: 'work-reference-office',
          schemaVersion: 1,
          sourceName: pathFreeSourceName(input.officeDocument.sourceTitle),
          sourceFormat: input.officeDocument.sourceFormat,
          sourceSha256: input.officeDocument.sourceSha256,
          strategy: excerpt.strategy,
          originalCharCount: originalChars,
          excerptCharCount: excerpt.excerptChars,
          sourceWasTruncated: input.officeDocument.truncated,
          excerptWasTruncated: excerpt.excerptChars < originalChars,
          segments: excerpt.segments.map(pathSafeEvidenceText)
        },
        provenance: 'workspace-view',
        now
      }))
    }
  }
  return attachments
}

/**
 * Keep the Work submission inside the shared ComposerContext budget before it
 * reaches the chat store. Explicit references win, then the focused Office
 * view, then optional PPT workflow state; attachment identity de-duplicates
 * overlapping sources without changing their selected priority.
 */
export function mergeWriteComposerContexts(
  references: readonly ComposerContextAttachment[],
  views: readonly ComposerContextAttachment[],
  ppt: readonly ComposerContextAttachment[]
): ComposerContextAttachment[] {
  const contexts: ComposerContextAttachment[] = []
  const seen = new Set<string>()
  for (const context of [...references, ...views, ...ppt]) {
    if (seen.has(context.attachmentId)) continue
    seen.add(context.attachmentId)
    contexts.push(context)
    if (contexts.length === MAX_COMPOSER_CONTEXT_ATTACHMENTS) break
  }
  return contexts
}

export function isWriteTurnReferenceAttachment(
  attachment: ComposerContextAttachment
): boolean {
  const parsed = ComposerContextAttachmentSchema.safeParse(attachment)
  if (!parsed.success) return false
  const kind = parsed.data.reference.kind
  return (
    kind === 'work-reference-resource' ||
    kind === 'work-reference-quotes' ||
    kind === 'work-reference-retrieval' ||
    kind === 'work-reference-office' ||
    kind === 'work-reference-whiteboard' ||
    kind === 'work-reference-paper'
  ) && (
    ('source' in parsed.data.provenance && parsed.data.provenance.source === 'workspace-selection') ||
    ('source' in parsed.data.provenance && parsed.data.provenance.source === 'workspace-view')
  )
}
