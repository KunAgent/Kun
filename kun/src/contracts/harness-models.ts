/** Native model facts; absence of a capability means unknown, not unsupported. */
export type HarnessModelInfo = {
  id: string
  displayName?: string
  description?: string
  isDefault?: boolean
  inputModalities?: string[]
  reasoningEfforts?: string[]
  defaultReasoningEffort?: string
}

export type HarnessModelCatalog = { models: string[]; modelInfo: HarnessModelInfo[] }
