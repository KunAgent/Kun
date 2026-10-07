import { harnessProfileEnabled, harnessProfileReady } from '@shared/harness-enablement'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings-types-kun-runtime'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { harnessRowRunsTurns, harnessRowUnavailableCode } from '../../store/harness-store'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'

export type CodeDefaultAgentSettings = {
  model: string
  providerId?: string
  harnesses?: Pick<KunHarnessSettingsV1, 'defaultHarnessId' | 'defaults' | 'disabledIds' | 'enabledProfiles'>
}
export type CodeDefaultAgentRoute = {
  harnessId: string
  credentialMode: string
  model: string
  providerId: string
}
export type CodeDefaultAgentResult = {
  route: CodeDefaultAgentRoute
  error?: 'detecting' | 'disabled' | 'unavailable' | 'credential' | 'provider' | 'model'
}

/** Resolve a whole route; a failed default remains selected and never falls back to another Agent. */
export function resolveCodeDefaultAgentRoute(input: {
  settings: CodeDefaultAgentSettings
  rows: AdeHarnessRow[]
  catalogLoaded: boolean
  groups: ModelProviderModelGroup[]
  currentModel: string
  currentProviderId: string
  collaboration: boolean
}): CodeDefaultAgentResult {
  const { settings, groups } = input
  const harnessId = settings.harnesses?.defaultHarnessId?.trim() || 'kun'
  const defaults = settings.harnesses?.defaults[harnessId]
  const row = input.rows.find((entry) => entry.definition.id === harnessId)
  const credentialMode = harnessId === 'kun' ? 'provider'
    : defaults?.credentialMode ?? row?.definition.credentialModes[0] ?? ''
  const route: CodeDefaultAgentRoute = {
    harnessId, credentialMode, model: defaults?.model ?? '', providerId: defaults?.providerId ?? ''
  }
  if (settings.harnesses?.disabledIds.includes(harnessId)) return { route, error: 'disabled' }
  if (harnessId !== 'kun') {
    if (!input.catalogLoaded) return { route, error: 'detecting' }
    if (!row || !harnessRowRunsTurns(row)) return { route, error: 'unavailable' }
    const unavailable = harnessRowUnavailableCode(row)
    if (unavailable) return { route, error: unavailable === 'detecting' ? 'detecting' : 'unavailable' }
    if (!row.definition.credentialModes.some((mode) => mode === credentialMode)) return { route, error: 'credential' }
  }
  if (credentialMode === 'native-login') {
    // Empty chooses the Agent's native default, never the Kun provider model.
    if (!row || !harnessProfileReady(row, { harnessId, credentialMode: 'native-login', providerId: route.providerId || undefined }) ||
      (settings.harnesses && !harnessProfileEnabled(settings.harnesses, { harnessId, credentialMode: 'native-login', providerId: route.providerId || undefined }))) return { route, error: 'disabled' }
    return { route }
  }
  const candidates = groups.filter((group) =>
    harnessId === 'cursor' && credentialMode === 'provider'
      ? group.kind === 'cursor-sdk'
      : isKunModelProviderGroup(group))
  const requestedProvider = defaults?.providerId
  const group = requestedProvider
    ? candidates.find((entry) => entry.providerId === requestedProvider)
    : candidates.find((entry) => entry.providerId === input.currentProviderId)
      ?? candidates.find((entry) => entry.providerId === settings.providerId)
      ?? candidates[0]
  if (!group) return { route, error: 'provider' }
  const model = defaults?.model ||
    (group.providerId === input.currentProviderId ? input.currentModel : '') ||
    (group.providerId === settings.providerId ? settings.model : '') || group.modelIds[0] || ''
  if (!model) return { route: { ...route, providerId: group.providerId }, error: 'model' }
  if (harnessId !== 'kun' && (!row || !harnessProfileReady(row, { harnessId, credentialMode: credentialMode as 'provider' | 'kun-gateway', providerId: group.providerId }) || (settings.harnesses && !harnessProfileEnabled(settings.harnesses, { harnessId, credentialMode: credentialMode as 'provider' | 'kun-gateway', providerId: group.providerId })))) return { route, error: 'disabled' }
  return { route: { ...route, model, providerId: group.providerId } }
}
