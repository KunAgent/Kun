import type { ReactElement } from 'react'
import type {
  KunFastContextSettingsV1,
  ModelReasoningEffort,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  MODEL_REASONING_EFFORTS
} from '@shared/app-settings'
import { modelProviderModelProfile } from '@shared/app-settings-provider-core'
import {
  InlineNoticeView,
  ModelSelect,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
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
 * Fast Context settings panel. Configures the first-class `fast_context` tool:
 * a master switch plus an optional model/provider/reasoning/fast override.
 * Empty model + providerId means "follow the main session model".
 */
export function FastContextSettingsPanel({
  t,
  value,
  modelProviders,
  leadProviderId,
  leadModel,
  selectControlClass,
  onChange
}: {
  t: Translate
  value: KunFastContextSettingsV1
  modelProviders: ModelProviderProfileV1[]
  leadProviderId: string
  leadModel: string
  selectControlClass: string
  onChange: (patch: Partial<KunFastContextSettingsV1>) => void
}): ReactElement {
  const agent = value
  const fixed = Boolean(agent.model?.trim() && agent.providerId?.trim())
  const providerId = fixed ? agent.providerId : leadProviderId
  const provider = modelProviders.find((candidate) => candidate.id === providerId) ?? modelProviders[0]
  const model = fixed ? agent.model : leadModel
  const reasoningEfforts = reasoningEffortsForModel(provider, model)
  const composerModelGroups = useChatStore((s) => s.composerModelGroups)
  const fastSupported = composerSupportsCodexFastMode(composerModelGroups, model, providerId)

  return (
    <div className="mt-6">
      <SettingsCard title={t('fastContextTitle')}>
        <div className="space-y-3 px-3 py-4">
          <InlineNoticeView notice={{ tone: 'info', message: t('fastContextDescription') }} />
        </div>
        <SettingRow
          title={t('fastContextEnabled')}
          description={t('fastContextEnabledDesc')}
          control={
            <Toggle
              checked={agent.enabled}
              onChange={(enabled) => onChange({ enabled })}
            />
          }
        />
        {agent.enabled ? (
          <>
            <SettingRow
              title={t('fastContextModelMode')}
              description={t('fastContextModelModeDesc')}
              control={
                <select
                  className={selectControlClass}
                  value={fixed ? 'fixed' : 'inherit'}
                  onChange={(event) => {
                    if (event.target.value === 'inherit') {
                      onChange({
                        model: '',
                        providerId: '',
                        reasoningEffort: undefined,
                        fast: false
                      })
                      return
                    }
                    const providerId = provider?.id || leadProviderId
                    const model = (provider?.models ?? []).includes(leadModel)
                      ? leadModel
                      : provider?.models?.[0] ?? leadModel
                    onChange({
                      model,
                      providerId,
                      reasoningEffort: undefined,
                      fast: false
                    })
                  }}
                >
                  <option value="inherit">{t('fastContextModelModeInherit')}</option>
                  <option value="fixed">{t('fastContextModelModeFixed')}</option>
                </select>
              }
            />
            {fixed ? (
              <SettingRow
                title={t('fastContextModel')}
                description={t('fastContextModelDesc')}
                wideControl
                control={
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select
                      aria-label={t('fastContextProvider')}
                      className={selectControlClass}
                      value={provider?.id ?? providerId}
                      onChange={(event) => {
                        const nextProviderId = event.target.value
                        const nextProvider = modelProviders.find((item) => item.id === nextProviderId)
                        const nextModel = nextProvider?.models?.includes(model)
                          ? model
                          : nextProvider?.models?.[0] ?? model
                        onChange({
                          model: nextModel,
                          providerId: nextProviderId,
                          reasoningEffort: compatibleReasoningEffort(
                            nextProvider,
                            nextModel,
                            agent.reasoningEffort
                          )
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
                          model: trimmed || model,
                          providerId: provider?.id ?? providerId,
                          reasoningEffort: compatibleReasoningEffort(
                            provider,
                            trimmed || model,
                            agent.reasoningEffort
                          )
                        })
                      }}
                    />
                  </div>
                }
              />
            ) : null}
            {fixed ? (
              <SettingRow
                title={t('fastContextReasoning')}
                description={t('fastContextReasoningDesc')}
                control={
                  <select
                    aria-label={t('fastContextReasoning')}
                    className={selectControlClass}
                    value={agent.reasoningEffort ?? ''}
                    onChange={(event) => onChange({
                      reasoningEffort: event.target.value
                        ? event.target.value as ModelReasoningEffort
                        : undefined
                    })}
                  >
                    <option value="">{t('fastContextReasoningInherit')}</option>
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
                title={t('fastContextFast')}
                description={t('fastContextFastDesc')}
                control={
                  <Toggle
                    checked={agent.fast === true && fastSupported}
                    disabled={!fastSupported}
                    onChange={(fast) => onChange({ fast })}
                  />
                }
              />
            ) : null}
            {fixed && !fastSupported ? (
              <div className="px-3 pb-3">
                <p className="text-[12px] leading-5 text-ds-faint">
                  {t('fastContextFastUnsupportedHint')}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </SettingsCard>
    </div>
  )
}
