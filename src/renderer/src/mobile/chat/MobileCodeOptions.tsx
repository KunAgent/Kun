import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ChatState } from '../../store/chat-store-types'
import { MobileSheet } from '../sheets/MobileSheet'
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
  const providerForModel = (value: string): string =>
    groups.find((group) => group.modelIds.includes(value))?.providerId ?? ''
  const modeLabels: Record<(typeof MODES)[number], string> = {
    auto: t('autoLabel'), agent: t('agentMode'), plan: t('planMode')
  }
  const reasoningLabels: Record<(typeof REASONING)[number], string> = {
    auto: t('composerReasoningAuto'), off: t('composerReasoningOff'), low: t('composerReasoningLow'),
    medium: t('composerReasoningMedium'), high: t('composerReasoningHigh'), max: t('composerReasoningMax')
  }
  return <MobileSheet open={open} title={t('composerModelControls')} closeLabel={t('close')} onClose={onClose}>
    <div className="kun-mobile-code-options">
      <fieldset><legend>{t('mode')}</legend>
        {MODES.map((value) => <button key={value} type="button"
          aria-pressed={mode === value} onClick={() => onMode(value)}>{modeLabels[value]}</button>)}</fieldset>
      <label>{t('composerModel')}<select value={model} onChange={(event) => onModel(event.target.value, providerForModel(event.target.value))}>
        {!model ? <option value="">{t('autoLabel')}</option> : null}
        {models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>{t('composerReasoning')}<select value={reasoning ?? 'auto'}
        onChange={(event) => onReasoning(event.target.value as ChatState['composerReasoningEffort'])}>
        {REASONING.map((value) => <option key={value} value={value}>{reasoningLabels[value]}</option>)}
      </select></label>
      {providerId ? <p>{providerId}</p> : null}
    </div>
  </MobileSheet>
}
