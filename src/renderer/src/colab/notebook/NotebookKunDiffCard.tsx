import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines } from 'diff'
import { Pencil } from 'lucide-react'
import type { NotebookCell } from './ipynb-format'

type DiffLine = {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

const MAX_PREVIEW_LINES = 6

function computeNotebookDiffPreview(
  baseline: NotebookCell[] | null,
  cells: NotebookCell[],
  changedCellIds: string[]
): { added: number; removed: number; lines: DiffLine[] } {
  if (!baseline || changedCellIds.length === 0) {
    return { added: 0, removed: 0, lines: [] }
  }
  const beforeText = baseline.map((cell) => cell.source).join('\n')
  const afterText = cells.map((cell) => cell.source).join('\n')
  const changes = diffLines(beforeText, afterText)
  let added = 0
  let removed = 0
  const lines: DiffLine[] = []

  for (const part of changes) {
    const rawLines = part.value.split('\n')
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop()
    }
    if (part.added) {
      added += rawLines.length
      for (const text of rawLines) {
        if (lines.length < MAX_PREVIEW_LINES) lines.push({ kind: 'add', text })
      }
    } else if (part.removed) {
      removed += rawLines.length
      for (const text of rawLines) {
        if (lines.length < MAX_PREVIEW_LINES) lines.push({ kind: 'del', text })
      }
    } else if (lines.length > 0 && lines.length < MAX_PREVIEW_LINES) {
      const firstNonEmpty = rawLines.find((line) => line.trim().length > 0)
      if (firstNonEmpty) lines.push({ kind: 'ctx', text: firstNonEmpty })
    }
  }

  return { added, removed, lines }
}

/** Compact diff card above the Kun composer for reviewing and undoing/keeping Kun edits. */
export function NotebookKunDiffCard({
  baseline,
  cells,
  changedCellIds,
  onLocate,
  onUndo,
  onKeep
}: {
  baseline: NotebookCell[] | null
  cells: NotebookCell[]
  changedCellIds: string[]
  onLocate: () => void
  onUndo: () => void
  onKeep: () => void
}): ReactElement {
  const { t } = useTranslation('common')

  const { added, removed, lines } = useMemo(
    () => computeNotebookDiffPreview(baseline, cells, changedCellIds),
    [baseline, cells, changedCellIds]
  )

  const headerTitle = useMemo(() => {
    if (changedCellIds.length === 1) {
      const idx = cells.findIndex((cell) => cell.id === changedCellIds[0])
      if (idx >= 0) return `${t('colabNb.kunModifiedCellsCount', { total: 1 })} · [${idx + 1}]`
    }
    return t('colabNb.kunModifiedCellsCount', { total: changedCellIds.length })
  }, [cells, changedCellIds, t])

  return (
    <div
      data-colab-kun-diff-card
      className="mb-2.5 overflow-hidden rounded-[10px] border border-accent-tint/25 bg-ds-card"
    >
      <div className="flex items-center gap-2 bg-accent-tint/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-accent">
        <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
        <button
          type="button"
          onClick={onLocate}
          className="min-w-0 flex-1 truncate text-left hover:underline"
        >
          {headerTitle}
        </button>
        {added > 0 || removed > 0 ? (
          <span className="shrink-0 font-mono text-[11px] font-normal">
            {added > 0 ? `+${added}` : ''}
            {added > 0 && removed > 0 ? ' ' : ''}
            {removed > 0 ? `−${removed}` : ''}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onLocate}
          className="shrink-0 text-[11px] font-normal text-ds-muted hover:text-ds-ink"
        >
          {t('colabNb.kunLocateCell')}
        </button>
      </div>

      {lines.length > 0 ? (
        <div className="max-h-28 overflow-hidden px-2.5 py-1.5 font-mono text-[11px] leading-[1.6]">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={`truncate rounded-[3px] px-1 ${
                line.kind === 'add'
                  ? 'bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400'
                  : line.kind === 'del'
                    ? 'bg-red-500/[0.07] text-red-700 line-through decoration-red-500/40 dark:text-red-400'
                    : 'text-ds-faint'
              }`}
            >
              {line.text || ' '}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-1.5 border-t border-ds-border-muted px-2.5 py-1.5">
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex h-6 items-center rounded-[6px] border border-ds-border bg-ds-card px-2.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {t('colabNb.kunUndo')}
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="inline-flex h-6 items-center rounded-[6px] bg-accent px-2.5 text-[11.5px] font-medium text-white transition hover:opacity-90"
        >
          {t('colabNb.kunKeep')}
        </button>
      </div>
    </div>
  )
}
