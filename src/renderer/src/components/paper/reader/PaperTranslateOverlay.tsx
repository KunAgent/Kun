import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { PdfTextBlock } from '../../../paper/pdf-text-blocks'
import { usePaperReaderServices } from './paper-reader-context'
import type { PaperPageLayerProps } from './PaperPageStack'

/**
 * R2.2 overlay: translated text painted over each block's bbox on a
 * paper-tone-matched div. Font starts at the block's size (user units → CSS
 * px via the width-derived scale), shrinks to ≥0.8× while the estimated text
 * overflows, line-height relaxes 1.25 → 1.1, and a still-overflowing block
 * may extend downward only until the next overlapping block's top.
 */

type FittedBlock = {
  block: PdfTextBlock
  text: string
  fontPx: number
  lineHeight: number
  /** CSS px bottom override — set when the translation needs extra room. */
  extendTo: number | null
}

/** Rough width of `text` at `fontPx`: CJK ~1em, latin/digits ~0.55em. */
function estimatedTextWidth(text: string, fontPx: number): number {
  let units = 0
  for (const ch of text) {
    units += /[\u3000-\u9fff\uac00-\ud7ff]/.test(ch) ? 1 : 0.55
  }
  return units * fontPx
}

const horizontalOverlap = (a: PdfTextBlock, b: PdfTextBlock): boolean =>
  a.bbox[0] < b.bbox[0] + b.bbox[2] && b.bbox[0] < a.bbox[0] + a.bbox[2]

function fitBlock(
  block: PdfTextBlock,
  text: string,
  scale: number,
  nextTopPx: number | null,
  viewport: { width: number; height: number }
): FittedBlock {
  const boxW = block.bbox[2] * viewport.width
  const boxTopPx = block.bbox[1] * viewport.height
  const boxH = block.bbox[3] * viewport.height
  const baseFont = Math.max(6, block.fontSize * scale)
  const fits = (fp: number, lh: number): boolean =>
    Math.ceil(estimatedTextWidth(text, fp) / Math.max(1, boxW)) * fp * lh <= boxH

  let fontPx = baseFont
  let lineHeight = 1.25
  while (!fits(fontPx, lineHeight) && fontPx > baseFont * 0.8) fontPx -= 0.5
  if (!fits(fontPx, lineHeight)) lineHeight = 1.1

  let extendTo: number | null = null
  if (!fits(fontPx, lineHeight) && nextTopPx !== null) {
    const needed = Math.ceil(estimatedTextWidth(text, fontPx) / Math.max(1, boxW)) * fontPx * lineHeight
    const wanted = boxTopPx + needed
    if (wanted > boxTopPx + boxH && nextTopPx > boxTopPx + boxH) {
      extendTo = Math.min(nextTopPx, wanted)
    }
  }
  return { block, text, fontPx, lineHeight, extendTo }
}

export function PaperTranslateOverlay({ page, viewport }: PaperPageLayerProps): ReactElement | null {
  const services = usePaperReaderServices()
  const [blocks, setBlocks] = useState<PdfTextBlock[] | null>(null)
  const [userWidth, setUserWidth] = useState(0)

  const translations = services?.pageTranslations(page) ?? null

  useEffect(() => {
    let cancelled = false
    if (!services || !viewport) return
    void services.getPageBlocks(page)
      .then((result) => {
        if (!cancelled) {
          setBlocks(result.blocks)
          setUserWidth(result.pageWidth)
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [page, viewport, services])

  const fitted = useMemo<FittedBlock[]>(() => {
    if (!blocks || !translations || !viewport || userWidth === 0) return []
    const scale = viewport.width / userWidth
    const sorted = [...blocks].sort((a, b) => a.bbox[1] - b.bbox[1])
    const out: FittedBlock[] = []
    for (const block of sorted) {
      const text = translations[block.id]
      if (!text) continue
      const next = sorted.find(
        (other) => other.bbox[1] > block.bbox[1] && horizontalOverlap(block, other)
      )
      const nextTopPx = next ? next.bbox[1] * viewport.height : null
      out.push(fitBlock(block, text, scale, nextTopPx, viewport))
    }
    return out
  }, [blocks, translations, viewport, userWidth])

  if (!fitted.length || !viewport) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[3]">
      {fitted.map(({ block, text, fontPx, lineHeight, extendTo }) => (
        <div
          key={block.id}
          className="paper-translate-block absolute overflow-hidden text-justify"
          style={{
            left: `${block.bbox[0] * 100}%`,
            top: `${block.bbox[1] * 100}%`,
            width: `${block.bbox[2] * 100}%`,
            height:
              extendTo !== null
                ? `${((extendTo - block.bbox[1] * viewport.height) / viewport.height) * 100}%`
                : `${block.bbox[3] * 100}%`,
            fontSize: fontPx,
            lineHeight: String(lineHeight)
          }}
        >
          {text}
        </div>
      ))}
    </div>
  )
}
