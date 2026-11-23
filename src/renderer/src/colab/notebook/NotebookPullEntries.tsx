import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, NotebookPen, RefreshCw, Search } from 'lucide-react'
import {
  NOTEBOOK_IMPORT_MAX_BYTES,
  NOTEBOOK_PULL_MAX_FILES,
  type ColabDriveNotebookEntry
} from '@shared/colab/colab-notebook-types'
import { formatColabBytes } from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { pullSecondaryBtn, pullSupporting, pullSurface } from './NotebookPullDriveAccess'
import {
  canPullEntry,
  filterPullEntries,
  useNotebookPullStore,
  type NotebookPullTask
} from './notebook-pull-store'

function formatModifiedAt(modifiedAtMs: number, locale: string): string {
  if (!Number.isFinite(modifiedAtMs) || modifiedAtMs <= 0) return '—'
  const diffSec = Math.round((modifiedAtMs - Date.now()) / 1000)
  const absSec = Math.abs(diffSec)
  try {
    const rtf = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto' })
    if (absSec < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute')
    if (absSec < 86400) return rtf.format(Math.trunc(diffSec / 3600), 'hour')
    if (absSec < 86400 * 14) return rtf.format(Math.trunc(diffSec / 86400), 'day')
    if (absSec < 86400 * 30) return rtf.format(Math.trunc(diffSec / (86400 * 7)), 'week')
    return new Intl.DateTimeFormat(locale || 'en', { month: 'short', day: 'numeric' }).format(
      new Date(modifiedAtMs)
    )
  } catch {
    return new Date(modifiedAtMs).toLocaleDateString()
  }
}

export function PullEntries({ task }: { task: NotebookPullTask }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const notebooks = useColabNotebookStore((s) => s.notebooks)
  const visible = useMemo(
    () => filterPullEntries(task.entries, task.query),
    [task.entries, task.query]
  )
  const picked = new Set(task.picked)
  const saved = new Set(task.saved.map((file) => file.remotePath))
  const local = new Set(notebooks.map((path) => path.toLocaleLowerCase()))
  const isSelectable = (entry: ColabDriveNotebookEntry): boolean =>
    canPullEntry(entry) && !saved.has(entry.remotePath)
  const paths = visible.filter(isSelectable).map((entry) => entry.remotePath)
  const allVisiblePicked = paths.length > 0 && paths.every((path) => picked.has(path))

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-ds-border bg-ds-main/60 px-2.5 text-ds-muted focus-within:border-accent">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <input
            type="search"
            aria-label={t('colabNb.driveSearchPlaceholder')}
            placeholder={t('colabNb.driveSearchPlaceholder')}
            value={task.query}
            onChange={(event) => useNotebookPullStore.getState().setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </label>
        <span className="shrink-0 text-[12px] text-ds-muted">
          {t('colabNb.importCountStat', { total: visible.length, picked: task.picked.length })}
        </span>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          title={t('colabNb.refresh')}
          aria-label={t('colabNb.refresh')}
          onClick={() => void useNotebookPullStore.getState().refresh()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {visible.length > 0 ? (
        <div className="overflow-hidden rounded-[10px] border border-ds-border">
          <div className="flex items-center gap-2.5 border-b border-ds-border bg-ds-subtle/70 px-3 py-2 text-[11.5px] font-medium text-ds-faint">
            <input
              type="checkbox"
              checked={allVisiblePicked}
              disabled={paths.length === 0}
              aria-label={t('colabNb.pullSelectVisible')}
              className="shrink-0 accent-accent"
              ref={(node) => {
                if (node) {
                  node.indeterminate = !allVisiblePicked && paths.some((path) => picked.has(path))
                }
              }}
              onChange={(event) =>
                useNotebookPullStore.getState().setPicked(paths, event.target.checked)
              }
            />
            <span className="min-w-0 flex-1">{t('colabNb.colName')}</span>
            <span className="w-24 shrink-0">{t('colabNb.colModified')}</span>
            <span className="w-16 shrink-0 text-right">{t('colabNb.colSize')}</span>
          </div>
          <ul className="max-h-[280px] divide-y divide-ds-border/60 overflow-y-auto bg-ds-card">
            {visible.map((entry) => {
              const inBatch = saved.has(entry.remotePath)
              const tooBig = !canPullEntry(entry)
              const sameName = local.has(entry.name.toLocaleLowerCase())
              const selectable = isSelectable(entry)
              return (
                <li key={entry.remotePath}>
                  <label
                    className={`flex items-center gap-2.5 px-3 py-2 text-[12.5px] ${
                      selectable ? 'cursor-pointer hover:bg-ds-hover/70' : 'opacity-55'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="shrink-0 accent-accent"
                      disabled={!selectable}
                      checked={picked.has(entry.remotePath)}
                      aria-label={entry.relativePath}
                      onChange={(event) =>
                        useNotebookPullStore
                          .getState()
                          .setPicked([entry.remotePath], event.target.checked)
                      }
                    />
                    <NotebookPen
                      className={`h-3.5 w-3.5 shrink-0 ${tooBig ? 'text-ds-faint' : 'text-amber-500'}`}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium text-ds-ink" title={entry.relativePath}>
                        {entry.relativePath}
                      </span>
                      {inBatch ? (
                        <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                          {t('colabNb.pullAlreadySaved')}
                        </span>
                      ) : tooBig ? (
                        <span className="text-[11px] text-ds-faint">
                          {t('colabNb.pullTooLarge', {
                            size: formatColabBytes(NOTEBOOK_IMPORT_MAX_BYTES)
                          })}
                        </span>
                      ) : sameName ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                          {t('colabNb.sameNameBadge')}
                        </span>
                      ) : null}
                    </span>
                    <span className="w-24 shrink-0 truncate text-[11.5px] text-ds-muted">
                      {formatModifiedAt(entry.modifiedAtMs, i18n.language)}
                    </span>
                    <span className="w-16 shrink-0 whitespace-nowrap text-right font-mono text-[11.5px] text-ds-muted">
                      {entry.sizeBytes < 0 ? '—' : formatColabBytes(entry.sizeBytes)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className={pullSurface} role="status">
          <p className="text-[13px] font-semibold text-ds-ink">
            {t(task.entries.length ? 'colabNb.pullNoMatches' : 'colabNb.driveEmpty')}
          </p>
          {!task.entries.length && task.source.kind === 'drive' ? (
            <p className={`${pullSupporting} mt-1`}>{t('colabNb.pullEmptyDriveHint')}</p>
          ) : null}
        </div>
      )}
      <p className="text-[11px] text-ds-faint">
        {t('colabNb.pullCopyPolicy', { total: NOTEBOOK_PULL_MAX_FILES })}
      </p>
    </div>
  )
}

export function PullResults({
  task,
  allowOpen
}: {
  task: NotebookPullTask
  allowOpen: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const kunBusy = useColabNotebookStore((s) => s.kunBusy)
  return (
    <div className="space-y-3">
      <h3 role="status" className="text-[14px] font-semibold text-ds-ink">
        {t(task.failed.length ? 'colabNb.pullPartial' : 'colabNb.pullDone', {
          saved: task.saved.length,
          failed: task.failed.length
        })}
      </h3>
      <ul className="max-h-[280px] space-y-1.5 overflow-y-auto">
        {task.saved.map((file) => (
          <li
            key={file.remotePath}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-ds-border bg-ds-main/40 px-3 py-2.5"
          >
            <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-[13px] font-medium text-ds-ink">{file.relativePath}</p>
              <p className={pullSupporting}>{t(`colabNb.pullDisposition.${file.disposition}`)}</p>
            </div>
            <button
              type="button"
              className={pullSecondaryBtn}
              disabled={!allowOpen || kunBusy}
              onClick={() => {
                if (useColabNotebookStore.getState().workspaceRoot !== task.workspaceRoot) return
                void useNotebookPullStore.getState().close()
                void useColabNotebookStore.getState().openNotebook(file.relativePath)
              }}
            >
              {t('colabNb.pullOpenCopy')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {task.failed.map(({ entry, message }) => (
          <li
            key={entry.remotePath}
            className="rounded-lg border border-amber-500/40 bg-ds-main/40 px-3 py-2.5"
          >
            <p className="break-words text-[13px] font-medium text-ds-ink">{entry.relativePath}</p>
            <p className="break-words text-[12px] text-amber-700 dark:text-amber-300">
              {message ?? t('colabNb.pullFileFailed')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
