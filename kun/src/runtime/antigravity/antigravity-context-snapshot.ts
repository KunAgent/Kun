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
 * Build a `context_snapshot` draft for an Antigravity CLI turn, emitting an
 * estimate at turn start and replacing it with `agy`'s per-step `input_tokens`
 * once reported.
 */
export function buildAntigravityContextSnapshot(input: {
  threadId: string
  turnId: string
  model: string
  explicitProviderId?: string
  contextProfile: AntigravityContextProfile
  resumed: boolean
  sentInstructionsText: string
  promptText: string
  liveInputTokens?: number
  toolCount?: number
}): Extract<RuntimeEventDraft, { kind: 'context_snapshot' }> {
  const providerId = input.explicitProviderId?.trim() || 'default'
  const base = {
    kind: 'context_snapshot' as const,
    threadId: input.threadId,
    turnId: input.turnId,
    model: input.model,
    providerId,
    stepIndex: 0,
    contextWindowTokens: input.contextProfile.contextWindowTokens,
    softThresholdTokens: input.contextProfile.softThresholdTokens,
    hardThresholdTokens: input.contextProfile.hardThresholdTokens,
    contextWindowKnown: Boolean(input.contextProfile.contextWindowKnown),
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
