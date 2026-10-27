import type { ReactElement } from 'react'
import { BookOpenText, Expand, MessageSquareQuote, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Top row of the selection menu: 改写 and 扩写 edit the selection in place
 * (with review), 解释 asks in the session, 引用到会话 quotes it into the
 * composer. Editing moves only appear where the document can be edited.
 */
export function SelectionActionStrip({ editEnabled, onAskEdit, onAskChat, onQuoteSelection, onDone }: {
  editEnabled: boolean
  onAskEdit?: (instruction: string) => void
  onAskChat?: (instruction: string) => void
  onQuoteSelection?: () => void
  onDone: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const actions = [
    { id: 'rewrite', show: editEnabled && Boolean(onAskEdit), Icon: PenLine, label: t('writeSelectionActionRewrite'),
      run: () => onAskEdit?.(t('writeSelectionActionRewritePrompt')) },
    { id: 'expand', show: editEnabled && Boolean(onAskEdit), Icon: Expand, label: t('writeSelectionActionExpand'),
      run: () => onAskEdit?.(t('writeSelectionActionExpandPrompt')) },
    { id: 'explain', show: Boolean(onAskChat), Icon: BookOpenText, label: t('writeQuickActionExplain'),
      run: () => onAskChat?.(t('writeQuickActionExplainPrompt')) },
    { id: 'quote', show: Boolean(onQuoteSelection), Icon: MessageSquareQuote, label: t('writeSelectionActionQuote'),
      run: () => onQuoteSelection?.() }
  ].filter((action) => action.show)
  return (
    <div className="write-selection-strip" role="toolbar" aria-label={t('writeSelectionActions')}>
      {actions.map(({ id, Icon, label, run }) => (
        <button key={id} type="button" className="write-selection-strip-button" data-selection-action={id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { run(); onDone() }}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
