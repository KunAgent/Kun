import {
  providerCatalogEntries,
  type ProviderCatalogAuthFlow,
  type ProviderCatalogAuthType,
  type ProviderCatalogCredentialRequirement,
  type ProviderCatalogKind
} from '@kun/provider-catalog'
import {
  isModelConnectionProfileUsable,
  type ModelConnectionProfile
} from '../contracts/model-connections.js'

export type ConnectionPreset = {
  id: string
  presetSource?: string
  name: string
  category: 'Free' | 'Subscription' | 'API'
  kind: ProviderCatalogKind
  authFlow: ProviderCatalogAuthFlow
  authType: ProviderCatalogAuthType
  credentialRequirement: ProviderCatalogCredentialRequirement
  baseUrl?: string
  endpointFormat: 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint'
  models: string[]
  docsUrl?: string
  credentialUrl?: string
}

export const connectionPresets: ConnectionPreset[] = [
  {
    id: 'custom', name: 'Custom provider', category: 'API', kind: 'http',
    authFlow: 'api-key', authType: 'api-key', credentialRequirement: 'required',
    endpointFormat: 'chat_completions', models: []
  },
  ...providerCatalogEntries().map((entry): ConnectionPreset => ({
    id: entry.profileId,
    presetSource: entry.presetSource,
    name: entry.label,
    category: entry.category === 'free'
      ? 'Free'
      : entry.category === 'subscription' ? 'Subscription' : 'API',
    kind: entry.kind,
    authFlow: entry.authFlow,
    authType: entry.authType,
    credentialRequirement: entry.credentialRequirement,
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    endpointFormat: entry.endpointFormat,
    models: [...entry.models],
    docsUrl: entry.docsUrl,
    credentialUrl: entry.credentialUrl
  }))
]

export function connectionPresetForProfile(profile: ModelConnectionProfile): ConnectionPreset | undefined {
  const identities = [profile.presetSource, profile.id].filter((value): value is string => Boolean(value))
  const exact = connectionPresets.find((entry) => identities.includes(entry.id))
  if (exact) return exact
  return [...connectionPresets]
    .filter((entry) => entry.id !== 'custom')
    .sort((left, right) => right.id.length - left.id.length)
    .find((entry) => identities.some((identity) =>
      identity.startsWith(`${entry.id}-`) && /^\d+$/u.test(identity.slice(entry.id.length + 1))
    ))
}

export function credentialAvailabilityLabel(
  profile: Pick<ModelConnectionProfile, 'configured' | 'credentialStatus'>
): string {
  if (profile.credentialStatus === 'missing') return 'Credential missing'
  if (profile.credentialStatus === 'unreadable') return 'Credential unreadable'
  return isModelConnectionProfileUsable(profile) ? 'Connected' : 'Needs configuration'
}

export const CONNECT_ENDPOINT_FORMATS = ['chat_completions', 'responses', 'messages', 'custom_endpoint'] as const

export type ConnectField = 'id' | 'name' | 'baseUrl' | 'endpointFormat' | 'credential' | 'models'

export function connectionRequiresCredential(preset: ConnectionPreset): boolean {
  return preset.credentialRequirement === 'required'
}

export type ManagementAction = {
  kind: 'rename' | 'reconnect' | 'credential' | 'probe' | 'disconnect' | 'back'
  label: string
}

export function authenticationStrategy(
  authFlow: ProviderCatalogAuthFlow
): 'secret' | 'runtime' | 'official-cli' {
  switch (authFlow) {
    case 'api-key':
    case 'cursor-api-key':
      return 'secret'
    case 'chatgpt-oauth':
    case 'grok-oauth':
    case 'claude-subscription':
      return 'runtime'
    case 'gemini-subscription':
    case 'gemini-cli-subscription':
      return 'official-cli'
  }
}

export function managementActions(
  profile: ModelConnectionProfile,
  preset: ConnectionPreset | undefined
): ManagementAction[] {
  const strategy = preset ? authenticationStrategy(preset.authFlow) : undefined
  return [
    { kind: 'rename', label: 'Rename connection' },
    ...(strategy === 'runtime' || strategy === 'official-cli'
      ? [{ kind: 'reconnect', label: 'Sign in again / reconnect' }] satisfies ManagementAction[]
      : profile.kind === 'http' || profile.kind === 'cursor-sdk'
      ? [{ kind: 'credential', label: 'Replace credential' }] satisfies ManagementAction[]
      : []),
    ...(profile.kind === 'http'
      ? [{ kind: 'probe', label: 'Probe connection and models' }] satisfies ManagementAction[]
      : []),
    { kind: 'disconnect', label: 'Disconnect and remove credential' },
    { kind: 'back', label: 'Back to connections' }
  ]
}
