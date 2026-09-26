import type { ReactElement } from 'react'
import {
  BookMarked,
  GraduationCap,
  ListTodo,
  MessageSquareQuote,
  NotebookPen
} from 'lucide-react'
import type { TFunction } from 'i18next'

const ACTION_ICON =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl'

function ActionRow({
  iconClass,
  icon,
  label,
  sub,
  onClick,
  bordered = true
}: {
  iconClass: string
  icon: ReactElement
  label: string
  sub: string
  onClick: () => void
  bordered?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`write-assistant-action-row ${bordered ? 'border-t border-ds-border-muted' : ''}`}
    >
      <span className={`${ACTION_ICON} ${iconClass}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-ds-ink">{label}</span>
        <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{sub}</span>
      </span>
    </button>
  )
}

/**
 * Paper-aware empty-state suggestions (U5): replaces the generic document
 * prompts on the papers surface — summarize the open paper, query the
 * library, extract key arguments, draft related work — plus the shared
 * quote/polish-selection row.
 */
export function WritePaperAssistantActions({
  paperTitle,
  selectionIsSpreadsheet,
  selectionActionLabel,
  selectionActionDescription,
  selectionCharCount,
  onSetPrompt,
  onQuoteSelection,
  t
}: {
  paperTitle: string
  selectionIsSpreadsheet: boolean
  selectionActionLabel: string
  selectionActionDescription: string
  selectionCharCount: number
  onSetPrompt: (prompt: string) => void
  onQuoteSelection: () => void
  t: TFunction
}): ReactElement {
  return (
    <>
      <ActionRow
        bordered={false}
        iconClass="bg-sky-500/10 text-sky-600 dark:text-sky-300"
        icon={<BookMarked className="h-4 w-4" strokeWidth={1.9} />}
        label={t('writePaperAssistSummarize')}
        sub={t('writePaperAssistSummarizeSub')}
        onClick={() => onSetPrompt(t('writePaperAssistSummarizePrompt', { title: paperTitle }))}
      />
      <ActionRow
        iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
        icon={<GraduationCap className="h-4 w-4" strokeWidth={1.9} />}
        label={t('writePaperAssistLibrary')}
        sub={t('writePaperAssistLibrarySub')}
        onClick={() => onSetPrompt(t('writePaperAssistLibraryPrompt'))}
      />
      <ActionRow
        iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300"
        icon={<ListTodo className="h-4 w-4" strokeWidth={1.9} />}
        label={t('writePaperAssistArguments')}
        sub={t('writePaperAssistArgumentsSub')}
        onClick={() => onSetPrompt(t('writePaperAssistArgumentsPrompt', { title: paperTitle }))}
      />
      <ActionRow
        iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-300"
        icon={<NotebookPen className="h-4 w-4" strokeWidth={1.9} />}
        label={t('writePaperAssistRelatedWork')}
        sub={t('writePaperAssistRelatedWorkSub')}
        onClick={() => onSetPrompt(t('writePaperAssistRelatedWorkPrompt', { title: paperTitle }))}
      />
      {!selectionIsSpreadsheet ? (
        <ActionRow
          iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-300"
          icon={<MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />}
          label={selectionActionLabel}
          sub={selectionActionDescription}
          onClick={() => {
            if (selectionCharCount > 0) onQuoteSelection()
            else onSetPrompt(t('writeAssistantPolishSelectionPrompt'))
          }}
        />
      ) : null}
    </>
  )
}
