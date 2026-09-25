import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { expandCitationNumbers, findPaperCitations, type PaperCitationHit } from '../../../paper/pdf-citation-resolve'
import { usePaperReaderServices } from './paper-reader-context'
import { PaperCitationCard } from './PaperCitationCard'
import type { PaperPageLayerProps } from './PaperPageStack'

type CssRect = { left: number; top: number; width: number; height: number }

type CitationTarget = { hit: PaperCitationHit; rects: CssRect[] }
type LinkTarget =
  | { kind: 'external'; url: string; rect: CssRect }
  | { kind: 'internal'; rect: CssRect; jump: () => void }

/** Sticky hover window for the citation card (R2.5 spec: ~200ms). */
const CARD_CLOSE_DELAY_MS = 200
const CITATION_SCAN_DEBOUNCE_MS = 150

/**
 * R2.5 page layer: PDF link annotations + citation/cross-reference hitboxes
 * derived from the rendered text layer. Citation hits resolve through
 * references.json / figures/index.json (lazy, cached by the reader context);
 * unresolved ones fall back to a jump-to-references card. External links open
 * in the system browser; internal links jump pages with a flash highlight.
 */
export function PaperLinkLayer({ page, viewport }: PaperPageLayerProps): ReactElement {
  const { t } = useTranslation('common')
  const services = usePaperReaderServices()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [citations, setCitations] = useState<CitationTarget[]>([])
  const [links, setLinks] = useState<LinkTarget[]>([])
  const [card, setCard] = useState<{ hit: PaperCitationHit; x: number; y: number } | null>(null)
  const cardCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const scheduleCardClose = useCallback(() => {
    if (cardCloseTimer.current) clearTimeout(cardCloseTimer.current)
    cardCloseTimer.current = setTimeout(() => setCard(null), CARD_CLOSE_DELAY_MS)
  }, [])
  const cancelCardClose = useCallback(() => {
    if (cardCloseTimer.current) clearTimeout(cardCloseTimer.current)
    cardCloseTimer.current = null
  }, [])

  // Citation hitboxes: walk text-layer DOM nodes once rendered; a match's
  // Range client rects become overlay coordinates relative to the page.
  useEffect(() => {
    const host = hostRef.current
    const wrapper = host?.closest<HTMLElement>('[data-paper-page]')
    if (!host || !wrapper || !viewport) return
    let debounce: ReturnType<typeof setTimeout> | null = null

    const scan = (): void => {
      const textLayer = wrapper.querySelector<HTMLElement>('.write-pdf-text-layer')
      const wrapperRect = wrapper.getBoundingClientRect()
      if (!textLayer || !textLayer.childElementCount || wrapperRect.width === 0) {
        setCitations((prev) => (prev.length ? [] : prev))
        return
      }
      const targets: CitationTarget[] = []
      const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const text = node.textContent ?? ''
        if (text.trim().length >= 2) {
          for (const hit of findPaperCitations(text)) {
            const range = document.createRange()
            try {
              range.setStart(node, hit.start)
              range.setEnd(node, hit.end)
            } catch {
              continue
            }
            const rects = Array.from(range.getClientRects())
              .map((r) => ({
                left: r.left - wrapperRect.left,
                top: r.top - wrapperRect.top,
                width: r.width,
                height: r.height
              }))
              .filter((r) => r.width > 0 && r.height > 0)
            range.detach()
            if (rects.length) targets.push({ hit, rects })
          }
        }
        node = walker.nextNode()
      }
      // Superscript citation runs: pdf.js emits them as smaller-font spans
      // ("12,13" style). Compare each span's font-size to the page maximum.
      let maxFont = 0
      const spans = Array.from(textLayer.querySelectorAll<HTMLElement>('span'))
      for (const span of spans) {
        const size = Number.parseFloat(span.style.fontSize || '')
        if (size > maxFont) maxFont = size
      }
      if (maxFont > 0) {
        for (const span of spans) {
          const text = span.textContent ?? ''
          const size = Number.parseFloat(span.style.fontSize || '0')
          if (!/^\d+(?:[,\s–-]\d+)*$/.test(text) || size >= maxFont * 0.72) continue
          const numbers = expandCitationNumbers(text)
          if (!numbers.length) continue
          const rect = span.getBoundingClientRect()
          const css: CssRect = {
            left: rect.left - wrapperRect.left,
            top: rect.top - wrapperRect.top,
            width: rect.width,
            height: Math.max(rect.height, 6)
          }
          if (css.width > 0) {
            targets.push({
              hit: { kind: 'reference', raw: text, start: 0, end: text.length, numbers },
              rects: [css]
            })
          }
        }
      }
      setCitations(targets)
    }

    const schedule = (): void => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(scan, CITATION_SCAN_DEBOUNCE_MS)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(wrapper, { childList: true, subtree: true })
    schedule()
    return () => {
      observer.disconnect()
      if (debounce) clearTimeout(debounce)
    }
  }, [viewport])

  const pdfDocument = services?.pdfDocument ?? null

  // Link annotations: pdf.js getAnnotations gives rects in PDF user units;
  // convert via a viewport built at the rendered CSS width.
  useEffect(() => {
    if (!pdfDocument || !viewport || viewport.width === 0) return
    let cancelled = false
    const jumpToDest = async (dest: unknown): Promise<void> => {
      try {
        const resolved = typeof dest === 'string' ? await pdfDocument.getDestination(dest) : dest
        const ref = Array.isArray(resolved) ? resolved[0] : null
        if (ref) {
          const index = await pdfDocument.getPageIndex(ref as never)
          services?.jumpToPage(index + 1)
        }
      } catch {
        // Unresolvable destination — ignore.
      }
    }
    void (async () => {
      const pageProxy = await pdfDocument.getPage(page).catch(() => null)
      if (!pageProxy || cancelled) return
      const unitViewport = pageProxy.getViewport({ scale: 1 })
      const cssViewport = pageProxy.getViewport({ scale: viewport.width / unitViewport.width })
      const annotations = await pageProxy.getAnnotations().catch(() => [])
      if (cancelled) return
      const targets: LinkTarget[] = []
      for (const annotation of annotations) {
        const isLink = annotation.annotationType === 2 || annotation.subtype === 'Link'
        if (!isLink || !annotation.rect) continue
        const [x1, y1, x2, y2] = cssViewport.convertToViewportRectangle(annotation.rect)
        const rect: CssRect = {
          left: Math.min(x1, x2),
          top: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1)
        }
        if (rect.width === 0 || rect.height === 0) continue
        const url = annotation.url ?? annotation.unsafeUrl
        if (url && /^https?:/i.test(url)) {
          targets.push({ kind: 'external', url, rect })
          continue
        }
        const dest = annotation.dest ?? annotation.destName
        if (dest) {
          targets.push({
            kind: 'internal',
            rect,
            jump: () => { void jumpToDest(dest) }
          })
        }
      }
      setLinks(targets)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, viewport, pdfDocument])

  const suppressed = services?.linksSuppressed ?? true

  const openCitationCard = (target: CitationTarget): void => {
    cancelCardClose()
    const first = target.rects[0]
    const last = target.rects[target.rects.length - 1]
    setCard({
      hit: target.hit,
      // Card sits just under the last rect of the citation span, nudged
      // inward so it stays readable near the page edge.
      x: Math.max(4, Math.min(last.left, (viewport?.width ?? 0) - 250)),
      y: Math.max(4, last.top + last.height + 4) || first.top + first.height + 4
    })
  }

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[4]">
      {suppressed
        ? null
        : (
          <>
            {links.map((link, index) => (
              <button
                key={`link-${index}`}
                type="button"
                className="pointer-events-auto absolute rounded-[3px] transition-colors hover:bg-accent/15"
                style={link.rect}
                title={link.kind === 'external' ? link.url : undefined}
                aria-label={link.kind === 'external' ? link.url : t('writePaperCitationInternalLink')}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (link.kind === 'external') void window.kunGui?.openExternal?.(link.url)
                  else link.jump()
                }}
                onPointerDown={(event) => event.stopPropagation()}
              />
            ))}
            {citations.map((target, index) =>
              target.rects.map((rect, rectIndex) => (
                <button
                  key={`cite-${index}-${rectIndex}`}
                  type="button"
                  className="pointer-events-auto absolute rounded-[2px] transition-colors hover:bg-accent/15"
                  style={rect}
                  aria-label={target.hit.raw}
                  onPointerEnter={() => openCitationCard(target)}
                  onPointerLeave={scheduleCardClose}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.preventDefault()}
                />
              ))
            )}
            {card ? (
              <div
                ref={cardRef}
                className="pointer-events-auto absolute"
                style={{ left: card.x, top: card.y }}
                onPointerEnter={cancelCardClose}
                onPointerLeave={scheduleCardClose}
              >
                <PaperCitationCard hit={card.hit} anchor={{ x: 0, y: 0 }} onCloseIntent={() => setCard(null)} t={t} />
              </div>
            ) : null}
          </>
          )}
    </div>
  )
}
