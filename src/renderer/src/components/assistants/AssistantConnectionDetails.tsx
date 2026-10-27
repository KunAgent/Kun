import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AssistantView } from '@shared/assistant-mailbox'
import { RoomPopover } from '../rooms/RoomPopover'
import { relativeTime } from './assistant-format'

/** Diagnostics state is separate from task execution and model availability. */
export function AssistantConnectionDetails({ assistant }: { assistant: AssistantView }) {
  const { t, i18n } = useTranslation('common')
  const p = assistant.presence
  return <RoomPopover label={t('assistantConnectionDetails')} trigger={<Info size={16} />} align="end" width={290} className="rooms-icon-button">
    {() => <div className="flex flex-col gap-2 p-3 text-[12px] leading-5 text-ds-muted">
      <h3 className="text-[13px] font-semibold text-ds-ink">{t('assistantConnectionDetails')}</h3>
      {p ? <>
        <p>{t('assistantSyncState', { state: t(`assistantSyncState_${p.syncState}`) })}</p>
        <p>{t(p.listening ? 'assistantConsumerListening' : 'assistantConsumerNotListening')}</p>
        <p>{t('assistantPresenceProgram', { version: p.agentVersion, platform: p.platform })}</p>
        <p>{t('assistantPresenceInstance', { id: p.instanceId })}</p>
        <p>{t('assistantPresenceReported', { time: relativeTime(p.reportedAt, i18n.language || 'en') })}</p>
        {p.lastConsumerAt ? <p>{t('assistantPresenceConsumed', { time: relativeTime(p.lastConsumerAt, i18n.language || 'en') })}</p> : null}
        {p.lastError ? <p role="status">{t('assistantPresenceError', { code: p.lastError })}</p> : null}
      </> : <p>{t(assistant.presenceUnavailable ? 'assistantPresenceSyncUnavailable' : 'assistantPresenceUnavailable')}</p>}
      <p>{t('assistantPresencePending', { count: assistant.pendingToAssistant })}</p>
      <p>{t('assistantPresencePendingHost', { count: assistant.pendingToHost })}</p>
      <p>{t('assistantPresenceNotExecution')}</p>
    </div>}
  </RoomPopover>
}
