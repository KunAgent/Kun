import type { ReactElement, RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FilePen, SearchCode, SquareArrowOutUpRight } from 'lucide-react'
import type { ToolBlock } from '../../agent/types'
import { countDiffStats, sumDiffStats } from '../../lib/diff-stats'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import { DiffView } from '../DiffView'
import { FileTypeIcon } from '../FileTypeIcon'
import { TurnUndoCardButton, type TurnChangeUndoState } from './turn-undo-controls'

const COLLAPSED_FILE_COUNT = 3
const DIFF_BAR_BLOCKS = 5

const GHOST_ACTION_CLASS =
  'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'

function splitFilePath(path: string): { name: string; dir: string } {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return { name: normalized, dir: '' }
  return { name: normalized.slice(slash + 1), dir: normalized.slice(0, slash) }
}

/** GitHub-style proportion bar: five blocks split between additions and removals. */
function DiffProportionBar({ added, removed }: { added: number; removed: number }): ReactElement | null {
  const total = added + removed
  if (total <= 0) return null
  let addedBlocks = Math.round((added / total) * DIFF_BAR_BLOCKS)
  if (added > 0 && addedBlocks === 0) addedBlocks = 1
  if (removed > 0 && addedBlocks === DIFF_BAR_BLOCKS) addedBlocks = DIFF_BAR_BLOCKS - 1
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden data-turn-change-diff-bar>
      {Array.from({ length: DIFF_BAR_BLOCKS }, (_, index) => (
        <span
          key={index}
          className={`h-[7px] w-[7px] rounded-[2px] ${
            index < addedBlocks ? 'bg-ds-diff-added' : 'bg-ds-diff-removed'
          }`}
        />
      ))}
    </span>
  )
}

function DiffStatText({ added, removed, className = '' }: { added: number; removed: number; className?: string }): ReactElement {
  return (
    <span className={`shrink-0 font-mono tabular-nums ${className}`}>
      <span className="text-ds-diff-added">+{added}</span>
      <span className="ml-1.5 text-ds-diff-removed">−{removed}</span>
    </span>
  )
}

export function TurnChangeSummary({
  changes,
  viewportRef,
  compact = false,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false,
  undo
}: {
  changes: ToolBlock[]
  viewportRef: RefObject<HTMLDivElement | null>
  compact?: boolean
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
  undo?: TurnChangeUndoState
}): ReactElement {
  const { t } = useTranslation('common')
  const [showAllFiles, setShowAllFiles] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (changes.length === 0) {
      setActiveId(null)
      setShowAllFiles(false)
      return
    }
    setActiveId((current) => {
      if (current && changes.some((change) => change.id === current)) return current
      return null
    })
    if (changes.length <= COLLAPSED_FILE_COUNT) setShowAllFiles(false)
  }, [changes])

  const totals = useMemo(() => sumDiffStats(changes.map((change) => change.detail)), [changes])
  const undone = undo?.undone === true
  const undoneCount = undo?.undoneFileCount ?? changes.length
  const title = useMemo(
    () => undone
      ? undoneCount === 1 ? t('turnUndoUndoneTitleOne') : t('turnUndoUndoneTitleMany', { count: undoneCount })
      : changes.length === 1 ? t('turnChangeFilesOne') : t('turnChangeFilesMany', { count: changes.length }),
    [changes.length, t, undone, undoneCount]
  )
  const visibleChanges = showAllFiles ? changes : changes.slice(0, COLLAPSED_FILE_COUNT)
  const hiddenFileCount = Math.max(0, changes.length - COLLAPSED_FILE_COUNT)
  const { ref: deferredBodyRef, shouldRender: shouldRenderBody } = useDeferredRender<HTMLDivElement>({
    enabled: activeId !== null,
    root: viewportRef
  })
  const rowPadding = compact ? 'px-3' : 'px-3.5'

  return (
    <section
      data-turn-change-summary
      className={`overflow-hidden border border-ds-border bg-ds-card ${compact ? 'rounded-xl' : 'rounded-[14px]'}`}
    >
      <div
        className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 ${rowPadding} ${compact ? 'py-2' : 'py-2.5'}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FilePen className="h-[15px] w-[15px] shrink-0 text-ds-muted" strokeWidth={1.8} aria-hidden />
          <span className="truncate text-[13px] font-semibold text-ds-ink">{title}</span>
          {undone ? (
            <span className="truncate text-[12px] text-ds-faint">{t('turnUndoUndoneSubtitle')}</span>
          ) : totals ? (
            <span className="flex shrink-0 items-center gap-2" data-turn-change-totals>
              <DiffStatText added={totals.added} removed={totals.removed} className="text-[11.5px]" />
              <DiffProportionBar added={totals.added} removed={totals.removed} />
            </span>
          ) : null}
        </div>
        {onOpenChanges || onReviewChanges || undo ? (
          <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
            {onOpenChanges ? (
              <button type="button" onClick={onOpenChanges} className={GHOST_ACTION_CLASS}>
                <SquareArrowOutUpRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {t('composerOpenChanges')}
              </button>
            ) : null}
            {onReviewChanges && !undone ? (
              <button
                type="button"
                disabled={reviewChangesDisabled}
                onClick={onReviewChanges}
                className={GHOST_ACTION_CLASS}
              >
                <SearchCode className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {t('composerReviewChanges')}
              </button>
            ) : null}
            {undo ? <TurnUndoCardButton undo={undo} /> : null}
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-ds-border-muted border-t border-ds-border-muted">
        {visibleChanges.map((change) => {
          const stats = countDiffStats(change.detail)
          const open = activeId === change.id
          const primary = change.filePath ?? t('toolActionFile')
          const { name, dir } = change.filePath ? splitFilePath(change.filePath) : { name: primary, dir: '' }

          return (
            <div key={change.id} data-turn-change-file>
              <button
                type="button"
                onClick={() => setActiveId(open ? null : change.id)}
                aria-expanded={open}
                title={primary}
                className={`group flex w-full items-center gap-2 text-left transition ${rowPadding} ${
                  compact ? 'h-8' : 'h-9'
                } ${open ? 'bg-ds-hover' : 'hover:bg-ds-hover'}`}
              >
                {change.filePath ? (
                  <FileTypeIcon path={change.filePath} size={14} className="shrink-0" />
                ) : null}
                <span
                  className={`flex min-w-0 flex-1 items-baseline gap-2 ${undone ? 'line-through opacity-70' : ''}`}
                >
                  <span className="shrink-0 truncate text-[12.5px] font-medium text-ds-ink">{name}</span>
                  {dir ? <span className="min-w-0 truncate text-[11.5px] text-ds-faint">{dir}</span> : null}
                </span>
                {stats ? <DiffStatText added={stats.added} removed={stats.removed} className="text-[11px]" /> : null}
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${
                    open ? 'rotate-90' : 'opacity-60 group-hover:opacity-100'
                  }`}
                  strokeWidth={1.8}
                  aria-hidden
                />
              </button>

              {open && change.detail ? (
                <div
                  ref={deferredBodyRef}
                  className={compact ? 'px-2.5 pb-2.5 pt-0.5' : 'px-3 pb-3 pt-0.5'}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? 'auto 148px' : 'auto 260px' }}
                >
                  {shouldRenderBody ? (
                    <DiffView
                      patch={change.detail}
                      filePath={change.filePath}
                      maxHeight={compact ? 148 : 260}
                      className="border border-ds-border-muted"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {hiddenFileCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            if (
              showAllFiles &&
              activeId &&
              !changes.slice(0, COLLAPSED_FILE_COUNT).some((change) => change.id === activeId)
            ) {
              setActiveId(null)
            }
            setShowAllFiles(!showAllFiles)
          }}
          aria-expanded={showAllFiles}
          className={`flex h-8 w-full items-center gap-1.5 border-t border-ds-border-muted text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink ${rowPadding}`}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showAllFiles ? 'rotate-180' : ''}`}
            strokeWidth={1.8}
            aria-hidden
          />
          {showAllFiles
            ? t('turnChangeShowFewer')
            : t('turnChangeShowMore', { count: hiddenFileCount })}
        </button>
      ) : null}
    </section>
  )
}
