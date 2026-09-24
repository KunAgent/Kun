/**
 * Figure extraction orchestrator (D5): try arXiv HTML figures, then e-print
 * TeX images, then PDF caption cropping, and finally whole-page renders. All
 * tiers write `figures/` + `index.json`; later tiers only run when the earlier
 * ones produced nothing.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PAPER_FIGURES_DIR_NAME,
  type PaperFigureIndexV1,
  type PaperFigureItemV1,
  type PaperFigureSource,
  type PaperUnitMetaV1
} from '../../../shared/paper/paper-types'
import { atomicWriteFile } from '../../atomic-json-file'
import {
  downloadArxivEprint,
  fetchArxivHtmlPage,
  parseArxivHtmlFigures,
  type PaperFetchContext
} from './arxiv-client'
import { paperFetchBytes } from './paper-http'
import { eprintToTexSources, resolveTexFigures } from './paper-figure-tex'
import {
  findCaptionCropCandidates,
  openPdfDocument,
  renderPagePng,
  renderRegionPng,
  PDF_CROP_MAX_PAGES
} from './paper-figure-pdf-crop'
import { loadPdfJs } from '../write-pdf-text-service'

export type PaperFiguresOutcome = {
  status: 'ok' | 'partial' | 'failed'
  source?: PaperFigureSource
  figureCount: number
}

type Progress = (stage: string, message?: string) => void

const MAX_FIGURES = 60
const FIGURE_DOWNLOAD_TIMEOUT_MS = 45_000

function figureId(kind: 'figure' | 'table', n: number): string {
  return `${kind === 'table' ? 'tab' : 'fig'}-${n}`
}

async function imageSize(png: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(png).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

async function writeIndex(unitDirAbs: string, source: PaperFigureSource, items: PaperFigureItemV1[]): Promise<void> {
  const index: PaperFigureIndexV1 = { version: 1, source, items }
  await atomicWriteFile(
    join(unitDirAbs, PAPER_FIGURES_DIR_NAME, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`
  )
}

async function saveImageExt(
  figuresDir: string,
  id: string,
  data: Buffer,
  ext: string
): Promise<{ path: string; width: number; height: number }> {
  const normalized = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext) ? ext : '.png'
  const sharp = (await import('sharp')).default
  const outName = `${id}${normalized}`
  let outData = data
  if (normalized === '.png' && ext !== '.png') {
    outData = await sharp(data).png().toBuffer()
  }
  await writeFile(join(figuresDir, outName), outData)
  const size = normalized === '.svg' ? { width: 0, height: 0 } : await imageSize(outData)
  return { path: `${PAPER_FIGURES_DIR_NAME}/${outName}`, ...size }
}

/** Tier 1: LaTeXML HTML figures — best captions, clean raster crops. */
async function figuresFromArxivHtml(
  unitDirAbs: string,
  arxivId: string,
  ctx: PaperFetchContext,
  progress: Progress
): Promise<PaperFigureItemV1[]> {
  const pageUrl = `https://arxiv.org/html/${arxivId}`
  const html = await fetchArxivHtmlPage(arxivId, ctx).catch(() => null)
  if (!html) return []
  const figures = parseArxivHtmlFigures(html, pageUrl)
  if (!figures.length) return []
  const figuresDir = join(unitDirAbs, PAPER_FIGURES_DIR_NAME)
  const items: PaperFigureItemV1[] = []
  for (const figure of figures.slice(0, MAX_FIGURES)) {
    if (ctx.signal?.aborted) throw new Error('canceled')
    progress('figures', `downloading ${figure.label}`)
    try {
      const data = await paperFetchBytes(figure.imgUrl, {
        signal: ctx.signal,
        timeoutMs: FIGURE_DOWNLOAD_TIMEOUT_MS,
        allowAnyHost: true,
        proxyUrl: ctx.proxyUrl
      })
      const ext = figure.imgUrl.match(/\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)/i)?.[0]?.split(/[?#]/)[0]?.toLowerCase() ?? '.png'
      const id = figureId('figure', items.length + 1)
      const saved = await saveImageExt(figuresDir, id, data, ext)
      items.push({
        id,
        kind: 'figure',
        label: figure.label,
        caption: figure.caption,
        path: saved.path,
        width: saved.width,
        height: saved.height,
        confidence: 'high'
      })
    } catch {
      continue
    }
  }
  return items
}

/** Tier 2: e-print TeX sources — `\includegraphics` + `\caption`. */
async function figuresFromTex(
  unitDirAbs: string,
  arxivId: string,
  ctx: PaperFetchContext,
  progress: Progress
): Promise<PaperFigureItemV1[]> {
  const eprint = await downloadArxivEprint(arxivId, ctx).catch(() => null)
  if (!eprint || eprint.kind === 'pdf') return []
  const figuresDir = join(unitDirAbs, PAPER_FIGURES_DIR_NAME)
  const { texSources, files } = await eprintToTexSources(eprint)
  const resolved = resolveTexFigures(texSources, files)
  const items: PaperFigureItemV1[] = []
  let figureN = 0
  let tableN = 0
  for (const figure of resolved.slice(0, MAX_FIGURES)) {
    if (ctx.signal?.aborted) throw new Error('canceled')
    const n = figure.kind === 'table' ? ++tableN : ++figureN
    const id = figureId(figure.kind, n)
    const ext = figure.resolvedPath.match(/\.[a-zA-Z]+$/)?.[0]?.toLowerCase() ?? ''
    progress('figures', `extracting ${id}`)
    try {
      if (ext === '.eps') continue
      if (ext === '.pdf') {
        const pdfjs = await loadPdfJs()
        const task = pdfjs.getDocument({ data: new Uint8Array(figure.data), disableWorker: true, isEvalSupported: false } as unknown)
        const doc = await task.promise
        try {
          const page = await doc.getPage(1)
          const rendered = await renderPagePng(page)
          await writeFile(join(figuresDir, `${id}.png`), rendered.png)
          items.push({
            id,
            kind: figure.kind,
            label: `${figure.kind === 'table' ? 'Table' : 'Figure'} ${n}`,
            caption: figure.caption,
            path: `${PAPER_FIGURES_DIR_NAME}/${id}.png`,
            width: rendered.width,
            height: rendered.height,
            confidence: 'medium'
          })
        } finally {
          await doc.destroy()
        }
        continue
      }
      const saved = await saveImageExt(figuresDir, id, figure.data, ext)
      items.push({
        id,
        kind: figure.kind,
        label: `${figure.kind === 'table' ? 'Table' : 'Figure'} ${n}`,
        caption: figure.caption,
        path: saved.path,
        width: saved.width,
        height: saved.height,
        confidence: 'medium'
      })
    } catch {
      continue
    }
  }
  return items
}

/** Tier 3: caption-region crops from the PDF itself. */
async function figuresFromPdfCaptions(
  unitDirAbs: string,
  meta: PaperUnitMetaV1,
  ctx: PaperFetchContext,
  progress: Progress
): Promise<PaperFigureItemV1[]> {
  const doc = await openPdfDocument(join(unitDirAbs, meta.pdfFile))
  const figuresDir = join(unitDirAbs, PAPER_FIGURES_DIR_NAME)
  const items: PaperFigureItemV1[] = []
  try {
    const pages = Math.min(doc.numPages, PDF_CROP_MAX_PAGES)
    let figureN = 0
    let tableN = 0
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      if (ctx.signal?.aborted) throw new Error('canceled')
      if (items.length >= MAX_FIGURES) break
      const page = await doc.getPage(pageNumber)
      try {
        const viewport = page.getViewport({ scale: 1 })
        for (const candidate of await findCaptionCropCandidates(page)) {
          if (items.length >= MAX_FIGURES) break
          progress('figures', `cropping ${candidate.caption.label}`)
          const rendered = await renderRegionPng(
            page,
            candidate.regionWithImages,
            viewport.width,
            viewport.height
          )
          if (!rendered) continue
          const n = candidate.caption.kind === 'table' ? ++tableN : ++figureN
          const id = figureId(candidate.caption.kind, n)
          await writeFile(join(figuresDir, `${id}.png`), rendered.png)
          items.push({
            id,
            kind: candidate.caption.kind,
            label: candidate.caption.label,
            caption: candidate.caption.line.text,
            page: pageNumber,
            path: `${PAPER_FIGURES_DIR_NAME}/${id}.png`,
            width: rendered.width,
            height: rendered.height,
            confidence: candidate.confidence
          })
        }
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await doc.destroy()
  }
  return items
}

/** Tier 4: whole-page renders so the agent can still pick pages by caption. */
async function figuresFromPdfPages(
  unitDirAbs: string,
  meta: PaperUnitMetaV1,
  ctx: PaperFetchContext,
  progress: Progress
): Promise<PaperFigureItemV1[]> {
  const doc = await openPdfDocument(join(unitDirAbs, meta.pdfFile))
  const pagesDir = join(unitDirAbs, PAPER_FIGURES_DIR_NAME, 'pages')
  const items: PaperFigureItemV1[] = []
  try {
    const pages = Math.min(doc.numPages, PDF_CROP_MAX_PAGES)
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      if (ctx.signal?.aborted) throw new Error('canceled')
      progress('figures', `rendering page ${pageNumber}`)
      const page = await doc.getPage(pageNumber)
      try {
        const rendered = await renderPagePng(page)
        const name = `page-${pageNumber}.png`
        await writeFile(join(pagesDir, name), rendered.png)
        items.push({
          id: `page-${pageNumber}`,
          kind: 'figure',
          label: `Page ${pageNumber}`,
          caption: '',
          page: pageNumber,
          path: `${PAPER_FIGURES_DIR_NAME}/pages/${name}`,
          width: rendered.width,
          height: rendered.height,
          confidence: 'low'
        })
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await doc.destroy()
  }
  return items
}

/**
 * Run the D5 pipeline. Writes `figures/index.json` whenever any tier produced
 * output; returns the rolled-up status for `paper.json.preprocess`.
 */
export async function generatePaperFigures(
  unitDirAbs: string,
  meta: PaperUnitMetaV1,
  ctx: PaperFetchContext,
  progress: Progress = () => undefined
): Promise<PaperFiguresOutcome> {
  const figuresDir = join(unitDirAbs, PAPER_FIGURES_DIR_NAME)
  await mkdir(figuresDir, { recursive: true })
  await mkdir(join(figuresDir, 'pages'), { recursive: true })

  if (meta.arxivId) {
    try {
      const items = await figuresFromArxivHtml(unitDirAbs, meta.arxivId, ctx, progress)
      if (items.length) {
        await writeIndex(unitDirAbs, 'arxiv-html', items)
        return { status: 'ok', source: 'arxiv-html', figureCount: items.length }
      }
      const tex = await figuresFromTex(unitDirAbs, meta.arxivId, ctx, progress)
      if (tex.length) {
        await writeIndex(unitDirAbs, 'tex', tex)
        return { status: 'ok', source: 'tex', figureCount: tex.length }
      }
    } catch (error) {
      if (ctx.signal?.aborted) throw error
      // fall through to PDF tiers
    }
  }

  try {
    const cropped = await figuresFromPdfCaptions(unitDirAbs, meta, ctx, progress)
    if (cropped.length) {
      await writeIndex(unitDirAbs, 'pdf-caption', cropped)
      const usable = cropped.filter((i) => i.confidence !== 'low').length
      return {
        status: usable > 0 ? 'ok' : 'partial',
        source: 'pdf-caption',
        figureCount: cropped.length
      }
    }
    const pages = await figuresFromPdfPages(unitDirAbs, meta, ctx, progress)
    if (pages.length) {
      await writeIndex(unitDirAbs, 'pdf-page', pages)
      return { status: 'partial', source: 'pdf-page', figureCount: pages.length }
    }
  } catch (error) {
    if (ctx.signal?.aborted) throw error
  }
  return { status: 'failed', figureCount: 0 }
}
