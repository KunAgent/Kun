import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModelBinding } from '@shared/rooms-api'

/** Keep the full model discoverable while the toolbar adapts to narrow panels. */
export function RoomComposerModelButton({ model, onClick }: {
  model?: AgentModelBinding; onClick: () => void
}) {
  const { t } = useTranslation('common')
  const label = model?.model || t('directChooseModel')
  const detail = [model?.providerId, model?.accountId, model?.model].filter(Boolean).join(' / ')
  return <button type="button" className="rooms-composer-model" onClick={onClick}
    aria-label={`${t('directModels')}: ${label}`} title={detail || t('directModels')}>
    <span>{label}</span><ChevronDown size={14} aria-hidden="true" />
  </button>
}
