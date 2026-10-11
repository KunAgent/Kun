import {
  DEFAULT_MODEL_PROVIDER_ID,
  type ModelProviderPreset,
  type ModelProviderTokenPlanRegion
} from '@shared/app-settings'
import { modelProviderRequiresApiKey } from '@shared/app-settings-provider-core'
import {
  INITIAL_SETUP_CUSTOM_PRESET_ID,
  INITIAL_SETUP_PROVIDER_PRESETS,
  initialSetupDraftProfile,
  initialSetupProfileCapability,
  initialSetupProfileId,
  presetForInitialSetup,
  type InitialSetupAccessMode,
  type InitialSetupDraft,
  type InitialSetupSelection
} from '../initial-setup-save'

export type OnboardingProviderTab = 'featured' | 'api' | 'plan' | 'login' | 'local'
export type OnboardingRegionFilter = 'all' | 'china' | 'united-states'
/** How the configure page collects the credential. */
export type OnboardingConnectKind = 'key' | 'login' | 'local' | 'custom'
/** Subscription logins reuse the Settings login sections. */
export type OnboardingLoginFlow = 'codex' | 'grok' | 'claude' | 'antigravity' | 'gemini-cli'

export type OnboardingProviderEntry = {
  /** Unique entry id: the preset id, `<preset>:token-plan`, or `deepseek`. */
  id: string
  presetId: string
  mode: InitialSetupAccessMode
  name: string
  /** Catalog one-liner (English in the preset catalog); featured entries localize it. */
  note: string
  tab: Exclude<OnboardingProviderTab, 'featured'>
  region?: Exclude<OnboardingRegionFilter, 'all'>
  connect: OnboardingConnectKind
  loginFlow?: OnboardingLoginFlow
  speech: boolean
  image: boolean
}

/** Shown first: the providers most first-run users reach for. */
export const ONBOARDING_FEATURED_IDS = [
  'deepseek',
  'xiaomi',
  'minimax',
  'moonshot-cn',
  'zhipu-api',
  'aliyun',
  'volcengine',
  'openrouter',
  'codex',
  'claude-subscription',
  'ollama-local',
  'siliconflow'
] as const

const LOGIN_FLOWS: Readonly<Record<string, OnboardingLoginFlow>> = {
  codex: 'codex',
  'grok-subscription': 'grok',
  'claude-subscription': 'claude',
  'gemini-subscription': 'antigravity',
  'gemini-cli-subscription': 'gemini-cli'
}

const TOKEN_PLAN_ENTRY_SUFFIX = ':token-plan'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function presetEntry(preset: ModelProviderPreset): OnboardingProviderEntry {
  const loginFlow = LOGIN_FLOWS[preset.id]
  const capability = initialSetupProfileCapability(preset.id)
  const login = Boolean(loginFlow) || preset.kind === 'cursor-sdk'
  const local = preset.origin === 'local'
  return {
    id: preset.id,
    presetId: preset.id,
    mode: 'api',
    name: preset.name,
    note: preset.note ?? hostOf(preset.baseUrl),
    tab: login ? 'login' : local ? 'local' : preset.category === 'subscription' ? 'plan' : 'api',
    ...(preset.subscriptionRegion ? { region: preset.subscriptionRegion } : {}),
    connect: loginFlow ? 'login' : local ? 'local' : 'key',
    ...(loginFlow ? { loginFlow } : {}),
    speech: capability.speech,
    image: capability.image
  }
}

function tokenPlanEntry(preset: ModelProviderPreset): OnboardingProviderEntry | null {
  const plan = preset.tokenPlan
  if (!plan) return null
  const capability = initialSetupProfileCapability(initialSetupProfileId({ presetId: preset.id, mode: 'token-plan' }))
  return {
    id: `${preset.id}${TOKEN_PLAN_ENTRY_SUFFIX}`,
    presetId: preset.id,
    mode: 'token-plan',
    name: plan.displayName?.trim() || `${preset.name} Token Plan`,
    note: hostOf(plan.baseUrl),
    tab: 'plan',
    ...(preset.subscriptionRegion ? { region: preset.subscriptionRegion } : {}),
    connect: 'key',
    speech: capability.speech,
    image: capability.image
  }
}

const DEEPSEEK_ENTRY: OnboardingProviderEntry = {
  id: DEFAULT_MODEL_PROVIDER_ID,
  presetId: DEFAULT_MODEL_PROVIDER_ID,
  mode: 'api',
  name: 'DeepSeek',
  note: 'api.deepseek.com',
  tab: 'api',
  connect: 'key',
  speech: false,
  image: false
}

let cachedEntries: OnboardingProviderEntry[] | null = null

/** Every connectable entry: DeepSeek, each preset, and each preset's Token Plan. */
export function onboardingProviderEntries(): OnboardingProviderEntry[] {
  if (cachedEntries) return cachedEntries
  const entries: OnboardingProviderEntry[] = [DEEPSEEK_ENTRY]
  for (const preset of INITIAL_SETUP_PROVIDER_PRESETS) {
    entries.push(presetEntry(preset))
    const plan = tokenPlanEntry(preset)
    if (plan) entries.push(plan)
  }
  cachedEntries = entries
  return entries
}

export function onboardingProviderEntry(id: string): OnboardingProviderEntry | null {
  return onboardingProviderEntries().find((entry) => entry.id === id) ?? null
}

/** Entry for a selection; the custom endpoint has no catalog entry. */
export function onboardingEntryForSelection(
  selection: Pick<InitialSetupSelection, 'presetId' | 'mode'>
): OnboardingProviderEntry | null {
  if (selection.presetId === INITIAL_SETUP_CUSTOM_PRESET_ID) return null
  const id = selection.mode === 'token-plan'
    ? `${selection.presetId}${TOKEN_PLAN_ENTRY_SUFFIX}`
    : selection.presetId
  return onboardingProviderEntry(id) ?? onboardingProviderEntry(selection.presetId)
}

export function onboardingTabEntries(
  tab: OnboardingProviderTab,
  region: OnboardingRegionFilter = 'all'
): OnboardingProviderEntry[] {
  const entries = onboardingProviderEntries()
  if (tab === 'featured') {
    return ONBOARDING_FEATURED_IDS
      .map((id) => entries.find((entry) => entry.id === id))
      .filter((entry): entry is OnboardingProviderEntry => Boolean(entry))
  }
  return entries.filter((entry) => entry.tab === tab && (tab !== 'plan' || region === 'all' || entry.region === region))
}

export function onboardingTabCounts(): Record<OnboardingProviderTab, number> {
  const entries = onboardingProviderEntries()
  return {
    featured: ONBOARDING_FEATURED_IDS.length,
    api: entries.filter((entry) => entry.tab === 'api').length,
    plan: entries.filter((entry) => entry.tab === 'plan').length,
    login: entries.filter((entry) => entry.tab === 'login').length,
    local: entries.filter((entry) => entry.tab === 'local').length
  }
}

/** Case-insensitive match on name, id and note across the whole catalog. */
export function searchOnboardingProviders(query: string): OnboardingProviderEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return onboardingProviderEntries().filter((entry) =>
    `${entry.name} ${entry.id} ${entry.note}`.toLocaleLowerCase().includes(needle))
}

/** Distinct services; a preset's Token Plan is the same vendor and is not counted twice. */
export function onboardingProviderCount(): number {
  return onboardingProviderEntries().filter((entry) => entry.mode === 'api').length
}

/** Region choices for the configure page (API regions or Token Plan regions). */
export function onboardingEntryRegions(entry: OnboardingProviderEntry): readonly ModelProviderTokenPlanRegion[] {
  const preset = presetForInitialSetup(entry.presetId)
  if (!preset) return []
  return entry.mode === 'token-plan' ? preset.tokenPlan?.regions ?? [] : preset.regions ?? []
}

/** Where the "get a key" link points. */
export function onboardingKeyPageUrl(entry: OnboardingProviderEntry): string {
  if (entry.presetId === DEFAULT_MODEL_PROVIDER_ID) return 'https://platform.deepseek.com/usage'
  const preset = presetForInitialSetup(entry.presetId)
  if (!preset) return ''
  return entry.mode === 'token-plan' ? preset.tokenPlan?.apiKeyUrl ?? preset.apiKeyUrl : preset.apiKeyUrl
}

export function onboardingKeyPlaceholder(entry: OnboardingProviderEntry): string {
  if (entry.presetId === DEFAULT_MODEL_PROVIDER_ID) return 'sk-...'
  const prefix = entry.mode === 'token-plan' ? presetForInitialSetup(entry.presetId)?.tokenPlan?.keyPrefix : undefined
  if (prefix) return `${prefix}...`
  if (entry.presetId === 'xiaomi') return 'sk-...'
  return 'API Key'
}

/** Existing first-run hint keys for the providers that already had them. */
export function onboardingKeyHintKey(entry: OnboardingProviderEntry): string | null {
  if (entry.presetId === DEFAULT_MODEL_PROVIDER_ID) return 'firstRunBuyApiHint'
  const suffix = entry.mode === 'token-plan' ? 'TokenPlan' : 'Api'
  if (entry.presetId === 'xiaomi') return `firstRunKeyHintXiaomi${suffix}`
  if (entry.presetId === 'minimax') return `firstRunKeyHintMinimax${suffix}`
  return null
}

/** Presets that ship a default model list; the others need discovery first. */
export function onboardingEntryHasModels(entry: OnboardingProviderEntry): boolean {
  if (entry.presetId === DEFAULT_MODEL_PROVIDER_ID) return true
  const preset = presetForInitialSetup(entry.presetId)
  if (!preset) return false
  return entry.mode === 'token-plan' ? Boolean(preset.tokenPlan?.models.length) : preset.models.length > 0
}

/** The preset's own guidance when its base URL must point at the user's resource. */
export function onboardingEndpointHint(entry: OnboardingProviderEntry): string | null {
  return presetForInitialSetup(entry.presetId)?.endpointHint ?? null
}

const NON_CHAT_MODEL_PATTERN = /(embed|rerank|whisper|tts|transcri|moderation|dall-e|image|audio|speech|realtime|vision-preview)/iu

/** Keeps discovered chat models in provider order, capped for a readable picker. */
export function onboardingChatModels(modelIds: readonly string[], limit = 24): string[] {
  const seen = new Set<string>()
  const chat: string[] = []
  for (const raw of modelIds) {
    const id = raw.trim()
    if (!id || seen.has(id) || NON_CHAT_MODEL_PATTERN.test(id)) continue
    seen.add(id)
    chat.push(id)
    if (chat.length >= limit) break
  }
  return chat
}

/** What still blocks leaving the configure page, or null when it is complete. */
export type OnboardingConfigureIssue = 'key' | 'login' | 'baseUrl' | 'model'

export function onboardingConfigureIssue(
  entry: OnboardingProviderEntry | null,
  profileId: string,
  draft: InitialSetupDraft
): OnboardingConfigureIssue | null {
  if (profileId === DEFAULT_MODEL_PROVIDER_ID) return draft.apiKey.trim() ? null : 'key'
  if (!entry && !draft.baseUrl.trim()) return 'baseUrl'
  const profile = initialSetupDraftProfile(profileId, draft)
  if (!profile) return 'baseUrl'
  if (!profile.baseUrl.trim() && !profile.kind) return 'baseUrl'
  if (entry?.loginFlow === 'codex' || entry?.loginFlow === 'grok') {
    if (!draft.apiKey.trim()) return 'login'
  } else if (modelProviderRequiresApiKey(profile) && !draft.apiKey.trim()) {
    return 'key'
  }
  return profile.models.length ? null : 'model'
}
