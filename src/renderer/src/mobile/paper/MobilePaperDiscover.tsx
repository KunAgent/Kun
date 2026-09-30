import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { DEFAULT_PAPER_SEARCH_SOURCES, PAPER_SEARCH_SOURCE_LABELS,
  type PaperSearchHit, type PaperSearchSource } from '@shared/paper/paper-search'
import { listResearchSessions, newResearchSessionId, readLastResearchSession,
  writeLastResearchSession } from '../../paper/paper-research-sessions'
import { MobilePaperAssistant } from './MobilePaperAssistant'
import { MobilePaperBrowse } from './MobilePaperBrowse'
import { buildResearchPool } from '../../paper/paper-research-pool'
import { useMobilePaperLibraryIndex } from './mobile-paper-library-index'
import { mobilePaperLibraryRoot } from './mobile-paper-library-root'
import {
  readPendingResearchSessions,
  rememberPendingResearchSession
} from './mobile-paper-research-pending'
import { mobilePaperYearRange } from './mobile-paper-year-range'
import './mobile-paper.css'

type Props = { onBack: () => void; onSettings: () => void; onBusyChange: (busy: boolean) => void }

export function MobilePaperDiscover({ onBack, onSettings, onBusyChange }: Props) {
  const { t } = useTranslation('common')
  const paperMode = useWriteWorkspaceStore((state) => state.paperMode)
  const papersDir = useWriteWorkspaceStore((state) => state.paperReading.papersDir)
  const root = mobilePaperLibraryRoot(paperMode.libraries, paperMode.activeLibrary)
  const { listing: libraryListing, loading: libraryLoading, error: libraryError, refresh: refreshLibrary } =
    useMobilePaperLibraryIndex(root, papersDir)
  const threads = useChatStore((state) => state.threads)
  const blocks = useChatStore((state) => state.blocks)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const libraryEntries = libraryListing?.entries
  const sessions = useMemo(() => listResearchSessions(root, threads), [root, threads])
  const [session, setSession] = useState<string | null>(null)
  const [pendingSessions, setPendingSessions] = useState<string[]>([])
  const activeRootRef = useRef(root)
  activeRootRef.current = root
  const sessionReady = Boolean(session && (pendingSessions.includes(session) || sessions.some((item) => item.sessionId === session)))
  const pool = useMemo(() => buildResearchPool(
    session && activeThreadId === sessions.find((item) => item.sessionId === session)?.threadId ? blocks : []
  ), [session, activeThreadId, sessions, blocks])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PaperSearchHit[]>([])
  const [reports, setReports] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [sources, setSources] = useState<PaperSearchSource[]>(
    paperMode.search.enabledSources.length ? paperMode.search.enabledSources : [...DEFAULT_PAPER_SEARCH_SOURCES])
  const [tab, setTab] = useState<'browse' | 'search' | 'research'>('search')
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const years = mobilePaperYearRange(yearFrom, yearTo)
  const [browseBusy, setBrowseBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestSeq = useRef(0)
  const jobRef = useRef<string | null>(null)
  const jobRootRef = useRef<string | null>(null)
  const cancelBatch = useRef(false)
  useEffect(() => {
    requestSeq.current += 1
    if (jobRef.current) { cancelBatch.current = true
      void window.kunGui.paperCancel({ requestId: jobRef.current }) }
    setSession(readLastResearchSession(root)); setPendingSessions(readPendingResearchSessions(root)); setSelected([])
    setHits([]); setReports([]); setLoading(false); setMessage(''); setError('')
  }, [root])
  useEffect(() => { onBusyChange(importing || browseBusy); return () => onBusyChange(false) }, [importing, browseBusy, onBusyChange])
  useEffect(() => window.kunGui.onPaperProgress((event) => {
    if (event.requestId === jobRef.current && jobRootRef.current === activeRootRef.current) setMessage(event.message || event.stage)
  }), [])
  useEffect(() => () => { if (jobRef.current) void window.kunGui.paperCancel({ requestId: jobRef.current }) }, [])
  useEffect(() => {
    const reconcile = (): void => {
      refreshLibrary()
      if (jobRef.current && jobRootRef.current === activeRootRef.current) setMessage(t('mobileWorkPaperReconnected'))
    }
    const offReconnect = window.kunGui.onRemoteStreamReconnected?.(reconcile)
    const offReset = window.kunGui.onRemoteSenderReset?.(reconcile)
    return () => { offReconnect?.(); offReset?.() }
  }, [refreshLibrary, t])
  const search = async (): Promise<void> => {
    const text = query.trim()
    if (!text || !sources.length || loading) return
    const range = mobilePaperYearRange(yearFrom, yearTo)
    if (!range) { setError(t('mobileWorkPaperYearInvalid')); return }
    const serial = ++requestSeq.current
    setLoading(true); setError(''); setHits([]); setSelected([]); setReports([])
    try {
      const result = await window.kunGui.paperSearch({ query: text, sources, limit: 15,
        ...range })
      if (serial !== requestSeq.current) return
      if (!result.ok) throw new Error(result.message)
      setHits(result.hits)
      setReports(result.sources.map((source) => `${PAPER_SEARCH_SOURCE_LABELS[source.source]}: ${source.error || t('mobileWorkPaperSourceReport', { count: source.count, cached: source.cached ? t('mobileWorkPaperCached') : '' })}`))
      if (!result.hits.length) setMessage(t('mobileWorkPaperNoSearchResults'))
    } catch (cause) { if (serial === requestSeq.current) setError(String(cause)) }
    finally { if (serial === requestSeq.current) setLoading(false) }
  }
  const importSelected = async (): Promise<void> => {
    const targetRoot = root
    const batch = (tab === 'research' ? pool.entries : hits)
      .filter((hit) => selected.includes(hit.key)).slice(0, 20)
    if (!targetRoot || !paperMode.libraries.includes(targetRoot) || !batch.length || importing) return
    setImporting(true); setError('')
    cancelBatch.current = false
    const failures: string[] = []
    let imported = 0
    try {
      for (const hit of batch) {
        if (cancelBatch.current || activeRootRef.current !== targetRoot) break
        const input = hit.arxivId || hit.doi || hit.coolId || hit.pdfUrl || hit.url
        if (!input) { failures.push(t('mobileWorkPaperMissingIdentifier', { title: hit.title })); continue }
        const requestId = crypto.randomUUID()
        jobRef.current = requestId
        jobRootRef.current = targetRoot
        setMessage(t('mobileWorkPaperImportProgress', { current: imported + failures.length + 1, total: batch.length, title: hit.title }))
        try {
          const result = await window.kunGui.paperImport({ workspaceRoot: targetRoot,
            input, parentDir: papersDir, requestId,
            meta: { title: hit.title, authors: hit.authors, abstract: hit.abstract,
              year: hit.year ? String(hit.year) : undefined, venue: hit.venue,
              doi: hit.doi, arxivId: hit.arxivId, coolId: hit.coolId, pdfUrl: hit.pdfUrl } })
          if (result.ok) imported += 1
          else failures.push(`${hit.title}: ${result.message}`)
        } catch (cause) { failures.push(`${hit.title}: ${String(cause)}`) }
        jobRef.current = null
      }
      if (activeRootRef.current !== targetRoot) return
      setMessage(cancelBatch.current
        ? t('mobileWorkPaperImportCancelled', { imported, failed: failures.length })
        : t('mobileWorkPaperImportSummary', { imported, failed: failures.length }))
      setSelected([])
      refreshLibrary()
      if (failures.length) setError(failures.join('；'))
    } finally { jobRef.current = null; jobRootRef.current = null; setImporting(false) }
  }
  const startResearch = (): void => {
    if (!root || importing || browseBusy) return
    const id = newResearchSessionId()
    rememberPendingResearchSession(root, id)
    setPendingSessions(readPendingResearchSessions(root)); setSession(id); setSelected([])
    writeLastResearchSession(root, id); setTab('research')
  }
  if (!root) return <section className="kun-mobile-paper"><header><button type="button" onClick={onBack}>‹ {t('mobileWorkPaperBackLibrary')}</button>
    <h1>{t('mobileWorkPaperDiscover')}</h1></header><p role="status">{t('mobileWorkPaperNoLibraryResearch')}</p></section>
  return <section className="kun-mobile-paper">
    <header><button type="button" onClick={onBack}>‹ {t('mobileWorkPaperBackLibrary')}</button><h1>{t('mobileWorkPaperDiscover')}</h1>
      <button type="button" disabled={importing || browseBusy} onClick={startResearch}>{t('mobileWorkPaperNewResearch')}</button></header>
    <nav className="kun-mobile-work-tabs" aria-label={t('mobileWorkPaperDiscover')}>
      <button type="button" disabled={importing || browseBusy} aria-current={tab === 'browse' ? 'page' : undefined}
        onClick={() => { setSelected([]); setTab('browse') }}>{t('mobileWorkPaperBrowse')}</button>
      <button type="button" disabled={importing || browseBusy} aria-current={tab === 'search' ? 'page' : undefined}
        onClick={() => { setSelected([]); setTab('search') }}>{t('mobileWorkPaperSearchTab')}</button>
      <button type="button" disabled={importing || browseBusy} aria-current={tab === 'research' ? 'page' : undefined}
        onClick={() => { setSelected([]); setTab('research') }}>{t('mobileWorkPaperResearchTab')}</button>
    </nav>
    {tab === 'browse' ? <MobilePaperBrowse root={root} papersDir={papersDir}
      onBusyChange={setBrowseBusy} onImported={refreshLibrary} /> : tab === 'search' ? <>
      <form className="kun-mobile-paper-search kun-mobile-field" onSubmit={(event) => { event.preventDefault(); void search() }}>
        <label>{t('mobileWorkPaperSearchInput')}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={t('mobileWorkPaperSearchHint')} /></label>
        <button type="submit" disabled={loading || !query.trim() || !sources.length}>{loading ? t('mobileWorkPaperSearching') : t('mobileWorkPaperSearchNow')}</button>
      </form>
      <details className="kun-mobile-paper-filters"><summary>{t('mobileWorkPaperSources', { count: sources.length })}</summary><div>
        {Object.entries(PAPER_SEARCH_SOURCE_LABELS).map(([source, title]) =>
          <label key={source}><input type="checkbox" checked={sources.includes(source as PaperSearchSource)}
            onChange={(event) => setSources((current) => event.target.checked
              ? [...current, source as PaperSearchSource] : current.filter((item) => item !== source))} />{title}</label>)}
      </div></details>
      <div className="kun-mobile-paper-year-scope">
        <label>{t('mobileWorkPaperYearFrom')} <input type="number" min={1900} max={new Date().getFullYear() + 1}
          value={yearFrom} onChange={(event) => setYearFrom(event.target.value)} /></label>
        <label>{t('mobileWorkPaperYearTo')} <input type="number" min={1900} max={new Date().getFullYear() + 1}
          value={yearTo} onChange={(event) => setYearTo(event.target.value)} /></label>
      </div>
      {!years ? <p role="alert">{t('mobileWorkPaperYearInvalid')}</p> : null}
      {reports.length ? <details className="kun-mobile-paper-filters"><summary>{t('mobileWorkPaperSourceStatus')}</summary><ul>
        {reports.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      {selected.length ? <div className="kun-mobile-paper-actions"><span>{t('mobileWorkPaperSelected', { count: selected.length })}</span>
        <button type="button" disabled={importing} onClick={() => void importSelected()}>{t('mobileWorkPaperImportSelected')}</button>
        {importing ? <button type="button" onClick={() => { cancelBatch.current = true
          if (jobRef.current) void window.kunGui.paperCancel({ requestId: jobRef.current }) }}>{t('mobileWorkPaperCancelBatch')}</button> : null}
      </div> : null}
      {message ? <p role="status" className="kun-mobile-paper-actions">{message}</p> : null}
      {error ? <p role="alert" className="kun-mobile-paper-actions">{error}</p> : null}
      <div className="kun-mobile-paper-list"><ul>{hits.map((hit) => <li key={hit.key}>
        <label className="kun-mobile-paper-open"><input type="checkbox" checked={selected.includes(hit.key)}
          onChange={(event) => setSelected((old) => event.target.checked ? [...old, hit.key]
            : old.filter((key) => key !== hit.key))} />
          <strong>{hit.title}</strong><small>{hit.authors.slice(0, 3).join(', ')} · {hit.year || '—'}</small>
          <small>{hit.sources.map((source) => PAPER_SEARCH_SOURCE_LABELS[source]).join(' · ')}</small>
          {hit.abstract ? <span className="kun-mobile-paper-abstract">{hit.abstract}</span> : null}
        </label></li>)}</ul></div>
    </> : <>
      <div className="kun-mobile-paper-actions"><label>{t('mobileWorkPaperResearchSession')} <select value={session ?? ''} onChange={(event) => {
        setSession(event.target.value || null); setSelected([])
        writeLastResearchSession(root, event.target.value || null)
      }}><option value="">{t('mobileWorkPaperNewSession')}</option>
        {pendingSessions.filter((id) => !sessions.some((item) => item.sessionId === id)).map((id) =>
          <option key={id} value={id}>{t('mobileWorkPaperPendingResearch')}</option>)}
        {sessions.map((item) => <option key={item.sessionId} value={item.sessionId}>{item.title}</option>)}</select></label>
        <button type="button" disabled={importing || browseBusy} onClick={startResearch}>{t('mobileWorkPaperStartResearch')}</button></div>
      <div className="kun-mobile-paper-year-scope">
        <label>{t('mobileWorkPaperDepth')} <select value={depth} onChange={(event) => setDepth(event.target.value as typeof depth)}>
          <option value="quick">{t('paperResearchDepth_quick')}</option><option value="standard">{t('paperResearchDepth_standard')}</option><option value="deep">{t('paperResearchDepth_deep')}</option>
        </select></label>
        <label>{t('mobileWorkPaperYearFrom')} <input type="number" min={1900} max={new Date().getFullYear() + 1}
          value={yearFrom} onChange={(event) => setYearFrom(event.target.value)} /></label>
        <label>{t('mobileWorkPaperYearTo')} <input type="number" min={1900} max={new Date().getFullYear() + 1}
          value={yearTo} onChange={(event) => setYearTo(event.target.value)} /></label>
      </div>
      <details className="kun-mobile-paper-filters"><summary>{t('mobileWorkPaperSources', { count: sources.length })}</summary><div>
        {Object.entries(PAPER_SEARCH_SOURCE_LABELS).map(([source, title]) =>
          <label key={source}><input type="checkbox" checked={sources.includes(source as PaperSearchSource)}
            onChange={(event) => setSources((current) => event.target.checked
              ? [...current, source as PaperSearchSource] : current.filter((item) => item !== source))} />{title}</label>)}
      </div></details>
      {!years ? <p role="alert">{t('mobileWorkPaperYearInvalid')}</p> : null}
      <div className="kun-mobile-paper-research">
      {sessionReady && session ? <MobilePaperAssistant key={session} root={root} unitDir="" page={0} quote={null}
        researchSessionId={session} researchRequest={{ depth, sources, ...(years ?? {}) }}
        researchBlockedReason={!years ? t('mobileWorkPaperYearInvalid') : !sources.length ? t('mobileWorkPaperNoResearchSource') : null}
        onSettings={onSettings} onClearQuote={() => undefined}
        onSessionAdmitted={() => setPendingSessions(readPendingResearchSessions(root))} />
        : <p role={session ? 'alert' : 'status'}>{session ? t('mobileWorkPaperMissingSession')
          : t('mobileWorkPaperResearchEmpty')}</p>}
      {session ? <div className="kun-mobile-paper-pool">
        <h2>{t('mobileWorkPaperResearchPool', { count: pool.stats.candidates })}</h2>
        <p>{t('mobileWorkPaperResearchStats', { searches: pool.stats.searches, recommended: pool.stats.recommended })}</p>
        {libraryError ? <p role="alert">{t('mobileWorkPaperIndexUnavailable', { error: libraryError })}</p> : null}
        {pool.stats.failedSources.length ? <p role="status">{t('mobileWorkPaperFailedSources', { sources: pool.stats.failedSources.join('、') })}</p> : null}
        {pool.entries.length ? <><ul>{pool.entries.slice(0, 80).map((item) => {
          const inLibrary = libraryEntries?.some((entry) => entry.meta.doi && entry.meta.doi === item.doi ||
            entry.meta.arxivId && entry.meta.arxivId === item.arxivId)
          return <li key={item.key}><label><input type="checkbox" checked={selected.includes(item.key)}
            onChange={(event) => setSelected((current) => event.target.checked
              ? [...current, item.key] : current.filter((key) => key !== item.key))} />
            <strong>{item.title}</strong> · {t('mobileWorkPaperHits', { count: item.hits })} {libraryLoading ? `· ${t('mobileWorkPaperLibraryChecking')}` : libraryError ? `· ${t('mobileWorkPaperLibraryUnknown')}` : inLibrary ? `· ${t('mobileWorkPaperInLibrary')}` : ''}
            {item.recommended ? <small> · {item.recommended.priority || t('mobileWorkPaperRecommended')}：{item.recommended.reason}</small> : null}
          </label></li>
        })}</ul>{pool.entries.length > 80 ? <p role="status">{t('mobileWorkPaperPoolLimit', { count: pool.entries.length })}</p> : null}
        {selected.length ? <button type="button" disabled={importing} onClick={() => void importSelected()}>{t('mobileWorkPaperImportCandidate')}</button> : null}</>
          : <p>{t('mobileWorkPaperPoolEmpty')}</p>}
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div> : null}
      </div>
    </>}
  </section>
}
