import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Folder, FolderPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { expandFolderPaths } from '../../../paper/paper-folder-tree'
import { folderDisplayPath, importFolderLabel, joinPaperFolder, setImportFolder } from '../../../paper/paper-import-target'
import { runPaperImport } from '../../../paper/paper-import-job'
import {
  childFolderNames,
  importGroupLabels,
  planPaperImport,
  plannedFolderRows,
  plannedImportCount,
  suggestTopicFolder,
  type ImportCandidate
} from '../../../paper/paper-import-plan'
import { readImportSheetPrefs, writeImportSheetPrefs } from '../../../paper/paper-import-sheet-prefs'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { PaperFolderTree, usePaperLibraryLocation } from './PaperFolderTree'

function Check({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }): ReactElement {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ds-ink">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--ds-accent)]"
      />
      {label}
    </label>
  )
}

/**
 * The one place a paper import is configured: pick where in the library the
 * papers go (a folder tree), optionally add a new folder there (named after
 * the search topic by default), and optionally one subfolder per recommended
 * group. Already-owned papers stay put unless moved.
 */
export function PaperImportSheet({
  scope,
  candidates,
  topic,
  onClose
}: {
  scope: string
  candidates: readonly ImportCandidate[]
  topic: string
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const groups = usePaperModeStore((s) => s.groups)
  const { papersDir } = usePaperLibraryLocation()
  const prefs = useMemo(readImportSheetPrefs, [])
  const known = useMemo(() => new Set(expandFolderPaths(groups)), [groups])
  const [parent, setParent] = useState(known.has(prefs.parent) ? prefs.parent : '')
  const suggested = useMemo(
    () => (prefs.topicFolder ? suggestTopicFolder(topic, childFolderNames(groups, parent)) : ''),
    // The suggestion is made once, for the folder the sheet opens on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [name, setName] = useState(suggested)
  const [byGroup, setByGroup] = useState(prefs.byGroup)
  const [owned, setOwned] = useState<'keep' | 'move'>(prefs.owned)

  const labels = useMemo(() => importGroupLabels(candidates), [candidates])
  const ownedCount = candidates.filter((candidate) => candidate.owned).length
  const joined = joinPaperFolder(parent, name)
  const nameInvalid = joined === null
  const folder = joined ?? parent
  const isNewFolder = joined !== null && joined !== '' && !known.has(joined)
  const plan = useMemo(
    () => planPaperImport(candidates, { folder, byGroup: byGroup && labels.length >= 2, owned }),
    [candidates, folder, byGroup, labels.length, owned]
  )
  const count = plannedImportCount(plan) + plan.moves.length
  const rows = plannedFolderRows(plan, folder)
  const canConfirm = !nameInvalid && count > 0

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const confirm = (): void => {
    if (!canConfirm) return
    writeImportSheetPrefs({ parent, topicFolder: name.trim() !== '', byGroup, owned })
    setImportFolder(folder)
    void runPaperImport({ scope, plan, folder, t })
    onClose()
  }

  const folderName = folderDisplayPath(folder, t('paperImportFolderRoot'))
  const summary = plan.batches.length > 1 || (plan.batches[0] && plan.batches[0].folder !== folder)
    ? t('paperImportSheetSummaryGroups', { count, folder: folderName, groups: Math.max(plan.batches.length, 1) })
    : t('paperImportSheetSummary', { count, folder: folderName })

  return createPortal(
    <div className="ds-no-drag fixed inset-0 z-[95] flex items-center justify-center bg-black/25 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('paperImportSheetTitle', { count: candidates.length })}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[min(720px,calc(100vh-48px))] w-[440px] max-w-full flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-elevated shadow-[0_24px_64px_rgba(15,23,42,0.22)]"
      >
        <header className="flex items-start gap-2 px-4 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ds-ink">{t('paperImportSheetTitle', { count: candidates.length })}</h2>
            {topic ? <p className="mt-0.5 truncate text-[12px] text-ds-faint">{t('paperImportSheetFrom', { topic })}</p> : null}
          </div>
          <button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <p className="px-4 pb-1.5 pt-2 text-[11.5px] font-medium text-ds-faint">{t('paperImportSheetWhere')}</p>
          <div className="mx-4">
            <PaperFolderTree value={parent} onChange={setParent} maxHeight={200} />
          </div>
          <div className="mx-4 mt-2">
            <label
              className={`flex h-8 items-center gap-1.5 rounded-lg border bg-ds-main px-2.5 ${
                nameInvalid ? 'border-red-400' : 'border-ds-border-muted focus-within:border-[var(--ds-accent)]'
              }`}
            >
              <FolderPlus className="h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)]" strokeWidth={1.8} />
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) confirm()
                }}
                placeholder={t('paperImportSheetSubfolderPlaceholder')}
                aria-label={t('paperImportSheetNew')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-ink outline-none focus-visible:outline-none placeholder:text-ds-faint"
              />
            </label>
            <p className={`mt-1 break-all text-[11.5px] ${nameInvalid ? 'text-red-600 dark:text-red-300' : 'text-ds-faint'}`}>
              {nameInvalid
                ? t('paperImportFolderInvalid')
                : t(isNewFolder ? 'paperImportSheetDestinationNew' : 'paperImportSheetDestination', {
                    path: [papersDir, folder].filter(Boolean).join('/')
                  })}
            </p>
          </div>

          {labels.length >= 2 ? (
            <div className="mx-4 mt-3">
              <Check on={byGroup} onChange={setByGroup} label={t('paperImportSheetByGroup', { count: labels.length })} />
            </div>
          ) : null}

          {rows.length > 0 && (rows.length > 1 || plan.moves.length > 0) ? (
            <ul aria-label={t('paperImportSheetPreview')} className="mx-4 mt-2.5 rounded-lg border border-ds-border-muted bg-ds-main px-3 py-2">
              {rows.map((row) => {
                const depth = row.folder === folder ? 0 : row.folder.slice(folder ? folder.length + 1 : 0).split('/').length
                return (
                  <li key={row.folder} className="flex h-6 items-center gap-1.5 text-[12.5px] text-ds-ink" style={{ paddingLeft: depth * 16 }}>
                    <Folder className={`h-3.5 w-3.5 shrink-0 ${depth === 0 ? 'text-[var(--ds-accent)]' : 'text-ds-faint'}`} strokeWidth={1.8} />
                    <span className={`min-w-0 flex-1 truncate ${depth === 0 ? 'font-medium' : ''}`}>
                      {importFolderLabel(row.folder, t('paperImportFolderRoot'))}
                    </span>
                    <span className="text-[11px] tabular-nums text-ds-faint">{row.count}</span>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {ownedCount > 0 ? (
            <div className="mx-4 mt-3">
              <p className="text-[11.5px] font-medium text-ds-faint">{t('paperImportSheetOwned', { count: ownedCount })}</p>
              <div role="radiogroup" aria-label={t('paperImportSheetOwned', { count: ownedCount })} className="mt-1.5 inline-flex rounded-lg bg-ds-subtle p-0.5">
                {(['keep', 'move'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={owned === value}
                    onClick={() => setOwned(value)}
                    className={`h-6 rounded-md px-2.5 text-[12px] transition ${
                      owned === value ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
                    }`}
                  >
                    {t(value === 'keep' ? 'paperImportSheetOwnedKeep' : 'paperImportSheetOwnedMove')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="mx-4 mt-3 text-[11.5px] leading-[1.5] text-ds-faint">{t('paperImportSheetNoPdfNote')}</p>
        </div>

        <footer className="flex items-center gap-2 border-t border-ds-border-muted bg-ds-subtle/50 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted" title={summary}>
            {count > 0 ? summary : t('paperImportSheetNothing')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-ds-border px-3 text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
          >
            {t('paperImportSheetCancel')}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={confirm}
            className="h-8 rounded-lg bg-[var(--ds-control)] px-3.5 text-[12.5px] font-semibold text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:opacity-40"
          >
            {t('paperImportSheetConfirm', { count })}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
