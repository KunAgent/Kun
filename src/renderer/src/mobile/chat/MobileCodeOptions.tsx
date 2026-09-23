import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ChatState } from '../../store/chat-store-types'
import { MobileSheet } from '../sheets/MobileSheet'
import { MobileModelSelect } from './MobileModelSelect'
import './mobile-code-options.css'

const MODES = ['auto', 'agent', 'plan'] as const
const REASONING = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const

export function MobileCodeOptions({ open, onClose, model, providerId, models, groups, mode,
  reasoning, onModel, onMode, onReasoning }: {
  open: boolean
  onClose: () => void
  model: string
  providerId: string
  models: string[]
  groups: ModelProviderModelGroup[]
  mode: ChatState['composerMode']
  reasoning: ChatState['composerReasoningEffort']
  onModel: ChatState['setComposerModel']
  onMode: ChatState['setComposerMode']
  onReasoning: ChatState['setComposerReasoningEffort']
}) {
  const { t } = useTranslation('common')
  const providerLabel = providerId
    ? groups.find((group) => group.providerId === providerId)?.label || providerId
    : ''
  const modeLabels: Record<(typeof MODES)[number], string> = {
    auto: t('autoLabel'), agent: t('agentMode'), plan: t('planMode')
  }
  const reasoningLabels: Record<(typeof REASONING)[number], string> = {
    auto: t('composerReasoningAuto'), off: t('composerReasoningOff'), low: t('composerReasoningLow'),
    medium: t('composerReasoningMedium'), high: t('composerReasoningHigh'), max: t('composerReasoningMax')
  }
  return <MobileSheet open={open} title={t('composerModelControls')} closeLabel={t('close')} onClose={onClose}>
    <div className="kun-mobile-form">
      <fieldset className="kun-mobile-field">
        <legend>{t('mode')}</legend>
        <div className="kun-mobile-segmented" role="group" aria-label={t('mode')}>
          {MODES.map((value) => (
            <button key={value} type="button"
              aria-pressed={mode === value} onClick={() => onMode(value)}>{modeLabels[value]}</button>
          ))}
        </div>
      </fieldset>
      <label className="kun-mobile-field">{t('composerModel')}
        <MobileModelSelect
          value={model}
          groups={groups}
          fallbackIds={models}
          autoLabel={t('autoLabel')}
          onChange={(value, provider) => onModel(value, provider)}
        />
      </label>
      {model ? (
        <p className="kun-mobile-hint">
          {t('mobileOptionsCurrent', { provider: providerLabel || t('autoLabel'), model })}
        </p>
      ) : null}
      <fieldset className="kun-mobile-field">
        <legend>{t('composerReasoning')}</legend>
        <div className="kun-mobile-chip-grid" role="group" aria-label={t('composerReasoning')}>
          {REASONING.map((value) => (
            <button key={value} type="button"
              aria-pressed={(reasoning ?? 'auto') === value}
              onClick={() => onReasoning(value)}>{reasoningLabels[value]}</button>
          ))}
        </div>
      </fieldset>
    </div>
  </MobileSheet>
}
