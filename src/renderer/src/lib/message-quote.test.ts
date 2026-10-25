import { describe, expect, it } from 'vitest'
import {
  appendMessageQuote,
  createMessageQuote,
  createMessageQuoteAttachment,
  createMessageQuoteAttachments,
  MAX_MESSAGE_QUOTE_CHARS,
  MAX_MESSAGE_QUOTES_PER_TURN,
  messageQuoteFromBlockquote,
  messageQuoteFromComposerContext,
  messageQuotesFromComposerContexts,
  messageQuoteToBlockquote,
  normalizeMessageQuoteText,
  type MessageQuote
} from './message-quote'

function quote(text: string, overrides: Partial<MessageQuote> = {}): MessageQuote {
  return {
    id: `q-${text.slice(0, 6)}`,
    text,
    role: 'assistant',
    charCount: Array.from(text).length,
    truncated: false,
    ...overrides
  }
}

describe('message quote text', () => {
  it('normalizes line endings, invisible characters and blank runs', () => {
    const result = normalizeMessageQuoteText('  first\u00a0line  \r\n\r\n\r\n\u200bsecond\u0007 line\t\n ')
    expect(result).toEqual({ text: 'first line\n\nsecond  line', charCount: 24, truncated: false })
  })

  it('clips long selections but reports the original length', () => {
    const raw = 'a'.repeat(MAX_MESSAGE_QUOTE_CHARS + 50)
    const result = normalizeMessageQuoteText(raw)
    expect(result.text).toHaveLength(MAX_MESSAGE_QUOTE_CHARS)
    expect(result.charCount).toBe(MAX_MESSAGE_QUOTE_CHARS + 50)
    expect(result.truncated).toBe(true)
  })

  it('never splits a surrogate pair when clipping', () => {
    const raw = `${'a'.repeat(MAX_MESSAGE_QUOTE_CHARS - 1)}\u{1F600}tail`
    const { text } = normalizeMessageQuoteText(raw)
    expect(text.endsWith('a')).toBe(true)
    expect(text).toHaveLength(MAX_MESSAGE_QUOTE_CHARS - 1)
  })

  it('round-trips quote text through the blockquote encoding', () => {
    const text = '/Users/me/project\n\n- item\n> nested'
    const encoded = messageQuoteToBlockquote(text)
    expect(encoded).toBe('> /Users/me/project\n>\n> - item\n> > nested')
    expect(messageQuoteFromBlockquote(encoded)).toBe(text)
  })

  it('drops empty selections and live overlay ids', () => {
    expect(createMessageQuote({ rawText: ' \n ', role: 'assistant' })).toBeNull()
    expect(createMessageQuote({ rawText: 'x', role: 'assistant', sourceBlockId: 'live-assistant' })?.sourceBlockId)
      .toBeUndefined()
    expect(createMessageQuote({ rawText: 'x', role: 'user', sourceBlockId: 'item_42' }))
      .toMatchObject({ text: 'x', role: 'user', sourceBlockId: 'item_42' })
  })

  it('skips duplicate quotes and keeps the newest per-turn budget', () => {
    let quotes: MessageQuote[] = []
    quotes = appendMessageQuote(quotes, quote('one', { id: 'a' }))
    quotes = appendMessageQuote(quotes, quote('one', { id: 'b' }))
    expect(quotes.map((item) => item.id)).toEqual(['a'])
    for (const text of ['two', 'three', 'four', 'five']) {
      quotes = appendMessageQuote(quotes, quote(text, { id: text }))
    }
    expect(quotes).toHaveLength(MAX_MESSAGE_QUOTES_PER_TURN)
    expect(quotes.map((item) => item.id)).toEqual(['two', 'three', 'four', 'five'])
  })
})

describe('message quote composer contexts', () => {
  it('accepts a selection that starts with an absolute path', async () => {
    const attachment = await createMessageQuoteAttachment({
      workspaceRoot: '/repo',
      quote: quote('/Users/me/project/src/main.ts', { sourceBlockId: 'item_7' }),
      now: 1
    })
    expect(attachment.attachmentId).toMatch(/^workspace-selection-context:[a-f0-9]{64}$/)
    expect(attachment.reference).toMatchObject({
      kind: 'message-quote',
      role: 'assistant',
      quote: '> /Users/me/project/src/main.ts',
      messageId: 'item_7',
      truncated: false
    })
    expect(messageQuoteFromComposerContext(attachment)).toEqual({
      text: '/Users/me/project/src/main.ts',
      role: 'assistant',
      truncated: false,
      sourceBlockId: 'item_7'
    })
  })

  it('stays inside the reference string limit for many short lines', async () => {
    const text = Array.from({ length: 900 }, () => 'ab').join('\n')
    const attachment = await createMessageQuoteAttachment({ workspaceRoot: '/repo', quote: quote(text) })
    const quoted = String(attachment.reference.quote)
    expect(quoted.length).toBeLessThanOrEqual(2_048)
    expect(attachment.reference.truncated).toBe(true)
  })

  it('folds identical quotes into one attachment', async () => {
    const attachments = await createMessageQuoteAttachments({
      workspaceRoot: '/repo',
      quotes: [quote('same', { id: 'a' }), quote('same', { id: 'b' }), quote('other')]
    })
    expect(attachments).toHaveLength(2)
  })

  it('ignores other composer contexts when reading quotes back', () => {
    expect(messageQuotesFromComposerContexts([
      { reference: { kind: 'document-quote', text: 'doc' } },
      { reference: { kind: 'message-quote', role: 'user', quote: '> mine' } },
      null
    ])).toEqual([{ text: 'mine', role: 'user', truncated: false }])
  })
})
