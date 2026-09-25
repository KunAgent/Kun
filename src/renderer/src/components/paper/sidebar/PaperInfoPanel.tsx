import { useMemo, useRef, useState, type ReactElement } from 'react'
import {
  BookOpen,
  ExternalLink,
  FileText,
  PanelBottomClose,
  PanelBottomOpen,
  Pencil,
  Zap
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { openPaperInterpretation } from '../../../write/paper/paper-open-layout'
import { interpretPaper, preprocessPaper } from '../../../write/paper/paper-actions'
import { fetchCoolNotes } from '../../../write/paper/paper-actions'
import { PaperMetaEditDialog } from '../library/PaperMetaEditDialog'
import { PaperTitleText } from '../PaperTitleText'
import { pathInsidePaperUnit } from './PaperTree'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

const MIN_HEIGHT = 120
const MAX_HEIGHT = 420

/**
 * Persistent paper info panel pinned to the bottom of the left sidebar (U3):
 * once a paper is active its title/authors/venue/tags/links stay visible while
 * the user reads. Collapsible and drag-resizable; defaults to ~220px.
 */
export function PaperInfoPanel(): ReactElement | null {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const activeFilePath = useWriteWorkspaceStore((s) => s.activeFilePath)
  const entries = usePaperModeStore((s) => s.entries)
  const infoUnitDir = usePaperModeStore((s) => s.infoUnitDir)
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(220)
  const [editing, setEditing] = useState(false)
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null)

  const entry = useMemo(() => {
    const byDir = (dir: string | null | undefined): PaperLibraryEntry | undefined =>
      dir ? entries.find((item) => item.unitDir === dir) : undefined
    return (
      byDir(infoUnitDir) ??
      entries.find((item) => pathInsidePaperUnit(activeFilePath, workspaceRoot, item.unitDir)) ??
      null
    )
  }, [entries, infoUnitDir, activeFilePath, workspaceRoot])

  if (!entry) return null
  const { meta } = entry

  const links: { label: string; url: string }[] = []
  if (meta.arxivId) links.push({ label: 'arXiv', url: `https://arxiv.org/abs/${meta.arxivId}` })
  if (meta.doi) links.push({ label: 'DOI', url: `https://doi.org/${meta.doi}` })
  if (meta.coolPapers) {
    links.push({
      label: 'papers.cool',
      url: `https://papers.cool/${meta.coolPapers.branch}/${meta.coolPapers.id}`
    })
  }
  if (meta.sourceUrl) links.push({ label: t('writePaperLinkSource'), url: meta.sourceUrl })

  const interpretation = meta.interpretations?.at(-1)
  const progress = entry.pageCount
    ? Math.min(1, (entry.lastPage ?? 0) / entry.pageCount)
    : 0

  const onDragStart = (event: React.PointerEvent): void => {
    dragState.current = { startY: event.clientY, startHeight: height }
    const onMove = (move: PointerEvent): void => {
      const start = dragState.current
      if (!start) return
      setHeight(
        Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, start.startHeight + (start.startY - move.clientY)))
      )
    }
    const onUp = (): void => {
      dragState.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const runInterpret = async (): Promise<void> => {
    const bridge = usePaperModeStore.getState().composerBridge
    await interpretPaper({
      workspaceRoot,
      settings: useWriteWorkspaceStore.getState().paperReading,
      t,
      unitDir: entry.unitDir,
      meta,
      input: bridge?.input ?? '',
      setInput: bridge?.setInput ?? (() => undefined),
      onSubmitPrompt: bridge?.submit
    })
  }

  return (
    <div
      className="flex shrink-0 flex-col border-t border-ds-border bg-ds-panel"
      style={collapsed ? undefined : { height }}
    >
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={onDragStart}
          className="h-1 shrink-0 cursor-ns-resize hover:bg-accent/30"
        />
      ) : null}
      <div className="flex h-7 shrink-0 items-center gap-1.5 px-2.5">
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-ds-faint">
          {t('writePaperInfoTitle')}
        </span>
        <button
          type="button"
          title={t('writePaperEditMeta')}
          onClick={() => setEditing(true)}
          className="rounded p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          title={collapsed ? t('writePaperInfoExpand') : t('writePaperInfoCollapse')}
          onClick={() => setCollapsed((value) => !value)}
          className="rounded p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {collapsed ? (
            <PanelBottomOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
          ) : (
            <PanelBottomClose className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>
      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
          <p className="text-[12.5px] font-medium leading-snug text-ds-ink">
            <PaperTitleText title={meta.title} />
          </p>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ds-muted">
            {meta.authors.join(', ')}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-ds-faint">
            {[meta.year, meta.venue].filter(Boolean).join(' · ')}
          </p>
          {progress > 0 ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-ds-hover">
                <span
                  className="block h-full rounded-full bg-accent/70"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </span>
              <span className="text-[10px] text-ds-faint">
                {entry.lastPage ?? 0}/{entry.pageCount}
              </span>
            </div>
          ) : null}
          {meta.tags?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {meta.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-ds-hover px-1.5 py-px text-[10.5px] text-ds-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {links.length ? (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {links.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  onClick={() => void window.kunGui?.openExternal?.(link.url)}
                  className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                >
                  {link.label}
                  <ExternalLink className="h-2.5 w-2.5" strokeWidth={2} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void runInterpret()}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-accent/10 px-2 text-[11px] font-medium text-accent transition hover:bg-accent/15"
            >
              <Zap className="h-3 w-3" strokeWidth={1.9} />
              {t('writePaperInterpret')}
            </button>
            {interpretation ? (
              <button
                type="button"
                onClick={() =>
                  void openPaperInterpretation({
                    workspaceRoot,
                    unitDir: entry.unitDir,
                    path: interpretation.path
                  })
                }
                className="inline-flex h-6 items-center gap-1 rounded-md bg-ds-hover px-2 text-[11px] text-ds-muted transition hover:text-ds-ink"
              >
                <FileText className="h-3 w-3" strokeWidth={1.8} />
                {t('writePaperOpenInterpretation')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void preprocessPaper({
                  workspaceRoot,
                  settings: useWriteWorkspaceStore.getState().paperReading,
                  t,
                  unitDir: entry.unitDir
                })
              }
              className="inline-flex h-6 items-center rounded-md bg-ds-hover px-2 text-[11px] text-ds-muted transition hover:text-ds-ink"
            >
              {t('writePaperPreprocess')}
            </button>
            <button
              type="button"
              onClick={() =>
                void fetchCoolNotes({
                  workspaceRoot,
                  settings: useWriteWorkspaceStore.getState().paperReading,
                  t,
                  unitDir: entry.unitDir
                })
              }
              className="inline-flex h-6 items-center rounded-md bg-ds-hover px-2 text-[11px] text-ds-muted transition hover:text-ds-ink"
            >
              {t('writePaperCoolNotes')}
            </button>
          </div>
        </div>
      )}
      {editing ? <PaperMetaEditDialog entry={entry} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}
