import { describe, expect, it } from 'vitest'
import { writePromptQuotesFromComposerContexts } from './write-composer-context-quotes'

const quoteContext = {
  schemaVersion: 1,
  id: 'work-reference-quotes-abc',
  title: 'Work references (2)',
  summary: 'Exact user-selected passages for this turn',
  reference: {
    kind: 'work-reference-quotes',
    schemaVersion: 1,
    quotes: [
      {
        sourceName: 'notes/draft.md',
        sourceKind: 'text',
        charCount: 18,
        text: 'Selected paragraph',
        lineStart: 3,
        lineEnd: 5
      },
      {
        sourceName: 'papers/study.pdf',
        sourceKind: 'pdf',
        sourceFormat: 'pdf',
        charCount: 38,
        text: 'The method improves retrieval quality.',
        pageStart: 3,
        pageEnd: 4
      }
    ]
  },
  revision: 1,
  generation: 0,
  attachmentId: 'workspace-selection-context:abc',
  provenance: { source: 'workspace-selection', workspaceId: 'a'.repeat(64) }
}

describe('writePromptQuotesFromComposerContexts', () => {
  it('returns an empty list for undefined or empty contexts', () => {
    expect(writePromptQuotesFromComposerContexts(undefined)).toEqual([])
    expect(writePromptQuotesFromComposerContexts([])).toEqual([])
  })

  it('extracts quoted selections from a work-reference-quotes context', () => {
    const quotes = writePromptQuotesFromComposerContexts([quoteContext])

    expect(quotes).toHaveLength(2)
    expect(quotes[0]).toMatchObject({
      sourceTitle: 'notes/draft.md',
      text: 'Selected paragraph',
      lineStart: 3,
      lineEnd: 5,
      charCount: 18
    })
    expect(quotes[1]).toMatchObject({
      sourceTitle: 'papers/study.pdf',
      text: 'The method improves retrieval quality.',
      pageStart: 3,
      pageEnd: 4
    })
  })

  it('ignores non-quote composer contexts and malformed entries', () => {
    const quotes = writePromptQuotesFromComposerContexts([
      {
        ...quoteContext,
        reference: { kind: 'work-reference-resource', schemaVersion: 1 }
      },
      null,
      { reference: { kind: 'work-reference-quotes', quotes: 'not-an-array' } },
      {
        ...quoteContext,
        reference: {
          ...quoteContext.reference,
          quotes: [{ sourceName: 'empty.md', text: '   ' }]
        }
      }
    ])

    expect(quotes).toEqual([])
  })
})
