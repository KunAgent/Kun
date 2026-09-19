import { SourceHistoryRecordViewer } from './SourceHistoryRecordViewer'
import { SourceHistoryAttachments } from './SourceHistoryAttachments'
import { useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ConversationTurn } from '../components/chat/message-timeline-conversation-turn'
import { groupTurns } from '../components/chat/message-timeline-turns'
import { mergeChatBlocks } from '../agent/kun-mapper'
import { historyBlocks, type HistoryPage } from './history-reference-api'

export function SourceHistoryPreview({ page, workspace, loading, onMore }: {
  page: HistoryPage; workspace: string; loading: boolean; onMore: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const viewportRef = useRef<HTMLDivElement>(null)
  return <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-ds-border-muted p-4">
    {page.hasMore ? <button type="button" onClick={onMore} disabled={loading}
      className="ds-chip mb-4 rounded-lg px-3 py-2 text-sm">{t('codexHistoryMore')}</button> : null}
    {groupTurns(mergeChatBlocks(page.turns.flatMap(historyBlocks))).map((turn, index) =>
      <div key={turn.turnId ?? index} className="mb-6">
        <ConversationTurn turn={turn} isProcessing={false} live="" liveReasoning=""
          filePreviewWorkspaceRoot={workspace} viewportRef={viewportRef}
          allowMainThreadActions={false} allowRecoveryContinue={false} compactCards />
        <SourceHistoryRecordViewer blocks={turn.user ? [turn.user, ...turn.blocks] : turn.blocks} />
        <SourceHistoryAttachments blocks={turn.user ? [turn.user, ...turn.blocks] : turn.blocks} />
      </div>)}
  </div>
}
