import { createHash } from 'node:crypto'
import type { ToolCallLike, ToolHostResult } from '../ports/tool-host.js'
import { normalizeBrowserUseActionInput } from '../contracts/browser-use.js'

export type ToolStormBreakerOptions = {
  interactiveThreshold?: number
  browserDuplicateThreshold?: number
}

const DEFAULT_INTERACTIVE_THRESHOLD = 3
const DEFAULT_BROWSER_DUPLICATE_THRESHOLD = 3
const FAILED_CALL_THRESHOLD = 3
const MAX_FAILED_CALLS = 256
const INTERACTIVE_TOOL_NAMES = new Set(['request_user_input', 'user_input'])

/**
 * Prevents repeated interactive user-input gates (user_input /
 * request_user_input) from spamming the user and suppresses a Browser Use call
 * only after the same semantic arguments repeat past a small bounded threshold.
 * Ordinary calls are suppressed only after repeated execution failures.
 * State is turn-scoped, not context-window-scoped.
 */
export class ToolStormBreaker {
  private readonly failures = new Map<string, { count: number; notePath?: string }>()
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
    const failure = this.failures.get(toolCallFingerprint(call))
    if (failure && failure.count >= FAILED_CALL_THRESHOLD) {
      return { suppress: true, reason: `${call.toolName} failed ${failure.count} times with the same arguments in this turn. ` +
        'Repeated failure guard suppressed this call. Inspect the error, change the approach, or report the blocker; do not retry unchanged.' }
    }
    if (!failure && this.failures.size >= MAX_FAILED_CALLS) {
      return { suppress: true, reason: 'The turn exhausted its distinct failed-call tracking budget. Stop retrying and report the blocker.' }
    }
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

  inspectRejectedBatch(calls: readonly ToolCallLike[]): { suppress: boolean; reason?: string } {
    // Batch protocol errors must not poison a corrected standalone call.
    const fingerprint = hash(stableJson(['rejected-batch', calls.map((call) => [call.toolName, call.arguments])]))
    const previous = this.failures.get(fingerprint)
    if ((previous?.count ?? 0) >= FAILED_CALL_THRESHOLD || (!previous && this.failures.size >= MAX_FAILED_CALLS)) {
      return { suppress: true, reason: 'Repeated invalid tool batch suppressed. Call new_context alone or report the blocker.' }
    }
    this.failures.set(fingerprint, { count: (previous?.count ?? 0) + 1 })
    return { suppress: false }
  }

  recordResult(call: ToolCallLike, result: ToolHostResult): void {
    const item = result.item
    if (item.kind !== 'tool_result') return
    const fingerprint = toolCallFingerprint(call)
    if (item.isError) {
      const previous = this.failures.get(fingerprint)
      if (!previous && this.failures.size >= MAX_FAILED_CALLS) return
      this.failures.set(fingerprint, {
        count: Math.min(FAILED_CALL_THRESHOLD, (previous?.count ?? 0) + 1),
        ...(call.toolName === 'notes_read_file' && typeof call.arguments.path === 'string'
          ? { notePath: hash(call.arguments.path) } : {})
      })
      return
    }
    this.failures.delete(fingerprint)
    // Only a confirmed mutation of this note invalidates its failed reads.
    // Unrelated successes and revision conflicts must not reopen the loop.
    const output = item.output as Record<string, unknown> | null
    if ((call.toolName === 'notes_write_file' || call.toolName === 'notes_append_to_file') &&
        typeof call.arguments.path === 'string' && output?.path === call.arguments.path &&
        typeof output.revision === 'number' &&
        (call.toolName === 'notes_append_to_file' ? output.applied === true : output.status === 'ok')) {
      const notePath = hash(call.arguments.path)
      for (const [key, failure] of this.failures) {
        if (failure.notePath === notePath) this.failures.delete(key)
      }
    }
  }

  reset(): void {
    this.failures.clear()
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

export function toolCallFingerprint(call: ToolCallLike): string {
  return hash(stableJson([call.toolName, call.arguments]))
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}
