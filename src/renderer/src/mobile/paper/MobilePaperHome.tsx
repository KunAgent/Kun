import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { emptyPaperLibraryFilter, PAPER_DEFAULT_SORT } from '../../paper/paper-mode-store'
import { useMobilePaperLibraryIndex } from './mobile-paper-library-index'
import { filterPaperEntries, sortPaperEntries } from '../../paper/paper-library-filter'
import { MobileSheet } from '../sheets/MobileSheet'
import type { PaperLibraryEntry, PaperLibraryFilter, PaperLibrarySort } from '@shared/paper/paper-library-types'
import type { MobilePage } from '../navigation/mobile-page'
import { rememberMobilePaperRoute } from './mobile-paper-route'
import { mobilePaperLibraryRoot, setMobilePaperLibraryRoot } from './mobile-paper-library-root'
import './mobile-paper.css'

type Props = {
  navigate: (page: MobilePage) => void
  onDocuments: () => void
  onBusyChange: (busy: boolean) => void
}

export function MobilePaperHome({ navigate, onDocuments, onBusyChange }: Props) {
  const { t } = useTranslation('common')
  const { paperMode, paperReading } = useWriteWorkspaceStore(useShallow((state) => ({
    paperMode: state.paperMode, paperReading: state.paperReading
  })))
  const [preferredRoot, setPreferredRoot] = useState('')
  const root = preferredRoot && paperMode.libraries.includes(preferredRoot) ? preferredRoot
    : mobilePaperLibraryRoot(paperMode.libraries, paperMode.activeLibrary)
  const { listing, loading, error: listError, refresh } = useMobilePaperLibraryIndex(root, paperReading.papersDir)
  const [filter, setFilter] = useState<PaperLibraryFilter>(emptyPaperLibraryFilter)
  const [sort, setSort] = useState<PaperLibrarySort>(PAPER_DEFAULT_SORT)
  const [limit, setLimit] = useState(60)
  const [importOpen, setImportOpen] = useState(false)
  const [input, setInput] = useState('')
  const [bibtex, setBibtex] = useState(false)
  const [progress, setProgress] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  const [selected, setSelected] = useState<PaperLibraryEntry | null>(null)
  const [selectedRoot, setSelectedRoot] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [editStatus, setEditStatus] = useState<'unread' | 'reading' | 'read'>('unread')
  const [file, setFile] = useState<File | null>(null)
  const requestRef = useRef<string | null>(null)
  useEffect(() => {
    setFilter(emptyPaperLibraryFilter()); setSort(PAPER_DEFAULT_SORT); setLimit(60); setSelected(null)
  }, [root])
  const reload = (): void => refresh()
  useEffect(() => window.kunGui.onPaperProgress((event) => {
    if (event.requestId === requestRef.current) setProgress(event.message || event.stage)
  }), [])
  useEffect(() => {
    const reconcile = (): void => {
      refresh()
      if (requestRef.current) setProgress(t('mobileWorkPaperReconnected'))
    }
    const offReconnect = window.kunGui.onRemoteStreamReconnected?.(reconcile)
    const offReset = window.kunGui.onRemoteSenderReset?.(reconcile)
    return () => { offReconnect?.(); offReset?.() }
  }, [refresh, t])

  const filtered = useMemo(() => sortPaperEntries(filterPaperEntries(listing?.entries ?? [], filter), sort),
    [listing, filter, sort])
  const runImport = async (): Promise<void> => {
    const targetRoot = root
    if (!targetRoot || !paperMode.libraries.includes(targetRoot) || busy || (!file && !input.trim())) return
    setBusy(true); setActionError(''); setProgress(t('mobileWorkPaperUploading'))
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    try {
      if (bibtex && !file) {
        const result = await window.kunGui.paperImportBibtex({ workspaceRoot: targetRoot, bibtex: input,
          parentDir: paperReading.papersDir, downloadPdfs: false, requestId })
        if (!result.ok) throw new Error(result.message)
      } else {
        const path = file ? await window.kunGui.uploadRemoteFile?.(file) : undefined
        if (file && !path) throw new Error(t('mobileWorkPaperUploadUnavailable'))
        const result = await window.kunGui.paperImport({ workspaceRoot: targetRoot,
          input: path || input.trim(), ...(path ? { localPdfPath: path } : {}),
          parentDir: paperReading.papersDir, requestId })
        if (!result.ok) throw new Error(result.message)
      }
      setFile(null); setInput(''); setImportOpen(false); reload()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { requestRef.current = null; setBusy(false); setProgress('') }
  }
  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.currentTarget.files?.[0] ?? null
    if (next && (next.size > 40 * 1024 * 1024 || !/\.pdf$/i.test(next.name))) {
      setActionError(t('mobileWorkPaperPdfLimit')); setFile(null)
    } else { setActionError(''); setFile(next) }
    event.currentTarget.value = ''
  }
  const updateMeta = async (): Promise<void> => {
    if (!selected || selectedRoot !== root || !paperMode.libraries.includes(root) || busy) return
    setBusy(true); setActionError('')
    try {
      const result = await window.kunGui.paperUpdateMeta({ workspaceRoot: root,
        unitDir: selected.unitDir, patch: { status: editStatus,
          tags: editTags.split(',').map((tag) => tag.trim()).filter(Boolean) } })
      if (!result.ok) throw new Error(result.message)
      const group = newGroup.trim() ? (await window.kunGui.paperCreateGroup({ workspaceRoot: root, group: newGroup.trim() })) : null
      if (group && !group.ok) throw new Error(group.message)
      const targetGroup = group?.ok ? group.group : editGroup
      if (targetGroup !== selected.group) {
        const moved = await window.kunGui.paperMoveToGroup({ workspaceRoot: root,
          unitDir: selected.unitDir, group: targetGroup })
        if (!moved.ok) throw new Error(moved.message)
      }
      setSelected(null); setNewGroup(''); reload()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const statusLabels = { unread: t('mobileWorkPaperUnread'), reading: t('mobileWorkPaperReading'), read: t('mobileWorkPaperReadStatus') }
  return <section className="kun-mobile-paper" aria-label={t('mobileWorkPaperLibrary')}>
    <header><h1>{t('mobileWorkPaperLibrary')}</h1><button type="button" disabled={!root || busy} onClick={() => setImportOpen(true)}>{t('writePaperImportSubmit')}</button></header>
    <nav className="kun-mobile-work-tabs" aria-label={t('workspaceModeWorkLabel')}>
      <button type="button" onClick={onDocuments}>{t('mobileWorkPaperDocuments')}</button>
      <button type="button" aria-current="page">{t('writePaperModePapers')}</button>
    </nav>
    {!root ? <p role="status" className="kun-mobile-paper-list">{t('mobileWorkPaperNoLibrary')}</p> : null}
    <div className="kun-mobile-paper-actions"><span>{root.split(/[\\/]/).filter(Boolean).at(-1) || t('mobileWorkPaperLibrary')} · {t('mobileWorkPaperCount', { count: listing?.counts.total ?? 0 })}</span>
      <button type="button" disabled={!root || busy} onClick={() => navigate({ mode: 'work', kind: 'discover' })}>{t('mobileWorkPaperDiscover')}</button></div>
    {paperMode.libraries.length > 1 ? <label className="kun-mobile-field kun-mobile-paper-library">{t('mobileWorkPaperLibrary')}
      <select value={root} disabled={busy} onChange={(event) => { setMobilePaperLibraryRoot(event.target.value, paperMode.libraries)
        setPreferredRoot(event.target.value); setSelected(null); setLimit(60) }}>
        {paperMode.libraries.map((value) => <option value={value} key={value}>{value.split(/[\\/]/).filter(Boolean).at(-1) || value}</option>)}
      </select></label> : null}
    <label className="kun-mobile-field kun-mobile-paper-search">{t('mobileWorkPaperSearchPapers')}
      <input type="search" value={filter.query} onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
        placeholder={t('mobileWorkPaperSearchFields')} /></label>
    <details className="kun-mobile-paper-filters"><summary>{t('mobileWorkPaperFilterSort')}</summary><div>
      <label className="kun-mobile-field">{t('mobileWorkPaperStatus')} <select value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as typeof filter.status }))}>
        <option value="">{t('mobileWorkPaperAll')}</option><option value="unread">{t('mobileWorkPaperUnread')}</option><option value="reading">{t('mobileWorkPaperReading')}</option><option value="read">{t('mobileWorkPaperReadStatus')}</option></select></label>
      <label className="kun-mobile-field">{t('mobileWorkPaperGroup')} <select value={filter.group} onChange={(event) => setFilter((current) => ({ ...current, group: event.target.value }))}>
        <option value="">{t('mobileWorkPaperAll')}</option>{listing?.groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
      <label className="kun-mobile-field">{t('mobileWorkPaperTags')} <select value={filter.tag} onChange={(event) => setFilter((current) => ({ ...current, tag: event.target.value }))}>
        <option value="">{t('mobileWorkPaperAll')}</option>{listing?.tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
      <label className="kun-mobile-field">{t('mobileWorkPaperSort')} <select value={sort.key} onChange={(event) => setSort({ key: event.target.value as typeof sort.key, dir: 'desc' })}>
        <option value="importedAt">{t('mobileWorkPaperImportedAt')}</option><option value="lastOpenedAt">{t('mobileWorkPaperLastOpened')}</option><option value="year">{t('mobileWorkPaperYear')}</option><option value="title">{t('mobileWorkPaperTitle')}</option></select></label>
    </div></details>
    <div className="kun-mobile-paper-list" aria-busy={loading}>
      {listError ? <p role="alert">{listError} <button type="button" onClick={reload}>{t('mobileWorkPaperRetry')}</button></p> : null}
      {root && !listError && !loading && !filtered.length ? <p role="status">{t('mobileWorkPaperNoMatch')}</p> : null}
      <ul>{filtered.slice(0, limit).map((entry) => <li key={entry.unitDir}>
        <button type="button" className="kun-mobile-paper-open" onClick={() => navigate({ mode: 'work', kind: 'paper', paperKey: rememberMobilePaperRoute(root, entry.unitDir), view: entry.hasPdf ? 'read' : 'info' })}>
          <strong>{entry.meta.title}</strong><span>{entry.meta.authors.slice(0, 3).join(', ')} · {entry.meta.year ?? '—'}</span>
          <small>{statusLabels[entry.meta.status ?? 'unread']} · {entry.lastPage ? t('mobileWorkPaperPage', { page: entry.lastPage }) : t('mobileWorkPaperNotStarted')} · {entry.hasPdf ? 'PDF' : t('mobileWorkPaperNoPdf')}</small></button>
        <button type="button" className="kun-mobile-paper-more" aria-label={t('mobileWorkPaperEditNamed', { title: entry.meta.title })}
          onClick={() => { setSelected(entry); setSelectedRoot(root); setEditStatus(entry.meta.status ?? 'unread'); setEditTags(entry.meta.tags?.join(', ') ?? ''); setEditGroup(entry.group); setNewGroup(''); setActionError('') }}>···</button>
      </li>)}</ul>
      {filtered.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 60)}>{t('mobileWorkPaperLoadMore')}</button> : null}
    </div>
    <MobileSheet open={importOpen} title={t('writePaperImportSubmit')} closeLabel={t('close')} onClose={() => { if (!busy) setImportOpen(false) }}>
      <label className="kun-mobile-field">{t('mobileWorkPaperImportIdentifier')}
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} /></label>
      <label><input type="checkbox" checked={bibtex} onChange={(event) => setBibtex(event.target.checked)} />{t('mobileWorkPaperBibtexText')}</label>
      <label className="kun-mobile-field">{t('mobileWorkPaperPhonePdf')}<input type="file" accept=".pdf,application/pdf" onChange={pickFile} /></label>
      {file ? <p>{file.name}</p> : null}
      {progress ? <p role="status">{progress}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}
      <button type="button" className="kun-mobile-work-sheet-button" disabled={busy || !root || (!input.trim() && !file)} onClick={() => void runImport()}>{t('mobileWorkPaperStartImport')}</button>
      {busy && requestRef.current ? <button type="button" className="kun-mobile-work-sheet-button" onClick={() => { void window.kunGui.paperCancel({ requestId: requestRef.current! }) }}>{t('mobileWorkPaperCancelImport')}</button> : null}
    </MobileSheet>
    <MobileSheet open={Boolean(selected && selectedRoot === root)} title={selected?.meta.title ?? ''} closeLabel={t('close')} onClose={() => { if (!busy) setSelected(null) }}>
      <label className="kun-mobile-field">{t('mobileWorkPaperReadingStatus')} <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as typeof editStatus)}>
        <option value="unread">{t('mobileWorkPaperUnread')}</option><option value="reading">{t('mobileWorkPaperReading')}</option><option value="read">{t('mobileWorkPaperReadStatus')}</option></select></label>
      <label className="kun-mobile-field">{t('mobileWorkPaperTagList')}<input value={editTags} onChange={(event) => setEditTags(event.target.value)} /></label>
      <label className="kun-mobile-field">{t('mobileWorkPaperGroup')} <select value={editGroup} onChange={(event) => setEditGroup(event.target.value)}>
        <option value="">{t('mobileWorkPaperUngrouped')}</option>{listing?.groups.map((group) => <option key={group} value={group}>{group}</option>)}
      </select></label>
      <label className="kun-mobile-field">{t('mobileWorkPaperNewGroup')}<input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} /></label>
      {actionError ? <p role="alert">{actionError}</p> : null}
      <button type="button" className="kun-mobile-work-sheet-button" disabled={busy} onClick={() => void updateMeta()}>{t('mobileWorkPaperSaveMetadata')}</button>
    </MobileSheet>
  </section>
}
