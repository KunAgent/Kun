import { describe, expect, it } from 'vitest'
import type { InlineCompletionRequestContext } from './types'
import { evaluateInlineCompletionCandidate } from './feedback'

function context(partial: Partial<InlineCompletionRequestContext> = {}): InlineCompletionRequestContext {
  return {
    filePath: '/tmp/workspace/draft.md',
    language: 'markdown',
    head: 12,
    lineNumber: 1,
    column: 12,
    docLength: 48,
    prefix: 'This is ',
    suffix: ' a draft.',
    prefixWindow: 'This is ',
    suffixWindow: ' a draft.',
    currentLinePrefix: 'This is ',
    currentLineSuffix: ' a draft.',
    currentLineText: 'This is  a draft.',
    previousLineText: '',
    previousNonEmptyLineText: '',
    nextLineText: '',
    indentation: '',
    isAtLineEnd: false,
    currentLinePrefixTrimmed: 'This is',
    currentLineSuffixTrimmed: 'a draft.',
    docPreview: 'This is ',
    isBlankLine: false,
    hasMeaningfulPrefix: true,
    hasStructuralContext: false,
    hasListContext: false,
    hasQuoteContext: false,
    hasHeadingContext: false,
    hasTableContext: false,
    endsWithWordChar: false,
    endsWithSentencePunctuation: false,
    previousLineEndsWithSentencePunctuation: false,
    prefersNewLineCompletion: false,
    isParagraphBreakOpportunity: false,
    nextCharIsWord: false,
    looksLikeUrlTail: false,
    ...partial
  }
}

describe('evaluateInlineCompletionCandidate', () => {
  it('shows structured short actions that pass hard local checks', () => {
    const decision = evaluateInlineCompletionCandidate(
      context(),
      {
        text: 'a focused continuation',
        action: { kind: 'short', text: 'a focused continuation' }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(true)
    expect(decision.feedback.reason).toBe('model-returned-action')
  })

  it('suppresses candidates that still carry leaked protocol markers', () => {
    const decision = evaluateInlineCompletionCandidate(
      context(),
      {
        text: '>>> <<<LONG >>> <<<EDIT',
        action: { kind: 'short', text: '>>> <<<LONG >>> <<<EDIT' }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(false)
    expect(decision.feedback.reason).toBe('marker-artifact')
  })

  it('still suppresses structured actions that duplicate the suffix', () => {
    const decision = evaluateInlineCompletionCandidate(
      context({ suffixWindow: 'a focused continuation after the cursor' }),
      {
        text: 'a focused continuation',
        action: { kind: 'short', text: 'a focused continuation' }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(false)
    expect(decision.feedback.reason).toBe('already-in-suffix')
  })

  it('accepts structured edit actions for unchanged local hard checks', () => {
    const decision = evaluateInlineCompletionCandidate(
      context(),
      {
        text: 'Write mode keeps text editing local.',
        action: {
          kind: 'edit',
          from: 0,
          to: 41,
          original: 'DeepSeek GUI keeps text editing local.',
          replacement: 'Write mode keeps text editing local.',
          scopeKind: 'paragraph'
        }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(true)
    expect(decision.action).toMatchObject({
      kind: 'edit',
      replacement: 'Write mode keeps text editing local.'
    })
    expect(decision.feedback.reason).toBe('model-selected-edit')
  })

  it('adds a missing space between adjacent Latin words', () => {
    const decision = evaluateInlineCompletionCandidate(
      context({
        currentLinePrefix: 'hello',
        prefixWindow: 'hello',
        endsWithWordChar: true
      }),
      { text: 'world', action: { kind: 'short', text: 'world' } },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(true)
    expect(decision.text).toBe(' world')
    expect(decision.action).toEqual({ kind: 'short', text: ' world' })
  })

  it.each([
    ['existing whitespace', 'hello', ' world', false, false, ' world'],
    ['punctuation continuation', 'hello', ', world', false, false, ', world'],
    ['cursor inside a word', 'hello', 'world', true, false, 'world'],
    ['URL continuation', 'https://example.com', 'path', false, true, 'path'],
    ['CJK continuation', '你好', '世界', false, false, '世界']
  ])('keeps %s unchanged', (_label, prefix, suggestion, nextCharIsWord, looksLikeUrlTail, expected) => {
    const decision = evaluateInlineCompletionCandidate(
      context({
        currentLinePrefix: prefix,
        prefixWindow: prefix,
        endsWithWordChar: true,
        nextCharIsWord,
        looksLikeUrlTail
      }),
      { text: suggestion, action: { kind: 'short', text: suggestion } },
      { minAcceptScore: 0, mode: 'short' }
    )

    expect(decision.accepted).toBe(true)
    expect(decision.text).toBe(expected)
    expect(decision.action).toEqual({ kind: 'short', text: expected })
  })
})
