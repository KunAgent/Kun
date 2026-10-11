import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { WriteQuotedSelection } from '../../write/quoted-selection'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { WriteRightPanelEmpty, WriteRightPanelHeader } from './WriteRightPanelHeader'

function quoteLocation(quote: WriteQuotedSelection, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (quote.pageStart) return t('workReferencesPage', { page: quote.pageStart })
  if (quote.sheetName) return quote.cellRange ? `${quote.sheetName} · ${quote.cellRange}` : quote.sheetName
  if (quote.lineStart) {
    return t('workReferencesLines', { start: quote.lineStart, end: quote.lineEnd ?? quote.lineStart })
  }
  return ''
}

export function WriteReferencesPanel({ onCollapse }: { onCollapse: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const { quotes, workspaceRoot, openFile, removeQuote, clearQuotes } = useWriteWorkspaceStore(
    useShallow((state) => ({
      quotes: state.quotedSelections,
      workspaceRoot: state.workspaceRoot,
      openFile: state.openFile,
      removeQuote: state.removeQuotedSelection,
      clearQuotes: state.clearQuotedSelections
    }))
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WriteRightPanelHeader
        id="references"
        onCollapse={onCollapse}
        actions={quotes.length > 0 ? (
          <button type="button" onClick={clearQuotes} className="write-panel-text-button">
            {t('workReferencesClear')}
          </button>
        ) : null}
      />
      {quotes.length === 0 ? (
        <WriteRightPanelEmpty>{t('workReferencesEmpty')}</WriteRightPanelEmpty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3.5">
          <h3 className="m-0 text-[11.5px] font-semibold tracking-[0.02em] text-ds-faint">
            {t('workReferencesSelections')}
          </h3>
          {quotes.map((quote) => {
            const location = quoteLocation(quote, t)
            const source = quote.sourceTitle || writeBasenameFromPath(quote.sourceFilePath)
            return (
              <div key={quote.id} className="write-reference-card group">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-1.5 text-left"
                  onClick={() => void openFile(workspaceRoot, quote.sourceFilePath)}
                >
                  <span className="write-reference-text">{quote.text}</span>
                  <span className="truncate text-[11.5px] text-ds-faint">
                    {location ? `${source} · ${location}` : source}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeQuote(quote.id)}
                  className="write-panel-icon-button h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t('workReferencesRemove')}
                  title={t('workReferencesRemove')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
