import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { FileText, ListTodo, MessageSquareQuote } from 'lucide-react'
import { WritePaperAssistantActions } from './WritePaperAssistantActions'
import { WorkKunAvatar } from './WorkHomeEmptyState'

/** The docked assistant before the first message: Kun plus three quick asks. */
export function WriteAssistantEmptyState({
  papersSurface,
  paperContextLabel,
  activeFileLabel,
  selectionCharCount,
  selectionIsSpreadsheet,
  selectionActionLabel,
  selectionActionDescription,
  setAssistantPrompt,
  quoteSelectionForAssistant,
  t
}: {
  papersSurface: boolean
  paperContextLabel: string | null
  activeFileLabel: string
  selectionCharCount: number
  selectionIsSpreadsheet: boolean
  selectionActionLabel: string
  selectionActionDescription: string
  setAssistantPrompt: (prompt: string) => void
  quoteSelectionForAssistant: () => void
  t: TFunction
}): ReactElement {
  const selection = { charCount: selectionCharCount }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-5">
      <div className="write-assistant-ready flex flex-col items-center px-3 pb-8 pt-12 text-center">
        <WorkKunAvatar variant={papersSurface ? 'researcher' : 'writer'} size={56} />
        <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.025em] text-ds-ink">
          {t('writeAssistantEmptyTitle')}
        </h3>
        <p className="mt-2 max-w-[270px] text-[12.5px] leading-5 text-ds-muted">
          {t('writeAssistantEmptySub')}
        </p>
      </div>

      <div className="write-assistant-actions mt-auto overflow-hidden border-y border-ds-border-muted">
        {papersSurface ? (
          <WritePaperAssistantActions
            paperTitle={paperContextLabel ?? ''}
            selectionIsSpreadsheet={selectionIsSpreadsheet}
            selectionActionLabel={selectionActionLabel}
            selectionActionDescription={selectionActionDescription}
            selectionCharCount={selection.charCount}
            onSetPrompt={setAssistantPrompt}
            onQuoteSelection={quoteSelectionForAssistant}
            t={t}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAssistantPrompt(t('writeAssistantSummarizePrompt', { file: activeFileLabel }))}
              className="write-assistant-action-row"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                <FileText className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantSummarize')}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantSummarizeSub')}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAssistantPrompt(t('writeAssistantOutlinePrompt', { file: activeFileLabel }))}
              className="write-assistant-action-row border-t border-ds-border-muted"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <ListTodo className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantOutline')}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantOutlineSub')}</span>
              </span>
            </button>
            {!selectionIsSpreadsheet ? (
              <button
                type="button"
                onClick={() => {
                  if (selection.charCount > 0) {
                    quoteSelectionForAssistant()
                  } else {
                    setAssistantPrompt(t('writeAssistantPolishSelectionPrompt'))
                  }
                }}
                className="write-assistant-action-row border-t border-ds-border-muted"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                  <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ds-ink">
                    {selectionActionLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                    {selectionActionDescription}
                  </span>
                </span>
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
