import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_AUTOSAVE_DELAY_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  DEFAULT_WRITE_EDITOR_FONT_SIZE_PX,
  DEFAULT_WRITE_EDITOR_LINE_HEIGHT,
  WRITE_EDITOR_FONT_SIZE_MAX,
  WRITE_EDITOR_FONT_SIZE_MIN,
  WRITE_EDITOR_LINE_HEIGHT_MAX,
  WRITE_EDITOR_LINE_HEIGHT_MIN,
  WRITE_FONT_PRESETS,
  WRITE_AGENT_PERSONA_MAX_CHARS,
  WRITE_AGENT_PRESET_MAX_COUNT,
  WRITE_AGENT_PRESET_NAME_MAX_CHARS,
  MAX_WRITE_AUTOSAVE_DELAY_MS,
  MIN_WRITE_AUTOSAVE_DELAY_MS,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_PROVIDER_ID,
  type AppSettingsV1,
  type ModelEndpointFormat,
  type ModelProviderProfileV1,
  type WriteAgentPresetV1,
  type WriteFontPreset,
  type WriteInlineCompletionSettingsV1,
  type WriteQuickActionMode,
  type WriteQuickActionV1,
  type WriteSelectionAssistSettingsV1,
  type WriteSettingsPatchV1,
  type WriteSettingsV1,
  type WriteTypographySettingsV1
} from './app-settings-types'
import { getActiveAgentApiKey, getKunRuntimeSettings } from './app-settings-kun'
import { getModelProviderProfile, resolveModelProviderBaseUrl } from './app-settings-provider'
import { compactStrings } from './app-settings-normalizers'

export const WRITE_QUICK_ACTION_BUILTIN_IDS = [
  'polish',
  'explain',
  'reformat',
  'distill',
  'bolder',
  'quieter',
  'critique'
] as const

/** Managed seed file created in Kun's default writing space. */
export const DEFAULT_WRITE_WELCOME_FILE_NAME = 'welcome.md'

// Retired built-ins: pristine stored rows (label and prompt empty, i.e. "use
// the built-in defaults") are dropped on normalization since the defaults no
// longer exist. Customized rows survive as ordinary custom actions.
const WRITE_QUICK_ACTION_RETIRED_IDS = new Set(['proofread'])

export const WRITE_QUICK_ACTION_MAX_COUNT = 12
export const WRITE_QUICK_ACTION_LABEL_MAX_CHARS = 64
export const WRITE_QUICK_ACTION_PROMPT_MAX_CHARS = 4_000

// Built-in default modes: polish/explain answer through the sidebar assistant —
// reliable, high-quality prose (the in-place inline-edit pipeline proved too
// lossy/slow for whole-paragraph rewrites). reformat rewrites in place and lands
// as an inline red/green diff review, as does any instruction typed into the
// floating "AI edit" box.
const WRITE_QUICK_ACTION_BUILTIN_MODES: Record<string, WriteQuickActionMode> = {
  polish: 'chat',
  explain: 'chat',
  reformat: 'edit',
  // Design-vocabulary transforms + review. Whole-selection rewrites go through
  // the sidebar assistant (like polish); critique is a read-only review.
  distill: 'chat',
  bolder: 'chat',
  quieter: 'chat',
  critique: 'chat'
}

export function builtinWriteQuickActionMode(id: string): WriteQuickActionMode {
  return WRITE_QUICK_ACTION_BUILTIN_MODES[id] ?? 'chat'
}

export function defaultWriteQuickActions(): WriteQuickActionV1[] {
  // Empty label/prompt = "use the localized built-in"; the renderer resolves
  // them through i18n so defaults follow the UI language.
  return WRITE_QUICK_ACTION_BUILTIN_IDS.map((id) => ({
    id,
    label: '',
    prompt: '',
    mode: builtinWriteQuickActionMode(id)
  }))
}

export function defaultWriteSelectionAssistSettings(): WriteSelectionAssistSettingsV1 {
  return {
    infographicPrompt: '',
    designDraftPrompt: '',
    prototypePrompt: '',
    quickActions: defaultWriteQuickActions()
  }
}

export function isBuiltinWriteQuickActionId(id: string): boolean {
  return (WRITE_QUICK_ACTION_BUILTIN_IDS as readonly string[]).includes(id)
}

/**
 * Structural normalization only (ids, dedupe, caps). Labels and prompts are
 * intentionally not trimmed and empty custom actions are kept: this runs on
 * every settings-form keystroke, and trimming or dropping here would eat
 * trailing spaces and freshly added rows while the user is still typing.
 * Point-of-use resolution filters out un-dispatchable actions instead.
 */
export function normalizeWriteSelectionAssistSettings(
  input: WriteSettingsPatchV1['selectionAssist'] | undefined
): WriteSelectionAssistSettingsV1 {
  const defaults = defaultWriteSelectionAssistSettings()
  const infographicPrompt =
    typeof input?.infographicPrompt === 'string'
      ? input.infographicPrompt.slice(0, WRITE_QUICK_ACTION_PROMPT_MAX_CHARS)
      : defaults.infographicPrompt
  const designDraftPrompt =
    typeof input?.designDraftPrompt === 'string'
      ? input.designDraftPrompt.slice(0, WRITE_QUICK_ACTION_PROMPT_MAX_CHARS)
      : defaults.designDraftPrompt
  const prototypePrompt =
    typeof input?.prototypePrompt === 'string'
      ? input.prototypePrompt.slice(0, WRITE_QUICK_ACTION_PROMPT_MAX_CHARS)
      : defaults.prototypePrompt
  if (!Array.isArray(input?.quickActions)) {
    return { infographicPrompt, designDraftPrompt, prototypePrompt, quickActions: defaults.quickActions }
  }

  const seen = new Set<string>()
  const quickActions: WriteQuickActionV1[] = []
  for (const raw of input.quickActions) {
    const id = typeof raw?.id === 'string' ? raw.id.trim().slice(0, 64) : ''
    if (!id || seen.has(id)) continue
    const label = typeof raw?.label === 'string'
      ? raw.label.slice(0, WRITE_QUICK_ACTION_LABEL_MAX_CHARS)
      : ''
    const prompt = typeof raw?.prompt === 'string'
      ? raw.prompt.slice(0, WRITE_QUICK_ACTION_PROMPT_MAX_CHARS)
      : ''
    const pristineBuiltin = !label.trim() && !prompt.trim()
    if (pristineBuiltin && WRITE_QUICK_ACTION_RETIRED_IDS.has(id)) continue
    const storedMode: WriteQuickActionMode | null =
      raw?.mode === 'edit' || raw?.mode === 'chat' ? raw.mode : null
    // Pristine 'polish' rows follow the current built-in default (sidebar chat),
    // migrating away from any older in-place value. Customized rows (with a label
    // or prompt) keep the user's explicit mode choice.
    const mode: WriteQuickActionMode = storedMode === null
      ? builtinWriteQuickActionMode(id)
      : pristineBuiltin && id === 'polish'
        ? builtinWriteQuickActionMode(id)
        : storedMode
    seen.add(id)
    quickActions.push({ id, label, prompt, mode })
    if (quickActions.length >= WRITE_QUICK_ACTION_MAX_COUNT) break
  }
  // NOTE: built-in ids absent from the stored list are intentionally NOT
  // re-added here — this runs on every settings-form keystroke, so appending
  // would make a built-in row impossible to delete. New built-ins (e.g. the
  // design actions) therefore reach existing users via a settings reset or
  // manual add; fresh installs get them from defaultWriteQuickActions().
  return { infographicPrompt, designDraftPrompt, prototypePrompt, quickActions }
}

// Concrete CSS font-family stacks per preset. Every stack ends with a generic
// family and chains CJK fallbacks so a missing primary face still renders a
// sensible Chinese font across macOS/Windows.
const WRITE_FONT_STACKS: Record<Exclude<WriteFontPreset, 'custom'>, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  sourceHanSans: "'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  yahei: "'Microsoft YaHei', '微软雅黑', 'PingFang SC', 'Noto Sans SC', sans-serif",
  pingfang: "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  simhei: "'SimHei', '黑体', 'PingFang SC', 'Noto Sans SC', sans-serif",
  simsun: "'SimSun', '宋体', 'Songti SC', serif",
  kaiti: "'KaiTi', '楷体', 'STKaiti', 'Songti SC', serif"
}

export const DEFAULT_WRITE_FONT_PRESET: WriteFontPreset = 'system'

export function defaultWriteTypography(): WriteTypographySettingsV1 {
  return {
    fontPreset: DEFAULT_WRITE_FONT_PRESET,
    customFontFamily: '',
    fontSizePx: DEFAULT_WRITE_EDITOR_FONT_SIZE_PX,
    lineHeight: DEFAULT_WRITE_EDITOR_LINE_HEIGHT
  }
}

/** Resolves a typography preset to a concrete CSS `font-family` stack. */
export function writeFontStackFor(preset: WriteFontPreset, customFontFamily: string): string {
  if (preset === 'custom') {
    const trimmed = customFontFamily.trim()
    return trimmed || WRITE_FONT_STACKS.system
  }
  return WRITE_FONT_STACKS[preset] ?? WRITE_FONT_STACKS.system
}

function clampWriteNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export function normalizeWriteTypography(
  input: Partial<WriteTypographySettingsV1> | undefined
): WriteTypographySettingsV1 {
  const defaults = defaultWriteTypography()
  const fontPreset =
    typeof input?.fontPreset === 'string' &&
    (WRITE_FONT_PRESETS as readonly string[]).includes(input.fontPreset)
      ? (input.fontPreset as WriteFontPreset)
      : defaults.fontPreset
  const customFontFamily =
    typeof input?.customFontFamily === 'string' ? input.customFontFamily.slice(0, 200) : defaults.customFontFamily
  const fontSizePx = Math.round(
    clampWriteNumber(input?.fontSizePx, WRITE_EDITOR_FONT_SIZE_MIN, WRITE_EDITOR_FONT_SIZE_MAX, defaults.fontSizePx)
  )
  // Snap line-height to one decimal so the slider produces clean values.
  const lineHeight =
    Math.round(
      clampWriteNumber(
        input?.lineHeight,
        WRITE_EDITOR_LINE_HEIGHT_MIN,
        WRITE_EDITOR_LINE_HEIGHT_MAX,
        defaults.lineHeight
      ) * 10
    ) / 10
  return { fontPreset, customFontFamily, fontSizePx, lineHeight }
}

export const WRITE_AGENT_PRESET_BUILTIN_IDS = ['coordinator', 'editor', 'foreshadowing', 'continuity'] as const

const WRITE_AGENT_PRESET_BUILTIN_EMOJI: Record<string, string> = {
  coordinator: '🧭',
  editor: '✒️',
  foreshadowing: '🪤',
  continuity: '🔍'
}

export function isBuiltinWriteAgentPresetId(id: string): boolean {
  return (WRITE_AGENT_PRESET_BUILTIN_IDS as readonly string[]).includes(id)
}

// Writing agents are fully user-defined and opt-in: default to none and ship no
// preset templates. Pristine built-in ids left over from older builds are
// dropped in normalizeWriteAgentPresets so the list always starts clean.
export function defaultWriteAgentPresets(): WriteAgentPresetV1[] {
  return []
}

export function normalizeWriteAgentPresets(
  input: Array<Partial<WriteAgentPresetV1>> | undefined
): WriteAgentPresetV1[] {
  if (!Array.isArray(input)) return defaultWriteAgentPresets()
  const seen = new Set<string>()
  const presets: WriteAgentPresetV1[] = []
  for (const raw of input) {
    const id = typeof raw?.id === 'string' ? raw.id.trim().slice(0, 64) : ''
    if (!id || seen.has(id)) continue
    const name = typeof raw?.name === 'string' ? raw.name.slice(0, WRITE_AGENT_PRESET_NAME_MAX_CHARS) : ''
    const persona = typeof raw?.persona === 'string' ? raw.persona.slice(0, WRITE_AGENT_PERSONA_MAX_CHARS) : ''
    // Drop un-customized built-in templates left over from older builds: writing
    // agents ship no presets, so a pristine 'coordinator'/'editor'/… row (empty
    // name AND persona) is cleared instead of resurrected with a default.
    if (isBuiltinWriteAgentPresetId(id) && !name.trim() && !persona.trim()) continue
    seen.add(id)
    presets.push({
      id,
      name,
      emoji: typeof raw?.emoji === 'string' ? raw.emoji.slice(0, 8) : (WRITE_AGENT_PRESET_BUILTIN_EMOJI[id] ?? ''),
      persona
    })
    if (presets.length >= WRITE_AGENT_PRESET_MAX_COUNT) break
  }
  return presets
}

export function defaultWriteSettings(): WriteSettingsV1 {
  return {
    defaultWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
    activeWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
    workspaces: [DEFAULT_WRITE_WORKSPACE_ROOT],
    autoSaveEnabled: true,
    autoSaveDelayMs: DEFAULT_WRITE_AUTOSAVE_DELAY_MS,
    inlineCompletion: {
      enabled: true,
      retrievalEnabled: true,
      longCompletionEnabled: true,
      inheritProvider: true,
      providerId: '',
      apiKey: '',
      baseUrl: '',
      inheritModel: true,
      model: DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
      debounceMs: DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
      longDebounceMs: DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
      minAcceptScore: DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
      longMinAcceptScore: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
      maxTokens: DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
      longMaxTokens: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
    },
    selectionAssist: defaultWriteSelectionAssistSettings(),
    typography: defaultWriteTypography(),
    agentPresets: defaultWriteAgentPresets()
  }
}

function normalizeWriteInlineCompletionSettings(
  input: Partial<WriteInlineCompletionSettingsV1> | undefined
): WriteInlineCompletionSettingsV1 {
  const defaults = defaultWriteSettings().inlineCompletion
  const debounceMs = Number(input?.debounceMs)
  const longDebounceMs = Number(input?.longDebounceMs)
  const minAcceptScore = Number(input?.minAcceptScore)
  const longMinAcceptScore = Number(input?.longMinAcceptScore)
  const maxTokens = Number(input?.maxTokens)
  const longMaxTokens = Number(input?.longMaxTokens)
  const model = normalizeWriteInlineCompletionModel(input?.model)
  return {
    enabled: input?.enabled !== false,
    retrievalEnabled: input?.retrievalEnabled !== false,
    longCompletionEnabled: input?.longCompletionEnabled !== false,
    inheritProvider: shouldInheritWriteInlineCompletionProvider(input),
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    inheritModel: shouldInheritWriteInlineCompletionModel(input),
    model,
    debounceMs:
      Number.isFinite(debounceMs)
        ? Math.max(150, Math.min(5_000, Math.round(debounceMs)))
        : defaults.debounceMs,
    longDebounceMs:
      Number.isFinite(longDebounceMs)
        ? Math.max(1_000, Math.min(15_000, Math.round(longDebounceMs)))
        : defaults.longDebounceMs,
    minAcceptScore:
      Number.isFinite(minAcceptScore)
        ? Math.max(0.1, Math.min(0.95, minAcceptScore))
        : defaults.minAcceptScore,
    longMinAcceptScore:
      Number.isFinite(longMinAcceptScore)
        ? Math.max(0.1, Math.min(0.95, longMinAcceptScore))
        : defaults.longMinAcceptScore,
    maxTokens:
      Number.isFinite(maxTokens)
        ? Math.max(16, Math.min(512, Math.round(maxTokens)))
        : defaults.maxTokens,
    longMaxTokens:
      Number.isFinite(longMaxTokens)
        ? Math.max(64, Math.min(1_024, Math.round(longMaxTokens)))
        : defaults.longMaxTokens
  }
}

export function shouldInheritWriteInlineCompletionProvider(
  input: Partial<Pick<WriteInlineCompletionSettingsV1, 'inheritProvider' | 'providerId'>> | undefined
): boolean {
  if (typeof input?.inheritProvider === 'boolean') return input.inheritProvider
  const providerId = typeof input?.providerId === 'string' ? input.providerId.trim() : ''
  return !providerId
}

export function normalizeWriteInlineCompletionModel(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || trimmed === 'auto') return DEFAULT_WRITE_INLINE_COMPLETION_MODEL
  return trimmed
}

export function shouldInheritWriteInlineCompletionModel(
  input: Partial<Pick<WriteInlineCompletionSettingsV1, 'inheritModel' | 'model'>> | undefined
): boolean {
  if (typeof input?.inheritModel === 'boolean') return input.inheritModel
  const trimmed = typeof input?.model === 'string' ? input.model.trim() : ''
  return !trimmed || trimmed === DEFAULT_WRITE_INLINE_COMPLETION_MODEL
}

function getNormalizedWriteInlineCompletionSettings(settings: AppSettingsV1): WriteInlineCompletionSettingsV1 {
  return normalizeWriteSettings(
    (settings as { write?: WriteSettingsPatchV1 }).write
  ).inlineCompletion
}

export function resolveWriteInlineCompletionBaseUrl(settings: AppSettingsV1): string {
  const configured = getNormalizedWriteInlineCompletionSettings(settings).baseUrl.trim()
  if (configured && configured !== DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL) {
    return configured
  }
  return resolveWriteInlineCompletionProviderProfile(settings).baseUrl.trim() || resolveModelProviderBaseUrl(settings)
}

export function resolveWriteInlineCompletionApiKey(settings: AppSettingsV1): string {
  const inlineCompletion = getNormalizedWriteInlineCompletionSettings(settings)
  const configured = inlineCompletion.apiKey.trim()
  if (configured) return configured
  const provider = resolveWriteInlineCompletionProviderProfile(settings)
  return provider.apiKey.trim() || (inlineCompletion.inheritProvider ? getActiveAgentApiKey(settings) : '')
}

export function resolveWriteInlineCompletionEndpointFormat(settings: AppSettingsV1): ModelEndpointFormat {
  return resolveWriteInlineCompletionProviderProfile(settings).endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT
}

export function resolveWriteInlineCompletionProviderId(settings: AppSettingsV1): string {
  const inlineCompletion = getNormalizedWriteInlineCompletionSettings(settings)
  if (!inlineCompletion.inheritProvider && inlineCompletion.providerId.trim()) {
    return inlineCompletion.providerId.trim()
  }
  return getKunRuntimeSettings(settings).providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
}

export function resolveWriteInlineCompletionProviderProfile(settings: AppSettingsV1): ModelProviderProfileV1 {
  return getModelProviderProfile(settings, resolveWriteInlineCompletionProviderId(settings))
}

export function resolveWriteInlineCompletionModel(
  settings: AppSettingsV1,
  requestedModel?: string | null
): string {
  const requested = typeof requestedModel === 'string' ? requestedModel.trim() : ''
  if (requested) return normalizeWriteInlineCompletionModel(requested)
  const configuredSettings = getNormalizedWriteInlineCompletionSettings(settings)
  const configured = configuredSettings.model.trim()
  if (!configuredSettings.inheritModel) {
    return normalizeWriteInlineCompletionModel(configured)
  }
  if (!configuredSettings.inheritProvider && configuredSettings.providerId.trim()) {
    const providerModel = resolveWriteInlineCompletionProviderProfile(settings).models[0]?.trim()
    if (providerModel) return providerModel
  }
  const runtimeModel = getKunRuntimeSettings(settings).model?.trim() ?? ''
  if (runtimeModel) return runtimeModel
  return normalizeWriteInlineCompletionModel(configured)
}

export function normalizeWriteSettings(input: WriteSettingsPatchV1 | undefined): WriteSettingsV1 {
  const defaults = defaultWriteSettings()
  const source = input ?? {}
  const defaultWorkspaceRoot =
    typeof source.defaultWorkspaceRoot === 'string' && source.defaultWorkspaceRoot.trim()
      ? source.defaultWorkspaceRoot.trim()
      : defaults.defaultWorkspaceRoot
  const activeWorkspaceRoot =
    typeof source.activeWorkspaceRoot === 'string' && source.activeWorkspaceRoot.trim()
      ? source.activeWorkspaceRoot.trim()
      : defaultWorkspaceRoot
  const workspaces = compactStrings([
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    ...(Array.isArray(source.workspaces) ? source.workspaces : [])
  ])
  const autoSaveDelayMs = Number(source.autoSaveDelayMs)
  return {
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    workspaces: workspaces.length > 0 ? workspaces : [defaultWorkspaceRoot],
    autoSaveEnabled: source.autoSaveEnabled !== false,
    autoSaveDelayMs: Number.isFinite(autoSaveDelayMs)
      ? Math.max(MIN_WRITE_AUTOSAVE_DELAY_MS, Math.min(MAX_WRITE_AUTOSAVE_DELAY_MS, Math.round(autoSaveDelayMs)))
      : defaults.autoSaveDelayMs,
    inlineCompletion: normalizeWriteInlineCompletionSettings(source.inlineCompletion),
    selectionAssist: normalizeWriteSelectionAssistSettings(source.selectionAssist),
    typography: normalizeWriteTypography(source.typography),
    agentPresets: normalizeWriteAgentPresets(source.agentPresets)
  }
}

export function mergeWriteSettings(
  current: WriteSettingsV1,
  patch: WriteSettingsPatchV1 | undefined
): WriteSettingsV1 {
  const inlinePatch = patch?.inlineCompletion ?? {}
  const nextInlineCompletion: Partial<WriteInlineCompletionSettingsV1> = {
    ...current.inlineCompletion,
    ...inlinePatch
  }

  if ('model' in inlinePatch && !('inheritModel' in inlinePatch)) {
    delete (nextInlineCompletion as { inheritModel?: boolean }).inheritModel
  }
  if ('providerId' in inlinePatch && !('inheritProvider' in inlinePatch)) {
    delete (nextInlineCompletion as { inheritProvider?: boolean }).inheritProvider
  }

  const selectionAssistPatch = patch?.selectionAssist ?? {}
  const nextSelectionAssist: WriteSettingsPatchV1['selectionAssist'] = {
    ...current.selectionAssist,
    ...selectionAssistPatch
  }

  const typographyPatch = patch?.typography ?? {}
  const nextTypography: Partial<WriteTypographySettingsV1> = {
    ...current.typography,
    ...typographyPatch
  }

  return normalizeWriteSettings({
    ...current,
    ...(patch ?? {}),
    inlineCompletion: nextInlineCompletion,
    selectionAssist: nextSelectionAssist,
    typography: nextTypography
  })
}
