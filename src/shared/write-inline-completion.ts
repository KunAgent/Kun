export type WriteInlineCompletionMode = 'short' | 'long'

export type WriteInlineCompletionRequest = {
  prefix: string
  suffix: string
  mode?: WriteInlineCompletionMode
  workspaceRoot?: string
  currentFilePath?: string
  cursor: {
    line: number
    column: number
  }
  context: {
    language: string
    currentLinePrefix: string
    currentLineSuffix: string
    previousLine: string
    previousNonEmptyLine: string
    nextLine: string
    indentation: string
    signals: {
      list: boolean
      quote: boolean
      heading: boolean
      table: boolean
      atLineEnd: boolean
      endsWithSentencePunctuation: boolean
      previousLineEndsWithSentencePunctuation: boolean
      prefersNewLineCompletion: boolean
      paragraphBreakOpportunity: boolean
    }
  }
  policy: {
    name: string
    instruction: string
    acceptanceCriteria: string[]
    rejectionCriteria: string[]
  }
  preview: {
    local: string
    documentTail: string
  }
  model?: string
}

export type WriteInlineCompletionResult =
  | {
      ok: true
      completion: string
      model: string
      mode?: WriteInlineCompletionMode
    }
  | { ok: false; message: string }
