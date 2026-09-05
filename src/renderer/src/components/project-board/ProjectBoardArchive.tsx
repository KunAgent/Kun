import type { ReactElement } from 'react'
import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectBoardCard } from '../../project-board/project-board-types'

export function ProjectBoardArchive(props: {
  cards: ProjectBoardCard[]
  disabled: boolean
  onRestore: (card: ProjectBoardCard) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-2">
        {props.cards.map((card) => (
          <div key={card.id} className="flex items-center gap-3 rounded-xl border border-ds-border-muted bg-ds-card p-3 shadow-sm">
            <Archive className="h-4 w-4 shrink-0 text-ds-faint" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ds-ink">{card.title}</p>
              <p className="mt-0.5 truncate text-xs text-ds-faint">{card.source.threadTitle || card.source.label}</p>
            </div>
            <button type="button" disabled={props.disabled} onClick={() => props.onRestore(card)} className="rounded-lg border border-ds-border-muted px-3 py-1.5 text-xs text-ds-muted hover:bg-ds-main disabled:opacity-40">
              {t('projectBoardRestore')}
            </button>
          </div>
        ))}
        {props.cards.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center text-ds-faint">
            <Archive className="h-8 w-8" strokeWidth={1.4} />
            <p className="text-sm">{t('projectBoardArchiveEmpty')}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
