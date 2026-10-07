import {
  KUN_TOOL_PERMISSION_MODES,
  type AppSettingsPatch,
  type AppSettingsV1,
  type KunToolPermissionMode,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import { modelProviderRequiresApiKey } from '@shared/app-settings-provider-core'
import { UNREADABLE_CREDENTIAL_KEY_ERROR_CODE } from '@shared/kun-gui-api'
import { Bot, Hand, LockKeyholeOpen, Monitor, Moon, Sun } from 'lucide-react'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { RuntimeConnectionStatus } from '../agent/types'
import type { InitialSetupMode } from '../store/chat-store-types'
import type { InitialSetupDrafts } from './initial-setup-save'
import { sharedConnectionConnectFields } from './settings-section-providers-shared-payloads'
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

type PermissionOption = {
  value: KunToolPermissionMode
  labelKey: string
  descriptionKey: string
  Icon: typeof Hand
  tone: 'ask' | 'auto' | 'full'
}

export const PERMISSION_OPTIONS: PermissionOption[] = KUN_TOOL_PERMISSION_MODES.map((value) => {
  switch (value) {
    case 'ask-for-approval':
      return {
        value,
        labelKey: 'toolPermissionAskForApproval',
        descriptionKey: 'toolPermissionAskForApprovalDesc',
        Icon: Hand,
        tone: 'ask'
      }
    case 'approve-for-me':
      return {
        value,
        labelKey: 'toolPermissionApproveForMe',
        descriptionKey: 'toolPermissionApproveForMeDesc',
        Icon: Bot,
        tone: 'auto'
      }
    case 'full-access':
      return {
        value,
        labelKey: 'toolPermissionFullAccess',
        descriptionKey: 'toolPermissionFullAccessDesc',
        Icon: LockKeyholeOpen,
        tone: 'full'
      }
  }
})

/** First-run onboarding preselects full access; a reopened guide keeps the saved mode. */
export const FIRST_RUN_PERMISSION_MODE: KunToolPermissionMode = 'full-access'

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
    if (message.trim()) {
      return new Error(`Shared model connection request failed (HTTP ${response.status}): ${message.trim().slice(0, 300)}`)
    }
  } catch {
    // Preserve the existing status-only error for malformed or unrelated response bodies.
  }
  return new Error(`Shared model connection request failed (HTTP ${response.status})`)
}

/**
 * Keyless profiles (local servers, CLI/SDK subscriptions) never pass through
 * the credential drain, so the selected one is connected here before the
 * selection is written. A profile that needs a key is left to the drain.
 */
async function connectKeylessInitialSetupProvider(
  snapshot: InitialSetupModelConnectionsSnapshot,
  options: {
    profiles: readonly ModelProviderProfileV1[]
    selectedProviderId: string
    selectedModel: string
  },
  request: InitialSetupRuntimeRequest
): Promise<InitialSetupModelConnectionsSnapshot> {
  if (snapshot.providers.some((provider) => provider.id === options.selectedProviderId)) return snapshot
  const profile = options.profiles.find((entry) => entry.id === options.selectedProviderId)
  if (!profile || modelProviderRequiresApiKey(profile)) return snapshot
  // A local HTTP server without a key is an anonymous connection; the registry
  // only treats those as usable when they are registered that way.
  const anonymous = (profile.kind ?? 'http') === 'http' && !profile.apiKey.trim()
  let current = snapshot
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request('/v1/model-connections/connect', 'POST', JSON.stringify({
      expectedRevision: current.revision,
      ...sharedConnectionConnectFields(profile),
      ...(anonymous ? { authType: 'none' } : {}),
      ...(profile.apiKey.trim() ? { credential: profile.apiKey.trim() } : {}),
      models: profile.models,
      ...(options.selectedModel ? { selectedModel: options.selectedModel } : {}),
      probe: false,
      select: false
    }))
    if (response.ok) return initialSetupModelConnectionResponse(response.body)
    if (response.status !== 409 || attempt === 1) throw initialSetupModelConnectionRequestError(response)
    const conflict = JSON.parse(response.body) as { snapshot?: unknown }
    current = initialSetupModelConnectionsSnapshot(conflict.snapshot)
    if (current.providers.some((provider) => provider.id === options.selectedProviderId)) return current
  }
  return current
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
  const selectedProfile = options.profiles.find((profile) => profile.id === options.selectedProviderId)
  const keylessSelection = Boolean(selectedProfile && !modelProviderRequiresApiKey(selectedProfile))
  if (replacements.length === 0 && !keylessSelection) return
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
                  ...sharedConnectionConnectFields(profile),
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
    snapshot = await connectKeylessInitialSetupProvider(snapshot, options, request)
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

/**
 * After the settings save: reload the UI and make sure Kun is reachable before
 * the guide moves on to steps that talk to the runtime. A required first run
 * blocks on the probe; the preview opened from Settings probes in background.
 */
export async function verifyInitialSetupRuntime(input: {
  mode: InitialSetupMode
  reloadUiSettings: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  getState: () => InitialSetupCompletionState
  setDialogError: (message: string) => void
  fallbackRuntimeError: string
}): Promise<boolean> {
  await input.reloadUiSettings()
  if (input.mode === 'preview') {
    void input.probeRuntime('background')
    return true
  }
  await input.probeRuntime('user')
  const state = input.getState()
  if (state.runtimeConnection !== 'ready') {
    input.setDialogError(state.error?.trim() || input.fallbackRuntimeError)
    return false
  }
  return true
}

/** Leaves the guide: a required first run lands in Code, the preview just closes. */
export async function finishInitialSetup(input: {
  mode: InitialSetupMode
  openCode: () => Promise<void>
  closeInitialSetup: () => void
}): Promise<void> {
  if (input.mode === 'required') await input.openCode()
  input.closeInitialSetup()
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
