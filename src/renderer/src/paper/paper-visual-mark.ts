import type { PDFPageProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperRect } from '@shared/paper/paper-marks-types'

/**
 * R2.4 region marks: capture helpers. `cropPageRegionPng` re-renders the PDF
 * page into an offscreen canvas at 2x, crops the normalized rect, and caps
 * the longest edge so the PNG stays well under the IPC size limit.
 */

export const PAPER_REGION_MIN_DRAG_PX = 12
export const PAPER_REGION_MAX_EDGE_PX = 1600
export const PAPER_REGION_RENDER_SCALE = 2

/** Normalize a dragged rect: clamp to 0..1 and flip when dragged backwards. */
export function normalizeDragRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  height: number
): PaperRect | null {
  if (width <= 0 || height <= 0) return null
  const x0 = Math.min(ax, bx) / width
  const y0 = Math.min(ay, by) / height
  const x1 = Math.max(ax, bx) / width
  const y1 = Math.max(ay, by) / height
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  const rect: PaperRect = [
    clamp01(x0),
    clamp01(y0),
    clamp01(x1) - clamp01(x0),
    clamp01(y1) - clamp01(y0)
  ]
  if (rect[2] <= 0 || rect[3] <= 0) return null
  return rect
}

export type PaperRegionCapture = {
  /** data:image/png;base64 — for instant in-app display. */
  dataUrl: string
  /** Raw base64 payload — for the IPC save. */
  base64: string
}

/**
 * Render the page region to a PNG. The rect is normalized to the unscaled
 * page box; rendering happens at `PAPER_REGION_RENDER_SCALE` and the longest
 * resulting edge is downscaled to `PAPER_REGION_MAX_EDGE_PX`.
 */
export async function cropPageRegionPng(
  page: PDFPageProxy,
  rect: PaperRect
): Promise<PaperRegionCapture | null> {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = PAPER_REGION_RENDER_SCALE
  const viewport = page.getViewport({ scale })
  const [rx, ry, rw, rh] = rect
  // pdf.js viewport y grows downward already once rendered to canvas — the
  // normalized rect maps directly onto canvas pixel space.
  const sx = Math.round(rx * viewport.width)
  const sy = Math.round(ry * viewport.height)
  const sw = Math.max(1, Math.round(rw * viewport.width))
  const sh = Math.max(1, Math.round(rh * viewport.height))

  const full = document.createElement('canvas')
  full.width = Math.ceil(viewport.width)
  full.height = Math.ceil(viewport.height)
  const ctx = full.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, full.width, full.height)
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport: page.getViewport({ scale })
  }).promise

  const longest = Math.max(sw, sh)
  const shrink = longest > PAPER_REGION_MAX_EDGE_PX
    ? PAPER_REGION_MAX_EDGE_PX / longest
    : 1
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw * shrink))
  out.height = Math.max(1, Math.round(sh * shrink))
  const outCtx = out.getContext('2d')
  if (!outCtx) return null
  // Cover the white margin under transparent glyphs so the card thumbnail
  // reads like paper, not like a dark-mode hole.
  outCtx.fillStyle = '#ffffff'
  outCtx.fillRect(0, 0, out.width, out.height)
  outCtx.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)

  const dataUrl = out.toDataURL('image/png')
  const base64 = dataUrl.slice('data:image/png;base64,'.length)
  if (!base64) return null
  return { dataUrl, base64 }
}
