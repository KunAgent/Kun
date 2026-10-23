import { Check, Copy, Quote } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  normalizeWorkspaceDocumentQuoteText,
  type WorkspaceDocumentQuoteDraft
} from '../lib/workspace-document-quote'

type SelectionToolbarState = {
  draft: WorkspaceDocumentQuoteDraft
  left: number
  top: number
  placement: 'above' | 'below'
}

type Props = {
  bodyRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  sourceName: string
  sourceSha256: string
  onQuoteSelection: (draft: WorkspaceDocumentQuoteDraft) => Promise<boolean> | boolean
}

export function WorkspaceDocxSelectionToolbar({
  bodyRef,
  scrollRef,
  sourceName,
  sourceSha256,
  onQuoteSelection
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [toolbar, setToolbar] = useState<SelectionToolbarState | null>(null)
  const [copied, setCopied] = useState(false)

  const syncSelection = useCallback((): void => {
    const body = bodyRef.current
    const viewport = scrollRef.current
    const selection = window.getSelection()
    if (!body || !viewport || !selection || selection.isCollapsed || selection.rangeCount < 1) {
      setToolbar(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) {
      setToolbar(null)
      return
    }
    const text = normalizeWorkspaceDocumentQuoteText(selection.toString())
    const pages = selectedDocxPageRange(range, body)
    if (!text || !pages) {
      setToolbar(null)
      return
    }
    const rect = visibleRangeRect(range)
    if (!rect) {
      setToolbar(null)
      return
    }
    const viewportRect = viewport.getBoundingClientRect()
    const position = documentSelectionToolbarPosition(rect, viewportRect, {
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      viewportWidth: viewport.clientWidth,
      scale: viewport.offsetHeight > 0 && viewportRect.height > 0 ? viewportRect.height / viewport.offsetHeight : 1
    })
    setCopied(false)
    setToolbar({
      draft: {
        sourceName,
        documentFormat: 'docx',
        sourceSha256,
        pageStart: pages.pageStart,
        pageEnd: pages.pageEnd,
        text
      },
      ...position
    })
  }, [bodyRef, scrollRef, sourceName, sourceSha256])

  useEffect(() => {
    const viewport = scrollRef.current
    document.addEventListener('selectionchange', syncSelection)
    viewport?.addEventListener('scroll', syncSelection)
    window.addEventListener('resize', syncSelection)
    return () => {
      document.removeEventListener('selectionchange', syncSelection)
      viewport?.removeEventListener('scroll', syncSelection)
      window.removeEventListener('resize', syncSelection)
    }
  }, [scrollRef, syncSelection])

  if (!toolbar) return null
  const transform = toolbar.placement === 'above'
    ? 'translate(-50%, calc(-100% - 8px))'
    : 'translate(-50%, 8px)'

  const preserveSelection = (event: ReactPointerEvent): void => event.preventDefault()
  const quoteSelection = async (): Promise<void> => {
    if (!await onQuoteSelection(toolbar.draft)) return
    window.getSelection()?.removeAllRanges()
    setToolbar(null)
  }
  const copySelection = async (): Promise<void> => {
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(toolbar.draft.text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      role="toolbar"
      aria-label={t('filePreviewSelectionActions')}
      className="ds-no-drag absolute z-30 flex h-9 select-none items-center rounded-lg border border-ds-border bg-ds-card px-1 shadow-lg"
      style={{ left: toolbar.left, top: toolbar.top, transform }}
      onPointerDown={preserveSelection}
    >
      <button
        type="button"
        data-docx-quote-selection
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-accent/10"
        onClick={() => void quoteSelection()}
      >
        <Quote className="h-3.5 w-3.5" strokeWidth={2} />
        {t('filePreviewQuoteSelection')}
      </button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-ds-border-muted" />
      <button
        type="button"
        data-docx-copy-selection
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        onClick={() => void copySelection()}
      >
        {copied
          ? <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
          : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
        {copied ? t('filePreviewSelectionCopied') : t('filePreviewCopySelection')}
      </button>
    </div>
  )
}

export function selectedDocxPageRange(
  range: Range,
  body: HTMLElement
): { pageStart: number; pageEnd: number } | null {
  const pages = Array.from(body.querySelectorAll<HTMLElement>('[data-docx-page-wrapper]'))
  const selected = pages.flatMap((page) => {
    try {
      const index = Number(page.dataset.docxPageIndex)
      return range.intersectsNode(page) && Number.isInteger(index) ? [index + 1] : []
    } catch {
      return []
    }
  })
  if (selected.length === 0) return null
  return { pageStart: selected[0]!, pageEnd: selected[selected.length - 1]! }
}

/**
 * Rects are in screen pixels, which the app's body zoom scales, while the pane's
 * scroll offsets and the toolbar's own position are in layout pixels; `scale` is
 * the ratio between the two.
 */
export function documentSelectionToolbarPosition(
  rangeRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>,
  viewportRect: Pick<DOMRect, 'left' | 'top'>,
  viewport: { scrollLeft: number; scrollTop: number; viewportWidth: number; scale?: number }
): { left: number; top: number; placement: 'above' | 'below' } {
  const scale = viewport.scale && viewport.scale > 0 ? viewport.scale : 1
  const visibleCenter = (rangeRect.left - viewportRect.left + rangeRect.width / 2) / scale + viewport.scrollLeft
  const minCenter = viewport.scrollLeft + 104
  const maxCenter = viewport.scrollLeft + Math.max(104, viewport.viewportWidth - 104)
  const placement = (rangeRect.top - viewportRect.top) / scale >= 48 ? 'above' : 'below'
  return {
    left: Math.min(maxCenter, Math.max(minCenter, visibleCenter)),
    top: ((placement === 'above' ? rangeRect.top : rangeRect.bottom) - viewportRect.top) / scale + viewport.scrollTop,
    placement
  }
}

function visibleRangeRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
  const rect = rects.at(-1) ?? range.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? rect : null
}
