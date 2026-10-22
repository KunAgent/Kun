import type { ReactElement } from 'react'
import type {
  KunLabSettingsPatchV1,
  KunLabSettingsV1,
  ModelReasoningEffort,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  MODEL_REASONING_EFFORTS
} from '@shared/app-settings'
import { modelProviderModelProfile } from '@shared/app-settings-provider-core'
import { Presentation } from 'lucide-react'
import {
  ModelSelect,
  SettingRow,
  Toggle
} from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'
import { composerSupportsCodexFastMode } from './chat/composer-fast-mode'
import { useChatStore } from '../store/chat-store'

type Translate = (key: string) => string

const REASONING_EFFORT_LABEL_KEYS: Record<ModelReasoningEffort, string> = {
  auto: 'graphSettingsReasoningAuto',
  off: 'graphSettingsReasoningOff',
  low: 'graphSettingsReasoningLow',
  medium: 'graphSettingsReasoningMedium',
  high: 'graphSettingsReasoningHigh',
  max: 'graphSettingsReasoningMax'
}

function reasoningEffortsForModel(
  provider: ModelProviderProfileV1 | undefined,
  model: string
): ModelReasoningEffort[] {
  if (!provider) return [...MODEL_REASONING_EFFORTS]
  const supported = modelProviderModelProfile(provider, model)?.reasoning?.supportedEfforts
  return supported && supported.length > 0
    ? supported
    : [...MODEL_REASONING_EFFORTS]
}

function compatibleReasoningEffort(
  provider: ModelProviderProfileV1 | undefined,
  model: string,
  current: ModelReasoningEffort | undefined
): ModelReasoningEffort | undefined {
  if (!current || !provider) return current
  const reasoning = modelProviderModelProfile(provider, model)?.reasoning
  if (!reasoning || reasoning.supportedEfforts.includes(current)) return current
  return reasoning.defaultEffort
}

/**
 * Lab → PPT 代理 panel. Configures the first-class `ppt_agent` tool:
 * a master switch plus an optional model/provider/reasoning/fast override.
 * Empty model + providerId means "follow the main session model".
 */
export function PptAgentSettingsPanel({
  t,
  value,
  modelProviders,
  leadProviderId,
  leadModel,
  imageGen,
  selectControlClass,
  onChange
}: {
  t: Translate
  value: KunLabSettingsV1
  modelProviders: ModelProviderProfileV1[]
  leadProviderId: string
  leadModel: string
  imageGen?: { available: boolean; reason?: string; supportsReferenceEdit?: boolean }
  selectControlClass: string
  onChange: (patch: KunLabSettingsPatchV1) => void
}): ReactElement {
  const agent = value.pptAgent
  const imageAssets = agent.imageAssets !== false
  const fixed =Boolean(agent.model?.trim() && agent.providerId?.trim())
  const providerId = fixed ? agent.providerId : leadProviderId
  const provider = modelProviders.find((candidate) => candidate.id === providerId) ?? modelProviders[0]
  const model = fixed ? agent.model : leadModel
  const reasoningEfforts = reasoningEffortsForModel(provider, model)
  const composerModelGroups = useChatStore((s) => s.composerModelGroups)
  const fastSupported = composerSupportsCodexFastMode(composerModelGroups, model, providerId)

  return (
    <SettingsFeatureCard
      icon={Presentation}
      tone="orange"
      title={t('labPptTitle')}
      description={t('labPptDescription')}
      enabled={agent.enabled}
      onEnabledChange={(enabled) => onChange({ pptAgent: { enabled } })}
      toggleLabel={t('labPptEnabled')}
      enabledLabel={t('settingsIaFeatureOn')}
    >
      <SettingRow
        title={t('labPptImageAssets')}
        description={t('labPptImageAssetsDesc')}
        control={
          <Toggle
            checked={imageAssets}
            onChange={(next) => onChange({ pptAgent: { imageAssets: next } })}
          />
        }
      />
      <div className="px-3 pb-3">
        <p className={`text-[12px] leading-5 ${imageAssets && imageGen?.available ? 'text-emerald-700 dark:text-emerald-200' : 'text-ds-faint'}`}>
          {!imageAssets
            ? t('labPptImageAssetsOffHint')
            : imageGen?.available
              ? t('labPptImageAssetsReadyHint')
              : `${t('labPptImageAssetsUnavailableHint')}${imageGen?.reason ? ` ${imageGen.reason}` : ''}`}
        </p>
      </div>
      <SettingRow
        title={t('labPptPreviewRenderer')}
        description={t('labPptPreviewRendererDesc')}
        control={
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
            {t('labPptPreviewRendererBuiltIn')}
          </span>
        }
      />
      <SettingRow
        title={t('labPptModelMode')}
        description={t('labPptModelModeDesc')}
        control={
          <select
            className={selectControlClass}
            value={fixed ? 'fixed' : 'inherit'}
            onChange={(event) => {
              if (event.target.value === 'inherit') {
                onChange({
                  pptAgent: {
                    model: '',
                    providerId: '',
                    reasoningEffort: undefined,
                    fast: false
                  }
                })
                return
              }
              const providerId = provider?.id || leadProviderId
              const model = (provider?.models ?? []).includes(leadModel)
                ? leadModel
                : provider?.models?.[0] ?? leadModel
              onChange({
                pptAgent: {
                  model,
                  providerId,
                  reasoningEffort: undefined,
                  fast: false
                }
              })
            }}
          >
            <option value="inherit">{t('labPptModelModeInherit')}</option>
            <option value="fixed">{t('labPptModelModeFixed')}</option>
          </select>
        }
      />
      {fixed ? (
        <SettingRow
          title={t('labPptModel')}
          description={t('labPptModelDesc')}
          wideControl
          control={
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                aria-label={t('labPptProvider')}
                className={selectControlClass}
                value={provider?.id ?? providerId}
                onChange={(event) => {
                  const nextProviderId = event.target.value
                  const nextProvider = modelProviders.find((item) => item.id === nextProviderId)
                  const nextModel = nextProvider?.models?.includes(model)
                    ? model
                    : nextProvider?.models?.[0] ?? model
                  onChange({
                    pptAgent: {
                      model: nextModel,
                      providerId: nextProviderId,
                      reasoningEffort: compatibleReasoningEffort(
                        nextProvider,
                        nextModel,
                        agent.reasoningEffort
                      )
                    }
                  })
                }}
              >
                {modelProviders.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <ModelSelect
                value={model}
                options={provider?.models ?? []}
                allowCustom
                customLabel={t('modelSelectCustomOption')}
                customPlaceholder={t('modelSelectCustomPlaceholder')}
                selectClassName={selectControlClass}
                onChange={(nextModel) => {
                  const trimmed = nextModel.trim()
                  onChange({
                    pptAgent: {
                      model: trimmed || model,
                      providerId: provider?.id ?? providerId,
                      reasoningEffort: compatibleReasoningEffort(
                        provider,
                        trimmed || model,
                        agent.reasoningEffort
                      )
                    }
                  })
                }}
              />
            </div>
          }
        />
      ) : null}
      {fixed ? (
        <SettingRow
          title={t('labPptReasoning')}
          description={t('labPptReasoningDesc')}
          control={
            <select
              aria-label={t('labPptReasoning')}
              className={selectControlClass}
              value={agent.reasoningEffort ?? ''}
              onChange={(event) => onChange({
                pptAgent: {
                  reasoningEffort: event.target.value
                    ? event.target.value as ModelReasoningEffort
                    : undefined
                }
              })}
            >
              <option value="">{t('labPptReasoningInherit')}</option>
              {reasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {t(REASONING_EFFORT_LABEL_KEYS[effort])}
                </option>
              ))}
            </select>
          }
        />
      ) : null}
      {fixed ? (
        <SettingRow
          title={t('labPptFast')}
          description={t('labPptFastDesc')}
          control={
            <Toggle
              checked={agent.fast === true && fastSupported}
              disabled={!fastSupported}
              onChange={(fast) => onChange({ pptAgent: { fast } })}
            />
          }
        />
      ) : null}
      {fixed && !fastSupported ? (
        <div className="px-3 pb-3">
          <p className="text-[12px] leading-5 text-ds-faint">
            {t('labPptFastUnsupportedHint')}
          </p>
        </div>
      ) : null}
    </SettingsFeatureCard>
  )
}
