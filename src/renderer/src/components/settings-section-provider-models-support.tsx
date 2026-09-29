import {
  type ModelEndpointFormat,
  type ModelProviderProfileV1,
  type ModelReasoningEffort,
  type ModelReasoningRequestProtocol
} from '@shared/app-settings'
import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  MessageSquareText,
  Mic,
  Music2
} from 'lucide-react'
import {
  type ReactElement,
  type ReactNode
} from 'react'
import {
  describeContextWindowTokens,
  newProviderModelForm,
  parseContextWindowInput,
  parsePricingInput,
  providerModelFormForExisting,
  type ProviderModelForm,
  type ProviderModelFormError,
  type ProviderModelKind
} from './provider-model-editor'
import { Toggle } from './settings-controls'


export type Translate = (key: string, params?: Record<string, unknown>) => string

export const fieldLabelClass = 'grid gap-1.5 text-[12px] font-semibold text-ds-muted'
export const textInputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

// Above this many models the list gets a search box + pagination so providers
// with large catalogs (e.g. after "fetch from API") stay scannable. At or
// below it, the plain list renders as-is to avoid needless chrome.
export const MODEL_LIST_PAGE_SIZE = 8

export const REASONING_PROTOCOL_LABEL_KEYS: Record<ModelReasoningRequestProtocol, string> = {
  'deepseek-chat-completions': 'providerModelReasoningProtocolDeepseek',
  'glm-chat-completions': 'providerModelReasoningProtocolGlm',
  'mimo-chat-completions': 'providerModelReasoningProtocolMimo',
  'openai-chat-completions': 'providerModelReasoningProtocolOpenAiChat',
  'qwen-chat-completions': 'providerModelReasoningProtocolQwen',
  'thinking-toggle-chat-completions': 'providerModelReasoningProtocolThinkingToggle',
  'openai-responses': 'providerModelReasoningProtocolResponses',
  'anthropic-thinking': 'providerModelReasoningProtocolAnthropic',
  none: 'providerModelReasoningProtocolNone'
}

export const REASONING_EFFORT_LABEL_KEYS: Record<ModelReasoningEffort, string> = {
  auto: 'providerModelEffortAuto',
  off: 'providerModelEffortOff',
  low: 'providerModelEffortLow',
  medium: 'providerModelEffortMedium',
  high: 'providerModelEffortHigh',
  max: 'providerModelEffortMax'
}

export const ENDPOINT_FORMAT_LABEL_KEYS: Record<ModelEndpointFormat, string> = {
  chat_completions: 'modelEndpointChatCompletions',
  responses: 'modelEndpointResponses',
  messages: 'modelEndpointMessages',
  custom_endpoint: 'modelEndpointCustomEndpoint'
}

export const MODEL_KIND_META: Array<{
  kind: ProviderModelKind
  icon: typeof MessageSquareText
  titleKey: string
  descKey: string
}> = [
  {
    kind: 'chat',
    icon: MessageSquareText,
    titleKey: 'providerModelKindChat',
    descKey: 'providerModelKindChatDesc'
  },
  {
    kind: 'image',
    icon: ImageIcon,
    titleKey: 'providerModelKindImage',
    descKey: 'providerModelKindImageDesc'
  },
  {
    kind: 'speech',
    icon: Mic,
    titleKey: 'providerModelKindSpeech',
    descKey: 'providerModelKindSpeechDesc'
  },
  {
    kind: 'tts',
    icon: AudioLines,
    titleKey: 'providerModelKindTts',
    descKey: 'providerModelKindTtsDesc'
  },
  {
    kind: 'music',
    icon: Music2,
    titleKey: 'providerModelKindMusic',
    descKey: 'providerModelKindMusicDesc'
  },
  {
    kind: 'video',
    icon: Clapperboard,
    titleKey: 'providerModelKindVideo',
    descKey: 'providerModelKindVideoDesc'
  }
]

export type EditorState = {
  mode: 'add' | 'edit'
  form: ProviderModelForm
  contextText: string
  maxOutputText: string
  pricingInputText: string
  pricingOutputText: string
  pricingCacheReadText: string
  pricingCacheWriteText: string
  aliasesText: string
}

export function editorStateForNew(provider: ModelProviderProfileV1): EditorState {
  const form = newProviderModelForm('chat', provider)
  return {
    mode: 'add',
    form,
    contextText: form.contextWindowTokens ? describeContextWindowTokens(form.contextWindowTokens) : '',
    maxOutputText: form.maxOutputTokens ? describeContextWindowTokens(form.maxOutputTokens) : '',
    pricingInputText: '',
    pricingOutputText: '',
    pricingCacheReadText: '',
    pricingCacheWriteText: '',
    aliasesText: ''
  }
}

export function editorStateForExisting(
  provider: ModelProviderProfileV1,
  kind: ProviderModelKind,
  modelId: string
): EditorState {
  const form = providerModelFormForExisting(provider, kind, modelId)
  return {
    mode: 'edit',
    form,
    contextText: form.contextWindowTokens ? describeContextWindowTokens(form.contextWindowTokens) : '',
    maxOutputText: form.maxOutputTokens ? describeContextWindowTokens(form.maxOutputTokens) : '',
    pricingInputText: pricingFieldText(form.pricing?.inputUsdPerMillion),
    pricingOutputText: pricingFieldText(form.pricing?.outputUsdPerMillion),
    pricingCacheReadText: pricingFieldText(form.pricing?.cacheReadUsdPerMillion),
    pricingCacheWriteText: pricingFieldText(form.pricing?.cacheWriteUsdPerMillion),
    aliasesText: form.aliases.join(', ')
  }
}

function pricingFieldText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

export function parseAliasesText(raw: string): string[] {
  return raw.split(/[\s,]+/).map((alias) => alias.trim()).filter(Boolean)
}

export function effectiveFormForEditor(editor: EditorState): ProviderModelForm {
  const trimmedContext = editor.contextText.trim()
  const contextWindowTokens =
    editor.form.kind !== 'chat' || trimmedContext === ''
      ? null
      : parseContextWindowInput(trimmedContext) ?? Number.NaN
  const trimmedMaxOutput = editor.maxOutputText.trim()
  const maxOutputTokens =
    editor.form.kind !== 'chat' || trimmedMaxOutput === ''
      ? null
      : parseContextWindowInput(trimmedMaxOutput) ?? Number.NaN
  const pricingInput = parsePricingInput(editor.pricingInputText)
  const pricingOutput = parsePricingInput(editor.pricingOutputText)
  const pricingCacheRead = parsePricingInput(editor.pricingCacheReadText)
  const pricingCacheWrite = parsePricingInput(editor.pricingCacheWriteText)
  const hasPricingInput =
    pricingInput !== null || pricingOutput !== null ||
    pricingCacheRead !== null || pricingCacheWrite !== null
  const pricing =
    editor.form.kind === 'chat' && hasPricingInput
      ? {
          inputUsdPerMillion: pricingInput,
          outputUsdPerMillion: pricingOutput,
          cacheReadUsdPerMillion: pricingCacheRead,
          cacheWriteUsdPerMillion: pricingCacheWrite
        }
      : null
  return {
    ...editor.form,
    contextWindowTokens,
    maxOutputTokens,
    pricing,
    aliases: parseAliasesText(editor.aliasesText)
  }
}

export function formErrorMessage(t: Translate, error: ProviderModelFormError): string {
  switch (error.code) {
    case 'missingId':
      return t('providerModelErrorMissingId')
    case 'duplicate':
      return t(`providerModelErrorDuplicate${duplicateKindSuffix(error.kind)}`)
    case 'invalidContextWindow':
      return t('providerModelErrorContext')
    case 'contextWindowTooLarge':
      return t('providerModelErrorContextTooLarge', { max: error.maximum.toLocaleString() })
    case 'invalidMaxOutput':
      return t('providerModelErrorMaxOutput')
    case 'maxOutputTooLarge':
      return t('providerModelErrorMaxOutputTooLarge', { max: error.maximum.toLocaleString() })
    case 'invalidPricing':
      return t('providerModelErrorPricing')
    case 'noReasoningEfforts':
      return t('providerModelErrorNoEfforts')
  }
}

export function duplicateKindSuffix(kind: ProviderModelKind): string {
  if (kind === 'chat') return 'Chat'
  if (kind === 'image') return 'Image'
  if (kind === 'speech') return 'Speech'
  if (kind === 'tts') return 'Tts'
  if (kind === 'music') return 'Music'
  return 'Video'
}

export function ModelBadge({
  tone = 'muted',
  icon,
  children
}: {
  tone?: 'muted' | 'warning' | 'faint'
  icon?: ReactNode
  children: ReactNode
}): ReactElement {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
      : tone === 'faint'
        ? 'border-ds-border-muted bg-transparent text-ds-faint'
        : 'border-ds-border-muted bg-ds-main/60 text-ds-muted'
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10.5px] font-medium leading-4 ${toneClass}`}>
      {icon}
      {children}
    </span>
  )
}

export function ModelName({ modelId }: { modelId: string }): ReactElement {
  return (
    <span className="group/model-name relative min-w-0" title={modelId}>
      <span className="block truncate font-mono text-[12.5px] text-ds-ink">{modelId}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-full z-30 mt-1 max-w-[min(28rem,calc(100vw-3rem))] break-all rounded-lg border border-ds-border bg-white px-2.5 py-1.5 font-mono text-[12px] leading-5 text-ds-ink opacity-0 shadow-[0_12px_32px_rgba(20,47,95,0.16)] transition group-hover/model-name:opacity-100 dark:bg-ds-card"
      >
        {modelId}
      </span>
    </span>
  )
}

export function chipButtonClass(active: boolean): string {
  return `inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition ${
    active
      ? 'border-accent/60 bg-ds-main/45 text-ds-ink ring-1 ring-accent/30'
      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  }`
}

export function modelEntryKey(kind: ProviderModelKind, modelId: string): string {
  return `${kind}:${modelId.trim().toLowerCase()}`
}

export function modelKindLabelKey(kind: ProviderModelKind): string {
  return MODEL_KIND_META.find((item) => item.kind === kind)?.titleKey ?? 'providerModelKindChat'
}

export function ToggleField({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-card/60 px-3 py-2.5">
      <div className="grid gap-0.5">
        <span className="text-[12.5px] font-semibold text-ds-ink">{label}</span>
        <span className="text-[12px] leading-5 text-ds-faint">{description}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  )
}
