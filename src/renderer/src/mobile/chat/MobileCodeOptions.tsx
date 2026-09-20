import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ChatState } from '../../store/chat-store-types'
import { MobileSheet } from '../sheets/MobileSheet'
import './mobile-code-options.css'

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
  return <MobileSheet open={open} title={t('composerSettings')} closeLabel={t('close')} onClose={onClose}>
    <div className="kun-mobile-code-options">
      <fieldset><legend>{t('mode')}</legend>
        {(['auto', 'agent', 'plan'] as const).map((value) => <button key={value} type="button"
          aria-pressed={mode === value} onClick={() => onMode(value)}>{value}</button>)}</fieldset>
      <label>{t('model')}<select value={model} onChange={(event) => onModel(event.target.value, providerForModel(event.target.value))}>
        {!model ? <option value="">{t('auto')}</option> : null}
        {models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>{t('composerReasoning')}<select value={reasoning ?? 'auto'}
        onChange={(event) => onReasoning(event.target.value as ChatState['composerReasoningEffort'])}>
        {['auto', 'off', 'low', 'medium', 'high', 'max'].map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      {providerId ? <p>{providerId}</p> : null}
    </div>
  </MobileSheet>
}
