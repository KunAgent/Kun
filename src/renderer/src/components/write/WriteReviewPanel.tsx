import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Crosshair } from 'lucide-react'
import { useWriteEditorBridge, type WriteReviewChunkSummary } from '../../write/write-editor-bridge'
import { WriteRightPanelEmpty, WriteRightPanelHeader } from './WriteRightPanelHeader'

const KIND_KEYS: Record<WriteReviewChunkSummary['kind'], string> = {
  added: 'workReviewAdded',
  removed: 'workReviewRemoved',
  modified: 'workReviewModified'
}

export function WriteReviewPanel({ onCollapse }: { onCollapse: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const { chunks, commands } = useWriteEditorBridge(useShallow((state) => ({
    chunks: state.reviewChunks,
    commands: state.commands
  })))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WriteRightPanelHeader id="review" onCollapse={onCollapse} />
      {chunks.length === 0 || !commands ? (
        <WriteRightPanelEmpty>{t('workReviewEmpty')}</WriteRightPanelEmpty>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
            <div className="text-[12px] text-ds-faint">{t('workReviewSummary', { count: chunks.length })}</div>
            {chunks.map((chunk, index) => (
              <section key={chunk.id} className="write-review-card">
                <div className="flex items-center gap-2 border-b border-ds-border-muted px-3 py-2.5">
                  <span className="flex-1 text-[12.5px] font-semibold text-ds-ink">
                    {index + 1} · {t(KIND_KEYS[chunk.kind])}
                  </span>
                  <button
                    type="button"
                    onClick={() => commands.focusChunk(index)}
                    className="write-panel-icon-button h-6 w-6"
                    aria-label={t('workReviewLocate')}
                    title={t('workReviewLocate')}
                  >
                    <Crosshair className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
                {chunk.kind !== 'added' && chunk.before ? (
                  <p className="write-review-text is-removed">{chunk.before}</p>
                ) : null}
                {chunk.kind !== 'removed' && chunk.after ? (
                  <p className="write-review-text is-added">{chunk.after}</p>
                ) : null}
                <div className="flex justify-end gap-1.5 px-2.5 py-2">
                  <button type="button" className="write-review-button" onClick={() => commands.resolveChunk(chunk.id, 'reject')}>
                    {t('workReviewReject')}
                  </button>
                  <button type="button" className="write-review-button is-strong" onClick={() => commands.resolveChunk(chunk.id, 'accept')}>
                    {t('workReviewAccept')}
                  </button>
                </div>
              </section>
            ))}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-ds-border-muted px-3.5 pb-3.5 pt-3">
            <button type="button" className="write-review-footer-button" onClick={() => commands.resolveAll('reject')}>
              {t('writeDiffRejectAll')}
            </button>
            <button type="button" className="write-review-footer-button is-primary" onClick={() => commands.resolveAll('accept')}>
              {t('writeDiffAcceptAll')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
