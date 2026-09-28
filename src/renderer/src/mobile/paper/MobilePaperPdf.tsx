import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaperHighlight, PaperRect } from '@shared/paper/paper-marks-types'
import { useWritePdfDocument } from '../../components/write/use-write-pdf-document'
import { WritePdfPage, selectionFromPdf } from '../../components/write/WritePdfPage'

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
  const root = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(initialPage)
  const [scale, setScale] = useState(0.72)
  const [selection, setSelection] = useState<Selection | null>(null)
  const publishSelection = useCallback(() => undefined, [])
  const pdf = useWritePdfDocument({ filePath: path, dataBase64: '', url, mtimeMs: 0, publishSelection })
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
  return <>
    <div className="kun-mobile-paper-reader-controls">
      <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</button>
      <label>第 <input type="number" min={1} max={pdf.pageCount} value={page}
        onChange={(event) => changePage(Number(event.target.value))} style={{ width: 58 }} /> / {pdf.pageCount} 页</label>
      <button type="button" disabled={page >= pdf.pageCount} onClick={() => changePage(page + 1)}>下一页</button>
      <button type="button" onClick={() => setScale((old) => Math.max(.3, old - .15))}>缩小</button>
      <button type="button" onClick={() => setScale((old) => Math.min(2, old + .15))}>放大</button>
    </div>
    <div className="kun-mobile-paper-reader-body" ref={root} onPointerUp={capture} onTouchEnd={capture}>
      {pdf.loading ? <p role="status">PDF 加载中…</p> : null}
      {pdf.error ? <p role="alert">{pdf.error}</p> : null}
      {pdf.pdfDocument ? <div className="kun-mobile-paper-page">
        <WritePdfPage key={`${page}:${scale}`} document={pdf.pdfDocument} pageNumber={page}
          scale={scale} selectionRects={[]} onPageText={pdf.updatePageText} />
        {marks.filter((mark) => mark.page === page).flatMap((mark) => mark.rects.map((rect, index) =>
          <div key={`${mark.id}-${index}`} aria-label="标注" title={mark.comment || mark.quote}
            style={{ position: 'absolute', pointerEvents: 'none', left: `${rect[0] * 100}%`,
              top: `${rect[1] * 100}%`, width: `${rect[2] * 100}%`, height: `${rect[3] * 100}%`,
              backgroundColor: 'rgba(255, 215, 90, .26)' }} />))}
      </div> : null}
    </div>
    {selection ? <div className="kun-mobile-paper-selection-actions">
      <button type="button" onClick={() => { onHighlight(selection); setSelection(null) }}>标注</button>
      <button type="button" onClick={() => { onTranslate(selection); setSelection(null) }}>翻译</button>
      <button type="button" onClick={() => { onQuote(selection); setSelection(null) }}>引用提问</button>
      <button type="button" onClick={() => setSelection(null)}>取消选择</button>
    </div> : null}
  </>
}

/** PDF.js fetches the authenticated workspace preview URL; no base64 IPC copy. */
export function MobilePaperPdf(props: Props) {
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
  if (error) return <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></p>
  if (!pdfUrl || pdfUrl.path !== props.path) return <p role="status">正在打开主机 PDF…</p>
  return <MobilePdfPage key={props.path} {...props} url={pdfUrl.url} />
}
