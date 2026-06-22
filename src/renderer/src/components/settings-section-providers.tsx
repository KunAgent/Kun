import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type {
  AppSettingsPatch,
  ImageGenerationProtocol,
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1,
  MusicGenerationProtocol,
  ModelEndpointFormat,
  ModelProviderImageCapabilityV1,
  ModelProviderModelProfileV1,
  ModelProviderMusicCapabilityV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from '@shared/app-settings'
import {
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_ENDPOINT_FORMATS,
  MODEL_PROVIDER_PRESETS,
  TOKEN_PLAN_PROVIDER_ID_SUFFIX,
  defaultMiniMaxMediaGenerationKunPatch,
  defaultModelProviderSettings,
  getModelProviderPreset,
  modelProviderPresetProfile,
  modelSupportsImageInput,
  modelProviderTokenPlanProfile,
  normalizeModelProviderId,
  tokenPlanProviderId
} from '@shared/app-settings'
import type { ModelProviderPreset } from '@shared/model-provider-presets'
import type { ModelProviderProbeResult } from '@shared/kun-gui-api'
import {
  AudioLines,
  ChevronDown,
  Clapperboard,
  Download,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  Music2,
  PlugZap,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import {
  InlineNoticeView,
  SecretInput,
  SettingsCard,
  SettingRow,
  Toggle,
  type InlineNotice
} from './settings-controls'
import { classifyProviderModelIds, providerModelListEntries } from './provider-model-editor'
import { ProviderModelsManager } from './settings-section-provider-models'
import {
  ProviderModelImportDialog,
  type ProviderModelImportResult
} from './provider-model-import-dialog'

const MODEL_ENDPOINT_FORMAT_LABEL_KEYS: Record<ModelEndpointFormat, string> = {
  chat_completions: 'modelEndpointChatCompletions',
  responses: 'modelEndpointResponses',
  messages: 'modelEndpointMessages',
  custom_endpoint: 'modelEndpointCustomEndpoint'
}

const IMAGE_GENERATION_PROTOCOL_LABEL_KEYS: Record<ImageGenerationProtocol, string> = {
  'openai-images': 'imageGenProtocolOpenAi',
  'minimax-image': 'imageGenProtocolMiniMax',
  'codex-responses-image': 'imageGenProtocolCodex'
}

const SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS: Partial<Record<SpeechToTextProtocol, string>> = {
  'openai-transcriptions': 'speechProtocolOpenAi',
  'mimo-asr': 'speechProtocolMimoAsr'
}

const TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS: Record<TextToSpeechProtocol, string> = {
  'openai-speech': 'textToSpeechProtocolOpenAi',
  'minimax-t2a': 'textToSpeechProtocolMiniMax',
  'mimo-tts': 'textToSpeechProtocolMimo'
}

const MUSIC_GENERATION_PROTOCOL_LABEL_KEYS: Record<MusicGenerationProtocol, string> = {
  'minimax-music': 'musicGenerationProtocolMiniMax'
}

const VIDEO_GENERATION_PROTOCOL_LABEL_KEYS: Record<VideoGenerationProtocol, string> = {
  'minimax-video': 'videoGenerationProtocolMiniMax'
}

export function modelProvidersSettingsPatch(input: {
  provider: ModelProviderSettingsV1
  providers: ModelProviderProfileV1[]
  kun?: KunRuntimeSettingsPatchV1
  currentKun?: Partial<KunRuntimeSettingsV1>
}): AppSettingsPatch {
  const defaultProvider = input.providers.find((item) => item.id === DEFAULT_MODEL_PROVIDER_ID)
  const miniMaxMediaDefaults = defaultMiniMaxMediaGenerationKunPatch({
    providers: input.providers,
    currentKun: input.currentKun,
    kunPatch: input.kun
  })
  const baseKunPatch = input.kun?.providerId?.trim()
    ? { ...input.kun, apiKey: '', baseUrl: '' }
    : input.kun ?? {}
  const kunPatch = {
    ...baseKunPatch,
    ...(miniMaxMediaDefaults ?? {})
  }
  return {
    provider: {
      apiKey: defaultProvider?.apiKey ?? input.provider.apiKey,
      baseUrl: defaultProvider?.baseUrl ?? input.provider.baseUrl,
      proxy: input.provider.proxy,
      providers: input.providers
    },
    ...(Object.keys(kunPatch).length > 0 ? { agents: { kun: kunPatch } } : {})
  }
}

function tokenPlanPresetForProfileId(id: string): ModelProviderPreset | null {
  if (!id.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)) return null
  const preset = getModelProviderPreset(id.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length))
  return preset?.tokenPlan ? preset : null
}

// 「套餐订阅」组 = Token Plan 套餐档(<id>-token-plan)或本身就是订阅制的预设(category==='subscription');
// 其余(默认 / 按量预设 / 自定义)归入「按量 API」组,便于一眼分辨两类计费方式。
function isSubscriptionProviderId(id: string): boolean {
  if (tokenPlanPresetForProfileId(id)) return true
  return getModelProviderPreset(id)?.category === 'subscription'
}

function mergeProviderModelIds(primary: readonly string[], secondary: readonly string[]): string[] {
  const ids = new Set<string>()
  for (const model of [...primary, ...secondary]) {
    const trimmed = model.trim()
    if (trimmed) ids.add(trimmed)
  }
  return [...ids]
}

function addedModelCount(current: readonly string[], next: readonly string[]): number {
  const currentIds = new Set(current.map((model) => model.trim().toLowerCase()).filter(Boolean))
  return next.filter((model) => {
    const id = model.trim().toLowerCase()
    return id && !currentIds.has(id)
  }).length
}

function providerModelCount(provider: ModelProviderProfileV1): number {
  return providerModelListEntries(provider).length
}

function defaultImageCapability(baseUrl: string): ModelProviderImageCapabilityV1 {
  return {
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultSpeechCapability(baseUrl: string): ModelProviderSpeechCapabilityV1 {
  return {
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultTextToSpeechCapability(baseUrl: string): ModelProviderTextToSpeechCapabilityV1 {
  return {
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultMusicCapability(baseUrl: string): ModelProviderMusicCapabilityV1 {
  return {
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function defaultVideoCapability(baseUrl: string): ModelProviderVideoCapabilityV1 {
  return {
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

function profileForModel(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  model: string
): ModelProviderModelProfileV1 | undefined {
  const trimmed = model.trim()
  if (!trimmed) return undefined
  return provider.modelProfiles[trimmed.toLowerCase()] ?? provider.modelProfiles[trimmed]
}

function presetImageCapability(providerId: string): ModelProviderImageCapabilityV1 | null {
  const preset = getModelProviderPreset(providerId)
  if (!preset?.image) return null
  return { protocol: preset.image.protocol, baseUrl: preset.image.baseUrl, models: [...preset.image.models] }
}

function presetSpeechCapability(provider: ModelProviderProfileV1): ModelProviderSpeechCapabilityV1 | null {
  const direct = getModelProviderPreset(provider.id)
  if (direct?.speech) {
    return { protocol: direct.speech.protocol, baseUrl: direct.speech.baseUrl, models: [...direct.speech.models] }
  }
  const tokenPlanSpeech = tokenPlanPresetForProfileId(provider.id)?.tokenPlan?.speech
  if (tokenPlanSpeech) {
    // 套餐端点自己提供 ASR,语音地址跟随该 profile 的服务地址。
    return { protocol: tokenPlanSpeech.protocol, baseUrl: provider.baseUrl, models: [...tokenPlanSpeech.models] }
  }
  return null
}

function presetTextToSpeechCapability(provider: ModelProviderProfileV1): ModelProviderTextToSpeechCapabilityV1 | null {
  const direct = getModelProviderPreset(provider.id)
  if (direct?.textToSpeech) {
    return {
      protocol: direct.textToSpeech.protocol,
      baseUrl: direct.textToSpeech.baseUrl,
      models: [...direct.textToSpeech.models]
    }
  }
  const tokenPlanTextToSpeech = tokenPlanPresetForProfileId(provider.id)?.tokenPlan?.textToSpeech
  if (tokenPlanTextToSpeech) {
    return {
      protocol: tokenPlanTextToSpeech.protocol,
      baseUrl: tokenPlanTextToSpeech.baseUrl ?? provider.baseUrl,
      models: [...tokenPlanTextToSpeech.models]
    }
  }
  return null
}

function presetMusicCapability(provider: ModelProviderProfileV1): ModelProviderMusicCapabilityV1 | null {
  const direct = getModelProviderPreset(provider.id)
  if (direct?.music) {
    return { protocol: direct.music.protocol, baseUrl: direct.music.baseUrl, models: [...direct.music.models] }
  }
  const tokenPlanMusic = tokenPlanPresetForProfileId(provider.id)?.tokenPlan?.music
  if (tokenPlanMusic) {
    return { protocol: tokenPlanMusic.protocol, baseUrl: tokenPlanMusic.baseUrl, models: [...tokenPlanMusic.models] }
  }
  return null
}

function presetVideoCapability(provider: ModelProviderProfileV1): ModelProviderVideoCapabilityV1 | null {
  const direct = getModelProviderPreset(provider.id)
  if (direct?.video) {
    return { protocol: direct.video.protocol, baseUrl: direct.video.baseUrl, models: [...direct.video.models] }
  }
  const tokenPlanVideo = tokenPlanPresetForProfileId(provider.id)?.tokenPlan?.video
  if (tokenPlanVideo) {
    return { protocol: tokenPlanVideo.protocol, baseUrl: tokenPlanVideo.baseUrl, models: [...tokenPlanVideo.models] }
  }
  return null
}

function isAcceptableHttpUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
}

function providerConnectionFingerprint(provider: ModelProviderProfileV1): string {
  return [provider.baseUrl, provider.apiKey, provider.endpointFormat].join('\0')
}

type ProbeState = {
  fingerprint: string
  mode: 'test' | 'fetch'
  status: 'busy' | 'ok' | 'error'
  latencyMs?: number
  total?: number
  message?: string
}

function providerPresetRequiresApiKey(provider: ModelProviderProfileV1): boolean {
  if (provider.id === 'litellm') return false
  if (isCodexProvider(provider.id)) return false
  if (isAnthropicProvider(provider.id)) return false
  return Boolean(getModelProviderPreset(provider.id) || tokenPlanPresetForProfileId(provider.id))
}

function isCodexProvider(id: string): boolean {
  return id === 'codex'
}

function isAnthropicProvider(id: string): boolean {
  return id === 'claude-subscription'
}

function anthropicAccountLabel(apiKey: string): string | undefined {
  if (!apiKey.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    if (parsed.kind !== 'anthropic-oauth') return undefined
    return typeof parsed.email === 'string' && parsed.email ? parsed.email : 'Claude'
  } catch {
    return undefined
  }
}

function parseCodexEmail(apiKey: string): string | undefined {
  if (!apiKey.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    if (parsed.kind === 'codex-oauth' && typeof parsed.email === 'string') return parsed.email
    if (parsed.kind === 'codex-oauth') return parsed.accountId as string
  } catch { /* ignore */ }
  return undefined
}

function CodexLoginSection({
  provider,
  onCredentialChange,
  t
}: {
  provider: ModelProviderProfileV1
  onCredentialChange: (apiKey: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [phase, setPhase] = useState<'idle' | 'browser' | 'polling' | 'error'>('idle')
  const [userCode, setUserCode] = useState('')
  const [verifyUrl, setVerifyUrl] = useState('')
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const codexEmail = parseCodexEmail(provider.apiKey)
  const connected = Boolean(codexEmail)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const startBrowserLogin = async (): Promise<void> => {
    if (typeof window.kunGui?.startCodexBrowserAuth !== 'function') {
      setPhase('error')
      setError('Codex 浏览器登录不可用，请重启应用')
      return
    }
    setPhase('browser')
    setError('')
    try {
      const result = await window.kunGui.startCodexBrowserAuth()
      if (result.ok) {
        onCredentialChange(JSON.stringify(result.credentials))
        setPhase('idle')
      } else {
        setPhase('error')
        setError(result.message)
      }
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startDeviceCodeLogin = async (): Promise<void> => {
    if (typeof window.kunGui?.startCodexAuth !== 'function') {
      setPhase('error')
      setError('Codex 登录不可用，请重启应用')
      return
    }
    setError('')
    try {
      const result = await window.kunGui.startCodexAuth()
      if (!result.ok) {
        setPhase('error')
        setError(result.message)
        return
      }
      setUserCode(result.userCode)
      setVerifyUrl(result.url)
      setPhase('polling')
      const deviceCode = result.deviceCode
      const uc = result.userCode
      const interval = Math.max(result.interval, 2) * 1000
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        if (typeof window.kunGui?.pollCodexAuth !== 'function') return
        try {
          const poll = await window.kunGui.pollCodexAuth(deviceCode, uc)
          if (poll.done) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            onCredentialChange(JSON.stringify(poll.credentials))
            setPhase('idle')
          } else if (poll.error) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setPhase('error')
            setError(poll.error)
          }
        } catch (pollError) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setPhase('error')
          setError(pollError instanceof Error ? pollError.message : String(pollError))
        }
      }, interval)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const cancelLogin = (): void => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    setPhase('idle')
    setError('')
  }

  const disconnect = (): void => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    onCredentialChange('')
    setPhase('idle')
    setUserCode('')
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] text-ds-ink">{codexEmail}</span>
        <button
          type="button"
          className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
          onClick={disconnect}
        >
          {t('codexDisconnect')}
        </button>
      </div>
    )
  }

  if (phase === 'browser') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('codexBrowserOpened')}</p>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  if (phase === 'polling') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('codexEnterCode')}</p>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-ds-hover px-3 py-1.5 text-[16px] font-mono font-bold tracking-widest text-ds-ink">
            {userCode}
          </code>
          <a
            href={verifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-accent/10 px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/20"
          >
            {t('codexOpenBrowser')}
          </a>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-accent/90"
        onClick={startBrowserLogin}
      >
        {t('codexLoginButton')}
      </button>
      <button
        type="button"
        className="w-full rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
        onClick={startDeviceCodeLogin}
      >
        {t('codexLoginDeviceCodeFallback')}
      </button>
      {phase === 'error' && error ? (
        <span className="text-[12px] text-red-500">{error}</span>
      ) : null}
    </div>
  )
}

function AnthropicLoginSection({
  provider,
  onCredentialChange,
  t
}: {
  provider: ModelProviderProfileV1
  onCredentialChange: (apiKey: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const [phase, setPhase] = useState<'idle' | 'browser' | 'error'>('idle')
  const [error, setError] = useState('')
  const accountLabel = anthropicAccountLabel(provider.apiKey)
  const connected = Boolean(accountLabel)

  const startBrowserLogin = async (): Promise<void> => {
    if (typeof window.kunGui?.startAnthropicBrowserAuth !== 'function') {
      setPhase('error')
      setError('Claude 浏览器登录不可用，请重启应用')
      return
    }
    setPhase('browser')
    setError('')
    try {
      const result = await window.kunGui.startAnthropicBrowserAuth()
      if (result.ok) {
        onCredentialChange(JSON.stringify(result.credentials))
        setPhase('idle')
      } else {
        setPhase('error')
        setError(result.message)
      }
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const cancelLogin = (): void => {
    setPhase('idle')
    setError('')
  }

  const disconnect = (): void => {
    onCredentialChange('')
    setPhase('idle')
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] text-ds-ink">{accountLabel}</span>
        <button
          type="button"
          className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
          onClick={disconnect}
        >
          {t('codexDisconnect')}
        </button>
      </div>
    )
  }

  if (phase === 'browser') {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ds-muted">{t('codexBrowserOpened')}</p>
        <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('codexWaitingAuth')}
        </div>
        <button
          type="button"
          className="w-fit text-[12px] font-medium text-ds-muted hover:text-ds-ink"
          onClick={cancelLogin}
        >
          {t('codexCancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-accent/90"
        onClick={startBrowserLogin}
      >
        {t('claudeLoginButton')}
      </button>
      {phase === 'error' && error ? (
        <span className="text-[12px] text-red-500">{error}</span>
      ) : null}
    </div>
  )
}

const fieldLabelClass = 'grid gap-1.5 text-[12px] font-semibold text-ds-muted'
const textInputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

function DetailSection({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <section className="grid gap-3 border-t border-ds-border-muted pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ds-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ProviderBadge({
  tone,
  children
}: {
  tone: 'accent' | 'warning'
  children: ReactNode
}): ReactElement {
  const toneClass =
    tone === 'accent'
      ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
      : 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${toneClass}`}>
      {children}
    </span>
  )
}

function ProviderListGroup({
  label,
  count,
  children
}: {
  label: string
  count: number
  children: ReactNode
}): ReactElement {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11.5px] font-semibold text-ds-muted">{label}</span>
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ds-main/60 px-1.5 text-[10.5px] font-medium text-ds-faint">
          {count}
        </span>
      </div>
      {children}
    </div>
  )
}

function ModelChipsInput({
  values,
  onChange,
  placeholder,
  inputAriaLabel,
  removeLabel
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  inputAriaLabel: string
  removeLabel: (model: string) => string
}): ReactElement {
  const [draft, setDraft] = useState('')

  const commit = (raw: string): void => {
    const ids = raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
    setDraft('')
    if (ids.length === 0) return
    const seen = new Set(values)
    const next = [...values]
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    if (next.length !== values.length) onChange(next)
  }

  const removeAt = (index: number): void => {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-2 py-1.5 shadow-sm focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/30">
      {values.map((model, index) => (
        <span
          key={`${model}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-ds-border-muted bg-ds-main/60 py-0.5 pl-2.5 pr-1 font-mono text-[12px] text-ds-ink"
        >
          <span className="truncate">{model}</span>
          <button
            type="button"
            aria-label={removeLabel(model)}
            onClick={() => removeAt(index)}
            className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        className="min-w-[150px] flex-1 bg-transparent px-1 py-1 font-mono text-[12.5px] font-normal text-ds-ink placeholder:text-ds-faint focus:outline-none"
        value={draft}
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            e.preventDefault()
            removeAt(values.length - 1)
          }
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (/[\s,]/.test(text)) {
            e.preventDefault()
            commit(`${draft} ${text}`)
          }
        }}
      />
    </div>
  )
}

export function ProvidersSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    provider: providerFromContext,
    kun,
    update,
    showApiKey,
    setShowApiKey,
    selectControlClass
  } = ctx
  const provider = providerFromContext ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    kun.providerId?.trim() || modelProviders[0]?.id || DEFAULT_MODEL_PROVIDER_ID
  )
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)
  // 点击菜单外部或按 Esc 关闭「添加供应商」下拉。用监听器代替全屏遮罩:全屏 fixed 遮罩会吞掉滚轮事件,
  // 导致下拉打开时整个设置页无法滚动(用户反馈的 bug)。
  useEffect(() => {
    if (!addMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && addMenuRef.current?.contains(target)) return
      setAddMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAddMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen])
  const [probeStates, setProbeStates] = useState<Record<string, ProbeState>>({})
  // Pending import dialog: when /v1/models returns hundreds of entries we want
  // the user to choose which ones to keep instead of dropping the whole list
  // into settings and forcing them to delete unwanted models one-by-one (#397).
  const [pendingImport, setPendingImport] = useState<
    | { providerId: string; modelIds: string[]; latencyMs?: number }
    | null
  >(null)
  // 新增供应商先停留在本地草稿,点「添加」才写入设置,避免半配置状态被持久化。
  const [draftProvider, setDraftProvider] = useState<ModelProviderProfileV1 | null>(null)
  const displayProviders = draftProvider ? [...modelProviders, draftProvider] : modelProviders
  const activeProvider =
    displayProviders.find((item) => item.id === selectedProviderId) ??
    modelProviders[0]
  const isDraftActive = Boolean(draftProvider && activeProvider?.id === draftProvider.id)
  const canEditActiveProviderId = Boolean(
    activeProvider &&
    activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID &&
    !getModelProviderPreset(activeProvider.id) &&
    !tokenPlanPresetForProfileId(activeProvider.id)
  )
  const activeKunProviderId: string = kun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const providerProxy = provider.proxy ?? { enabled: false, url: '' }

  const updateProviderProxy = (patch: Partial<typeof providerProxy>): void => {
    update({
      provider: {
        proxy: {
          ...providerProxy,
          ...patch
        }
      }
    })
  }

  const confirmAction = async (options: {
    message: string
    detail?: string
    confirmLabel?: string
    cancelLabel?: string
  }): Promise<boolean> => {
    if (typeof window.kunGui?.confirmDialog === 'function') {
      return window.kunGui.confirmDialog(options)
    }
    return true
  }

  const updateModelProviders = (
    providers: ModelProviderProfileV1[],
    kunPatch?: KunRuntimeSettingsPatchV1
  ): void => {
    update(modelProvidersSettingsPatch({
      provider,
      providers,
      kun: kunPatch,
      currentKun: kun
    }))
  }

  const patchProviderProfile = (
    item: ModelProviderProfileV1,
    transform: (item: ModelProviderProfileV1) => ModelProviderProfileV1
  ): void => {
    if (draftProvider && item.id === draftProvider.id) {
      setDraftProvider(transform(draftProvider))
      return
    }
    updateModelProviders(modelProviders.map((existing) => existing.id === item.id ? transform(existing) : existing))
  }

  const updateModelProvider = (id: string, patch: Partial<ModelProviderProfileV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({ ...item, ...patch }))
  }

  const updateModelProviderImage = (id: string, patch: Partial<ModelProviderImageCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      image: {
        ...(item.image ?? defaultImageCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderImage = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { image: _image, ...rest } = item
      void _image
      return rest
    })
  }

  const updateModelProviderSpeech = (id: string, patch: Partial<ModelProviderSpeechCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      speech: {
        ...(item.speech ?? defaultSpeechCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderSpeech = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { speech: _speech, ...rest } = item
      void _speech
      return rest
    })
  }

  const updateModelProviderTextToSpeech = (id: string, patch: Partial<ModelProviderTextToSpeechCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      textToSpeech: {
        ...(item.textToSpeech ?? defaultTextToSpeechCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderTextToSpeech = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { textToSpeech: _textToSpeech, ...rest } = item
      void _textToSpeech
      return rest
    })
  }

  const updateModelProviderMusic = (id: string, patch: Partial<ModelProviderMusicCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      music: {
        ...(item.music ?? defaultMusicCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderMusic = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { music: _music, ...rest } = item
      void _music
      return rest
    })
  }

  const updateModelProviderVideo = (id: string, patch: Partial<ModelProviderVideoCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      video: {
        ...(item.video ?? defaultVideoCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderVideo = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { video: _video, ...rest } = item
      void _video
      return rest
    })
  }

  const updateModelProviderId = (id: string, value: string): void => {
    if (id === DEFAULT_MODEL_PROVIDER_ID) return
    const nextId = normalizeModelProviderId(value)
    if (!nextId || nextId === id) return
    if (displayProviders.some((item) => item.id === nextId && item.id !== id)) return
    if (draftProvider && id === draftProvider.id) {
      setSelectedProviderId(nextId)
      setDraftProvider({ ...draftProvider, id: nextId })
      return
    }
    setSelectedProviderId(nextId)
    updateModelProviders(
      modelProviders.map((item) => item.id === id ? { ...item, id: nextId } : item),
      kun.providerId === id ? { providerId: nextId } : undefined
    )
  }

  const startProviderDraft = (profile: ModelProviderProfileV1): void => {
    setDraftProvider(profile)
    setSelectedProviderId(profile.id)
  }

  const commitProviderDraft = (): void => {
    if (!draftProvider) return
    const hasKey = Boolean(draftProvider.apiKey.trim())
    updateModelProviders(
      [...modelProviders, draftProvider],
      hasKey
        ? { providerId: draftProvider.id, model: draftProvider.models[0] ?? kun.model }
        : undefined
    )
    setDraftProvider(null)
    setSelectedProviderId(draftProvider.id)
  }

  const cancelProviderDraft = (): void => {
    if (!draftProvider) return
    setDraftProvider(null)
    setSelectedProviderId(activeKunProviderId)
  }

  const addModelProvider = (): void => {
    const baseId = 'custom-provider'
    let index = modelProviders.length + 1
    let id = `${baseId}-${index}`
    const used = new Set(displayProviders.map((item) => item.id))
    while (used.has(id)) {
      index += 1
      id = `${baseId}-${index}`
    }
    startProviderDraft({
      id,
      name: t('modelProviderNewName', { index }),
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions',
      models: [],
      modelProfiles: {}
    })
  }

  const addPresetModelProvider = async (
    preset: ModelProviderPreset,
    mode: 'api' | 'token-plan' = 'api'
  ): Promise<void> => {
    const presetProvider = mode === 'token-plan'
      ? modelProviderTokenPlanProfile(preset)
      : modelProviderPresetProfile(preset)
    if (!presetProvider) return
    const existingProvider = modelProviders.find((item) => item.id === presetProvider.id)
    if (existingProvider) {
      const confirmed = await confirmAction({
        message: t('modelProviderUpdatePresetTitle', { name: presetProvider.name }),
        detail: t('modelProviderUpdatePresetDetail'),
        confirmLabel: t('modelProviderUpdatePresetAction'),
        cancelLabel: t('modelProviderCancel')
      })
      if (!confirmed) {
        setSelectedProviderId(presetProvider.id)
        return
      }
    }
    if (!existingProvider) {
      startProviderDraft(presetProvider)
      return
    }
    const nextProvider: ModelProviderProfileV1 = {
      ...presetProvider,
      name: existingProvider.name.trim() || presetProvider.name,
      apiKey: existingProvider.apiKey,
      models: mergeProviderModelIds(presetProvider.models, existingProvider.models),
      modelProfiles: {
        ...existingProvider.modelProfiles,
        ...presetProvider.modelProfiles
      },
      image: presetProvider.image ?? existingProvider.image,
      speech: presetProvider.speech ?? existingProvider.speech,
      textToSpeech: presetProvider.textToSpeech ?? existingProvider.textToSpeech,
      music: presetProvider.music ?? existingProvider.music,
      video: presetProvider.video ?? existingProvider.video
    }
    const nextProviders = modelProviders.map((item) => item.id === presetProvider.id ? nextProvider : item)
    setSelectedProviderId(nextProvider.id)
    updateModelProviders(
      nextProviders,
      nextProvider.apiKey.trim()
        ? { providerId: nextProvider.id, model: nextProvider.models[0] ?? kun.model }
        : undefined
    )
  }

  const removeModelProvider = async (id: string): Promise<void> => {
    if (id === DEFAULT_MODEL_PROVIDER_ID) return
    const target = modelProviders.find((item) => item.id === id)
    if (!target) return
    const usedByChat = activeKunProviderId === id
    const usedByImage = (kun.imageGeneration?.providerId ?? '').trim() === id
    const usedBySpeech = (kun.speechToText?.providerId ?? '').trim() === id
    const usedByTextToSpeech = (kun.textToSpeech?.providerId ?? '').trim() === id
    const usedByMusic = (kun.musicGeneration?.providerId ?? '').trim() === id
    const usedByVideo = (kun.videoGeneration?.providerId ?? '').trim() === id
    const writeInline = form?.write?.inlineCompletion
    const usedByWrite = Boolean(
      writeInline && !writeInline.inheritProvider && writeInline.providerId === id
    )
    const references = [
      ...(usedByChat ? [t('modelProviderDeleteInUseChat')] : []),
      ...(usedByImage ? [t('modelProviderDeleteInUseImage')] : []),
      ...(usedBySpeech ? [t('modelProviderDeleteInUseSpeech')] : []),
      ...(usedByTextToSpeech ? [t('modelProviderDeleteInUseTextToSpeech')] : []),
      ...(usedByMusic ? [t('modelProviderDeleteInUseMusic')] : []),
      ...(usedByVideo ? [t('modelProviderDeleteInUseVideo')] : []),
      ...(usedByWrite ? [t('modelProviderDeleteInUseWrite')] : [])
    ]
    const confirmed = await confirmAction({
      message: t('modelProviderDeleteConfirmTitle', { name: target.name.trim() || target.id }),
      detail: [t('modelProviderDeleteConfirmDetail'), ...references].join('\n'),
      confirmLabel: t('modelProviderDeleteAction'),
      cancelLabel: t('modelProviderCancel')
    })
    if (!confirmed) return
    const nextProviders = modelProviders.filter((item) => item.id !== id)
    const kunPatch: KunRuntimeSettingsPatchV1 | undefined =
      usedByChat || usedByImage || usedBySpeech || usedByTextToSpeech || usedByMusic || usedByVideo
        ? {
            ...(usedByChat ? { providerId: DEFAULT_MODEL_PROVIDER_ID } : {}),
            ...(usedByImage ? { imageGeneration: { providerId: '' } } : {}),
            ...(usedBySpeech ? { speechToText: { providerId: '' } } : {}),
            ...(usedByTextToSpeech ? { textToSpeech: { providerId: '' } } : {}),
            ...(usedByMusic ? { musicGeneration: { providerId: '' } } : {}),
            ...(usedByVideo ? { videoGeneration: { providerId: '' } } : {})
          }
        : undefined
    const patch = modelProvidersSettingsPatch({
      provider,
      providers: nextProviders,
      kun: kunPatch,
      currentKun: kun
    })
    if (usedByWrite) {
      patch.write = { inlineCompletion: { inheritProvider: true, providerId: '' } }
    }
    setSelectedProviderId(DEFAULT_MODEL_PROVIDER_ID)
    update(patch)
  }

  const runProbe = async (target: ModelProviderProfileV1, mode: 'test' | 'fetch'): Promise<void> => {
    if (typeof window.kunGui?.probeModelProvider !== 'function') return
    const fingerprint = providerConnectionFingerprint(target)
    if (providerPresetRequiresApiKey(target) && !target.apiKey.trim()) {
      setProbeStates((prev) => ({
        ...prev,
        [target.id]: {
          fingerprint,
          mode,
          status: 'error',
          message: t('modelProviderPresetMissingKeyForProbe')
        }
      }))
      return
    }
    setProbeStates((prev) => ({ ...prev, [target.id]: { fingerprint, mode, status: 'busy' } }))
    let result: ModelProviderProbeResult
    try {
      result = await window.kunGui.probeModelProvider({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        endpointFormat: target.endpointFormat
      })
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    if (!result.ok) {
      setProbeStates((prev) => ({
        ...prev,
        [target.id]: { fingerprint, mode, status: 'error', message: result.message }
      }))
      return
    }
    if (mode === 'fetch') {
      setProbeStates((prev) => ({
        ...prev,
        [target.id]: {
          fingerprint,
          mode,
          status: 'ok',
          latencyMs: result.latencyMs,
          total: result.modelIds.length
        }
      }))
      setPendingImport({
        providerId: target.id,
        modelIds: [...result.modelIds],
        latencyMs: result.latencyMs
      })
      return
    }
    setProbeStates((prev) => ({
      ...prev,
      [target.id]: {
        fingerprint,
        mode,
        status: 'ok',
        latencyMs: result.latencyMs,
        total: result.modelIds.length
      }
    }))
  }

  const importPickedModels = (target: ModelProviderProfileV1, picked: ProviderModelImportResult): void => {
    const nextChatModels = mergeProviderModelIds(target.models, picked.chat)
    const nextImageModels = target.image
      ? mergeProviderModelIds(target.image.models, picked.image)
      : picked.image
    const nextSpeechModels = target.speech
      ? mergeProviderModelIds(target.speech.models, picked.speech)
      : picked.speech
    const nextTextToSpeechModels = target.textToSpeech
      ? mergeProviderModelIds(target.textToSpeech.models, picked.tts)
      : picked.tts
    const nextMusicModels = target.music
      ? mergeProviderModelIds(target.music.models, picked.music)
      : picked.music
    const nextVideoModels = target.video
      ? mergeProviderModelIds(target.video.models, picked.video)
      : picked.video
    const added =
      addedModelCount(target.models, nextChatModels)
      + addedModelCount(target.image?.models ?? [], nextImageModels)
      + addedModelCount(target.speech?.models ?? [], nextSpeechModels)
      + addedModelCount(target.textToSpeech?.models ?? [], nextTextToSpeechModels)
      + addedModelCount(target.music?.models ?? [], nextMusicModels)
      + addedModelCount(target.video?.models ?? [], nextVideoModels)
    if (added > 0) {
      patchProviderProfile(target, (item) => ({
        ...item,
        models: nextChatModels,
        ...(nextImageModels.length > 0
          ? { image: { ...(item.image ?? presetImageCapability(item.id) ?? defaultImageCapability(item.baseUrl)), models: nextImageModels } }
          : {}),
        ...(nextSpeechModels.length > 0
          ? { speech: { ...(item.speech ?? presetSpeechCapability(item) ?? defaultSpeechCapability(item.baseUrl)), models: nextSpeechModels } }
          : {}),
        ...(nextTextToSpeechModels.length > 0
          ? { textToSpeech: { ...(item.textToSpeech ?? presetTextToSpeechCapability(item) ?? defaultTextToSpeechCapability(item.baseUrl)), models: nextTextToSpeechModels } }
          : {}),
        ...(nextMusicModels.length > 0
          ? { music: { ...(item.music ?? presetMusicCapability(item) ?? defaultMusicCapability(item.baseUrl)), models: nextMusicModels } }
          : {}),
        ...(nextVideoModels.length > 0
          ? { video: { ...(item.video ?? presetVideoCapability(item) ?? defaultVideoCapability(item.baseUrl)), models: nextVideoModels } }
          : {})
      }))
    }
    setProbeStates((prev) => {
      const previous = prev[target.id]
      if (!previous) return prev
      return {
        ...prev,
        [target.id]: { ...previous, total: added }
      }
    })
  }

  const providerKindLabel = (item: ModelProviderProfileV1): string => {
    if (item.id === DEFAULT_MODEL_PROVIDER_ID) return t('modelProviderDefaultBadge')
    if (tokenPlanPresetForProfileId(item.id)) return t('modelProviderTokenPlanBadge')
    const preset = getModelProviderPreset(item.id)
    if (preset?.category === 'subscription') return t('modelProviderPlanBadge')
    if (preset) return t('modelProviderPresetBadge')
    return t('modelProviderCustomBadge')
  }

  const activeProbe = activeProvider ? probeStates[activeProvider.id] : undefined
  const activeProbeFresh = Boolean(
    activeProvider &&
    activeProbe &&
    activeProbe.fingerprint === providerConnectionFingerprint(activeProvider)
  )
  const probeBusy = Boolean(activeProbeFresh && activeProbe?.status === 'busy')
  const probeNotice: InlineNotice | null = (() => {
    if (!activeProbeFresh || !activeProbe) return null
    if (activeProbe.status === 'busy') {
      return { tone: 'info', message: t('modelProviderTesting') }
    }
    if (activeProbe.status === 'error') {
      return { tone: 'error', message: t('modelProviderTestFailed', { message: activeProbe.message ?? '' }) }
    }
    return {
      tone: 'success',
      message: activeProbe.mode === 'fetch'
        ? t('modelProviderFetchedModels', { total: activeProbe.total ?? 0 })
        : t('modelProviderTestSuccess', { latency: activeProbe.latencyMs ?? 0, total: activeProbe.total ?? 0 })
    }
  })()
  const activeBaseUrlInvalid = Boolean(activeProvider && !isAcceptableHttpUrl(activeProvider.baseUrl))
  const activeImageBaseUrlInvalid = Boolean(
    activeProvider?.image && !isAcceptableHttpUrl(activeProvider.image.baseUrl)
  )
  const activeSpeechBaseUrlInvalid = Boolean(
    activeProvider?.speech && !isAcceptableHttpUrl(activeProvider.speech.baseUrl)
  )
  const activeTextToSpeechBaseUrlInvalid = Boolean(
    activeProvider?.textToSpeech && !isAcceptableHttpUrl(activeProvider.textToSpeech.baseUrl)
  )
  const activeMusicBaseUrlInvalid = Boolean(
    activeProvider?.music && !isAcceptableHttpUrl(activeProvider.music.baseUrl)
  )
  const activeVideoBaseUrlInvalid = Boolean(
    activeProvider?.video && !isAcceptableHttpUrl(activeProvider.video.baseUrl)
  )
  const activeTokenPlanRegions = activeProvider
    ? tokenPlanPresetForProfileId(activeProvider.id)?.tokenPlan?.regions ?? []
    : []

  const planProviders = displayProviders.filter((item) => isSubscriptionProviderId(item.id))
  const apiProviders = displayProviders.filter((item) => !isSubscriptionProviderId(item.id))
  // 只要存在任一套餐类供应商就分组展示;否则(通常只有默认 DeepSeek)保持单一平铺列表。
  const grouped = planProviders.length > 0

  const renderProviderButton = (item: ModelProviderProfileV1): ReactElement => {
    const selected = activeProvider?.id === item.id
    const isDraft = draftProvider?.id === item.id
    const inUse = !isDraft && activeKunProviderId === item.id
    const missingKey = !item.apiKey.trim()
    return (
      <button
        key={item.id}
        type="button"
        aria-pressed={selected}
        onClick={() => setSelectedProviderId(item.id)}
        className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
          selected
            ? 'border-accent/60 bg-ds-main/45 ring-1 ring-accent/30'
            : 'border-ds-border bg-ds-card hover:bg-ds-hover'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-ds-ink">
            {item.name.trim() || item.id}
          </span>
          {isDraft ? <ProviderBadge tone="warning">{t('modelProviderDraftBadge')}</ProviderBadge> : null}
          {inUse ? <ProviderBadge tone="accent">{t('modelProviderInUse')}</ProviderBadge> : null}
          {!isDraft && missingKey ? <ProviderBadge tone="warning">{t('modelProviderMissingKey')}</ProviderBadge> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ds-faint">
          <span>{t('modelProviderModelCount', { total: providerModelCount(item) })}</span>
          <span aria-hidden="true">·</span>
          <span>{providerKindLabel(item)}</span>
          {item.apiKey.trim() ? <KeyRound className="h-3 w-3" strokeWidth={1.9} /> : null}
          {item.image ? <ImageIcon className="h-3 w-3" strokeWidth={1.9} /> : null}
          {item.models.some((model) =>
            modelSupportsImageInput(profileForModel(item, model))
          ) ? <span className="text-[11px] font-semibold text-ds-muted">{t('modelProviderVisionBadge')}</span> : null}
          {item.speech ? <Mic className="h-3 w-3" strokeWidth={1.9} /> : null}
          {item.textToSpeech ? <AudioLines className="h-3 w-3" strokeWidth={1.9} /> : null}
          {item.music ? <Music2 className="h-3 w-3" strokeWidth={1.9} /> : null}
          {item.video ? <Clapperboard className="h-3 w-3" strokeWidth={1.9} /> : null}
        </div>
      </button>
    )
  }

  const addMenuEntries = MODEL_PROVIDER_PRESETS.flatMap((preset) => {
    const entries: {
      preset: ModelProviderPreset
      mode: 'api' | 'token-plan'
      profileId: string
      label: string
      group: 'subscription' | 'api'
    }[] = [
      {
        preset,
        mode: 'api',
        profileId: preset.id,
        label: preset.name,
        group: preset.category === 'subscription' ? 'subscription' : 'api'
      }
    ]
    if (preset.tokenPlan) {
      entries.push({
        preset,
        mode: 'token-plan',
        profileId: tokenPlanProviderId(preset.id),
        label: `${preset.name} · Token Plan`,
        group: 'subscription'
      })
    }
    return entries
  })
  const planAddEntries = addMenuEntries.filter((entry) => entry.group === 'subscription')
  const apiAddEntries = addMenuEntries.filter((entry) => entry.group === 'api')
  const renderAddEntry = (entry: (typeof addMenuEntries)[number]): ReactElement => {
    const exists = modelProviders.some((item) => item.id === entry.profileId)
    return (
      <button
        key={entry.profileId}
        type="button"
        role="menuitem"
        onClick={() => {
          setAddMenuOpen(false)
          void addPresetModelProvider(entry.preset, entry.mode)
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover"
      >
        <span>{entry.label}</span>
        <span className="text-[11px] text-ds-faint">
          {exists
            ? t('modelProviderPresetUpdateTag')
            : entry.group === 'subscription'
              ? t('modelProviderPlanBadge')
              : t('modelProviderPresetBadge')}
        </span>
      </button>
    )
  }

  const pendingImportProvider = pendingImport
    ? displayProviders.find((item) => item.id === pendingImport.providerId)
    : null

  return (
    <>
    <SettingsCard title={t('providers')}>
      <SettingRow
        title={t('proxyUrl')}
        description={t('proxyUrlDesc')}
        control={
          <div className="flex w-full min-w-0 flex-col gap-2 md:max-w-md">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
              <span>{t('proxyEnabled')}</span>
              <Toggle
                checked={providerProxy.enabled === true}
                onChange={(enabled) => updateProviderProxy({ enabled })}
              />
            </label>
            <input
              className={textInputClass}
              placeholder={t('proxyUrlPlaceholder')}
              value={providerProxy.url}
              spellCheck={false}
              onChange={(e) => updateProviderProxy({ url: e.target.value })}
            />
          </div>
        }
      />
      <SettingRow
        title={t('providers')}
        description={t('providersDesc')}
        wideControl
        control={
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              {grouped ? (
                <>
                  <ProviderListGroup label={t('modelProviderGroupPlans')} count={planProviders.length}>
                    {planProviders.map(renderProviderButton)}
                  </ProviderListGroup>
                  <ProviderListGroup label={t('modelProviderGroupApi')} count={apiProviders.length}>
                    {apiProviders.map(renderProviderButton)}
                  </ProviderListGroup>
                </>
              ) : (
                <div className="grid gap-2">{displayProviders.map(renderProviderButton)}</div>
              )}
              <div ref={addMenuRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  onClick={() => setAddMenuOpen((value) => !value)}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {t('modelProviderAdd')}
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
                {addMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 right-0 z-20 mt-1 max-h-[min(60vh,420px)] overflow-y-auto rounded-xl border border-ds-border bg-ds-card p-1 shadow-lg"
                  >
                    <div className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-ds-faint">
                      {t('modelProviderGroupPlans')}
                    </div>
                    {planAddEntries.map(renderAddEntry)}
                    <div className="my-1 border-t border-ds-border-muted" />
                    <div className="px-2.5 pb-1 text-[11px] font-semibold text-ds-faint">
                      {t('modelProviderGroupApi')}
                    </div>
                    {apiAddEntries.map(renderAddEntry)}
                    <div className="my-1 border-t border-ds-border-muted" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false)
                        addModelProvider()
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('modelProviderAddMenuCustom')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {activeProvider ? (
              <div className="grid content-start gap-3 rounded-xl border border-ds-border-muted bg-ds-main/35 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[14px] font-semibold text-ds-ink">
                      {activeProvider.name.trim() || activeProvider.id}
                    </span>
                    <span className="font-mono text-[12px] text-ds-faint">{activeProvider.id}</span>
                    {!canEditActiveProviderId ? (
                      <span title={t('modelProviderIdLocked')} className="text-ds-faint">
                        <Lock className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={probeBusy}
                    onClick={() => void runProbe(activeProvider, 'test')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {probeBusy && activeProbe?.mode === 'test'
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                      : <PlugZap className="h-3.5 w-3.5" strokeWidth={1.9} />}
                    {t('modelProviderTestConnection')}
                  </button>
                </div>
                {probeNotice ? <InlineNoticeView notice={probeNotice} /> : null}
                <DetailSection title={t('modelProviderSectionBasics')}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className={fieldLabelClass}>
                      {t('modelProviderName')}
                      <input
                        className={textInputClass}
                        value={activeProvider.name}
                        onChange={(e) => updateModelProvider(activeProvider.id, { name: e.target.value })}
                      />
                    </label>
                    <label className={fieldLabelClass}>
                      {t('modelProviderId')}
                      <span className="relative block">
                        <input
                          className={`w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] font-normal shadow-sm ${
                            canEditActiveProviderId
                              ? 'text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
                              : 'pr-9 text-ds-faint'
                          }`}
                          value={activeProvider.id}
                          readOnly={!canEditActiveProviderId}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderId(activeProvider.id, e.target.value)}
                        />
                        {!canEditActiveProviderId ? (
                          <span
                            title={t('modelProviderIdLocked')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-faint"
                          >
                            <Lock className="h-3.5 w-3.5" strokeWidth={1.9} />
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </div>
                </DetailSection>
                <DetailSection title={t('modelProviderSectionConnection')}>
                  {isCodexProvider(activeProvider.id) ? (
                    <CodexLoginSection
                      provider={activeProvider}
                      onCredentialChange={(apiKey) => updateModelProvider(activeProvider.id, { apiKey })}
                      t={t}
                    />
                  ) : isAnthropicProvider(activeProvider.id) ? (
                    <AnthropicLoginSection
                      provider={activeProvider}
                      onCredentialChange={(apiKey) => updateModelProvider(activeProvider.id, { apiKey })}
                      t={t}
                    />
                  ) : (
                    <>
                      <label className={fieldLabelClass}>
                        {t('modelProviderApiKey')}
                        <SecretInput
                          value={activeProvider.apiKey}
                          onChange={(value) => updateModelProvider(activeProvider.id, { apiKey: value })}
                          visible={showApiKey}
                          onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                          placeholder={t('modelProviderApiKeyPlaceholder')}
                          autoComplete="off"
                          showLabel={t('showSecret')}
                          hideLabel={t('hideSecret')}
                        />
                      </label>
                      <label className={fieldLabelClass}>
                        {t('modelProviderBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.baseUrl}
                          placeholder={t('baseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProvider(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                    </>
                  )}
                  {activeTokenPlanRegions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-ds-muted">
                        {t('modelProviderTokenPlanRegion')}
                      </span>
                      {activeTokenPlanRegions.map((region) => {
                        const active = activeProvider.baseUrl.trim() === region.baseUrl
                        return (
                          <button
                            key={region.id}
                            type="button"
                            onClick={() => {
                              const patch: Partial<ModelProviderProfileV1> = { baseUrl: region.baseUrl }
                              const speech = activeProvider.speech
                              if (speech && activeTokenPlanRegions.some((item) => item.baseUrl === speech.baseUrl.trim())) {
                                patch.speech = { ...speech, baseUrl: region.baseUrl }
                              }
                              const textToSpeech = activeProvider.textToSpeech
                              if (
                                textToSpeech &&
                                activeTokenPlanRegions.some((item) => item.baseUrl === textToSpeech.baseUrl.trim())
                              ) {
                                patch.textToSpeech = { ...textToSpeech, baseUrl: region.baseUrl }
                              }
                              updateModelProvider(activeProvider.id, patch)
                            }}
                            className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition ${
                              active
                                ? 'border-accent/60 bg-ds-main/45 text-ds-ink ring-1 ring-accent/30'
                                : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                            }`}
                          >
                            {t(`firstRunRegion_${region.id}`)}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                  <label className={fieldLabelClass}>
                    {t('modelProviderEndpointFormat')}
                    <select
                      className={selectControlClass}
                      value={activeProvider.endpointFormat}
                      disabled={isCodexProvider(activeProvider.id) || isAnthropicProvider(activeProvider.id)}
                      onChange={(e) => updateModelProvider(activeProvider.id, {
                        endpointFormat: e.target.value as ModelEndpointFormat
                      })}
                    >
                      {MODEL_ENDPOINT_FORMATS.map((format) => (
                        <option key={format} value={format}>
                          {t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[format])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isCodexProvider(activeProvider.id) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('codexEndpointLocked')}
                    </p>
                  ) : isAnthropicProvider(activeProvider.id) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('claudeEndpointLocked')}
                    </p>
                  ) : activeProvider.endpointFormat === 'custom_endpoint' ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('modelEndpointCustomEndpointDesc')}
                    </p>
                  ) : null}
                </DetailSection>
                <DetailSection
                  title={`${t('modelProviderModels')} · ${providerModelCount(activeProvider)}`}
                  action={
                    <button
                      type="button"
                      disabled={probeBusy}
                      onClick={() => void runProbe(activeProvider, 'fetch')}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {probeBusy && activeProbe?.mode === 'fetch'
                        ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.9} />
                        : <Download className="h-3 w-3" strokeWidth={1.9} />}
                      {t('modelProviderFetchModels')}
                    </button>
                  }
                >
                  <ProviderModelsManager
                    key={activeProvider.id}
                    provider={activeProvider}
                    t={t}
                    selectControlClass={selectControlClass}
                    onChange={(next) => patchProviderProfile(activeProvider, () => next)}
                  />
                </DetailSection>
                <DetailSection
                  title={t('modelProviderImageCapability')}
                  action={
                    <Toggle
                      checked={Boolean(activeProvider.image)}
                      onChange={(value) => {
                        if (value) {
                          updateModelProvider(activeProvider.id, {
                            image: presetImageCapability(activeProvider.id) ?? defaultImageCapability(activeProvider.baseUrl)
                          })
                        } else {
                          removeModelProviderImage(activeProvider.id)
                        }
                      }}
                    />
                  }
                >
                  <p className="text-[12px] leading-5 text-ds-faint">{t('modelProviderImageCapabilityDesc')}</p>
                  {activeProvider.image ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('imageGenProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.image.protocol}
                          onChange={(e) => updateModelProviderImage(activeProvider.id, {
                            protocol: e.target.value as ImageGenerationProtocol
                          })}
                        >
                          {Object.entries(IMAGE_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('imageGenBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.image.baseUrl}
                          placeholder={t('imageGenBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderImage(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeImageBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('imageGenModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-image`}
                          values={activeProvider.image.models}
                          onChange={(models) => updateModelProviderImage(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('imageGenModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </DetailSection>
                <DetailSection
                  title={t('modelProviderSpeechCapability')}
                  action={
                    <Toggle
                      checked={Boolean(activeProvider.speech)}
                      onChange={(value) => {
                        if (value) {
                          updateModelProvider(activeProvider.id, {
                            speech: presetSpeechCapability(activeProvider) ?? defaultSpeechCapability(activeProvider.baseUrl)
                          })
                        } else {
                          removeModelProviderSpeech(activeProvider.id)
                        }
                      }}
                    />
                  }
                >
                  <p className="text-[12px] leading-5 text-ds-faint">{t('modelProviderSpeechCapabilityDesc')}</p>
                  {activeProvider.speech ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('speechToTextProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.speech.protocol}
                          onChange={(e) => updateModelProviderSpeech(activeProvider.id, {
                            protocol: e.target.value as SpeechToTextProtocol
                          })}
                        >
                          {Object.entries(SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('speechToTextBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.speech.baseUrl}
                          placeholder={t('baseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderSpeech(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeSpeechBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('speechToTextModels')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-speech`}
                          values={activeProvider.speech.models}
                          onChange={(models) => updateModelProviderSpeech(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('speechToTextModels')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </DetailSection>
                <DetailSection
                  title={t('modelProviderTextToSpeechCapability')}
                  action={
                    <Toggle
                      checked={Boolean(activeProvider.textToSpeech)}
                      onChange={(value) => {
                        if (value) {
                          updateModelProvider(activeProvider.id, {
                            textToSpeech: presetTextToSpeechCapability(activeProvider) ??
                              defaultTextToSpeechCapability(activeProvider.baseUrl)
                          })
                        } else {
                          removeModelProviderTextToSpeech(activeProvider.id)
                        }
                      }}
                    />
                  }
                >
                  <p className="text-[12px] leading-5 text-ds-faint">{t('modelProviderTextToSpeechCapabilityDesc')}</p>
                  {activeProvider.textToSpeech ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('textToSpeechProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.textToSpeech.protocol}
                          onChange={(e) => updateModelProviderTextToSpeech(activeProvider.id, {
                            protocol: e.target.value as TextToSpeechProtocol
                          })}
                        >
                          {Object.entries(TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('textToSpeechBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.textToSpeech.baseUrl}
                          placeholder={t('textToSpeechBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderTextToSpeech(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeTextToSpeechBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('textToSpeechModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-tts`}
                          values={activeProvider.textToSpeech.models}
                          onChange={(models) => updateModelProviderTextToSpeech(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('textToSpeechModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </DetailSection>
                <DetailSection
                  title={t('modelProviderMusicCapability')}
                  action={
                    <Toggle
                      checked={Boolean(activeProvider.music)}
                      onChange={(value) => {
                        if (value) {
                          updateModelProvider(activeProvider.id, {
                            music: presetMusicCapability(activeProvider) ?? defaultMusicCapability(activeProvider.baseUrl)
                          })
                        } else {
                          removeModelProviderMusic(activeProvider.id)
                        }
                      }}
                    />
                  }
                >
                  <p className="text-[12px] leading-5 text-ds-faint">{t('modelProviderMusicCapabilityDesc')}</p>
                  {activeProvider.music ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('musicGenerationProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.music.protocol}
                          onChange={(e) => updateModelProviderMusic(activeProvider.id, {
                            protocol: e.target.value as MusicGenerationProtocol
                          })}
                        >
                          {Object.entries(MUSIC_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('musicGenerationBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.music.baseUrl}
                          placeholder={t('musicGenerationBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderMusic(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeMusicBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('musicGenerationModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-music`}
                          values={activeProvider.music.models}
                          onChange={(models) => updateModelProviderMusic(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('musicGenerationModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </DetailSection>
                <DetailSection
                  title={t('modelProviderVideoCapability')}
                  action={
                    <Toggle
                      checked={Boolean(activeProvider.video)}
                      onChange={(value) => {
                        if (value) {
                          updateModelProvider(activeProvider.id, {
                            video: presetVideoCapability(activeProvider) ?? defaultVideoCapability(activeProvider.baseUrl)
                          })
                        } else {
                          removeModelProviderVideo(activeProvider.id)
                        }
                      }}
                    />
                  }
                >
                  <p className="text-[12px] leading-5 text-ds-faint">{t('modelProviderVideoCapabilityDesc')}</p>
                  {activeProvider.video ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('videoGenerationProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.video.protocol}
                          onChange={(e) => updateModelProviderVideo(activeProvider.id, {
                            protocol: e.target.value as VideoGenerationProtocol
                          })}
                        >
                          {Object.entries(VIDEO_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('videoGenerationBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.video.baseUrl}
                          placeholder={t('videoGenerationBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderVideo(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeVideoBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('videoGenerationModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-video`}
                          values={activeProvider.video.models}
                          onChange={(models) => updateModelProviderVideo(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('videoGenerationModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </DetailSection>
                {isDraftActive ? (
                  <DetailSection title={t('modelProviderDraftSection')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={commitProviderDraft}
                        className="inline-flex h-9 w-fit items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        {t('modelProviderDraftConfirm')}
                      </button>
                      <button
                        type="button"
                        onClick={cancelProviderDraft}
                        className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        {t('modelProviderDraftDiscard')}
                      </button>
                      <span className="text-[12px] text-ds-faint">
                        {activeProvider.apiKey.trim()
                          ? t('modelProviderDraftHintReady')
                          : t('modelProviderDraftHintNoKey')}
                      </span>
                    </div>
                  </DetailSection>
                ) : activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID ? (
                  <DetailSection title={t('modelProviderSectionDanger')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void removeModelProvider(activeProvider.id)}
                        className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-red-200/70 bg-red-50 px-3 text-[12.5px] font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-200 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {t('modelProviderRemove')}
                      </button>
                      <span className="text-[12px] text-ds-faint">{t('modelProviderDangerHint')}</span>
                    </div>
                  </DetailSection>
                ) : null}
              </div>
            ) : null}
          </div>
        }
      />
    </SettingsCard>
    {pendingImport && pendingImportProvider ? (
      <ProviderModelImportDialog
        provider={pendingImportProvider}
        fetchedModelIds={pendingImport.modelIds}
        t={t}
        onCancel={() => setPendingImport(null)}
        onConfirm={(picked) => {
          importPickedModels(pendingImportProvider, picked)
          setPendingImport(null)
        }}
      />
    ) : null}
    </>
  )
}
