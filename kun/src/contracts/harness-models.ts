/** Native model facts; absence of a capability means unknown, not unsupported. */
export type HarnessModelInfo = {
  id: string
  displayName?: string
  description?: string
  isDefault?: boolean
  inputModalities?: string[]
  reasoningEfforts?: string[]
  defaultReasoningEffort?: string
  category?: 'model' | 'fusion'
}

/** Why a live native catalog lookup returned no models (never contains secrets). */
export type HarnessModelCatalogError = {
  code: 'auth_required' | 'timeout' | 'spawn_failed' | 'protocol_error' | 'agent_error' | 'unavailable'
  message?: string
}

export type HarnessModelCatalog = { models: string[]; modelInfo: HarnessModelInfo[]; error?: HarnessModelCatalogError }
