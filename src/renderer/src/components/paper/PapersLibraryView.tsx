import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { FileDown, FileWarning, Import, Loader2, RefreshCw, Search, Tag, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperLibrarySortKey } from '@shared/paper/paper-library-types'
import { emptyPaperLibraryFilter, usePaperModeStore } from '../../paper/paper-mode-store'
import { usePaperSpaceStore, type PaperSpaceItem } from '../../paper/paper-space-store'
import { ensurePaperSpace, openPaperSpaceItem, refreshPaperSpace } from '../../paper/paper-space'
import { filterPaperEntries, sortPaperEntries } from '../../paper/paper-library-filter'
import { exportPaperSpaceCitations, trashPaperSpaceItems, updatePaperSpaceItems } from '../../paper/paper-space-library-actions'
import { copyPaperEntryBibtex, downloadMissingPaperPdfs, revealPaperEntry } from '../../paper/paper-library-row-actions'
import { usePaperBatchInterpret } from '../../paper/paper-batch-interpret'
import { usePaperImportDraft } from '../../paper/paper-import-draft'
import { usePaperStore } from '../../write/paper/paper-store'
import { PaperRowMenu, type PaperRowMenuAction } from './library/PaperRowMenu'
import { PaperMetaEditDialog } from './library/PaperMetaEditDialog'
import { PapersLibraryTable } from './library/PapersLibraryTable'
import { statusLabelKey } from './library/PaperLibraryTable'
import { PaperLibraryFeedsMenu } from './library/PaperLibraryFeedsMenu'
import './papers-space.css'

const STATUSES = ['', 'unread', 'reading', 'read'] as const

export function PapersLibraryView(): ReactElement {
  const { t } = useTranslation('common')
  const state = usePaperSpaceStore()
  const { items, filter, sort, selection } = state
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    node.scrollTop = usePaperSpaceStore.getState().libraryScrollTop
    return () => { usePaperSpaceStore.setState({ libraryScrollTop: node.scrollTop }) }
  }, [])
  const [menu, setMenu] = useState<{ item: PaperSpaceItem; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<PaperSpaceItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const visible = useMemo(() => {
    const byEntry = new Map(items.map((item) => [item.entry, item]))
    return sortPaperEntries(filterPaperEntries(items.map((item) => item.entry), { ...filter, group: '' }), sort)
      .map((entry) => byEntry.get(entry)!)
  }, [items, filter, sort])
  const counts = useMemo(() => ({
    '': items.length,
    unread: items.filter((item) => (item.entry.meta.status ?? 'unread') === 'unread').length,
    reading: items.filter((item) => item.entry.meta.status === 'reading').length,
    read: items.filter((item) => item.entry.meta.status === 'read').length
  }), [items])
  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.entry.meta.tags ?? []))].sort((a, b) => a.localeCompare(b)), [items])
  const selected = items.filter((item) => selection.has(item.key))
  const errors = Object.entries(state.errorsByRoot)
  const failed = state.status === 'error' || errors.length > 0
  const countKnown = items.length > 0 || (state.loaded && !failed)
  const filtered = Boolean(filter.query || filter.status || filter.tag || filter.recent)
  const importReady = state.status === 'ready'

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await action() } catch (error) {
      usePaperStore.getState().setNotice({ tone: 'error', message: t('writePaperErrorGeneric', { message: String(error) }) })
    } finally { setBusy(false) }
  }
  const importing = (): void => usePaperModeStore.getState().setImportDialogOpen(true)
  const interpret = (chosen: PaperSpaceItem[]): void => {
    usePaperBatchInterpret.getState().openDialog(state.workspaceRoot, chosen.map((item) => ({
      workspaceRoot: item.libraryRoot, unitDir: item.entry.unitDir, meta: item.entry.meta
    })))
  }
  const toggleSort = (key: PaperLibrarySortKey): void => state.setSort({
    key, dir: sort.key === key ? sort.dir === 'asc' ? 'desc' : 'asc' : key === 'title' ? 'asc' : 'desc'
  })
  const toggleAll = (): void => {
    const next = new Set(selection)
    const remove = visible.length > 0 && visible.every((item) => next.has(item.key))
    for (const item of visible) { if (remove) next.delete(item.key); else next.add(item.key) }
    state.setSelection(next)
  }
  const download = async (chosen: PaperSpaceItem[]): Promise<void> => {
    for (const root of new Set(chosen.map((item) => item.libraryRoot))) {
      await downloadMissingPaperPdfs(chosen.filter((item) => item.libraryRoot === root).map((item) => item.entry), t, root)
    }
    await refreshPaperSpace()
  }
  const rowAction = async (item: PaperSpaceItem, action: PaperRowMenuAction): Promise<void> => {
    if (typeof action === 'object') return updatePaperSpaceItems([item], { status: action.status }, t)
    switch (action) {
      case 'open': await openPaperSpaceItem(item); break
      case 'interpret': interpret([item]); break
      case 'edit': setEditing(item); break
      case 'copy-bibtex': await copyPaperEntryBibtex(item.entry, t, item.libraryRoot); break
      case 'download-pdf': await download([item]); break
      case 'reveal': await revealPaperEntry(item.entry, item.libraryRoot); break
      case 'trash': await trashPaperSpaceItems([item], t); break
    }
  }
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropActive(false)
    const paths = Array.from(event.dataTransfer.files).map((file) => window.kunGui?.getPathForFile?.(file) ?? '')
      .filter((path) => /\.(pdf|bib)$/i.test(path))
    if (!paths.length) return
    void run(async () => {
      await ensurePaperSpace()
      usePaperImportDraft.getState().queue(paths)
      importing()
    })
  }

  return (
    <div ref={scroller} className={`papers-library ds-no-drag ${dropActive ? 'is-dragging' : ''}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false) }} onDrop={onDrop}>
      <div className="papers-library-content">
        <header className="papers-library-heading">
          <div><h1>{t('workSidebarLibrary')}<span className="papers-library-count">{countKnown ? t('paperSpaceCount', { count: items.length }) : '—'}</span></h1><p className="papers-library-subtitle">{t('paperSpaceSummary')}</p></div>
          <div className="papers-library-actions">
            <PaperLibraryFeedsMenu />
            <button type="button" className="papers-button" disabled={busy || !items.length} onClick={() => void run(() => exportPaperSpaceCitations(selected.length ? selected : items, t))}><FileDown size={16} />{t('paperSpaceExportCitations')}</button>
            <button type="button" className="papers-button is-primary" disabled={!importReady} onClick={importing}><Import size={16} />{t('writePaperImport')}</button>
          </div>
        </header>
        <div className="papers-search-line">
          <label className="papers-search"><Search size={16} strokeWidth={1.75} /><input value={filter.query} onChange={(event) => state.setFilter({ query: event.target.value })} placeholder={t('writePaperSearchPlaceholder')} aria-label={t('writePaperSearchPlaceholder')} /></label>
          <button type="button" className="papers-icon-button" onClick={() => void refreshPaperSpace()} disabled={state.loading} title={t('writeRefreshWorkspace')} aria-label={t('writeRefreshWorkspace')}><RefreshCw size={16} className={state.loading ? 'animate-spin' : ''} /></button>
          <select className="papers-sort" value={`${sort.key}:${sort.dir}`} aria-label={t('paperSpaceSort')} onChange={(event) => { const [key, dir] = event.target.value.split(':'); state.setSort({ key: key as PaperLibrarySortKey, dir: dir as 'asc' | 'desc' }) }}>
            <option value="importedAt:desc">{t('paperSpaceRecentlyImported')}</option><option value="importedAt:asc">{t('paperSpaceOldestImported')}</option><option value="lastOpenedAt:desc">{t('paperSpaceRecentlyRead')}</option><option value="title:asc">{t('writePaperColTitle')} A–Z</option><option value="year:desc">{t('writePaperColYear')}</option>
            {!['importedAt:desc', 'importedAt:asc', 'lastOpenedAt:desc', 'title:asc', 'year:desc'].includes(`${sort.key}:${sort.dir}`) ? <option value={`${sort.key}:${sort.dir}`}>{t(sort.key === 'status' ? 'writePaperColStatus' : 'writePaperColTitle')} {sort.dir === 'asc' ? '↑' : '↓'}</option> : null}
          </select>
        </div>
        <div className="papers-filters">
          <div className="papers-status-tabs" role="tablist" aria-label={t('writePaperFilterStatus')}>
            {STATUSES.map((status) => <button type="button" role="tab" key={status} aria-selected={filter.status === status && !filter.recent} className="papers-filter" onClick={() => state.setFilter({ status, recent: false })}>{t(status ? statusLabelKey(status) : 'writePaperFilterAll')}<span className="papers-filter-count">{countKnown ? counts[status] : '—'}</span></button>)}
          </div>
          <label className="papers-tag-filter"><Tag size={14} /><select value={filter.tag} aria-label={t('writePaperFilterTag')} onChange={(event) => state.setFilter({ tag: event.target.value })}><option value="">{t('writePaperFilterTagAll')}</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
        </div>
        {selected.length > 0 ? <div className="papers-batch-bar" data-testid="paper-batch-bar"><strong>{t('writePaperSelected', { count: selected.length })}</strong>
          <button type="button" className="papers-button" disabled={busy} onClick={() => interpret(selected)}>{t('paperBatchAction', { count: selected.length })}</button>
          {(['unread', 'reading', 'read'] as const).map((status) => <button type="button" className="papers-button" disabled={busy} key={status} onClick={() => void run(() => updatePaperSpaceItems(selected, { status }, t))}>{t(statusLabelKey(status))}</button>)}
          <button type="button" className="papers-button" disabled={busy} onClick={() => void run(() => exportPaperSpaceCitations(selected, t))}>{t('paperSpaceExportCitations')}</button>
          <button type="button" className="papers-button is-danger" disabled={busy} onClick={() => void run(() => trashPaperSpaceItems(selected, t))}><Trash2 size={14} />{t('writePaperTrash')}</button>
          <button type="button" className="papers-batch-clear" onClick={state.clearSelection}>{t('writePaperClearSelection')}</button></div> : null}
        {failed ? <div className="papers-library-error" role="alert"><strong>{t(items.length ? 'paperSpacePartialError' : 'paperSpaceLoadError')}</strong><p>{t('paperSpaceLoadErrorHint')}</p>
          <details><summary>{t('paperSpaceErrorDetails')}</summary>{state.error ? <p>{state.error}</p> : null}{errors.map(([root, message]) => <p key={root}><b>{root}</b><br />{message}</p>)}</details>
          <button type="button" className="papers-button" disabled={state.loading} onClick={() => void refreshPaperSpace()}>{t('paperWorkspaceRetry')}</button></div> : null}
        {state.loading && !items.length ? <div className="papers-library-skeleton" role="status" aria-label={t('loading')}>
          <span className="sr-only">{t('loading')}</span>
          {[0, 1, 2].map((row) => <div key={row} className="papers-skeleton-row animate-pulse" aria-hidden><span className="papers-skeleton-thumb" /><div><span /><span /></div><Loader2 size={16} className="animate-spin" /></div>)}
        </div>
          : !visible.length && !failed ? <div className="papers-library-state"><FileTextEmpty /><h2>{t(filtered ? 'paperSpaceNoResults' : 'paperSpaceEmpty')}</h2><p>{t(filtered ? 'paperSpaceNoResultsHint' : 'paperSpaceEmptyHint')}</p><button type="button" className="papers-button is-primary" disabled={!filtered && !importReady} onClick={filtered ? () => state.setFilter(emptyPaperLibraryFilter()) : importing}>{t(filtered ? 'paperSpaceClearFilters' : 'writePaperImport')}</button></div>
            : visible.length > 0 ? <><PapersLibraryTable items={visible} selection={selection} sort={sort} onToggle={state.toggleSelected} onToggleAll={toggleAll} onSort={toggleSort} onOpen={(item) => void openPaperSpaceItem(item)} onMenu={(item, x, y) => setMenu({ item, x, y })} />
              <div className="papers-list-end"><span>{t('writePaperLibraryCount', { shown: visible.length, total: items.length })}</span><span>{t('paperSpaceOpenHint')}</span></div></> : null}
        {items.some((item) => !item.entry.hasPdf) ? <button type="button" disabled={busy} className="papers-download-missing" onClick={() => void run(() => download(items))}><FileWarning size={14} />{t('writePaperDownloadMissing', { count: items.filter((item) => !item.entry.hasPdf).length })}</button> : null}
        {importReady ? <button type="button" className="papers-drop-hint" onClick={importing}><Import size={16} />{t('paperSpaceDropHint')}</button> : null}
      </div>
      {menu ? <PaperRowMenu entry={menu.item.entry} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onAction={(action) => void run(() => rowAction(menu.item, action))} /> : null}
      {editing ? <PaperMetaEditDialog entry={editing.entry} libraryRoot={editing.libraryRoot} onClose={() => { setEditing(null); void refreshPaperSpace() }} /> : null}
    </div>
  )
}

function FileTextEmpty(): ReactElement { return <Import size={32} strokeWidth={1.5} aria-hidden /> }
