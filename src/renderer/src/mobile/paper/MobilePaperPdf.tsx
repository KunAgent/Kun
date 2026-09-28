import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperHighlight, PaperRect } from '@shared/paper/paper-marks-types'
import type { PDFOutlineItem } from 'pdfjs-dist/build/pdf.mjs'
import { useWritePdfDocument } from '../../components/write/use-write-pdf-document'
import { WritePdfPage, selectionFromPdf } from '../../components/write/WritePdfPage'
import { MobileSheet } from '../sheets/MobileSheet'
import { findPaperPdfPage, flattenPaperOutline, resolvePaperOutlinePage } from './mobile-paper-pdf-tools'

type Selection = { text: string; page: number; rects: PaperRect[] }

type Props = {
  workspaceRoot: string
  path: string
  initialPage: number
  marks: PaperHighlight[]
  onPage: (page: number, count: number) => void
  onQuote: (selection: Selection) => void
  onHighlight: (selection: Selection) => void
  onTranslate: (selection: Selection) => void
}

function MobilePdfPage({ url, path, initialPage, marks, onPage, onQuote, onHighlight, onTranslate }: Props & {
  url: string
}) {
  const { t } = useTranslation('common')
  const root = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(initialPage)
  const [scale, setScale] = useState(0.72)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const searchGeneration = useRef(0)
  const [toolsOpen, setToolsOpen] = useState<'search' | 'outline' | null>(null)
  const outlineOpen = toolsOpen === 'outline'
  const [outline, setOutline] = useState<PDFOutlineItem[] | null>(null)
  useEffect(() => { setPage(initialPage); setSelection(null) }, [initialPage])
  const publishSelection = useCallback(() => undefined, [])
  const pdf = useWritePdfDocument({ filePath: path, dataBase64: '', url, mtimeMs: 0, publishSelection })
  useEffect(() => () => { searchGeneration.current += 1 }, [pdf.pdfDocument])
  useEffect(() => {
    if (!outlineOpen || !pdf.pdfDocument) return
    let live = true
    setOutline(null)
    void pdf.pdfDocument.getOutline().then((items) => { if (live) setOutline(items ?? []) })
      .catch((cause: unknown) => { if (live) setSearchMessage(t('mobileWorkPaperOutlineFailed', { error: String(cause) })) })
    return () => { live = false }
  }, [outlineOpen, pdf.pdfDocument, t])
  useEffect(() => {
    if (!pdf.pdfDocument) return
    let canceled = false
    const resize = async (): Promise<void> => {
      const first = await pdf.pdfDocument!.getPage(1)
      if (canceled) return
      const width = first.getViewport({ scale: 1 }).width
      setScale(Math.min(1.4, Math.max(.35, (window.innerWidth - 32) / width)))
    }
    void resize()
    window.addEventListener('resize', resize)
    return () => { canceled = true; window.removeEventListener('resize', resize) }
  }, [pdf.pdfDocument])
  useEffect(() => {
    if (pdf.pageCount > 0 && page > pdf.pageCount) setPage(pdf.pageCount)
  }, [pdf.pageCount, page])
  useEffect(() => {
    if (pdf.pageCount) onPage(Math.min(page, pdf.pageCount), pdf.pageCount)
  }, [page, pdf.pageCount, onPage])
  const capture = (): void => {
    window.setTimeout(() => {
      if (!root.current) return
      const next = selectionFromPdf(root.current)
      if (!next.text.trim() || !next.rects?.length) return
      const rects = next.rects.flatMap((rect): PaperRect[] => {
        const host = root.current?.querySelector<HTMLElement>(`[data-write-pdf-page="${rect.page}"]`)
        if (!host?.offsetWidth || !host.offsetHeight) return []
        return [[rect.x / host.offsetWidth, rect.y / host.offsetHeight,
          rect.width / host.offsetWidth, rect.height / host.offsetHeight]
          .map((value) => Math.max(0, Math.min(1, value))) as PaperRect]
      }).slice(0, 64)
      if (rects.length) setSelection({ text: next.text.slice(0, 8000), page, rects })
    }, 30)
  }
  const changePage = (value: number): void => {
    setPage(Math.max(1, Math.min(pdf.pageCount, value))); setSelection(null)
  }
  const search = async (): Promise<void> => {
    if (!pdf.pdfDocument || !query.trim() || searching) return
    const serial = ++searchGeneration.current
    setSearching(true); setSearchMessage(t('mobileWorkPaperSearchingPdf'))
    try {
      const found = await findPaperPdfPage(pdf.pdfDocument, query, page, () => serial !== searchGeneration.current)
      if (serial !== searchGeneration.current) return
      if (found) { changePage(found); setSearchMessage(t('mobileWorkPaperSearchFound', { page: found })) }
      else setSearchMessage(t('mobileWorkPaperNoSearchResult'))
    } catch (cause) { if (serial === searchGeneration.current) setSearchMessage(t('mobileWorkPaperSearchFailed', { error: String(cause) })) }
    finally { if (serial === searchGeneration.current) setSearching(false) }
  }
  const jumpOutline = async (item: PDFOutlineItem): Promise<void> => {
    if (!pdf.pdfDocument) return
    try {
      const target = await resolvePaperOutlinePage(pdf.pdfDocument, item)
      if (target) { changePage(target); setToolsOpen(null) }
      else setSearchMessage(t('mobileWorkPaperOutlineMissingTarget'))
    } catch (cause) { setSearchMessage(t('mobileWorkPaperOutlineJumpFailed', { error: String(cause) })) }
  }
  return <>
    <div className="kun-mobile-paper-reader-controls">
      <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}>{t('mobileWorkPaperPrevPage')}</button>
      <label>{t('mobileWorkPaperPageInput')} <input type="number" min={1} max={pdf.pageCount} value={page}
        aria-label={t('mobileWorkPaperPageOf', { page, total: pdf.pageCount })}
        onChange={(event) => changePage(Number(event.target.value))} style={{ width: 58 }} /> {t('mobileWorkPaperOfPages', { total: pdf.pageCount })}</label>
      <button type="button" disabled={page >= pdf.pageCount} onClick={() => changePage(page + 1)}>{t('mobileWorkPaperNextPage')}</button>
      <button type="button" onClick={() => setScale((old) => Math.max(.3, old - .15))}>{t('mobileWorkPaperZoomOut')}</button>
      <button type="button" onClick={() => setScale((old) => Math.min(2, old + .15))}>{t('mobileWorkPaperZoomIn')}</button>
      <button type="button" disabled={!pdf.pdfDocument} onClick={() => { setSearchMessage(''); setToolsOpen('search') }}>{t('mobileWorkPaperSearchPdf')}</button>
      <button type="button" disabled={!pdf.pdfDocument} onClick={() => { setSearchMessage(''); setToolsOpen('outline') }}>{t('mobileWorkPaperOutline')}</button>
    </div>
    <MobileSheet open={toolsOpen === 'search'} title={t('mobileWorkPaperSearchPdf')} closeLabel={t('close')}
      onClose={() => { searchGeneration.current += 1; setSearching(false); setToolsOpen(null) }}>
      <form className="kun-mobile-paper-pdf-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
        <label>{t('mobileWorkPaperSearchPdf')} <input type="search" maxLength={120} value={query}
          onChange={(event) => { searchGeneration.current += 1; setSearching(false); setQuery(event.target.value) }} /></label>
        <button type="submit" disabled={!pdf.pdfDocument || !query.trim() || searching}>{t('mobileWorkPaperFind')}</button>
        {searching ? <button type="button" onClick={() => { searchGeneration.current += 1
          setSearching(false); setSearchMessage(t('mobileWorkPaperSearchCancelled')) }}>{t('mobileWorkPaperCancel')}</button> : null}
      </form>
      {searchMessage ? <p role="status" className="kun-mobile-paper-search-status">{searchMessage}</p> : null}
    </MobileSheet>
    <MobileSheet open={outlineOpen} title={t('mobileWorkPaperOutline')} closeLabel={t('close')}
      onClose={() => setToolsOpen(null)}>
      <div className="kun-mobile-paper-outline">
        {outline === null ? <p role="status">{t('mobileWorkPaperOutlineLoading')}</p>
          : outline.length ? <ul>{flattenPaperOutline(outline).map(({ item, depth }, index) =>
            <li key={index}><button type="button" style={{ paddingLeft: `${12 + depth * 12}px` }}
              onClick={() => void jumpOutline(item)}>{item.title}</button></li>)}</ul>
            : <p role="status">{t('mobileWorkPaperNoOutline')}</p>}
        {searchMessage ? <p role="status">{searchMessage}</p> : null}
      </div>
    </MobileSheet>
    <div className="kun-mobile-paper-reader-body" ref={root} onPointerUp={capture} onTouchEnd={capture}>
      {pdf.loading ? <p role="status">{t('mobileWorkPaperPdfLoading')}</p> : null}
      {pdf.error ? <p role="alert">{pdf.error}</p> : null}
      {pdf.pdfDocument ? <div className="kun-mobile-paper-page">
        <WritePdfPage key={`${page}:${scale}`} document={pdf.pdfDocument} pageNumber={page}
          scale={scale} selectionRects={[]} onPageText={pdf.updatePageText} />
        {marks.filter((mark) => mark.page === page).flatMap((mark) => mark.rects.map((rect, index) =>
          <div key={`${mark.id}-${index}`} aria-label={t('mobileWorkPaperHighlight')} title={mark.comment || mark.quote}
            style={{ position: 'absolute', pointerEvents: 'none', left: `${rect[0] * 100}%`,
              top: `${rect[1] * 100}%`, width: `${rect[2] * 100}%`, height: `${rect[3] * 100}%`,
              backgroundColor: 'rgba(255, 215, 90, .26)' }} />))}
      </div> : null}
    </div>
    {selection ? <div className="kun-mobile-paper-selection-actions">
      <button type="button" onClick={() => { onHighlight(selection); setSelection(null) }}>{t('mobileWorkPaperHighlight')}</button>
      <button type="button" onClick={() => { onTranslate(selection); setSelection(null) }}>{t('mobileWorkPaperTranslateSelection')}</button>
      <button type="button" onClick={() => { onQuote(selection); setSelection(null) }}>{t('mobileWorkPaperQuoteAsk')}</button>
      <button type="button" onClick={() => setSelection(null)}>{t('mobileWorkPaperCancelSelection')}</button>
    </div> : null}
  </>
}

/** PDF.js fetches the authenticated workspace preview URL; no base64 IPC copy. */
export function MobilePaperPdf(props: Props) {
  const { t } = useTranslation('common')
  const [pdfUrl, setPdfUrl] = useState<{ path: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    let leaseId: string | null = null
    setPdfUrl(null); setError('')
    void window.kunGui.openWorkspacePreviewResource({ workspaceRoot: props.workspaceRoot, path: props.path })
      .then((result) => {
        if (!result.ok) { if (live) setError(result.message); return }
        leaseId = result.leaseId
        if (live) setPdfUrl({ path: props.path, url: result.url })
        else void window.kunGui.releaseWorkspacePreviewResource({ leaseId: result.leaseId })
      }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => {
      live = false
      if (leaseId) void window.kunGui.releaseWorkspacePreviewResource({ leaseId })
    }
  }, [props.workspaceRoot, props.path, retry])
  if (error) return <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('mobileWorkPaperRetry')}</button></p>
  if (!pdfUrl || pdfUrl.path !== props.path) return <p role="status">{t('mobileWorkPaperPdfLoading')}</p>
  return <MobilePdfPage key={props.path} {...props} url={pdfUrl.url} />
}
