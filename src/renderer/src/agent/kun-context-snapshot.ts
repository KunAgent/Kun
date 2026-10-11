import type { ContextSnapshotEvent } from '../../../../kun/src/contracts/context-snapshot'
import type { CoreRuntimeEventJson } from './kun-contract'
import type { RequestContextSnapshot } from './types'
import { positiveInteger, nonnegativeInteger } from './kun-mapper-numbers'

export function contextSnapshotFromCore(event: CoreRuntimeEventJson | ContextSnapshotEvent): RequestContextSnapshot | null {
  if (event.child) return null
  const threadId = event.threadId?.trim()
  const model = event.model?.trim()
  const contextWindowTokens = positiveInteger(event.contextWindowTokens)
  const softThresholdTokens = positiveInteger(event.softThresholdTokens)
  const hardThresholdTokens = positiveInteger(event.hardThresholdTokens)
  const estimatedInputTokens = nonnegativeInteger(event.estimatedInputTokens)
  const stepIndex = nonnegativeInteger(event.stepIndex)
  const toolCount = nonnegativeInteger(event.toolCount)
  const rawBreakdown = event.breakdown
  const tools = nonnegativeInteger(rawBreakdown?.tools)
  const system = nonnegativeInteger(rawBreakdown?.system)
  const skills = nonnegativeInteger(rawBreakdown?.skills)
  const messages = nonnegativeInteger(rawBreakdown?.messages)
  const other = nonnegativeInteger(rawBreakdown?.other)
  if (
    !threadId ||
    !model ||
    contextWindowTokens === undefined ||
    softThresholdTokens === undefined ||
    hardThresholdTokens === undefined ||
    estimatedInputTokens === undefined ||
    stepIndex === undefined ||
    toolCount === undefined ||
    tools === undefined ||
    system === undefined ||
    skills === undefined ||
    messages === undefined ||
    other === undefined
  ) {
    return null
  }
  if (tools + system + skills + messages + other !== estimatedInputTokens) return null
  return {
    threadId,
    ...(event.turnId?.trim() ? { turnId: event.turnId.trim() } : {}),
    model,
    ...(event.providerId?.trim() ? { providerId: event.providerId.trim() } : {}),
    stepIndex,
    contextWindowTokens,
    ...(typeof event.contextWindowKnown === 'boolean' ? { contextWindowKnown: event.contextWindowKnown } : {}),
    ...(positiveInteger(event.maxInputTokens) ? { maxInputTokens: positiveInteger(event.maxInputTokens) } : {}),
    softThresholdTokens,
    hardThresholdTokens,
    estimatedInputTokens,
    breakdown: { tools, system, skills, messages, other },
    toolCount,
    activeSkillIds: Array.isArray(event.activeSkillIds)
      ? event.activeSkillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
      : [],
    ...(event.contextManagement === 'kun-managed' || event.contextManagement === 'sdk-managed'
      ? { contextManagement: event.contextManagement }
      : {}),
    ...(event.nativeHistory === 'known' || event.nativeHistory === 'unknown' || event.nativeHistory === 'none'
      ? { nativeHistory: event.nativeHistory } : {}),
    ...(event.occupancySource === 'agent' || event.occupancySource === 'estimate' ? { occupancySource: event.occupancySource } : {})
  }
}
