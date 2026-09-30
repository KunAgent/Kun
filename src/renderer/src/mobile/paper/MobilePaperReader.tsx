import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { findMobilePaperResource } from './mobile-paper-library-index'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { paperHighlightSchema, type PaperHighlight, type PaperHighlightColor, type PaperRect } from '@shared/paper/paper-marks-types'
import { MobilePaperPdf } from './MobilePaperPdf'
import { MobilePaperNotes } from './MobilePaperNotes'
import { MobilePaperAssistant } from './MobilePaperAssistant'
import { readMobilePaperPage, useMobilePaperPageProgress } from './mobile-paper-page-progress'
import { mobilePaperLibraryRoot } from './mobile-paper-library-root'
import { readMobilePaperRoute } from './mobile-paper-route'
import type { PaperResourceView } from '../navigation/mobile-page'
import type { PaperLibraryEntry, PaperReferenceItem } from '@shared/paper/paper-library-types'
import type { PaperUnitReadResult } from '@shared/paper/paper-types'
import { MobileSheet } from '../sheets/MobileSheet'
import './mobile-paper.css'

type Selection = { text: string; page: number; rects: PaperRect[] }

type Props = {
  paperKey: string; view: PaperResourceView
  onBack: () => void; onView: (view: PaperResourceView) => void; onSettings: () => void
  onUnsavedChange: (unsaved: boolean) => void
}

export function MobilePaperReader({ paperKey, view, onBack, onView, onSettings, onUnsavedChange }: Props) {
  const { t } = useTranslation('common')
  const translateRef = useRef(t)
  translateRef.current = t
  const paperMode = useWriteWorkspaceStore((state) => state.paperMode)
  const papersDir = useWriteWorkspaceStore((state) => state.paperReading.papersDir)
  const preferredRoot = mobilePaperLibraryRoot(paperMode.libraries, paperMode.activeLibrary)
  const [root, setRoot] = useState('')
  const [entry, setEntry] = useState<PaperLibraryEntry | null>(null)
  const [unit, setUnit] = useState<Extract<PaperUnitReadResult, { ok: true }> | null>(null)
  const [error, setError] = useState('')
  const [marks, setMarks] = useState<PaperHighlight[]>([])
  const marksRef = useRef<PaperHighlight[]>([])
  const removedIdsRef = useRef(new Set<string>())
  const writingMarks = useRef(false)
  const [marksReady, setMarksReady] = useState(false)
  const [cards, setCards] = useState<unknown[]>([])
  const [marksDirty, setMarksDirty] = useState(false)
  const [notesDirty, setNotesDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = notesDirty || marksDirty
  const [savingMarks, setSavingMarks] = useState(false)
  const [marksOpen, setMarksOpen] = useState(false)
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [colorDraft, setColorDraft] = useState<PaperHighlightColor>('yellow')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [pageSyncError, setPageSyncError] = useState('')
  const [quote, setQuote] = useState<{ text: string; page: number } | null>(null)
  const [translation, setTranslation] = useState('')
  const [translationOpen, setTranslationOpen] = useState(false)
  const translationSeq = useRef(0)
  const [busy, setBusy] = useState(false)
  const [fetchingPdf, setFetchingPdf] = useState(false)
  const [references, setReferences] = useState<PaperReferenceItem[] | null>(null)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [referencesLoading, setReferencesLoading] = useState(false)
  const [referencesError, setReferencesError] = useState('')
  const referencesSeq = useRef(0)
  const [retry, setRetry] = useState(0)
  const unitDir = entry?.unitDir ?? ''
  const flushPage = useMobilePaperPageProgress({ root, unitDir, page, pageCount }, setPageSyncError)
  const goBack = (): void => { void flushPage().then((saved) => { if (saved) onBack() }) }
  useEffect(() => () => { translationSeq.current += 1 }, [root, unitDir])
  useEffect(() => {
    if (dirtyRef.current) { setError(translateRef.current('mobileWorkPaperLibraryChangedPending')); return }
    let live = true
    setRoot(''); setEntry(null); setUnit(null); setMarks([]); marksRef.current = []; removedIdsRef.current.clear(); setMarksReady(false); setCards([]); setError(''); setQuote(null)
    referencesSeq.current += 1; setReferences(null); setReferencesOpen(false); setReferencesError(''); setReferencesLoading(false)
    setMarksDirty(false); setNotesDirty(false); setPageCount(0); setPageSyncError('')
    if (!paperMode.libraries.length) { setError(translateRef.current('mobileWorkPaperNoLibrary')); return }
    void findMobilePaperResource(paperMode.libraries, preferredRoot, paperKey, papersDir,
      (payload) => window.kunGui.paperLibraryList(payload),
      readMobilePaperRoute(paperKey, paperMode.libraries)).then((found) => {
      if (!live || dirtyRef.current) return
      if (!found) { setError(translateRef.current('mobileWorkPaperPaperNotFound')); return }
      const { root: foundRoot, entry: foundEntry } = found
      setRoot(foundRoot); setEntry(foundEntry)
      setPage(readMobilePaperPage(foundRoot, foundEntry.unitDir, foundEntry.lastPage, foundEntry.lastOpenedAt))
      void window.kunGui.paperReadUnit({ workspaceRoot: foundRoot, unitDir: foundEntry.unitDir }).then((read) => {
        if (live) { if (read.ok) setUnit(read); else setError(read.message) }
      }).catch((cause: unknown) => { if (live) setError(String(cause)) })
      void window.kunGui.paperMarksRead({ workspaceRoot: foundRoot, unitDir: foundEntry.unitDir }).then((read) => {
        if (!live) return
        if (!read.ok) { setError(read.message); return }
        const loaded = read.items.flatMap((item) => {
          const parsed = paperHighlightSchema.safeParse(item)
          return parsed.success ? [parsed.data] : []
        })
        marksRef.current = loaded
        setMarks(loaded)
        setCards(read.items.filter((item) => (item as { kind?: string })?.kind !== 'highlight'))
        setMarksReady(true)
      }).catch((cause: unknown) => { if (live) setError(String(cause)) })
      void window.kunGui.paperLocalStateWrite({ libraryRoot: foundRoot, unitRelDir: foundEntry.unitDir,
        patch: { lastOpenedAt: new Date().toISOString() } }).catch(() => undefined)
    }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [paperMode.libraries, preferredRoot, papersDir, paperKey, retry])
  useEffect(() => onUnsavedChange(notesDirty || marksDirty), [notesDirty, marksDirty, onUnsavedChange])
  const onPage = useCallback((next: number, count: number) => { setPage(next); setPageCount(count) }, [])
  const persistMarks = async (next: PaperHighlight[]): Promise<void> => {
    if (!unitDir || writingMarks.current) return
    writingMarks.current = true
    setSavingMarks(true); setError('')
    let saved = false
    const removedIds = [...removedIdsRef.current]
    try {
      const result = await window.kunGui.paperMarksWrite({ workspaceRoot: root, unitDir,
        items: [...next, ...cards], removedIds })
      if (!result.ok) throw new Error(result.message)
      saved = true
      for (const id of removedIds) removedIdsRef.current.delete(id)
      if (marksRef.current === next && removedIdsRef.current.size === 0) setMarksDirty(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setMarksDirty(true) }
    finally {
      writingMarks.current = false; setSavingMarks(false)
      if (saved && (marksRef.current !== next || removedIdsRef.current.size > 0)) void persistMarks(marksRef.current)
    }
  }
  const addHighlight = (selection: Selection): void => {
    const now = new Date().toISOString()
    const next: PaperHighlight = { id: crypto.randomUUID(), kind: 'highlight', color: 'yellow',
      page: selection.page, quote: selection.text, rects: selection.rects, createdAt: now, updatedAt: now }
    const merged = [...marksRef.current, next]
    marksRef.current = merged
    setMarks(merged); setMarksDirty(true); void persistMarks(merged)
  }
  const updateHighlight = (id: string, comment: string, color: PaperHighlightColor): void => {
    const next = marksRef.current.map((mark) => mark.id === id
      ? { ...mark, color, comment: comment.trim() || undefined, updatedAt: new Date().toISOString() } : mark)
    marksRef.current = next; setMarks(next); setMarksDirty(true); setEditingMarkId(null)
    void persistMarks(next)
  }
  const deleteHighlight = (id: string): void => {
    const next = marksRef.current.filter((mark) => mark.id !== id)
    if (next.length === marksRef.current.length) return
    removedIdsRef.current.add(id)
    marksRef.current = next; setMarks(next); setMarksDirty(true)
    void persistMarks(next)
  }
  const translate = (selection: Selection): void => {
    const request = ++translationSeq.current
    setTranslationOpen(true); setTranslation(t('mobileWorkPaperTranslating')); setBusy(true)
    const settings = useWriteWorkspaceStore.getState().paperMode.translate
    void window.kunGui.paperTranslateSelection({ text: selection.text,
      targetLanguage: settings.targetLanguage }).then((result) => {
      if (request === translationSeq.current) setTranslation(result.ok ? result.translation : result.message)
    }).catch((cause: unknown) => {
      if (request === translationSeq.current) setTranslation(String(cause))
    }).finally(() => { if (request === translationSeq.current) setBusy(false) })
  }
  const changeView = (next: PaperResourceView): void => {
    if (notesDirty && view === 'notes' && next !== 'notes') { setError(t('mobileWorkPaperNotesBeforeView')); return }
    void flushPage()
    onView(next)
  }
  const download = (): void => {
    if (!unit?.meta.pdfFile) return
    const path = writeJoinPath(writeJoinPath(root, unitDir), unit.meta.pdfFile)
    void window.kunGui.saveWorkspaceFileAs({ workspaceRoot: root, sourcePath: path,
      suggestedName: unit.meta.pdfFile }).then((result) => { if (!result.ok) setError(result.message) })
  }
  const fetchReferences = async (): Promise<void> => {
    if (!root || !unitDir || referencesLoading) return
    const serial = ++referencesSeq.current
    setReferencesLoading(true); setReferencesError('')
    try {
      const result = await window.kunGui.paperFetchReferences({ workspaceRoot: root, unitDir })
      if (serial !== referencesSeq.current) return
      if (!result.ok) throw new Error(result.message)
      setReferences(result.items)
    } catch (cause) { if (serial === referencesSeq.current) setReferencesError(String(cause)) }
    finally { if (serial === referencesSeq.current) setReferencesLoading(false) }
  }
  const fetchMissingPdf = async (): Promise<void> => {
    if (!entry || !unit || fetchingPdf) return
    setFetchingPdf(true); setError('')
    try {
      const result = await window.kunGui.paperDownloadPdf({ workspaceRoot: root, unitDir })
      if (!result.ok) throw new Error(result.message)
      setEntry({ ...entry, meta: result.meta, hasPdf: Boolean(result.meta.pdfFile) })
      setUnit({ ...unit, meta: result.meta })
      if (result.meta.pdfFile) onView('read')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setFetchingPdf(false) }
  }
  if (!entry || !unit || !marksReady) return <section className="kun-mobile-unavailable">
    <p role={error ? 'alert' : 'status'}>{error || t('mobileWorkPaperLoadingPaper')}</p>
    {error ? <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('mobileWorkPaperRetry')}</button> : null}
    <button type="button" onClick={goBack}>{t('mobileWorkPaperBackLibrary')}</button>
  </section>
  const pdfPath = unit.meta.pdfFile
    ? writeJoinPath(writeJoinPath(root, entry.unitDir), unit.meta.pdfFile) : null
  const status = ({ unread: t('mobileWorkPaperUnread'), reading: t('mobileWorkPaperReading'),
    read: t('mobileWorkPaperReadStatus') })[entry.meta.status ?? 'unread']
  return <section className="kun-mobile-paper-reader">
    <header><button type="button" onClick={goBack} aria-label={t('mobileWorkPaperBackLibrary')}>‹</button><h1>{unit.meta.title}</h1>
      {pdfPath ? <button type="button" onClick={download}>{t('mobileWorkPaperDownload')}</button> : <span />}</header>
    <nav aria-label={t('mobileWorkPaperLibrary')}>{(['read', 'notes', 'assistant', 'info'] as const).map((tab) =>
      <button type="button" key={tab} aria-current={view === tab ? 'page' : undefined}
        onClick={() => changeView(tab)}>{({ read: t('mobileWorkPaperViewRead'), notes: t('mobileWorkPaperViewNotes'),
          assistant: t('mobileWorkPaperViewAsk'), info: t('mobileWorkPaperViewInfo') })[tab]}</button>)}</nav>
    <div className="kun-mobile-paper-actions"><button type="button" onClick={() => setMarksOpen(true)}>
      {t('mobileWorkPaperMarks', { count: marks.length })}</button></div>
    {error ? <p role="alert">{error} {marksDirty ? <button type="button" disabled={savingMarks}
      onClick={() => void persistMarks(marks)}>{t('mobileWorkPaperSaveMarksRetry')}</button> : null}</p> : null}
    {pageSyncError ? <p role="alert">{t('mobileWorkPaperPageSyncFailed', { error: pageSyncError })}
      <button type="button" onClick={() => void flushPage()}>{t('mobileWorkPaperRetry')}</button>
      <button type="button" onClick={onBack}>{t('mobileWorkPaperLeaveWithoutPageSync')}</button></p> : null}
    {view === 'read' ? pdfPath ? <MobilePaperPdf workspaceRoot={root} path={pdfPath}
      initialPage={page} marks={marks} onPage={onPage} onHighlight={addHighlight} onTranslate={translate}
      onQuote={(selection) => { setQuote(selection); changeView('assistant') }} />
      : <div className="kun-mobile-paper-reader-body"><p>{t('mobileWorkPaperNoPdfInfo')}</p></div> : null}
    {view === 'notes' ? <MobilePaperNotes workspaceRoot={root} unitDir={unitDir} onDirty={setNotesDirty} /> : null}
    {view === 'assistant' ? <MobilePaperAssistant root={root} unitDir={unitDir} page={page}
      quote={quote} onClearQuote={() => setQuote(null)} onSettings={onSettings} /> : null}
    {view === 'info' ? <div className="kun-mobile-paper-reader-body">
      <h2>{unit.meta.title}</h2><p>{unit.meta.authors.join(', ')}</p>
      <p>{unit.meta.year} · {unit.meta.venue}</p><p>{unit.meta.abstract || t('mobileWorkPaperNoAbstract')}</p>
      <p>{t('mobileWorkPaperStatusTags', { status, tags: entry.meta.tags?.join(', ') || t('mobileWorkPaperNone') })}</p>
      <button type="button" onClick={() => { setReferencesOpen(true)
        if (!references && !referencesLoading) void fetchReferences()
      }}>{t('mobileWorkPaperShowReferences')}</button>
      {!pdfPath && (unit.meta.pdfUrl || unit.meta.arxivId) ? <button type="button"
        className="kun-mobile-work-sheet-button" disabled={fetchingPdf}
        onClick={() => void fetchMissingPdf()}>{fetchingPdf ? t('mobileWorkPaperFetchingPdf') : t('mobileWorkPaperGetPdf')}</button> : null}
      <p>{t('mobileWorkPaperLibraryLocation', { root })}</p>
    </div> : null}
    <MobileSheet open={marksOpen} title={t('mobileWorkPaperMarkEditor')} closeLabel={t('close')} onClose={() => setMarksOpen(false)}>
      {marks.length ? <ul className="kun-mobile-paper-mark-list">{marks.map((mark) => <li key={mark.id}>
        <button type="button" disabled={!pdfPath} onClick={() => {
          if (notesDirty && view === 'notes') { setError(t('mobileWorkPaperNoteBeforeJump')); return }
          setPage(mark.page); changeView('read'); setMarksOpen(false)
        }}>{t('mobileWorkPaperPage', { page: mark.page })} · {mark.quote.slice(0, 160)}</button>
        {mark.comment ? <p>{mark.comment}</p> : null}
        {editingMarkId === mark.id ? <>
          <label>{t('mobileWorkPaperMarkComment')} <textarea maxLength={8000} value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)} /></label>
          <label>{t('mobileWorkPaperMarkColor')} <select value={colorDraft} onChange={(event) => setColorDraft(event.target.value as PaperHighlightColor)}>
            <option value="yellow">{t('mobileWorkPaperColorYellow')}</option><option value="green">{t('mobileWorkPaperColorGreen')}</option>
            <option value="blue">{t('mobileWorkPaperColorBlue')}</option><option value="pink">{t('mobileWorkPaperColorPink')}</option>
          </select></label>
          <button type="button" onClick={() => updateHighlight(mark.id, commentDraft, colorDraft)}>{t('mobileWorkPaperSaveMark')}</button>
        </> : <button type="button" onClick={() => { setEditingMarkId(mark.id)
          setCommentDraft(mark.comment ?? ''); setColorDraft(mark.color) }}>{t('mobileWorkPaperEdit')}</button>}
        <button type="button" onClick={() => { if (window.confirm(t('mobileWorkPaperDeleteMarkConfirm'))) deleteHighlight(mark.id) }}>{t('mobileWorkPaperDelete')}</button>
      </li>)}</ul> : <p role="status">{t('mobileWorkPaperNoMarks')}</p>}
      {marksDirty ? <p role="status">{t('mobileWorkPaperMarkPending')}</p> : null}
    </MobileSheet>
    <MobileSheet open={referencesOpen} title={t('mobileWorkPaperReferences')} closeLabel={t('close')}
      onClose={() => setReferencesOpen(false)}>
      {referencesLoading ? <p role="status">{t('mobileWorkPaperReferencesLoading')}</p> : null}
      {referencesError ? <p role="alert">{referencesError}</p> : null}
      <button type="button" disabled={referencesLoading} onClick={() => void fetchReferences()}>{t('mobileWorkPaperRefreshReferences')}</button>
      {references ? references.length ? <ol className="kun-mobile-paper-references">
        {references.slice(0, 80).map((item) => <li key={item.n}>
          <strong>{item.title || item.raw || t('mobileWorkPaperReferenceNamed', { number: item.n })}</strong>
          <p>{item.authors?.join(', ')} {item.year} {item.venue}</p>
          {item.doi ? <small>DOI: {item.doi}</small> : null}
        </li>)}</ol> : <p role="status">{t('mobileWorkPaperReferencesEmpty')}</p> : null}
      {references && references.length > 80 ? <p role="status">{t('mobileWorkPaperReferencesLimit', { count: references.length })}</p> : null}
    </MobileSheet>
    <MobileSheet open={translationOpen} title={t('mobileWorkPaperTranslateSelection')} closeLabel={t('close')} onClose={() => setTranslationOpen(false)}>
      <p role={busy ? 'status' : undefined}>{translation}</p>
    </MobileSheet>
  </section>
}
