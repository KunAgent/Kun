import { GitFork, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMobileMessageActionsStore } from '../../stores/mobile-message-actions'
import {
  AssistantExportButton,
  CopyFeedbackButton
} from '../../components/chat/message-timeline-bubble-support'
import { AssistantSpeakButton } from '../../components/chat/AssistantSpeakButton'
import { AssistantSpeakTrackButton } from '../../components/chat/AssistantSpeakTrackButton'
import { TurnUsageRow } from '../../components/chat/TurnUsageRow'
import { MobileSheet } from '../sheets/MobileSheet'

/**
 * Bottom sheet with the message actions a phone cannot reach through the
 * desktop hover row. Rows reuse the shared action components so copy/speak/
 * export behave identically to desktop; empty rows hide themselves when a
 * capability (speak) is unavailable on Remote.
 */
export function MobileMessageActionsSheet(): React.JSX.Element {
  const { t } = useTranslation('common')
  const payload = useMobileMessageActionsStore((s) => s.payload)
  const close = useMobileMessageActionsStore((s) => s.close)
  const block = payload?.block ?? null
  const isAssistant = block?.kind === 'assistant'
  const blockText = block && 'text' in block ? block.text : ''

  return (
    <MobileSheet
      open={payload !== null}
      title={t('mobileMessageActions')}
      closeLabel={t('close')}
      onClose={close}
    >
      {block ? (
        <ul className="kun-mobile-action-list">
          <li><CopyFeedbackButton text={blockText} /></li>
          {payload?.forkAction ? (
            <li>
              <button
                type="button"
                disabled={payload.forkAction.busy}
                onClick={() => {
                  close()
                  payload.forkAction?.onFork()
                }}
              >
                <GitFork size={18} aria-hidden />
                {payload.forkAction.busy ? t('forkingThread') : t('forkResponse')}
              </button>
            </li>
          ) : null}
          {payload?.rollbackAction ? (
            <li>
              <button
                type="button"
                data-variant="danger"
                disabled={payload.rollbackAction.busy}
                onClick={() => {
                  close()
                  payload.rollbackAction?.onRollback()
                }}
              >
                <RotateCcw size={18} aria-hidden />
                {payload.rollbackAction.busy ? t('rollingBackWorkspace') : t('rollbackWorkspace')}
              </button>
            </li>
          ) : null}
          {isAssistant ? (
            <>
              <li><AssistantSpeakButton blockId={block.id} text={block.text} /></li>
              <li><AssistantSpeakTrackButton text={block.text} createdAt={block.createdAt} /></li>
              <li><AssistantExportButton text={block.text} createdAt={block.createdAt} /></li>
            </>
          ) : null}
        </ul>
      ) : null}
      {block && payload?.turnUsage ? (
        <div className="kun-mobile-usage-row">
          <TurnUsageRow usage={payload.turnUsage} stale={payload.turnUsageStale ?? false} />
        </div>
      ) : null}
    </MobileSheet>
  )
}
