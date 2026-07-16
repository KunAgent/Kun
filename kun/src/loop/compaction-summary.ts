import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ModelClient } from '../ports/model-client.js'
import { trimTrailingToolCalls } from './context-compactor.js'
import type { ContextCompactionConfig } from './model-context-profile.js'

export const DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS = 15_000
export const DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS = 2_048
/** @deprecated The compaction-mode path feeds real conversation messages, not a byte-capped transcript. Kept for config back-compat. */
export const DEFAULT_COMPACTION_SUMMARY_INPUT_MAX_BYTES = 96 * 1024

/**
 * System prompt for the dedicated "compaction mode" turn. Ported from
 * opencode's compaction agent (`agent/prompt/compaction.txt`) and adapted
 * for kun's coding-agent context: the model reads the actual conversation
 * (fed as real messages, not a serialized transcript) and writes a free-form
 * handoff summary so work can continue past the context window.
 */
export const COMPACTION_SYSTEM_PROMPT = [
  'You are summarizing a long coding-agent conversation so the work can continue past the context window.',
  '',
  'Write a structured handoff summary with these sections:',
  '## Goal',
  '## Durable Context',
  '## Completed and Decisions',
  '## Files, Commands, and Results',
  '## Open Issues and Next Steps',
  '',
  'Focus on information that would be helpful for continuing the work, including:',
  '- What was requested and the overall goal',
  '- What has been done and the decisions that were made (and why)',
  '- Which files are being created, edited, or inspected (with their paths)',
  '- Key technical findings: root causes, data values, API shapes, commands run and their results',
  '- What still needs to be done next',
  '- User requests, constraints, and preferences that must persist',
  '',
  'If the conversation contains a numbered or bulleted list of issues, tasks, TODOs, problems, requirements, or user findings, preserve every item that is still relevant. Do not collapse middle items into a range, "etc.", or an omitted-count line.',
  'Preserve concrete identifiers verbatim: file paths, function and variable names, commands, URLs, IDs, and error messages.',
  'Do not invent facts and do not add generic advice. Write in the same language as the conversation.',
  'Your summary should be comprehensive enough to provide full context but concise enough to be quickly understood.'
].join('\n')

/**
 * Free-form continuation prompt appended as the final user message of the
 * compaction turn. Ported from opencode's default compaction prompt; the new
 * session has no access to the conversation above, so the model is asked to
 * write a self-contained handoff. Optional pinned constraints are appended so
 * durable rules survive even in the free-form summary text.
 */
export function buildCompactionContinuationMessage(
  pinnedConstraints?: readonly string[],
  pinnedSkillPins?: readonly string[]
): string {
  const lines = [
    'Provide a detailed summary of our conversation above, written so a new session with no access to ' +
      'this history can continue the work seamlessly. Cover what we set out to do, what has been done, ' +
      'which files and locations are involved, the key findings and decisions, and what remains to be done next. ' +
      'Preserve concrete identifiers (file paths, function/variable names, commands, URLs, IDs, error messages) verbatim. ' +
      'If there are numbered or bulleted issue/task/problem/TODO/requirement lists, keep every still-relevant item rather than summarizing them as a range or omitted middle.'
  ]
  const pins = (pinnedConstraints ?? []).map((pin) => pin.trim()).filter((pin) => pin.length > 0)
  if (pins.length > 0) {
    lines.push('')
    lines.push('Durable constraints that MUST be preserved in your summary:')
    for (const pin of pins) lines.push(`- ${pin}`)
  }
  const skills = (pinnedSkillPins ?? []).map((pin) => pin.trim()).filter((pin) => pin.length > 0)
  if (skills.length > 0) {
    lines.push('')
    lines.push('Active skill pins that MUST be preserved in your summary:')
    for (const skill of skills) lines.push(`- ${skill}`)
  }
  return lines.join('\n')
}

/**
 * Resolve the model + provider for the compaction-mode turn. Mirrors
 * opencode's compaction agent precedence: an explicit compaction model
 * override (`contextCompaction.summaryModel`) wins, otherwise it falls back to
 * the main conversation model. Unlike one-shot roles (title/session-summary)
 * it does NOT drop to the small model — a faithful handoff summary wants the
 * same capability as the conversation it is folding.
 */
export type CompactionModelBinding = {
  model: string
  providerId?: string
  accountId?: string
  /** A fail-closed binding error that must prevent the history request. */
  bindingError?: string
}

/**
 * Resolve a turn override over its thread binding without borrowing an account
 * from a different provider. A turn may override only the account while it
 * keeps the thread provider, or override provider+account together.
 */
export function resolveCoherentProviderAccount(input: {
  turnProviderId?: string
  turnAccountId?: string
  threadProviderId?: string
  threadAccountId?: string
}): { providerId?: string; accountId?: string } {
  const turnProviderId = input.turnProviderId?.trim()
  const turnAccountId = input.turnAccountId?.trim()
  const threadProviderId = input.threadProviderId?.trim()
  const threadAccountId = input.threadAccountId?.trim()
  const providerId = turnProviderId || threadProviderId
  const canInheritThreadAccount =
    !turnProviderId ||
    Boolean(threadProviderId && turnProviderId.toLowerCase() === threadProviderId.toLowerCase())
  const accountId = turnAccountId || (canInheritThreadAccount ? threadAccountId : undefined)
  return {
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {})
  }
}

export function resolveCompactionModel(input: {
  contextCompaction?: ContextCompactionConfig
  fallbackModel: string
  fallbackProviderId?: string
  fallbackAccountId?: string
}): CompactionModelBinding {
  const model = input.contextCompaction?.summaryModel?.trim() || input.fallbackModel
  const explicitProviderId = input.contextCompaction?.summaryProviderId?.trim()
  const fallbackProviderId = input.fallbackProviderId?.trim()
  const fallbackAccountId = input.fallbackAccountId?.trim()

  if (explicitProviderId) {
    if (
      fallbackAccountId &&
      (!fallbackProviderId || explicitProviderId.toLowerCase() !== fallbackProviderId.toLowerCase())
    ) {
      return {
        model,
        providerId: explicitProviderId,
        bindingError:
          'Configured compaction summary provider does not match the active account binding; using heuristic summary.'
      }
    }
    return {
      model,
      providerId: explicitProviderId,
      ...(fallbackAccountId ? { accountId: fallbackAccountId } : {})
    }
  }

  if (fallbackAccountId && !fallbackProviderId) {
    return {
      model,
      bindingError:
        'Active compaction account binding has no provider; using heuristic summary.'
    }
  }

  return {
    model,
    ...(fallbackProviderId ? { providerId: fallbackProviderId } : {}),
    ...(fallbackAccountId ? { accountId: fallbackAccountId } : {})
  }
}

/**
 * Run the dedicated compaction-mode turn. The real conversation `items` are
 * fed to the model as messages (mirroring opencode's compaction agent),
 * followed by a free-form continuation prompt; the model returns a natural
 * handoff summary. Returns `undefined` on timeout / error / empty output so
 * the caller falls back to the heuristic summary.
 */
export async function summarizeCompactionWithModel(input: {
  threadId: string
  turnId: string
  model: string
  /** Optional per-provider routing id paired with `model`. */
  providerId?: string
  /** Opaque account id paired with `providerId`; never credential material. */
  accountId?: string
  modelClient: ModelClient
  prefix: ImmutablePrefix
  contextCompaction?: ContextCompactionConfig
  items: TurnItem[]
  pinnedSkillPins?: readonly string[]
  heuristicSummary: string
  signal: AbortSignal
  recordUsage?: (usage: UsageSnapshot) => Promise<void> | void
  recordFallback?: (message: string) => Promise<void> | void
}): Promise<string | undefined> {
  if (input.signal.aborted) return undefined
  let fallbackRecorded = false
  const recordFallback = async (message: string): Promise<void> => {
    if (fallbackRecorded || input.signal.aborted) return
    fallbackRecorded = true
    await input.recordFallback?.(message)
  }
  if (input.accountId && !input.providerId) {
    await recordFallback('Model compaction summary has an account without a provider; using heuristic summary.')
    return undefined
  }
  const timeoutMs = Math.max(
    1,
    Math.floor(input.contextCompaction?.summaryTimeoutMs ?? DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS)
  )
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  input.signal.addEventListener('abort', onAbort, { once: true })
  try {
    // Feed the real conversation as model messages (compaction mode), not a
    // serialized transcript. Trailing tool calls without results are dropped
    // so the request stays well-formed for OpenAI-compatible providers.
    const conversation = trimTrailingToolCalls(input.items)
    const continuationItem: TurnItem = {
      id: `item_${input.turnId}_compaction_continuation`,
      turnId: input.turnId,
      threadId: input.threadId,
      role: 'user' as const,
      status: 'completed' as const,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      kind: 'user_message' as const,
      text: buildCompactionContinuationMessage(input.prefix.pinnedConstraints, input.pinnedSkillPins)
    }
    let text = ''
    for await (const chunk of input.modelClient.stream({
      threadId: input.threadId,
      turnId: input.turnId,
      model: input.model,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      // Dedicated compaction-mode system prompt; the main agent prefix and
      // few-shots are intentionally dropped so this is a clean summarizer turn.
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      prefix: [],
      history: [...conversation, continuationItem],
      tools: [],
      stream: true,
      maxTokens: Math.max(
        1,
        Math.floor(input.contextCompaction?.summaryMaxTokens ?? DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS)
      ),
      temperature: 0,
      reasoningEffort: 'off',
      abortSignal: controller.signal
    })) {
      if (input.signal.aborted) return undefined
      if (controller.signal.aborted) {
        await recordFallback(
          `Model compaction summary timed out after ${timeoutMs}ms; using heuristic summary.`
        )
        return undefined
      }
      if (chunk.kind === 'assistant_text_delta') text += chunk.text
      if (chunk.kind === 'usage') await input.recordUsage?.(chunk.usage)
      if (chunk.kind === 'error') {
        await recordFallback(
          `Model compaction summary failed${chunk.code ? ` (${chunk.code})` : ''}: ${chunk.message}. Using heuristic summary.`
        )
        return undefined
      }
    }
    const summary = text.trim()
    if (!summary) {
      await recordFallback('Model compaction summary returned empty text; using heuristic summary.')
      return undefined
    }
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = controller.signal.aborted && !input.signal.aborted
      ? `Model compaction summary timed out after ${timeoutMs}ms`
      : `Model compaction summary threw: ${message}`
    await recordFallback(`${reason}; using heuristic summary.`)
    return undefined
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', onAbort)
  }
}
