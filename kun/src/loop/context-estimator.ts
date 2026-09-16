import type { TurnItem } from '../contracts/items.js'
import {
  IMAGE_TOOL_RESULT_TOKEN_ESTIMATE,
  extractToolResultImages,
  isModelVisibleImageOutput,
  toolResultTextWithoutImages
} from './tool-result-image.js'

/**
 * Token estimator for compaction decisions.
 *
 * The estimator prefers reported usage when available. When it must
 * approximate from text, it counts CJK and other wide characters as
 * roughly one token each and packs runs of ASCII at ~4 chars/token.
 * This avoids the severe under-counting that a naive `length / 4`
 * heuristic produces for Chinese/Japanese/Korean text, which is the
 * dominant language for many users of this app. Accurate estimates are
 * what let compaction trigger *before* the real context window is
 * exceeded rather than after.
 */
export class ContextEstimator {
  private readonly charsPerToken: number

  constructor(charsPerToken = 4) {
    this.charsPerToken = Math.max(1, charsPerToken)
  }

  estimateItem(item: TurnItem): number {
    const text = this.collectText(item)
    let tokens = this.estimateText(text)
    if (item.kind === 'tool_result') {
      // Forwarded screenshots cost a bounded vision-token amount, not the
      // length of their base64 (which `collectText` already drops).
      tokens += extractToolResultImages(item.output).length * IMAGE_TOOL_RESULT_TOKEN_ESTIMATE
    }
    return Math.max(1, tokens)
  }

  estimateItems(items: TurnItem[]): number {
    return items.reduce((sum, item) => sum + this.estimateItem(item), 0)
  }

  /**
   * Estimate tokens for a raw string. ASCII bytes are packed at
   * `charsPerToken` per token; non-ASCII characters (CJK, emoji, etc.)
   * count as ~1 token each, except zero-width combining marks.
   */
  estimateText(text: string): number {
    if (!text) return 0
    let asciiRun = 0
    let tokens = 0
    const flushAscii = (): void => {
      if (asciiRun > 0) {
        tokens += Math.ceil(asciiRun / this.charsPerToken)
        asciiRun = 0
      }
    }
    for (const char of text) {
      if (char.charCodeAt(0) <= 0x7f) {
        asciiRun += 1
        continue
      }
      flushAscii()
      tokens += isCombiningMark(char) ? 0 : 1
    }
    flushAscii()
    return tokens
  }

  private collectText(item: TurnItem): string {
    switch (item.kind) {
      case 'user_message':
      case 'goal_context':
      case 'model_context':
      case 'interruption_note':
      case 'assistant_text':
      case 'assistant_reasoning':
        return item.text
      case 'runtime_context_source':
        return item.content
      case 'tool_call':
        return `${item.toolName} ${JSON.stringify(item.arguments)}`
      case 'tool_result':
        if (isModelVisibleImageOutput(item.output)) return toolResultTextWithoutImages(item.output)
        return typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
      case 'approval':
        return `${item.toolName} ${item.summary}`
      case 'user_input':
        return item.prompt
      case 'compaction':
        return item.summary
      case 'context_window':
        return ''
      case 'review':
        return `${item.title} ${item.reviewText ?? ''} ${item.output ? JSON.stringify(item.output) : ''}`
      case 'error':
        return item.message
    }
  }
}

function isCombiningMark(char: string): boolean {
  return /[\u0300-\u036f\ufe00-\ufe0f]/u.test(char)
}
