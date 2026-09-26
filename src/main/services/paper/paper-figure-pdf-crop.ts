/**
 * PDF caption-crop fallback (D5 level 3): locate `Figure N` / `Table N`
 * captions in textContent, bound the artwork region by scanning for body text,
 * union embedded-image bboxes from the operator list, render at 2x, and trim
 * white margins with sharp. Confidence flags let the agent skip bad crops.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadCanvas, loadPdfJs } from '../write-pdf-text-service'

const CROP_RENDER_SCALE = 2
const CROP_TRIM_PADDING_PX = 12
const BODY_TEXT_MIN_CHARS = 6
const FULL_WIDTH_RATIO = 0.6
const HEADER_BAND_RATIO = 0.05
const MAX_PAGES = 120

export type PdfTextLine = {
  /** User-space rect: y grows upward (PDF coordinates). */
  x0: number
  y0: number
  x1: number
  y1: number
  text: string
  charCount: number
}

type PdfTextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

/** Merge textContent items into lines by shared baseline (tolerance ~40% of item height). */
export function aggregateTextLines(items: readonly unknown[]): PdfTextLine[] {
  const runs: Array<{ y: number; height: number; items: Array<{ x: number; w: number; str: string }> }> = []
  for (const raw of items) {
    const item = raw as PdfTextItem
    const str = typeof item.str === 'string' ? item.str : ''
    const t = item.transform
    if (!str.trim() || !t || t.length < 6) continue
    const y = t[5]
    const height = Math.abs(item.height ?? t[3] ?? 8) || 8
    const x = t[4]
    const w = Math.abs(item.width ?? t[0] * str.length) || str.length * height * 0.4
    const tolerance = Math.max(1.5, height * 0.45)
    let run = runs.find((r) => Math.abs(r.y - y) <= Math.max(tolerance, r.height * 0.45))
    if (!run) {
      run = { y, height, items: [] }
      runs.push(run)
    }
    run.items.push({ x, w, str })
    run.height = Math.max(run.height, height)
  }
  const lines: PdfTextLine[] = runs.map((run) => {
    const sorted = [...run.items].sort((a, b) => a.x - b.x)
    const text = sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
    const x0 = Math.min(...sorted.map((i) => i.x))
    const x1 = Math.max(...sorted.map((i) => i.x + i.w))
    // Baseline at run.y; ascender rises ~80% of font height above it.
    return { x0, y0: run.y - run.height * 0.2, x1, y1: run.y + run.height * 0.85, text, charCount: text.length }
  })
  return lines.filter((l) => l.charCount > 0).sort((a, b) => b.y1 - a.y1)
}

export type PdfCaption = {
  kind: 'figure' | 'table'
  label: string
  line: PdfTextLine
}

const CAPTION_RE = /^(Figure|Fig\.?|Table|图|表)\s*(\d+)[.:：]?/i

/** Lines that open with a figure/table caption marker. */
export function findCaptionLines(lines: readonly PdfTextLine[]): PdfCaption[] {
  const captions: PdfCaption[] = []
  for (const line of lines) {
    const m = CAPTION_RE.exec(line.text.trim())
    if (!m) continue
    // Body references like "…as Figure 3 shows…" rarely start a line; a short
    // uppercase tag at line start is caption-shaped.
    const kind = m[1].toLowerCase().startsWith('tab') || /^表/.test(m[1]) ? 'table' : 'figure'
    const label = `${/^(图|表)/.test(m[1]) ? m[1] : m[1].replace(/^Fig\.?$/i, 'Figure')} ${m[2]}`
    captions.push({ kind, label, line })
  }
  return captions
}

export type PdfRegion = { x0: number; y0: number; x1: number; y1: number }

function columnRange(caption: PdfTextLine, pageWidth: number): { x0: number; x1: number } {
  if (caption.x1 - caption.x0 >= pageWidth * FULL_WIDTH_RATIO) {
    return { x0: 0, x1: pageWidth }
  }
  const mid = pageWidth / 2
  const center = (caption.x0 + caption.x1) / 2
  return center < mid ? { x0: 0, x1: mid } : { x0: mid, x1: pageWidth }
}

/**
 * Figures sit above their captions (scan up); table captions sit above the
 * table (scan down). The region ends where 2+ consecutive body-text lines or
 * the header/footer band begin.
 */
export function scanRegionFromCaption(
  caption: PdfCaption,
  lines: readonly PdfTextLine[],
  pageWidth: number,
  pageHeight: number
): PdfRegion {
  const { x0, x1 } = columnRange(caption.line, pageWidth)
  const headerY = pageHeight * (1 - HEADER_BAND_RATIO)
  const footerY = pageHeight * HEADER_BAND_RATIO
  const inColumn = (l: PdfTextLine) => l.x1 > x0 + 2 && l.x0 < x1 - 2 && l !== caption.line
  const isBody = (l: PdfTextLine) => l.charCount >= BODY_TEXT_MIN_CHARS

  if (caption.kind === 'figure') {
    let top = caption.line.y1
    let run = 0
    const above = lines.filter((l) => inColumn(l) && l.y0 >= caption.line.y1 - 1).sort((a, b) => a.y0 - b.y0)
    for (const line of above) {
      if (line.y1 > headerY) break
      if (isBody(line)) {
        run += 1
        if (run >= 2) break
      } else {
        run = 0
      }
      top = Math.max(top, line.y1)
    }
    return { x0, y0: caption.line.y1, x1, y1: Math.min(top, pageHeight) }
  }
  // table: caption above the artwork
  let bottom = caption.line.y0
  let run = 0
  const below = lines.filter((l) => inColumn(l) && l.y1 <= caption.line.y0 + 1).sort((a, b) => b.y1 - a.y1)
  for (const line of below) {
    if (line.y0 < footerY) break
    if (isBody(line)) {
      run += 1
      if (run >= 2) break
    } else {
      run = 0
    }
    bottom = Math.min(bottom, line.y0)
  }
  return { x0, y0: Math.max(bottom, 0), x1, y1: caption.line.y0 }
}

/** Track the CTM through the operator list to find painted-image bboxes. */
export async function paintedImageRegions(page: PDFPageProxy): Promise<PdfRegion[]> {
  const pdfjs = await loadPdfJs()
  const ops = await page.getOperatorList()
  const regions: PdfRegion[] = []
  let ctm: number[] = [1, 0, 0, 1, 0, 0]
  const multiply = (m1: number[], m2: number[]): number[] => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ]
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === pdfjs.OPS.transform && Array.isArray(args) && args.length >= 6) {
      ctm = multiply(ctm, args.slice(0, 6) as number[])
    } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintImageXObjectRepeat) {
      // The image paints the unit square under the current transform.
      const corners = [
        [0, 0], [1, 0], [0, 1], [1, 1]
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]])
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      regions.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    }
  }
  return regions
}

export type CropCandidate = {
  caption: PdfCaption
  region: PdfRegion
  /** Region expanded to cover overlapping embedded images. */
  regionWithImages: PdfRegion
  confidence: 'high' | 'medium' | 'low'
}

function overlaps(a: PdfRegion, b: PdfRegion): boolean {
  return a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1
}

function union(a: PdfRegion, b: PdfRegion): PdfRegion {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1)
  }
}

export function scoreCropCandidate(
  region: PdfRegion,
  pageHeight: number,
  lines: readonly PdfTextLine[],
  caption: PdfCaption
): 'high' | 'medium' | 'low' {
  const height = region.y1 - region.y0
  const heightOk = height >= pageHeight * 0.1 && height <= pageHeight * 0.85
  const textFree = !lines.some(
    (l) => l !== caption.line && l.charCount >= BODY_TEXT_MIN_CHARS && overlaps(l, region)
  )
  if (heightOk && textFree) return 'high'
  if (heightOk || textFree) return 'medium'
  return 'low'
}

export async function findCaptionCropCandidates(page: PDFPageProxy): Promise<CropCandidate[]> {
  const content = await page.getTextContent()
  const lines = aggregateTextLines(content.items ?? [])
  const viewport = page.getViewport({ scale: 1 })
  const pageWidth = viewport.width
  const pageHeight = viewport.height
  const captions = findCaptionLines(lines)
  const images = await paintedImageRegions(page)
  return captions.map((caption) => {
    const region = scanRegionFromCaption(caption, lines, pageWidth, pageHeight)
    let regionWithImages = region
    for (const img of images) {
      if (overlaps(region, img)) regionWithImages = union(regionWithImages, img)
    }
    regionWithImages = {
      x0: Math.max(0, regionWithImages.x0),
      y0: Math.max(0, regionWithImages.y0),
      x1: Math.min(pageWidth, regionWithImages.x1),
      y1: Math.min(pageHeight, regionWithImages.y1)
    }
    return {
      caption,
      region,
      regionWithImages,
      confidence: scoreCropCandidate(regionWithImages, pageHeight, lines, caption)
    }
  })
}

/** Render a page region to a white-background PNG and trim the white margin. */
export async function renderRegionPng(
  page: PDFPageProxy,
  region: PdfRegion,
  pageWidth: number,
  pageHeight: number
): Promise<{ png: Buffer; width: number; height: number } | null> {
  const canvasModule = await loadCanvas()
  const viewport = page.getViewport({ scale: CROP_RENDER_SCALE })
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport
  }).promise
  // PDF y grows upward; canvas y grows downward.
  const left = Math.max(0, Math.floor(region.x0 * CROP_RENDER_SCALE))
  const top = Math.max(0, Math.floor((pageHeight - region.y1) * CROP_RENDER_SCALE))
  const width = Math.min(canvas.width - left, Math.ceil((region.x1 - region.x0) * CROP_RENDER_SCALE))
  const height = Math.min(canvas.height - top, Math.ceil((region.y1 - region.y0) * CROP_RENDER_SCALE))
  if (width < 16 || height < 16) return null
  const cropped = canvasModule.createCanvas(width, height)
  const cropContext = cropped.getContext('2d')
  cropContext.drawImage(canvas, left, top, width, height, 0, 0, width, height)
  const rawPng = cropped.toBuffer('image/png')

  const sharp = (await import('sharp')).default
  const trimmed = await sharp(rawPng)
    .trim({ threshold: 18 })
    .extend({ top: CROP_TRIM_PADDING_PX, bottom: CROP_TRIM_PADDING_PX, left: CROP_TRIM_PADDING_PX, right: CROP_TRIM_PADDING_PX, background: '#ffffff' })
    .png()
    .toBuffer()
  const info = await sharp(trimmed).metadata()
  return { png: trimmed, width: info.width ?? width, height: info.height ?? height }
}

/** Render a whole page for the `pdf-page` fallback tier. */
export async function renderPagePng(
  page: PDFPageProxy
): Promise<{ png: Buffer; width: number; height: number }> {
  const canvasModule = await loadCanvas()
  const viewport = page.getViewport({ scale: CROP_RENDER_SCALE })
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport
  }).promise
  return { png: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height }
}

export async function openPdfDocument(pdfPath: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs()
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(pdfPath)
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false
  } as unknown)
  return task.promise
}

export const PDF_CROP_MAX_PAGES = MAX_PAGES
