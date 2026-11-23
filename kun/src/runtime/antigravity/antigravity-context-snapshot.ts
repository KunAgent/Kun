import type { SessionStore } from '../../ports/session-store.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

export type AntigravityContextProfile = {
  contextWindowTokens: number
  contextWindowKnown?: boolean
  softThresholdTokens: number
  hardThresholdTokens: number
}

export function estimateAntigravityTokens(text: string): number {
  return text ? Math.ceil(Buffer.byteLength(text, 'utf8') / 4) : 0
}

/**
 * Resolve the known context window for an `agy` built-in model identifier
 * (including effort-suffixed variants such as `gemini-4-carbon-high` or
 * `gpt-oss-120b-medium`). Unknown custom models return `undefined`.
 */
export function antigravityModelContextWindow(model: string | undefined): number | undefined {
  const normalized = model
    ?.trim()
    .toLowerCase()
    .replace(/^kun\/[^/]+\//u, '')
    .replace(/^models\//u, '')
    .replace(/-(?:low|medium|high|xhigh|max)$/u, '')
  if (!normalized || normalized === 'default' || normalized === 'auto') return undefined
  if (normalized.startsWith('gemini-') || normalized.startsWith('orchestrator-')) {
    return 1_000_000
  }
  if (
    normalized.startsWith('claude-haiku-') ||
    normalized.startsWith('claude-3-') ||
    normalized.startsWith('claude-opus-4-5')
  ) {
    return 200_000
  }
  if (normalized.startsWith('claude-')) {
    return 1_000_000
  }
  if (normalized.startsWith('gpt-oss-') || normalized.startsWith('gpt-oss:')) {
    return 128_000
  }
  return undefined
}

/**
 * Build a `context_snapshot` draft for an Antigravity CLI turn, emitting an
 * estimate at turn start and replacing it with `agy`'s per-step context
 * occupancy (`input_tokens + cache_read_tokens`) as steps stream in.
 */
export function buildAntigravityContextSnapshot(input: {
  threadId: string
  turnId: string
  model: string
  resolvedModel?: string
  explicitProviderId?: string
  contextProfile: AntigravityContextProfile
  resumed: boolean
  sentInstructionsText: string
  promptText: string
  liveInputTokens?: number
  toolCount?: number
}): Extract<RuntimeEventDraft, { kind: 'context_snapshot' }> {
  const providerId = input.explicitProviderId?.trim() || 'default'
  const explicitWindowKnown = Boolean(input.contextProfile.contextWindowKnown)
  const catalogWindow = explicitWindowKnown
    ? undefined
    : antigravityModelContextWindow(input.resolvedModel ?? input.model)
  const contextWindowKnown = explicitWindowKnown || catalogWindow !== undefined
  const contextWindowTokens = explicitWindowKnown
    ? input.contextProfile.contextWindowTokens
    : (catalogWindow ?? input.contextProfile.contextWindowTokens)
  const base = {
    kind: 'context_snapshot' as const,
    threadId: input.threadId,
    turnId: input.turnId,
    model: input.model,
    providerId,
    stepIndex: 0,
    contextWindowTokens,
    // Antigravity compacts its own context without reporting a threshold;
    // never project Kun's compaction threshold onto an SDK-managed turn.
    softThresholdTokens: contextWindowTokens,
    hardThresholdTokens: contextWindowTokens,
    contextWindowKnown,
    activeSkillIds: [],
    contextManagement: 'sdk-managed' as const
  }
  if (input.liveInputTokens !== undefined) {
    const used = Math.max(0, Math.trunc(input.liveInputTokens))
    return {
      ...base,
      estimatedInputTokens: used,
      breakdown: { tools: 0, system: 0, skills: 0, messages: used, other: 0 },
      toolCount: input.toolCount ?? 0,
      occupancySource: 'agent',
      nativeHistory: 'known'
    }
  }
  const system = estimateAntigravityTokens(input.sentInstructionsText)
  const messages = Math.max(0, estimateAntigravityTokens(input.promptText) - system)
  return {
    ...base,
    estimatedInputTokens: system + messages,
    breakdown: { tools: 0, system, skills: 0, messages, other: 0 },
    toolCount: 0,
    occupancySource: 'estimate',
    nativeHistory: input.resumed ? 'unknown' : 'none'
  }
}

/**
 * Carry forward the last Agent-reported occupancy for a resumed `--conversation`
 * turn so the context gauge stays accurate until Step 1 streams new usage.
 */
export async function loadCarriedAntigravityOccupancy(
  sessionStore: SessionStore,
  threadId: string
): Promise<{ inputTokens: number; toolCount: number } | undefined> {
  try {
    const prevSeq = await sessionStore.highestSeq(threadId)
    if (prevSeq <= 0) return undefined
    if (sessionStore.loadLatestContextSnapshot) {
      const snapshot = await sessionStore.loadLatestContextSnapshot(threadId, prevSeq)
      if (
        snapshot &&
        snapshot.occupancySource === 'agent' &&
        snapshot.nativeHistory === 'known' &&
        snapshot.estimatedInputTokens > 0
      ) {
        return { inputTokens: snapshot.estimatedInputTokens, toolCount: snapshot.toolCount }
      }
      return undefined
    }
    const recent = await sessionStore.loadEventsSince(threadId, Math.max(0, prevSeq - 20))
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const event = recent[index]
      if (event?.kind !== 'context_snapshot' || event.child) continue
      if (
        event.occupancySource === 'agent' &&
        event.nativeHistory === 'known' &&
        event.estimatedInputTokens > 0
      ) {
        return { inputTokens: event.estimatedInputTokens, toolCount: event.toolCount }
      }
      return undefined
    }
  } catch {
    // Fall back to the start-of-turn estimate if session history cannot be read.
  }
  return undefined
}
