import { PROVIDER_CATALOG } from './presets.js'

export * from './antigravity-model-catalog.js'
export { PROVIDER_CATALOG } from './presets.js'

export const TOKEN_PLAN_PROVIDER_ID_SUFFIX = '-token-plan'

export type ProviderCatalogCategory = 'api' | 'free' | 'subscription'
export type ProviderCatalogKind =
  | 'http'
  | 'agent-sdk'
  | 'antigravity-cli'
  | 'gemini-cli-api'
  | 'cursor-sdk'
export type ProviderCatalogAuthFlow =
  | 'api-key'
  | 'chatgpt-oauth'
  | 'grok-oauth'
  | 'claude-subscription'
  | 'gemini-subscription'
  | 'gemini-cli-subscription'
  | 'cursor-api-key'
export type ProviderCatalogAuthType = 'api-key' | 'oauth' | 'subscription'
export type ProviderCatalogCredentialRequirement = 'required' | 'optional' | 'none'
export type ProviderCatalogEndpointFormat =
  | 'chat_completions'
  | 'responses'
  | 'messages'
  | 'custom_endpoint'

export type ProviderCatalogTokenPlan = {
  /** Optional product-specific name used instead of the generic "Token Plan" label. */
  displayName?: string
  baseUrl: string
  regions?: ReadonlyArray<{ id: string; baseUrl: string }>
  endpointFormat: ProviderCatalogEndpointFormat
  models: readonly string[]
  credentialUrl: string
}

export type ProviderCatalogPreset = {
  id: string
  name: string
  category: ProviderCatalogCategory
  kind: ProviderCatalogKind
  authFlow: ProviderCatalogAuthFlow
  authType: ProviderCatalogAuthType
  credentialRequirement?: ProviderCatalogCredentialRequirement
  baseUrl: string
  endpointFormat: ProviderCatalogEndpointFormat
  models: readonly string[]
  docsUrl: string
  credentialUrl: string
  tokenPlan?: ProviderCatalogTokenPlan
}

export type ProviderCatalogEntry = {
  profileId: string
  presetSource: string
  presetId: string
  mode: 'api' | 'token-plan'
  label: string
  name: string
  category: ProviderCatalogCategory
  kind: ProviderCatalogKind
  authFlow: ProviderCatalogAuthFlow
  authType: ProviderCatalogAuthType
  credentialRequirement: ProviderCatalogCredentialRequirement
  baseUrl: string
  endpointFormat: ProviderCatalogEndpointFormat
  models: readonly string[]
  docsUrl: string
  credentialUrl: string
}

export type ProviderCatalogSource = {
  preset: ProviderCatalogPreset
  presetSource: string
  presetMode: 'api' | 'token-plan'
}

export type ProviderCatalogSourceInput = {
  id?: string
  presetSource?: string
  presetMode?: 'api' | 'token-plan'
}


export function getProviderCatalogPreset(id: string): ProviderCatalogPreset | null {
  return PROVIDER_CATALOG.find((preset) => preset.id === id) ?? null
}

export function tokenPlanProviderId(presetId: string): string {
  return `${presetId}${TOKEN_PLAN_PROVIDER_ID_SUFFIX}`
}

/**
 * Resolves catalog identity independently from the provider/account id. The
 * numbered-account fallback is deliberately limited to known catalog IDs so a
 * custom provider sharing an endpoint is never silently reclassified.
 */
export function resolveProviderCatalogSource(
  input: ProviderCatalogSourceInput
): ProviderCatalogSource | null {
  const catalog: readonly ProviderCatalogPreset[] = PROVIDER_CATALOG
  const requestedSource = input.presetSource?.trim().toLowerCase()
  const explicitMode = input.presetMode
  if (requestedSource) {
    const explicit = catalog.find((preset) => preset.id === requestedSource)
    if (explicit && (!explicitMode || explicitMode === 'api' || explicit.tokenPlan)) {
      return {
        preset: explicit,
        presetSource: explicit.id,
        presetMode: explicitMode ?? (requestedSource.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX) ? 'token-plan' : 'api')
      }
    }
    if (requestedSource.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)) {
      const presetId = requestedSource.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length)
      const tokenPlanPreset = catalog.find((preset) => preset.id === presetId && preset.tokenPlan)
      if (tokenPlanPreset) {
        return { preset: tokenPlanPreset, presetSource: tokenPlanPreset.id, presetMode: 'token-plan' }
      }
    }
  }

  const id = input.id?.trim().toLowerCase() ?? ''
  const exact = catalog.find((preset) => preset.id === id)
  if (exact) return { preset: exact, presetSource: exact.id, presetMode: 'api' }
  const numbered = /^(.*)-(?:[2-9]|[1-9][0-9]+)$/u.exec(id)?.[1]
  if (!numbered) return null
  const baseId = numbered
  const tokenPlan = baseId.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)
  const presetId = tokenPlan ? baseId.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length) : baseId
  const preset = catalog.find((candidate) => candidate.id === presetId)
  if (!preset || (tokenPlan && !preset.tokenPlan)) return null
  return { preset, presetSource: preset.id, presetMode: tokenPlan ? 'token-plan' : 'api' }
}

export function providerCatalogEntries(): ProviderCatalogEntry[] {
  const catalog: readonly ProviderCatalogPreset[] = PROVIDER_CATALOG
  const entries = catalog.flatMap((preset): ProviderCatalogEntry[] => {
    const base: ProviderCatalogEntry = {
      profileId: preset.id,
      presetSource: preset.id,
      presetId: preset.id,
      mode: 'api',
      label: preset.name,
      name: preset.name,
      category: preset.category,
      kind: preset.kind,
      authFlow: preset.authFlow,
      authType: preset.authType,
      credentialRequirement: preset.credentialRequirement ?? 'required',
      baseUrl: preset.baseUrl,
      endpointFormat: preset.endpointFormat,
      models: [...preset.models],
      docsUrl: preset.docsUrl,
      credentialUrl: preset.credentialUrl
    }
    if (!preset.tokenPlan) return [base]
    const tokenPlanName = preset.tokenPlan.displayName?.trim() || `${preset.name} Token Plan`
    return [
      base,
      {
        profileId: tokenPlanProviderId(preset.id),
        presetSource: tokenPlanProviderId(preset.id),
        presetId: preset.id,
        mode: 'token-plan',
        label: preset.tokenPlan.displayName?.trim() || `${preset.name} · Token Plan`,
        name: tokenPlanName,
        category: 'subscription',
        kind: 'http',
        authFlow: 'api-key',
        authType: 'subscription',
        credentialRequirement: 'required',
        baseUrl: preset.tokenPlan.baseUrl,
        endpointFormat: preset.tokenPlan.endpointFormat,
        models: [...preset.tokenPlan.models],
        docsUrl: preset.docsUrl,
        credentialUrl: preset.tokenPlan.credentialUrl
      }
    ]
  })
  return [
    ...entries.filter((entry) => entry.category === 'free'),
    ...entries.filter((entry) => entry.category === 'subscription'),
    ...entries.filter((entry) => entry.category === 'api')
  ]
}
