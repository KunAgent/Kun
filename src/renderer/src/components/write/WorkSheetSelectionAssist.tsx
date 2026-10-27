import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'

type SheetAsk = { id: string; labelKey: string; promptKey: string; numericOnly?: boolean }

const ASKS: SheetAsk[] = [
  { id: 'chart', labelKey: 'workSheetAskChart', promptKey: 'workSheetAskChartPrompt', numericOnly: true },
  { id: 'outliers', labelKey: 'workSheetAskOutliers', promptKey: 'workSheetAskOutliersPrompt', numericOnly: true },
  { id: 'formula', labelKey: 'workSheetAskFormula', promptKey: 'workSheetAskFormulaPrompt' },
  { id: 'explain', labelKey: 'workSheetAskExplain', promptKey: 'workSheetAskExplainPrompt' }
]

/**
 * Kun beside a spreadsheet selection in Work: one tap quotes the selected
 * cells into the session and asks for a chart, outliers, a formula or an
 * explanation. Code previews and other hosts without the Work composer show
 * nothing.
 */
export function WorkSheetSelectionAssist({ rangeLabel, numeric }: { rangeLabel: string; numeric: boolean }): ReactElement | null {
  const { t } = useTranslation('common')
  const route = useChatStore((state) => state.route)
  const submit = usePaperModeStore((state) => state.composerBridge?.submit)
  if (route !== 'write' || !submit) return null
  const ask = (item: SheetAsk): void => {
    const write = useWriteWorkspaceStore.getState()
    if (!write.workspaceRoot.trim()) return
    write.quoteCurrentSelection(write.workspaceRoot)
    write.setAssistantOpen(true)
    submit(t(item.promptKey, { range: rangeLabel }))
  }
  return (
    <div className="work-sheet-assist" data-selection-ignore="true" role="toolbar" aria-label={t('workSheetAskLabel', { range: rangeLabel })}>
      <span className="work-sheet-assist-mark" aria-hidden="true">K</span>
      <span className="work-sheet-assist-range">{t('workSheetAskLabel', { range: rangeLabel })}</span>
      {ASKS.filter((item) => numeric || !item.numericOnly).map((item) => (
        <button key={item.id} type="button" className="work-sheet-assist-chip" data-sheet-ask={item.id}
          onMouseDown={(event) => event.preventDefault()} onClick={() => ask(item)}>
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  )
}
