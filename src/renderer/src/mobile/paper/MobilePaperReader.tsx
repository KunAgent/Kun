import { useCallback, useEffect, useRef, useState } from 'react'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { paperHighlightSchema, type PaperHighlight, type PaperRect } from '@shared/paper/paper-marks-types'
import { MobilePaperPdf } from './MobilePaperPdf'
import { MobilePaperNotes } from './MobilePaperNotes'
import { MobilePaperAssistant } from './MobilePaperAssistant'
import { paperResourceKey } from './paper-resource-key'
import { mobilePaperLibraryRoot } from './mobile-paper-library-root'
import type { PaperResourceView } from '../navigation/mobile-page'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
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
  const paperMode = useWriteWorkspaceStore((state) => state.paperMode)
  const papersDir = useWriteWorkspaceStore((state) => state.paperReading.papersDir)
  const workspaceRoot = useWriteWorkspaceStore((state) => state.workspaceRoot)
  const root = mobilePaperLibraryRoot(paperMode.libraries, paperMode.activeLibrary, workspaceRoot)
  const setEntriesResult = usePaperModeStore((state) => state.setEntriesResult)
  const [entry, setEntry] = useState<PaperLibraryEntry | null>(null)
  const [unit, setUnit] = useState<Extract<PaperUnitReadResult, { ok: true }> | null>(null)
  const [error, setError] = useState('')
  const [marks, setMarks] = useState<PaperHighlight[]>([])
  const marksRef = useRef<PaperHighlight[]>([])
  const writingMarks = useRef(false)
  const [marksReady, setMarksReady] = useState(false)
  const [cards, setCards] = useState<unknown[]>([])
  const [marksDirty, setMarksDirty] = useState(false)
  const [notesDirty, setNotesDirty] = useState(false)
  const [savingMarks, setSavingMarks] = useState(false)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [quote, setQuote] = useState<{ text: string; page: number } | null>(null)
  const [translation, setTranslation] = useState('')
  const [translationOpen, setTranslationOpen] = useState(false)
  const translationSeq = useRef(0)
  const [busy, setBusy] = useState(false)
  const [fetchingPdf, setFetchingPdf] = useState(false)
  const [retry, setRetry] = useState(0)
  const pageTimer = useRef<number | null>(null)
  const unitDir = entry?.unitDir ?? ''
  useEffect(() => () => { translationSeq.current += 1 }, [root, unitDir])
  useEffect(() => {
    let live = true
    setEntry(null); setUnit(null); setMarks([]); marksRef.current = []; setMarksReady(false); setCards([]); setError(''); setQuote(null)
    setMarksDirty(false); setNotesDirty(false)
    if (!root) { setError('请先设置文献库'); return }
    void window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir }).then((result) => {
      if (!live) return
      if (!result.ok) { setError(result.message); return }
      setEntriesResult(result)
      const found = result.entries.find((item) => paperResourceKey(root, item.unitDir) === paperKey)
      if (!found) { setError('论文不存在或文献库已切换'); return }
      setEntry(found); setPage(found.lastPage ?? 1)
      void window.kunGui.paperReadUnit({ workspaceRoot: root, unitDir: found.unitDir }).then((read) => {
        if (live) { if (read.ok) setUnit(read); else setError(read.message) }
      }).catch((cause: unknown) => { if (live) setError(String(cause)) })
      void window.kunGui.paperMarksRead({ workspaceRoot: root, unitDir: found.unitDir }).then((read) => {
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
      void window.kunGui.paperLocalStateWrite({ libraryRoot: root, unitRelDir: found.unitDir,
        patch: { lastOpenedAt: new Date().toISOString() } })
    }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [root, papersDir, paperKey, retry, setEntriesResult])
  useEffect(() => onUnsavedChange(notesDirty || marksDirty), [notesDirty, marksDirty, onUnsavedChange])
  useEffect(() => {
    if (!unitDir || pageCount === 0) return
    if (pageTimer.current !== null) window.clearTimeout(pageTimer.current)
    pageTimer.current = window.setTimeout(() => {
      pageTimer.current = null
      void window.kunGui.paperLocalStateWrite({ libraryRoot: root, unitRelDir: unitDir,
        patch: { lastPage: page, pageCount } })
    }, 700)
    return () => { if (pageTimer.current !== null) window.clearTimeout(pageTimer.current) }
  }, [root, unitDir, page, pageCount])
  const onPage = useCallback((next: number, count: number) => { setPage(next); setPageCount(count) }, [])
  const persistMarks = async (next: PaperHighlight[]): Promise<void> => {
    if (!unitDir || writingMarks.current) return
    writingMarks.current = true
    setSavingMarks(true); setError('')
    let saved = false
    try {
      const result = await window.kunGui.paperMarksWrite({ workspaceRoot: root, unitDir,
        items: [...next, ...cards] })
      if (!result.ok) throw new Error(result.message)
      saved = true
      if (marksRef.current === next) setMarksDirty(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setMarksDirty(true) }
    finally {
      writingMarks.current = false; setSavingMarks(false)
      if (saved && marksRef.current !== next) void persistMarks(marksRef.current)
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
  const translate = (selection: Selection): void => {
    const request = ++translationSeq.current
    setTranslationOpen(true); setTranslation('翻译中…'); setBusy(true)
    const settings = useWriteWorkspaceStore.getState().paperMode.translate
    void window.kunGui.paperTranslateSelection({ text: selection.text,
      targetLanguage: settings.targetLanguage }).then((result) => {
      if (request === translationSeq.current) setTranslation(result.ok ? result.translation : result.message)
    }).catch((cause: unknown) => {
      if (request === translationSeq.current) setTranslation(String(cause))
    }).finally(() => { if (request === translationSeq.current) setBusy(false) })
  }
  const changeView = (next: PaperResourceView): void => {
    if (notesDirty && view === 'notes' && next !== 'notes') { setError('请先保存笔记再切换'); return }
    onView(next)
  }
  const download = (): void => {
    if (!unit?.meta.pdfFile) return
    const path = writeJoinPath(writeJoinPath(root, unitDir), unit.meta.pdfFile)
    void window.kunGui.saveWorkspaceFileAs({ workspaceRoot: root, sourcePath: path,
      suggestedName: unit.meta.pdfFile }).then((result) => { if (!result.ok) setError(result.message) })
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
    <p role={error ? 'alert' : 'status'}>{error || '正在加载论文…'}</p>
    {error ? <button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button> : null}
    <button type="button" onClick={onBack}>返回论文库</button>
  </section>
  const pdfPath = unit.meta.pdfFile
    ? writeJoinPath(writeJoinPath(root, entry.unitDir), unit.meta.pdfFile) : null
  return <section className="kun-mobile-paper-reader">
    <header><button type="button" onClick={onBack} aria-label="返回论文库">‹</button><h1>{unit.meta.title}</h1>
      {pdfPath ? <button type="button" onClick={download}>下载</button> : <span />}</header>
    <nav aria-label="论文视图">{(['read', 'notes', 'assistant', 'info'] as const).map((tab) =>
      <button type="button" key={tab} aria-current={view === tab ? 'page' : undefined}
        onClick={() => changeView(tab)}>{({ read: '阅读', notes: '笔记', assistant: '提问', info: '信息' })[tab]}</button>)}</nav>
    {error ? <p role="alert">{error} {marksDirty ? <button type="button" disabled={savingMarks}
      onClick={() => void persistMarks(marks)}>重试保存标注</button> : null}</p> : null}
    {view === 'read' ? pdfPath ? <MobilePaperPdf workspaceRoot={root} path={pdfPath}
      initialPage={page} marks={marks} onPage={onPage} onHighlight={addHighlight} onTranslate={translate}
      onQuote={(selection) => { setQuote(selection); changeView('assistant') }} />
      : <div className="kun-mobile-paper-reader-body"><p>这篇论文尚无 PDF，可在信息页查看摘要。</p></div> : null}
    {view === 'notes' ? <MobilePaperNotes workspaceRoot={root} unitDir={unitDir} onDirty={setNotesDirty} /> : null}
    {view === 'assistant' ? <MobilePaperAssistant root={root} unitDir={unitDir} page={page}
      quote={quote} onClearQuote={() => setQuote(null)} onSettings={onSettings} /> : null}
    {view === 'info' ? <div className="kun-mobile-paper-reader-body">
      <h2>{unit.meta.title}</h2><p>{unit.meta.authors.join(', ')}</p>
      <p>{unit.meta.year} · {unit.meta.venue}</p><p>{unit.meta.abstract || '暂无摘要'}</p>
      <p>状态：{entry.meta.status ?? 'unread'} · 标签：{entry.meta.tags?.join('、') || '无'}</p>
      {!pdfPath && (unit.meta.pdfUrl || unit.meta.arxivId) ? <button type="button"
        className="kun-mobile-work-sheet-button" disabled={fetchingPdf}
        onClick={() => void fetchMissingPdf()}>{fetchingPdf ? '获取 PDF 中…' : '从论文来源获取 PDF'}</button> : null}
      <p>所在文献库：{root}</p>
    </div> : null}
    <MobileSheet open={translationOpen} title="选中文本翻译" closeLabel="关闭" onClose={() => setTranslationOpen(false)}>
      <p role={busy ? 'status' : undefined}>{translation}</p>
    </MobileSheet>
  </section>
}
