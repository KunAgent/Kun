import type {
  InlineCompletionPayload,
  InlineCompletionRequestContext
} from './types'
import type { WriteInlineCompletionMode } from '@shared/write-inline-completion'

function compactText(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function contextNotes(context: InlineCompletionRequestContext): string[] {
  const notes: string[] = []
  if (context.hasListContext) {
    notes.push('Continue the current list item or next bullet only if the local markdown structure clearly suggests it.')
  }
  if (context.hasQuoteContext) notes.push('Preserve the current blockquote marker and indentation.')
  if (context.hasHeadingContext) {
    notes.push('Prefer a short heading continuation instead of drafting a new section.')
  }
  if (context.hasTableContext) notes.push('Respect table cell boundaries and pipe separators.')
  if (context.prefersNewLineCompletion) {
    notes.push('The current sentence looks complete at the end of the line. Do not tack extra words onto that line; wait for a new line instead.')
  }
  if (context.isParagraphBreakOpportunity) {
    notes.push('The cursor is on a fresh paragraph break after a completed sentence. Suggest the opening of the next paragraph only if the nearby context strongly supports it.')
  }
  if (context.endsWithSentencePunctuation && !context.prefersNewLineCompletion) {
    notes.push('A short continuation or newline is more likely than a long new paragraph.')
  }
  return notes
}

export function buildInlineCompletionPayload(
  context: InlineCompletionRequestContext,
  options: {
    model?: string
    workspaceRoot?: string
    mode?: WriteInlineCompletionMode
  } = {}
): InlineCompletionPayload {
  const mode = options.mode ?? 'short'
  const notes = contextNotes(context)
  const longInstructions = mode === 'long'
    ? [
        'The user has paused for inspiration. You may suggest a richer continuation, but keep it directly grounded in the existing draft.',
        'Prefer one compact paragraph or a short list continuation. Do not produce a full article, outline, or generic brainstorm.',
        'Use retrieved references as style and terminology hints when they fit the current passage.'
      ]
    : []
  const policy = {
    name: mode === 'long' ? 'inspiration-inline-v1' : 'precision-inline-v2',
    instruction: [
      'Return only the text that should be inserted at the cursor.',
      'Prefer returning an empty completion when the local context is ambiguous.',
      'Do not repeat text that already exists after the cursor.',
      'Treat this as inline editing plus completion, not open-ended writing.',
      'Keep completions short, local, and structurally aligned with the current markdown block.',
      'Do not invent new sections, summaries, or generic filler when the nearby context does not justify them.',
      ...longInstructions,
      ...notes
    ].join('\n'),
    acceptanceCriteria: [
      'The completion should look like the most likely next keystrokes for this exact cursor position.',
      'The completion should preserve indentation, markdown markers, and local phrasing.',
      ...(mode === 'long'
        ? ['The completion may provide a useful next thought without taking over the whole draft.']
        : []),
      'The completion should be safe to hide completely if confidence is low.'
    ],
    rejectionCriteria: [
      'Skip completions that only restate earlier text.',
      'Skip completions that open a new topic not grounded in the current block.',
      'Skip completions that are long, generic, or speculative.'
    ]
  }

  return {
    prefix: context.prefixWindow,
    suffix: context.suffixWindow,
    mode,
    workspaceRoot: options.workspaceRoot,
    currentFilePath: context.filePath,
    cursor: {
      line: context.lineNumber,
      column: context.column
    },
    context: {
      language: context.language,
      currentLinePrefix: context.currentLinePrefix,
      currentLineSuffix: context.currentLineSuffix,
      previousLine: context.previousLineText,
      previousNonEmptyLine: context.previousNonEmptyLineText,
      nextLine: context.nextLineText,
      indentation: context.indentation,
      signals: {
        list: context.hasListContext,
        quote: context.hasQuoteContext,
        heading: context.hasHeadingContext,
        table: context.hasTableContext,
        atLineEnd: context.isAtLineEnd,
        endsWithSentencePunctuation: context.endsWithSentencePunctuation,
        previousLineEndsWithSentencePunctuation: context.previousLineEndsWithSentencePunctuation,
        prefersNewLineCompletion: context.prefersNewLineCompletion,
        paragraphBreakOpportunity: context.isParagraphBreakOpportunity
      }
    },
    policy,
    preview: {
      local: compactText(context.currentLineText).slice(0, 120),
      documentTail: compactText(context.docPreview).slice(0, 180)
    },
    model: options.model
  }
}
