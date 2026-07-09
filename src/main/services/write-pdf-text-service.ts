import { createRequire } from 'node:module'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { WorkspaceFileTarget } from '../../shared/workspace-file'
import { resolveOpenTargetPath } from './workspace-paths'

const MAX_PDF_TEXT_BYTES = 64 * 1024 * 1024
const MAX_PDF_TEXT_PAGES = 300
const MAX_PDF_TEXT_CHARS = 1_000_000
const MAX_PDF_OCR_PAGES = 40
const MAX_PDF_OCR_RENDER_PIXELS = 3_200_000
const PDF_OCR_TARGET_SCALE = 2
const PDF_OCR_TEXT_THRESHOLD_CHARS = 12

export type WritePdfTextPage = {
  page: number
  text: string
  charStart: number
  charEnd: number
  source?: 'text' | 'ocr'
}

export type WritePdfTextResult =
  | {
      ok: true
      path: string
      size: number
      mtimeMs: number
      pageCount: number
      pages: WritePdfTextPage[]
      hasText: boolean
      ocrApplied: boolean
      ocrPageCount: number
      truncated: boolean
    }
  | {
      ok: false
      message: string
    }

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type CanvasModule = typeof import('@napi-rs/canvas')
type TesseractWorker = {
  recognize: (image: Buffer) => Promise<{ data?: { text?: string } }>
  setParameters: (params: Record<string, unknown>) => Promise<unknown>
  terminate: () => Promise<unknown>
}
type TesseractModule = {
  createWorker: (
    langs?: string,
    oem?: number,
    options?: Record<string, unknown>
  ) => Promise<TesseractWorker>
  PSM?: Record<string, string>
}
type TesseractLanguagePackage = {
  langPath: string
  gzip?: boolean
}
type DraftPdfPageText = {
  page: number
  text: string
  source: 'text' | 'ocr'
}

const pdfTextCache = new Map<string, Promise<WritePdfTextResult>>()
let pdfJsModulePromise: Promise<PdfJsModule> | null = null
let canvasModulePromise: Promise<CanvasModule> | null = null
let tesseractModulePromise: Promise<TesseractModule> | null = null
const require = createRequire(import.meta.url)

function ensurePdfJsNodePolyfills(): void {
  const target = globalThis as unknown as Record<string, unknown>
  target.DOMMatrix ??= class DOMMatrix {}
  target.ImageData ??= class ImageData {}
  target.Path2D ??= class Path2D {}
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    ensurePdfJsNodePolyfills()
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfJsModulePromise
}

async function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModulePromise) {
    canvasModulePromise = import('@napi-rs/canvas').then((canvas) => {
      const target = globalThis as unknown as Record<string, unknown>
      target.DOMMatrix = canvas.DOMMatrix
      target.ImageData = canvas.ImageData
      target.Path2D = canvas.Path2D
      return canvas
    })
  }
  return canvasModulePromise
}

async function loadTesseract(): Promise<TesseractModule> {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import('tesseract.js').then((module) => {
      const maybeModule = module as unknown as { createWorker?: unknown; default?: unknown }
      return (typeof maybeModule.createWorker === 'function' ? maybeModule : maybeModule.default) as TesseractModule
    })
  }
  return tesseractModulePromise
}

function loadEnglishTesseractData(): TesseractLanguagePackage {
  return require('@tesseract.js-data/eng') as TesseractLanguagePackage
}

function compactPdfText(text = ''): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textContentToPageText(content: { items?: unknown[] }): string {
  const parts: string[] = []
  for (const item of content.items ?? []) {
    if (!item || typeof item !== 'object') continue
    const value = (item as { str?: unknown }).str
    if (typeof value === 'string' && value.trim()) parts.push(value)
  }
  return compactPdfText(parts.join(' '))
}

function shouldOcrPage(text: string): boolean {
  return compactPdfText(text).length < PDF_OCR_TEXT_THRESHOLD_CHARS
}

function mergeOcrDraft(
  drafts: Map<number, DraftPdfPageText>,
  pageNumber: number,
  ocrText: string
): boolean {
  const text = compactPdfText(ocrText)
  if (!text) return false
  const existing = drafts.get(pageNumber)
  if (!existing || !existing.text.trim()) {
    drafts.set(pageNumber, { page: pageNumber, text, source: 'ocr' })
    return true
  }
  if (text.length > existing.text.length + 40) {
    drafts.set(pageNumber, { page: pageNumber, text, source: 'ocr' })
    return true
  }
  return false
}

function buildPageResults(
  drafts: Map<number, DraftPdfPageText>,
  truncated: boolean
): { pages: WritePdfTextPage[]; truncated: boolean } {
  const pages: WritePdfTextPage[] = []
  let charOffset = 0
  let nextTruncated = truncated

  for (const draft of [...drafts.values()].sort((a, b) => a.page - b.page)) {
    const text = compactPdfText(draft.text)
    if (!text) continue
    const remaining = MAX_PDF_TEXT_CHARS - charOffset
    if (remaining <= 0) {
      nextTruncated = true
      break
    }
    const pageText = text.length > remaining ? text.slice(0, Math.max(0, remaining)).trim() : text
    if (pageText) {
      pages.push({
        page: draft.page,
        text: pageText,
        charStart: charOffset,
        charEnd: charOffset + pageText.length,
        source: draft.source
      })
      charOffset += pageText.length + 1
    }
    if (text.length > remaining || charOffset >= MAX_PDF_TEXT_CHARS) {
      nextTruncated = true
      break
    }
  }

  return { pages, truncated: nextTruncated }
}

async function createOcrWorker(): Promise<TesseractWorker> {
  const tesseract = await loadTesseract()
  const languageData = loadEnglishTesseractData()
  const worker = await tesseract.createWorker('eng', 1, {
    langPath: languageData.langPath,
    gzip: languageData.gzip ?? true,
    cacheMethod: 'none',
    logger: () => undefined
  })
  await worker.setParameters({
    tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? '3',
    preserve_interword_spaces: '1',
    user_defined_dpi: '150'
  })
  return worker
}

async function renderPdfPageToPng(
  page: PDFPageProxy
): Promise<Buffer> {
  const canvas = await loadCanvas()
  const baseViewport = page.getViewport({ scale: 1 })
  const maxScale = Math.sqrt(MAX_PDF_OCR_RENDER_PIXELS / Math.max(1, baseViewport.width * baseViewport.height))
  const scale = Math.max(1, Math.min(PDF_OCR_TARGET_SCALE, maxScale))
  const viewport = page.getViewport({ scale })
  const output = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = output.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, output.width, output.height)
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport
  }).promise
  return output.toBuffer('image/png')
}

async function extractOcrPageTexts(
  document: PDFDocumentProxy,
  pageNumbers: number[]
): Promise<Map<number, string>> {
  const texts = new Map<number, string>()
  if (pageNumbers.length === 0) return texts

  let worker: TesseractWorker | null = null
  try {
    worker = await createOcrWorker()
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber)
      try {
        const image = await renderPdfPageToPng(page)
        const result = await worker.recognize(image)
        const text = compactPdfText(result.data?.text ?? '')
        if (text) texts.set(pageNumber, text)
      } finally {
        page.cleanup()
      }
    }
  } finally {
    if (worker) await worker.terminate().catch(() => undefined)
  }

  return texts
}

async function extractPdfText(
  targetPath: string,
  size: number,
  mtimeMs: number
): Promise<WritePdfTextResult> {
  const pdfjs = await loadPdfJs()
  const bytes = await readFile(targetPath)
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false
  } as unknown)
  const document = await loadingTask.promise
  const pageCount = document.numPages
  const drafts = new Map<number, DraftPdfPageText>()
  const ocrCandidates: number[] = []
  let ocrApplied = false
  let ocrPageCount = 0
  let truncated = false

  try {
    const maxPages = Math.min(pageCount, MAX_PDF_TEXT_PAGES)
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = textContentToPageText(content)
      if (text) {
        drafts.set(pageNumber, { page: pageNumber, text, source: 'text' })
      }
      if (shouldOcrPage(text)) ocrCandidates.push(pageNumber)
      page.cleanup()
    }
    if (pageCount > MAX_PDF_TEXT_PAGES) truncated = true

    const pagesToOcr = ocrCandidates.slice(0, MAX_PDF_OCR_PAGES)
    if (ocrCandidates.length > pagesToOcr.length) truncated = true
    if (pagesToOcr.length > 0) {
      let ocrTexts: Map<number, string>
      try {
        ocrTexts = await extractOcrPageTexts(document, pagesToOcr)
      } catch {
        ocrTexts = new Map()
      }
      for (const [pageNumber, text] of ocrTexts) {
        if (mergeOcrDraft(drafts, pageNumber, text)) {
          ocrApplied = true
          ocrPageCount += 1
        }
      }
    }
  } finally {
    await document.destroy()
  }

  const pageResults = buildPageResults(drafts, truncated)
  return {
    ok: true,
    path: targetPath,
    size,
    mtimeMs,
    pageCount,
    pages: pageResults.pages,
    hasText: pageResults.pages.some((page) => page.text.trim().length > 0),
    ocrApplied,
    ocrPageCount,
    truncated: pageResults.truncated
  }
}

export async function readWritePdfText(payload: WorkspaceFileTarget): Promise<WritePdfTextResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    return readLocalPdfTextByPath(targetPath, 'This PDF is too large to parse in Write mode.')
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readLocalPdfText(payload: { path: string }): Promise<WritePdfTextResult> {
  try {
    return readLocalPdfTextByPath(payload.path, 'This PDF is too large to attach.')
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function readLocalPdfTextByPath(targetPath: string, tooLargeMessage: string): Promise<WritePdfTextResult> {
  const fileInfo = await stat(targetPath)
  if (fileInfo.isDirectory()) return { ok: false, message: 'Cannot read text from a directory.' }
  if (fileInfo.size > MAX_PDF_TEXT_BYTES) {
    return { ok: false, message: tooLargeMessage }
  }
  if (extname(targetPath).toLowerCase() !== '.pdf') {
    return { ok: false, message: 'This file is not a PDF document.' }
  }

  const cacheKey = `${targetPath}:${fileInfo.size}:${fileInfo.mtimeMs}`
  const cached = pdfTextCache.get(cacheKey)
  if (cached) return cached

  const pending = extractPdfText(targetPath, fileInfo.size, fileInfo.mtimeMs).finally(() => {
    if (pdfTextCache.size > 32) {
      const oldest = pdfTextCache.keys().next().value
      if (oldest) pdfTextCache.delete(oldest)
    }
  })
  pdfTextCache.set(cacheKey, pending)
  return pending
}

export function clearWritePdfTextCache(): void {
  pdfTextCache.clear()
}
