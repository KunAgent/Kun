import {
  DEFAULT_MODEL_PROVIDER_ID,
  KUN_TOOL_PERMISSION_MODES,
  MODEL_PROVIDER_PRESETS,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  normalizeAppSettings,
  tokenPlanProviderId,
  type AppSettingsPatch,
  type AppSettingsV1,
  type KunToolPermissionMode,
  type KunRuntimeSettingsPatchV1,
  type ModelEndpointFormat,
  type ModelProviderPreset,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { applyKunRuntimePatch } from '@shared/app-settings-kun-migration'
import { getModelProviderSettings } from '@shared/app-settings-provider-core'
import { defaultModelRequestRetrySettings } from '@shared/app-settings-provider-profiles'
import {
  resolveModelProviderPresetSource,
  withPresetRegion
} from '@shared/model-provider-preset-operations-core'
import { diffSettingsPatch } from './settings-utils'

export type InitialSetupAccessMode = 'api' | 'token-plan'

export type InitialSetupDraft = {
  apiKey: string
  baseUrl: string
  /** Models discovered or picked during onboarding; empty keeps the preset catalog. */
  models?: string[]
  /** Profile fields a login flow reported (e.g. a subscription's live model catalog). */
  profilePatch?: Partial<Pick<ModelProviderProfileV1, 'models' | 'modelProfiles'>>
  /** Default chat model chosen during onboarding. */
  model?: string
  /** Custom provider only. */
  name?: string
  endpointFormat?: ModelEndpointFormat
}

/** Keyed by provider profile id (deepseek, xiaomi, xiaomi-token-plan, ...). */
export type InitialSetupDrafts = Record<string, InitialSetupDraft>

export type InitialSetupSelection = {
  /** A preset id, `deepseek`, or `INITIAL_SETUP_CUSTOM_PRESET_ID`. */
  presetId: string
  mode: InitialSetupAccessMode
  permissionMode: KunToolPermissionMode
  /** True only after the user deliberately chooses a permission card. */
  permissionTouched: boolean
}

/** Selection id of the "custom endpoint" entry; it has no preset. */
export const INITIAL_SETUP_CUSTOM_PRESET_ID = 'custom'
/** Stable profile id for the provider created by the onboarding custom entry. */
export const INITIAL_SETUP_CUSTOM_PROFILE_ID = 'custom-provider-onboarding'

/** Every catalog preset can be connected from onboarding. */
export const INITIAL_SETUP_PROVIDER_PRESETS: readonly ModelProviderPreset[] = MODEL_PROVIDER_PRESETS

/** Presets whose drafts are seeded up front so speech/image wiring can be previewed. */
const SEEDED_PRESET_IDS = new Set(['xiaomi', 'minimax'])

export function presetForInitialSetup(presetId: string): ModelProviderPreset | null {
  return INITIAL_SETUP_PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? null
}

export function initialSetupProfileId(selection: Pick<InitialSetupSelection, 'presetId' | 'mode'>): string {
  if (selection.presetId === DEFAULT_MODEL_PROVIDER_ID) return DEFAULT_MODEL_PROVIDER_ID
  if (selection.presetId === INITIAL_SETUP_CUSTOM_PRESET_ID) return INITIAL_SETUP_CUSTOM_PROFILE_ID
  return selection.mode === 'token-plan' ? tokenPlanProviderId(selection.presetId) : selection.presetId
}

/** The preset and access mode a draft/profile id belongs to. */
export function initialSetupProfileTarget(
  profileId: string
): { preset: ModelProviderPreset; mode: InitialSetupAccessMode } | null {
  for (const preset of INITIAL_SETUP_PROVIDER_PRESETS) {
    if (preset.id === profileId) return { preset, mode: 'api' }
    if (preset.tokenPlan && tokenPlanProviderId(preset.id) === profileId) return { preset, mode: 'token-plan' }
  }
  return null
}

function presetDefaultBaseUrl(profileId: string): string {
  const target = initialSetupProfileTarget(profileId)
  if (!target) return ''
  return target.mode === 'token-plan' ? target.preset.tokenPlan?.baseUrl ?? '' : target.preset.baseUrl
}

/** Seed per-profile drafts from saved settings so existing keys show up. */
export function initialSetupDrafts(settings: AppSettingsV1): InitialSetupDrafts {
  const provider = getModelProviderSettings(settings)
  const byId = new Map(provider.providers.map((profile) => [profile.id, profile]))
  const drafts: InitialSetupDrafts = {
    [DEFAULT_MODEL_PROVIDER_ID]: { apiKey: provider.apiKey, baseUrl: provider.baseUrl }
  }
  for (const preset of INITIAL_SETUP_PROVIDER_PRESETS) {
    const ids = [preset.id, ...(preset.tokenPlan ? [tokenPlanProviderId(preset.id)] : [])]
    for (const id of ids) {
      const existing = byId.get(id)
      if (!existing && !SEEDED_PRESET_IDS.has(preset.id)) continue
      drafts[id] = {
        apiKey: existing?.apiKey ?? '',
        baseUrl: existing?.baseUrl ?? presetDefaultBaseUrl(id)
      }
    }
  }
  const custom = byId.get(INITIAL_SETUP_CUSTOM_PROFILE_ID)
  if (custom) {
    drafts[INITIAL_SETUP_CUSTOM_PROFILE_ID] = {
      apiKey: custom.apiKey,
      baseUrl: custom.baseUrl,
      name: custom.name,
      endpointFormat: custom.endpointFormat,
      models: [...custom.models]
    }
  }
  return drafts
}

/** The draft shown for a profile id, falling back to the preset defaults. */
export function initialSetupDraftFor(drafts: InitialSetupDrafts, profileId: string): InitialSetupDraft {
  return drafts[profileId] ?? { apiKey: '', baseUrl: presetDefaultBaseUrl(profileId) }
}

/**
 * Card and mode to preselect: the active provider when it maps to a preset
 * (or the onboarding custom provider), DeepSeek otherwise. A first run can ask
 * for a different default permission than the stored one.
 */
export function initialSetupSelection(
  settings: AppSettingsV1,
  options: { defaultPermissionMode?: KunToolPermissionMode } = {}
): InitialSetupSelection {
  const runtime = getKunRuntimeSettings(settings)
  const activeId = runtime.providerId.trim()
  const permissionMode = options.defaultPermissionMode ?? kunToolPermissionModeFromSettings(runtime)
  const base = { permissionMode, permissionTouched: false }
  if (activeId === INITIAL_SETUP_CUSTOM_PROFILE_ID) {
    return { presetId: INITIAL_SETUP_CUSTOM_PRESET_ID, mode: 'api', ...base }
  }
  const profile = getModelProviderSettings(settings).providers.find((entry) => entry.id === activeId)
  const source = activeId && activeId !== DEFAULT_MODEL_PROVIDER_ID
    ? resolveModelProviderPresetSource(profile ?? { id: activeId })
    : null
  if (source && presetForInitialSetup(source.preset.id)) {
    return { presetId: source.preset.id, mode: source.mode === 'token-plan' ? 'token-plan' : 'api', ...base }
  }
  return { presetId: DEFAULT_MODEL_PROVIDER_ID, mode: 'api', ...base }
}

export type InitialSetupAutoWirePlan = {
  speechProviderId: string
  imageProviderId: string
}

function draftHasCredential(drafts: InitialSetupDrafts, id: string): boolean {
  return Boolean(drafts[id]?.apiKey.trim())
}

/**
 * Capabilities to point at a just-configured profile. Only fires while the
 * capability is still unconfigured — never overrides a user choice. Speech and
 * image generation can come from a pay-as-you-go profile or a token plan when
 * the provider exposes that capability to subscription keys. Presets are
 * visited in catalog order and pay-as-you-go wins over the plan of the same
 * provider.
 */
export function initialSetupAutoWirePlan(
  settings: AppSettingsV1,
  drafts: InitialSetupDrafts
): InitialSetupAutoWirePlan {
  const runtime = getKunRuntimeSettings(settings)
  const speechUnconfigured = !runtime.speechToText.enabled && !runtime.speechToText.providerId.trim()
  const imageUnconfigured = !runtime.imageGeneration.enabled && !runtime.imageGeneration.providerId.trim()
  const plan: InitialSetupAutoWirePlan = { speechProviderId: '', imageProviderId: '' }
  for (const preset of INITIAL_SETUP_PROVIDER_PRESETS) {
    const apiKeyFilled = draftHasCredential(drafts, preset.id)
    const tokenPlanId = tokenPlanProviderId(preset.id)
    const tokenPlanKeyFilled = Boolean(preset.tokenPlan) && draftHasCredential(drafts, tokenPlanId)
    if (speechUnconfigured && !plan.speechProviderId) {
      if (preset.speech && apiKeyFilled) plan.speechProviderId = preset.id
      else if (preset.tokenPlan?.speech && tokenPlanKeyFilled) plan.speechProviderId = tokenPlanId
    }
    if (imageUnconfigured && !plan.imageProviderId) {
      if (preset.image && apiKeyFilled) plan.imageProviderId = preset.id
      else if (preset.tokenPlan?.image && tokenPlanKeyFilled) plan.imageProviderId = tokenPlanId
    }
  }
  return plan
}

/** Capability a profile would add when auto-wired; drives the UI hint. */
export function initialSetupProfileCapability(profileId: string): { speech: boolean; image: boolean } {
  const target = initialSetupProfileTarget(profileId)
  if (!target) return { speech: false, image: false }
  if (target.mode === 'token-plan') {
    return { speech: Boolean(target.preset.tokenPlan?.speech), image: Boolean(target.preset.tokenPlan?.image) }
  }
  return { speech: Boolean(target.preset.speech), image: Boolean(target.preset.image) }
}

function customProfile(draft: InitialSetupDraft): ModelProviderProfileV1 {
  return {
    id: INITIAL_SETUP_CUSTOM_PROFILE_ID,
    name: draft.name?.trim() || 'Custom provider',
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim(),
    endpointFormat: draft.endpointFormat ?? 'chat_completions',
    useProxy: false,
    retry: defaultModelRequestRetrySettings(),
    models: [],
    modelProfiles: {}
  }
}

/** The profile a draft produces, before it is merged with any saved profile. */
export function initialSetupDraftProfile(
  profileId: string,
  draft: InitialSetupDraft
): ModelProviderProfileV1 | null {
  const apiKey = draft.apiKey.trim()
  const baseUrl = (draft.baseUrl ?? '').trim()
  let built: ModelProviderProfileV1 | null
  if (profileId === INITIAL_SETUP_CUSTOM_PROFILE_ID) {
    built = customProfile(draft)
  } else {
    const target = initialSetupProfileTarget(profileId)
    if (!target) return null
    if (target.mode === 'token-plan') {
      built = modelProviderTokenPlanProfile(target.preset, apiKey, baseUrl)
    } else {
      const profile = modelProviderPresetProfile(target.preset, apiKey)
      built = baseUrl && baseUrl !== target.preset.baseUrl
        ? withPresetRegion(target.preset, profile, baseUrl)
        : profile
    }
  }
  if (!built) return null
  const patched = draft.profilePatch ? { ...built, ...draft.profilePatch } : built
  const models = draft.models?.map((model) => model.trim()).filter(Boolean) ?? []
  return models.length ? { ...patched, models } : patched
}

/**
 * Fold the onboarding drafts into settings: upsert one profile per draft that
 * carries a credential (plus the selected profile, which may be keyless),
 * activate the selected profile, and auto-wire speech/image to filled
 * profiles. The caller validates that the selected profile is usable.
 */
export function buildInitialSetupSettings(
  settings: AppSettingsV1,
  drafts: InitialSetupDrafts,
  selection: Pick<InitialSetupSelection, 'presetId' | 'mode'> &
    Partial<Pick<InitialSetupSelection, 'permissionMode' | 'permissionTouched'>>
): AppSettingsV1 {
  const provider = getModelProviderSettings(settings)
  const profiles = new Map(provider.providers.map((profile) => [profile.id, profile]))
  const selectedId = initialSetupProfileId(selection)

  const deepseekDraft = drafts[DEFAULT_MODEL_PROVIDER_ID]
  const nextApiKey = deepseekDraft ? deepseekDraft.apiKey.trim() : provider.apiKey
  const nextBaseUrl = deepseekDraft?.baseUrl.trim() ? deepseekDraft.baseUrl.trim() : provider.baseUrl
  const defaultProfile = profiles.get(DEFAULT_MODEL_PROVIDER_ID)
  if (defaultProfile) {
    profiles.set(DEFAULT_MODEL_PROVIDER_ID, {
      ...defaultProfile,
      apiKey: nextApiKey,
      baseUrl: nextBaseUrl,
      ...(selectedId === DEFAULT_MODEL_PROVIDER_ID && deepseekDraft?.models?.length
        ? { models: mergeModelIds(deepseekDraft.models, defaultProfile.models) }
        : {})
    })
  }

  for (const [id, draft] of Object.entries(drafts)) {
    if (id === DEFAULT_MODEL_PROVIDER_ID) continue
    if (!draft.apiKey.trim() && id !== selectedId) continue
    const built = initialSetupDraftProfile(id, draft)
    if (!built) continue
    const existing = profiles.get(id)
    const explicitModels = Boolean(draft.models?.length || draft.profilePatch?.models?.length)
    profiles.set(id, existing
      ? {
          ...built,
          name: existing.name.trim() || built.name,
          models: explicitModels ? built.models : mergeModelIds(built.models, existing.models)
        }
      : built)
  }

  const next = normalizeAppSettings({
    ...settings,
    initialSetupCompleted: true,
    provider: {
      apiKey: nextApiKey,
      baseUrl: nextBaseUrl,
      providers: [...profiles.values()]
    }
  } as AppSettingsV1)

  const runtime = getKunRuntimeSettings(next)
  const selectedProfile = getModelProviderSettings(next).providers.find(
    (profile) => profile.id === selectedId
  )
  const switchingProvider = (runtime.providerId.trim() || DEFAULT_MODEL_PROVIDER_ID) !== selectedId
  const chosenModel = drafts[selectedId]?.model?.trim()
  const model = chosenModel && selectedProfile?.models.includes(chosenModel)
    ? chosenModel
    : switchingProvider || (selectedProfile && !selectedProfile.models.includes(runtime.model))
      ? selectedProfile?.models[0]
      : undefined
  const wire = initialSetupAutoWirePlan(settings, drafts)
  // Only rewrite the complete authority snapshot when the user actually moved
  // the permission selector. The three-mode projection is intentionally lossy,
  // so emitting it while the selector is untouched would silently broaden or
  // otherwise rewrite a valid legacy approval/sandbox combination.
  const currentPermissionMode = kunToolPermissionModeFromSettings(runtime)
  const selectedPermissionMode = selection.permissionMode && KUN_TOOL_PERMISSION_MODES.includes(selection.permissionMode)
    ? selection.permissionMode
    : currentPermissionMode
  const permissionChanged =
    selection.permissionTouched === true ||
    selectedPermissionMode !== currentPermissionMode
  const kunPatch: KunRuntimeSettingsPatchV1 = {
    providerId: selectedId,
    apiKey: '',
    baseUrl: '',
    ...(permissionChanged ? kunToolPermissionModeSettings(selectedPermissionMode) : {}),
    ...(model ? { model } : {}),
    ...(wire.speechProviderId
      ? { speechToText: { enabled: true, providerId: wire.speechProviderId } }
      : {}),
    ...(wire.imageProviderId
      ? { imageGeneration: { enabled: true, providerId: wire.imageProviderId } }
      : {})
  }
  return applyKunRuntimePatch(next, kunPatch)
}

/**
 * `stored` is what Main last returned. The guide edits a local form (language,
 * theme), so the patch is diffed against the stored copy, not the form.
 */
export function buildInitialSetupSettingsPatch(
  settings: AppSettingsV1,
  drafts: InitialSetupDrafts,
  selection: Pick<InitialSetupSelection, 'presetId' | 'mode'> &
    Partial<Pick<InitialSetupSelection, 'permissionMode' | 'permissionTouched'>>,
  stored: AppSettingsV1 = settings
): AppSettingsPatch {
  const next = buildInitialSetupSettings(settings, drafts, selection)
  const providers = next.provider.providers.map((provider) => ({ ...provider, apiKey: '' }))
  return diffSettingsPatch(stored, {
    ...next,
    provider: {
      ...next.provider,
      apiKey: '',
      providers
    },
    agents: {
      ...next.agents,
      kun: { ...next.agents.kun, apiKey: '' }
    }
  })
}

function mergeModelIds(primary: readonly string[], secondary: readonly string[]): string[] {
  const ids = new Set<string>()
  for (const model of [...primary, ...secondary]) {
    const trimmed = model.trim()
    if (trimmed) ids.add(trimmed)
  }
  return [...ids]
}
