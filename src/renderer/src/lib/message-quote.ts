import {
  ComposerContextAttachmentSchema,
  type ComposerContextAttachment
} from '@kun/extension-api'

export const MESSAGE_QUOTE_KIND = 'message-quote'
/** Characters kept from one selection (UTF-16 units, before quote markers). */
export const MAX_MESSAGE_QUOTE_CHARS = 2_000
/** Composer context reference strings are capped at 2048 UTF-16 units. */
const MAX_MESSAGE_QUOTE_FIELD_LENGTH = 2_040
export const MAX_MESSAGE_QUOTES_PER_TURN = 4

export type MessageQuoteRole = 'assistant' | 'user'

/** A passage the user selected in the conversation to reply to. */
export type MessageQuote = {
  id: string
  text: string
  role: MessageQuoteRole
  /** Code points in the selection before any clipping. */
  charCount: number
  truncated: boolean
  sourceBlockId?: string
}

/** The quote as rendered back from a sent turn's composer contexts. */
export type MessageQuoteDisplay = Pick<MessageQuote, 'text' | 'role' | 'truncated' | 'sourceBlockId'>

function clipUtf16(value: string, maxLength: number): string {
  const clipped = value.slice(0, Math.max(0, maxLength))
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped
}

function stripControlCharacters(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    out += (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : character
  }
  return out
}

/**
 * Normalize a raw DOM selection into quote text: unify line endings, drop
 * zero-width and control characters, trim trailing spaces, collapse blank
 * runs and clip to the per-quote budget.
 */
export function normalizeMessageQuoteText(raw: string): {
  text: string
  charCount: number
  truncated: boolean
} {
  const normalized = stripControlCharacters(
    raw
      .replace(/\r\n?/g, '\n')
      .replaceAll('\u00a0', ' ')
      .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const charCount = Array.from(normalized).length
  if (normalized.length <= MAX_MESSAGE_QUOTE_CHARS) {
    return { text: normalized, charCount, truncated: false }
  }
  return {
    text: clipUtf16(normalized, MAX_MESSAGE_QUOTE_CHARS).trimEnd(),
    charCount,
    truncated: true
  }
}

/**
 * Quote text travels as a Markdown blockquote. Besides reading naturally to
 * the model, the leading `>` keeps a selected path such as `/Users/...` from
 * tripping the composer-context ban on strings that start like an absolute
 * filesystem path.
 */
export function messageQuoteToBlockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

export function messageQuoteFromBlockquote(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')
}

export function createMessageQuote(input: {
  rawText: string
  role: MessageQuoteRole
  sourceBlockId?: string | null
  now?: number
}): MessageQuote | null {
  const { text, charCount, truncated } = normalizeMessageQuoteText(input.rawText)
  if (!text) return null
  const sourceBlockId = stableSourceBlockId(input.sourceBlockId)
  return {
    id: `quote-${(input.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    role: input.role,
    charCount,
    truncated,
    ...(sourceBlockId ? { sourceBlockId } : {})
  }
}

/** Live overlay ids are replaced when the turn settles; never point at them. */
function stableSourceBlockId(value: string | null | undefined): string | undefined {
  const id = value?.trim()
  if (!id || id.length > 128 || /^live[-_]/.test(id)) return undefined
  return /^[A-Za-z0-9][A-Za-z0-9._:~-]*$/.test(id) ? id : undefined
}

/** Same passage of the same message: adding it twice is a no-op. */
export function sameMessageQuote(a: MessageQuote, b: MessageQuote): boolean {
  return a.role === b.role &&
    (a.sourceBlockId ?? '') === (b.sourceBlockId ?? '') &&
    a.text === b.text
}

/** Append a quote, skipping duplicates and keeping the newest per-turn budget. */
export function appendMessageQuote(
  quotes: readonly MessageQuote[],
  quote: MessageQuote
): MessageQuote[] {
  if (quotes.some((candidate) => sameMessageQuote(candidate, quote))) return [...quotes]
  return [...quotes, quote].slice(-MAX_MESSAGE_QUOTES_PER_TURN)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createMessageQuoteAttachment(input: {
  workspaceRoot: string
  quote: MessageQuote
  now?: number
}): Promise<ComposerContextAttachment> {
  const { quote } = input
  const blockquote = messageQuoteToBlockquote(quote.text)
  const quoted = clipUtf16(blockquote, MAX_MESSAGE_QUOTE_FIELD_LENGTH)
  const truncated = quote.truncated || quoted.length < blockquote.length
  const workspaceId = await sha256Hex(input.workspaceRoot.trim() || '__default__')
  const identity = await sha256Hex(JSON.stringify({
    workspaceId,
    role: quote.role,
    sourceBlockId: quote.sourceBlockId ?? null,
    quoted
  }))
  return ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `message-quote-${identity.slice(0, 24)}`,
    title: quote.role === 'assistant' ? 'Quoted assistant reply' : 'Quoted user message',
    summary: 'The user is replying to this excerpt from earlier in the conversation',
    reference: {
      kind: MESSAGE_QUOTE_KIND,
      schemaVersion: 1,
      role: quote.role,
      quote: quoted,
      charCount: quote.charCount,
      truncated,
      ...(quote.sourceBlockId ? { messageId: quote.sourceBlockId } : {})
    },
    revision: Math.max(0, Math.floor(input.now ?? Date.now())),
    generation: 0,
    attachmentId: `workspace-selection-context:${identity}`,
    provenance: { source: 'workspace-selection', workspaceId }
  })
}

export async function createMessageQuoteAttachments(input: {
  workspaceRoot: string
  quotes: readonly MessageQuote[]
  now?: number
}): Promise<ComposerContextAttachment[]> {
  const unique = new Map<string, ComposerContextAttachment>()
  for (const quote of input.quotes.slice(-MAX_MESSAGE_QUOTES_PER_TURN)) {
    const attachment = await createMessageQuoteAttachment({
      workspaceRoot: input.workspaceRoot,
      quote,
      now: input.now
    })
    unique.set(attachment.attachmentId, attachment)
  }
  return [...unique.values()]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Read a message quote back out of one composer context (sent or pending). */
export function messageQuoteFromComposerContext(value: unknown): MessageQuoteDisplay | null {
  const reference = asRecord(asRecord(value)?.reference)
  if (!reference || reference.kind !== MESSAGE_QUOTE_KIND) return null
  if (typeof reference.quote !== 'string' || !reference.quote.trim()) return null
  const role: MessageQuoteRole = reference.role === 'user' ? 'user' : 'assistant'
  const sourceBlockId = typeof reference.messageId === 'string' && reference.messageId
    ? reference.messageId
    : undefined
  return {
    text: messageQuoteFromBlockquote(reference.quote).trim(),
    role,
    truncated: reference.truncated === true,
    ...(sourceBlockId ? { sourceBlockId } : {})
  }
}

export function messageQuotesFromComposerContexts(
  contexts: readonly unknown[] | undefined
): MessageQuoteDisplay[] {
  if (!contexts?.length) return []
  return contexts.flatMap((context) => {
    const quote = messageQuoteFromComposerContext(context)
    return quote ? [quote] : []
  })
}
