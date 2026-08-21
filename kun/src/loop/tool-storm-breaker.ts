import type { ToolCallLike } from '../ports/tool-host.js'
import { normalizeBrowserUseActionInput } from '../contracts/browser-use.js'

export type ToolStormBreakerOptions = {
  interactiveThreshold?: number
  browserDuplicateThreshold?: number
}

const DEFAULT_INTERACTIVE_THRESHOLD = 3
const DEFAULT_BROWSER_DUPLICATE_THRESHOLD = 3
const INTERACTIVE_TOOL_NAMES = new Set(['request_user_input', 'user_input'])

/**
 * Prevents repeated interactive user-input gates (user_input /
 * request_user_input) from spamming the user and suppresses a Browser Use call
 * only after the same semantic arguments repeat past a small bounded threshold.
 * Other ordinary tool calls are never suppressed. It is deliberately turn-scoped; a new user turn is a new intent,
 * so the AgentLoop resets the breaker between turns.
 */
export class ToolStormBreaker {
  private readonly interactiveThreshold: number
  private readonly browserDuplicateThreshold: number
  private interactiveCount = 0
  private browserFingerprint?: string
  private browserDuplicateCount = 0

  constructor(options: ToolStormBreakerOptions = {}) {
    this.interactiveThreshold = Math.max(
      1,
      Math.floor(options.interactiveThreshold ?? DEFAULT_INTERACTIVE_THRESHOLD)
    )
    this.browserDuplicateThreshold = Math.max(
      1,
      Math.floor(options.browserDuplicateThreshold ?? DEFAULT_BROWSER_DUPLICATE_THRESHOLD)
    )
  }

  inspect(call: ToolCallLike): { suppress: boolean; reason?: string } {
    if (call.toolName === 'browser_use') return this.inspectBrowserUse(call)
    if (!INTERACTIVE_TOOL_NAMES.has(call.toolName)) return { suppress: false }
    this.interactiveCount += 1
    if (this.interactiveCount > this.interactiveThreshold) {
      return {
        suppress: true,
        reason:
          `${call.toolName} was called ${this.interactiveCount} times in this turn; ` +
          'interactive prompt guard suppressed the repeated ask. Act on the latest answer, finish, or ask follow-up in normal text.'
      }
    }
    return { suppress: false }
  }

  reset(): void {
    this.interactiveCount = 0
    this.browserFingerprint = undefined
    this.browserDuplicateCount = 0
  }

  private inspectBrowserUse(call: ToolCallLike): { suppress: boolean; reason?: string } {
    const normalized = normalizeBrowserUseActionInput(call.arguments)
    const fingerprint = stableJson(normalized)
    if (fingerprint !== this.browserFingerprint) {
      this.browserFingerprint = fingerprint
      this.browserDuplicateCount = 1
      return { suppress: false }
    }
    this.browserDuplicateCount += 1
    if (this.browserDuplicateCount <= this.browserDuplicateThreshold) return { suppress: false }
    return {
      suppress: true,
      reason:
        `browser_use repeated the same semantic call ${this.browserDuplicateCount} times in this turn; ` +
        'duplicate browser guard suppressed it. Change the arguments materially or stop retrying.'
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}
