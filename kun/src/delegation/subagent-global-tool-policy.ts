export const GLOBAL_SUBAGENT_TOOL_NAMES = ['fast_context'] as const
export const GLOBAL_SUBAGENT_PROVIDER_IDS = ['fast-context'] as const

/**
 * Add host-owned global child capabilities after ordinary profile narrowing.
 * An undefined allow-list already means unrestricted, so it must stay undefined.
 * Parent capability snapshots and explicit deny-lists remain authoritative.
 */
export function withGlobalSubagentTools(input: {
  allowedToolNames: readonly string[] | undefined
  parentAllowedToolNames?: readonly string[]
  blockedToolNames?: readonly string[]
  parentAllowedProviderIds?: readonly string[]
  parentBlockedProviderIds?: readonly string[]
  fastContext?: boolean
}): string[] | undefined {
  if (input.fastContext || input.allowedToolNames === undefined) {
    return input.allowedToolNames ? [...input.allowedToolNames] : undefined
  }

  const toolName = GLOBAL_SUBAGENT_TOOL_NAMES[0]
  const providerId = GLOBAL_SUBAGENT_PROVIDER_IDS[0]
  if (input.parentAllowedToolNames && !input.parentAllowedToolNames.includes(toolName)) {
    return [...input.allowedToolNames]
  }
  if (input.blockedToolNames?.includes(toolName)) return [...input.allowedToolNames]
  if (input.parentAllowedProviderIds && !input.parentAllowedProviderIds.includes(providerId)) {
    return [...input.allowedToolNames]
  }
  if (input.parentBlockedProviderIds?.includes(providerId)) return [...input.allowedToolNames]
  return [...new Set([...input.allowedToolNames, toolName])]
}
