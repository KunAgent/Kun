import type { ReactElement } from 'react'
import {
  shouldWarnMissingProviderCredential,
  type SharedConnectionCredentialState
} from '../lib/provider-credential-readiness'
import { ModelSelect, SecretInput, SettingRow } from './settings-controls'

const AUDIO_FORMATS = ['mp3', 'wav', 'flac'] as const
const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const compactInputClass =
  'w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

type ProviderCapability = { protocol: string; models: string[] }
type ProviderProfile = {
  id: string
  name: string
  apiKey?: string
  textToSpeech?: ProviderCapability
  music?: ProviderCapability
  video?: ProviderCapability
}

export function selectedProviderState(input: {
  settingProviderId: string
  customProviderId: string
  providers: ProviderProfile[]
  capabilityKey: 'textToSpeech' | 'music' | 'video'
}): {
  providerId: string
  provider?: ProviderProfile
  capability?: ProviderCapability
  usingCustom: boolean
} {
  const providerId = input.settingProviderId || input.customProviderId
  const provider = input.providers.find((item) => item.id === providerId)
  return {
    providerId,
    provider,
    capability: provider?.[input.capabilityKey],
    usingCustom: providerId === input.customProviderId || !provider
  }
}

export function renderProviderRow(input: {
  t: (key: string, values?: Record<string, unknown>) => string
  selectControlClass: string
  title: string
  description: string
  providers: ProviderProfile[]
  selected: ReturnType<typeof selectedProviderState>
  capabilityKey: 'textToSpeech' | 'music' | 'video'
  customProviderId: string
  customLabel: string
  missingKeyKey: string
  setting: { baseUrl: string; apiKey: string; protocol: string; model: string }
  defaultProtocol: string
  connectionCredentials: SharedConnectionCredentialState[] | null
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  const warnMissingKey = shouldWarnMissingProviderCredential({
    usingCustomProvider: input.selected.usingCustom,
    provider: input.selected.provider,
    connectionCredentials: input.connectionCredentials
  })
  return (
    <SettingRow
      title={input.title}
      description={input.description}
      control={
        <div className="w-full min-w-0 md:max-w-md">
          <select
            className={input.selectControlClass}
            value={input.selected.usingCustom ? input.customProviderId : input.selected.providerId}
            onChange={(e) => {
              const providerId = e.target.value
              const nextProvider = input.providers.find((item) => item.id === providerId)
              const capability = nextProvider?.[input.capabilityKey]
              input.update({
                providerId,
                baseUrl: providerId === input.customProviderId ? input.setting.baseUrl : '',
                apiKey: providerId === input.customProviderId ? input.setting.apiKey : '',
                protocol: providerId === input.customProviderId
                  ? input.setting.protocol
                  : capability?.protocol ?? input.defaultProtocol,
                model: providerId === input.customProviderId
                  ? input.setting.model
                  : preferredProviderCapabilityModel(capability, input.capabilityKey)
              })
            }}
          >
            {input.providers.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
            <option value={input.customProviderId}>{input.customLabel}</option>
          </select>
          {warnMissingKey ? (
            <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
              {input.t(input.missingKeyKey, {
                provider: input.selected.provider?.name ?? input.selected.providerId
              })}
            </p>
          ) : null}
        </div>
      }
    />
  )
}

export function preferredProviderCapabilityModel(
  capability: ProviderCapability | undefined,
  capabilityKey: 'textToSpeech' | 'music' | 'video'
): string {
  if (
    capabilityKey === 'video' &&
    capability?.protocol === 'grok-imagine-video' &&
    capability.models.includes('grok-imagine-video-1.5-preview')
  ) {
    return 'grok-imagine-video-1.5-preview'
  }
  return capability?.models?.[0] ?? ''
}

export function renderBaseUrlRow(
  t: (key: string) => string,
  prefix: string,
  value: string,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(`${prefix}BaseUrl`)}
      description={t(`${prefix}BaseUrlDesc`)}
      control={
        <input
          className={`${inputClass} md:max-w-md`}
          value={value}
          placeholder={t(`${prefix}BaseUrlPlaceholder`)}
          onChange={(e) => update({ baseUrl: e.target.value })}
        />
      }
    />
  )
}

export function renderApiKeyRow(input: {
  t: (key: string) => string
  prefix: string
  value: string
  visible: boolean
  setVisible: (value: boolean | ((prev: boolean) => boolean)) => void
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  return (
    <SettingRow
      title={input.t(`${input.prefix}ApiKey`)}
      description={input.t(`${input.prefix}ApiKeyDesc`)}
      control={
        <SecretInput
          value={input.value}
          onChange={(value) => input.update({ apiKey: value })}
          visible={input.visible}
          onToggleVisibility={() => input.setVisible((value) => !value)}
          autoComplete="off"
          showLabel={input.t('showSecret')}
          hideLabel={input.t('hideSecret')}
          className="md:max-w-md"
        />
      }
    />
  )
}

export function renderModelRow(input: {
  t: (key: string, values?: Record<string, unknown>) => string
  selectControlClass: string
  prefix: string
  usingCustom: boolean
  model: string
  options: string[]
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  return (
    <SettingRow
      title={input.t(`${input.prefix}Model`)}
      description={input.t(`${input.prefix}ModelDesc`)}
      control={
        <div className="w-full min-w-0 md:max-w-md">
          {input.usingCustom ? (
            <input
              className={inputClass}
              value={input.model}
              placeholder={input.t(`${input.prefix}ModelPlaceholder`)}
              onChange={(e) => input.update({ model: e.target.value })}
            />
          ) : (
            <ModelSelect
              value={input.options.includes(input.model) ? input.model : ''}
              options={input.options}
              defaultLabel={input.t('modelSelectDefaultOption', {
                model: input.options[0] ?? ''
              })}
              selectClassName={input.selectControlClass}
              onChange={(model) => input.update({ model })}
            />
          )}
        </div>
      }
    />
  )
}

export function renderAudioFormatRow(
  t: (key: string) => string,
  titleKey: string,
  value: string,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(titleKey)}
      description={t(`${titleKey}Desc`)}
      control={
        <select
          className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
          value={value}
          onChange={(e) => update({ format: e.target.value })}
        >
          {AUDIO_FORMATS.map((format) => (
            <option key={format} value={format}>{format}</option>
          ))}
        </select>
      }
    />
  )
}

export function renderTimeoutRow(
  t: (key: string) => string,
  titleKey: string,
  value: number,
  min: number,
  max: number,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(titleKey)}
      description={t(`${titleKey}Desc`)}
      control={
        <input
          type="number"
          min={min}
          max={max}
          step={10000}
          className={compactInputClass}
          value={value}
          onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
        />
      }
    />
  )
}

export function textToSpeechProtocolLabel(
  t: (key: string) => string,
  protocol: string
): string {
  if (protocol === 'deepseek-tts') return t('textToSpeechProtocolDeepSeek')
  if (protocol === 'minimax-t2a') return t('textToSpeechProtocolMiniMax')
  if (protocol === 'mimo-tts') return t('textToSpeechProtocolMimo')
  return t('textToSpeechProtocolOpenAi')
}

export function videoGenerationProtocolLabel(
  t: (key: string) => string,
  protocol: string
): string {
  if (protocol === 'volcengine-ark-video') return t('videoGenerationProtocolVolcengineArk')
  return protocol === 'grok-imagine-video'
    ? t('videoGenerationProtocolGrok')
    : t('videoGenerationProtocolMiniMax')
}
