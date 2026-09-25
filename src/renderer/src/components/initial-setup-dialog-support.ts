import {
  DEFAULT_MODEL_PROVIDER_ID,
  KUN_TOOL_PERMISSION_MODES,
  type AppSettingsPatch,
  type AppSettingsV1,
  type KunToolPermissionMode,
  type ModelProviderPreset,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import { UNREADABLE_CREDENTIAL_KEY_ERROR_CODE } from '@shared/kun-gui-api'
import { Bot, Hand, LockKeyholeOpen, Monitor, Moon, Sun } from 'lucide-react'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { RuntimeConnectionStatus } from '../agent/types'
import type { InitialSetupMode } from '../store/chat-store-types'
import {
  INITIAL_SETUP_PROVIDER_PRESETS,
  type InitialSetupDrafts,
  type InitialSetupSelection
} from './initial-setup-save'
import {
  drainSharedProviderCredentialMutation,
  enqueueSharedModelMutation,
  stageSharedProviderCredentialMutation
} from './shared-provider-mutation-coordinator'

export type ThemePref = AppSettingsV1['theme']
export type SetupFormPatch = AppSettingsPatch
type InitialSetupCompletionState = {
  runtimeConnection: RuntimeConnectionStatus
  error: string | null
}

export const themeOptions: { value: ThemePref; icon: typeof Sun; labelKey: string }[] = [
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' }
]
const DEEPSEEK_USAGE_URL = 'https://platform.deepseek.com/usage'

type PermissionOption = {
  value: KunToolPermissionMode
  labelKey: string
  descriptionKey: string
  Icon: typeof Hand
  iconClass: string
}

export const PERMISSION_OPTIONS: PermissionOption[] = KUN_TOOL_PERMISSION_MODES.map((value) => {
  switch (value) {
    case 'ask-for-approval':
      return {
        value,
        labelKey: 'toolPermissionAskForApproval',
        descriptionKey: 'toolPermissionAskForApprovalDesc',
        Icon: Hand,
        iconClass: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
      }
    case 'approve-for-me':
      return {
        value,
        labelKey: 'toolPermissionApproveForMe',
        descriptionKey: 'toolPermissionApproveForMeDesc',
        Icon: Bot,
        iconClass: 'border-teal-400/30 bg-teal-500/10 text-teal-700 dark:text-teal-200'
      }
    case 'full-access':
      return {
        value,
        labelKey: 'toolPermissionFullAccess',
        descriptionKey: 'toolPermissionFullAccessDesc',
        Icon: LockKeyholeOpen,
        iconClass: 'border-orange-400/35 bg-orange-500/10 text-orange-700 dark:text-orange-200'
      }
  }
})

export type SetupProviderCard = {
  presetId: string
  name: string
  descKey: string
  capability: 'speech' | 'image' | null
  preset: ModelProviderPreset | null
}

export const PROVIDER_CARDS: SetupProviderCard[] = [
  {
    presetId: DEFAULT_MODEL_PROVIDER_ID,
    name: 'DeepSeek',
    descKey: 'firstRunProviderDeepseekDesc',
    capability: null,
    preset: null
  },
  ...INITIAL_SETUP_PROVIDER_PRESETS.map((preset) => ({
    presetId: preset.id,
    name: preset.name,
    descKey: preset.id === 'xiaomi' ? 'firstRunProviderXiaomiDesc' : 'firstRunProviderMinimaxDesc',
    capability: preset.speech ? ('speech' as const) : preset.image ? ('image' as const) : null,
    preset
  }))
]

export function keyHintKey(card: SetupProviderCard, mode: InitialSetupSelection['mode']): string {
  if (card.presetId === DEFAULT_MODEL_PROVIDER_ID) return 'firstRunBuyApiHint'
  const suffix = mode === 'token-plan' ? 'TokenPlan' : 'Api'
  return card.presetId === 'xiaomi' ? `firstRunKeyHintXiaomi${suffix}` : `firstRunKeyHintMinimax${suffix}`
}

export function keyPageUrl(card: SetupProviderCard, mode: InitialSetupSelection['mode']): string {
  if (!card.preset) return DEEPSEEK_USAGE_URL
  if (mode === 'token-plan' && card.preset.tokenPlan) return card.preset.tokenPlan.apiKeyUrl
  return card.preset.apiKeyUrl
}

export function keyPlaceholder(card: SetupProviderCard, mode: InitialSetupSelection['mode']): string {
  if (mode === 'token-plan') {
    const prefix = card.preset?.tokenPlan?.keyPrefix
    return prefix ? `${prefix}...` : 'API Key'
  }
  return card.presetId === 'minimax' ? 'API Key' : 'sk-...'
}

type InitialSetupModelConnectionsSnapshot = {
  schemaVersion: 1
  revision: number
  providers: Array<{ id: string; accountId?: string }>
}

type InitialSetupRuntimeRequest = (
  path: string,
  method?: string,
  body?: string
) => Promise<{ ok: boolean; status: number; body: string }>

function initialSetupModelConnectionsSnapshot(raw: unknown): InitialSetupModelConnectionsSnapshot {
  const snapshot = raw as InitialSetupModelConnectionsSnapshot
  if (
    snapshot?.schemaVersion !== 1 ||
    !Number.isInteger(snapshot.revision) ||
    !Array.isArray(snapshot.providers)
  ) throw new Error('Invalid shared model connection response')
  return snapshot
}

function initialSetupModelConnectionResponse(body: string): InitialSetupModelConnectionsSnapshot {
  return initialSetupModelConnectionsSnapshot(JSON.parse(body))
}

function initialSetupModelConnectionRequestError(response: {
  status: number
  body: string
}): Error {
  try {
    const parsed = JSON.parse(response.body) as { code?: unknown; message?: unknown }
    const code = typeof parsed.code === 'string' ? parsed.code : ''
    const message = typeof parsed.message === 'string' ? parsed.message : ''
    if (code === UNREADABLE_CREDENTIAL_KEY_ERROR_CODE || message.includes(UNREADABLE_CREDENTIAL_KEY_ERROR_CODE)) {
      return new Error(`${UNREADABLE_CREDENTIAL_KEY_ERROR_CODE}: ${message || 'protected credential key is unreadable'}`)
    }
  } catch {
    // Preserve the existing status-only error for malformed or unrelated response bodies.
  }
  return new Error(`Shared model connection request failed (HTTP ${response.status})`)
}

export async function commitInitialSetupRegistryCredentials(
  drafts: InitialSetupDrafts,
  options: {
    profiles: readonly ModelProviderProfileV1[]
    selectedProviderId: string
    selectedModel: string
  },
  request: InitialSetupRuntimeRequest = (path, method, body) =>
    rendererRuntimeClient.runtimeRequest(path, method, body)
): Promise<void> {
  const replacements = Object.entries(drafts).flatMap(([providerId, draft]) => {
    const credential = draft.apiKey.trim()
    return credential ? [{ providerId, credential }] : []
  })
  if (replacements.length === 0) return
  const staged = replacements.map(({ providerId, credential }) => ({
    providerId,
    profile: options.profiles.find((profile) => profile.id === providerId),
    generation: stageSharedProviderCredentialMutation(
      providerId,
      credential,
      async (operationToken) => {
        const listed = await request('/v1/model-connections', 'GET')
        if (!listed.ok) {
          throw initialSetupModelConnectionRequestError(listed)
        }
        let snapshot = initialSetupModelConnectionResponse(listed.body)
        if (!snapshot.providers.some((provider) => provider.id === providerId)) return
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const fenced = await request(
            `/v1/model-connections/${encodeURIComponent(providerId)}/credential/fence`,
            'POST',
            JSON.stringify({ expectedRevision: snapshot.revision, operationToken })
          )
          if (fenced.ok) return
          if (fenced.status !== 409 || attempt === 1) {
            throw initialSetupModelConnectionRequestError(fenced)
          }
          const conflict = JSON.parse(fenced.body) as { snapshot?: unknown }
          snapshot = initialSetupModelConnectionsSnapshot(conflict.snapshot)
        }
      }
    ).generation
  }))
  for (const replacement of staged) {
    const profile = replacement.profile
    if (!profile) {
      throw new Error(`Shared model connection profile ${replacement.providerId} is unavailable`)
    }
    await drainSharedProviderCredentialMutation(
      replacement.providerId,
      replacement.generation,
      async (credential, operationToken, isCurrent) => {
        const listed = await request('/v1/model-connections', 'GET')
        if (!listed.ok) throw initialSetupModelConnectionRequestError(listed)
        let snapshot = initialSetupModelConnectionResponse(listed.body)
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (!isCurrent()) return snapshot
          const connected = snapshot.providers.some((provider) => provider.id === replacement.providerId)
          if (connected) {
            const fenced = await request(
                `/v1/model-connections/${encodeURIComponent(replacement.providerId)}/credential/fence`,
                'POST',
                JSON.stringify({ expectedRevision: snapshot.revision, operationToken })
              )
              if (!fenced.ok) {
                throw initialSetupModelConnectionRequestError(fenced)
              }
              snapshot = initialSetupModelConnectionResponse(fenced.body)
            if (!isCurrent()) return snapshot
          }
          let response = connected
            ? await request(
                `/v1/model-connections/${encodeURIComponent(replacement.providerId)}/credential`,
                'PUT',
                JSON.stringify({
                  expectedRevision: snapshot.revision,
                  credential,
                  operationToken
                })
              )
            : await request(
                '/v1/model-connections/connect',
                'POST',
                JSON.stringify({
                  expectedRevision: snapshot.revision,
                  id: profile.id,
                  name: profile.name.trim() || profile.id,
                  kind: profile.kind ?? 'http',
                  authType: 'api-key',
                  baseUrl: profile.baseUrl,
                  endpointFormat: profile.endpointFormat,
                  ...(profile.endpoints ? { endpoints: profile.endpoints } : {}),
                  credential,
                  models: profile.models,
                  ...(profile.models[0]
                    ? { selectedModel: profile.models[0] }
                    : {}),
                  probe: false,
                  select: false
                })
              )
          if (connected && response.ok) {
            snapshot = initialSetupModelConnectionResponse(response.body)
            if (!isCurrent()) return snapshot
            response = await request(
              `/v1/model-connections/${encodeURIComponent(replacement.providerId)}/credential/commit`,
              'POST',
              JSON.stringify({
                expectedRevision: snapshot.revision,
                operationToken
              })
            )
          }
          if (response.ok) return initialSetupModelConnectionResponse(response.body)
          if (response.status !== 409) {
            throw initialSetupModelConnectionRequestError(response)
          }
          const conflict = JSON.parse(response.body) as { snapshot?: unknown }
          snapshot = initialSetupModelConnectionsSnapshot(conflict.snapshot)
          if (!isCurrent()) return snapshot
          if (attempt === 1) {
            throw initialSetupModelConnectionRequestError(response)
          }
        }
        return snapshot
      }
    )
  }
  await enqueueSharedModelMutation(async () => {
    const listed = await request('/v1/model-connections', 'GET')
    if (!listed.ok) throw initialSetupModelConnectionRequestError(listed)
    let snapshot = initialSetupModelConnectionResponse(listed.body)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const selected = snapshot.providers.find((provider) => provider.id === options.selectedProviderId)
      if (!selected) throw new Error(`Shared model connection ${options.selectedProviderId} is unavailable`)
      const response = await request('/v1/model-connections/select', 'POST', JSON.stringify({
        expectedRevision: snapshot.revision,
        providerId: options.selectedProviderId,
        ...(selected.accountId ? { accountId: selected.accountId } : {}),
        model: options.selectedModel
      }))
      if (response.ok) return initialSetupModelConnectionResponse(response.body)
      if (response.status !== 409 || attempt === 1) {
        throw initialSetupModelConnectionRequestError(response)
      }
      const conflict = JSON.parse(response.body) as { snapshot?: unknown }
      snapshot = initialSetupModelConnectionsSnapshot(conflict.snapshot)
    }
    return snapshot
  })
}

export function canCloseInitialSetup(_mode: InitialSetupMode): boolean {
  return true
}

export function isUnreadableCredentialKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(UNREADABLE_CREDENTIAL_KEY_ERROR_CODE)
}

export async function completeInitialSetupAfterSave(input: {
  mode: InitialSetupMode
  reloadUiSettings: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  openCode: () => Promise<void>
  closeInitialSetup: () => void
  getState: () => InitialSetupCompletionState
  setDialogError: (message: string) => void
  fallbackRuntimeError: string
}): Promise<boolean> {
  await input.reloadUiSettings()
  if (input.mode === 'preview') {
    void input.probeRuntime('background')
    input.closeInitialSetup()
    return true
  }

  await input.probeRuntime('user')
  const state = input.getState()
  if (state.runtimeConnection !== 'ready') {
    input.setDialogError(state.error?.trim() || input.fallbackRuntimeError)
    return false
  }
  await input.openCode()
  input.closeInitialSetup()
  return true
}

export async function dismissInitialSetup(input: {
  mode: InitialSetupMode
  persistCompletion: () => Promise<void>
  reloadUiSettings: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  closeInitialSetup: () => void
}): Promise<void> {
  if (input.mode === 'required') {
    await input.persistCompletion()
  }
  await input.reloadUiSettings()
  input.closeInitialSetup()
  if (input.mode === 'required') {
    void input.probeRuntime('user')
  }
}
