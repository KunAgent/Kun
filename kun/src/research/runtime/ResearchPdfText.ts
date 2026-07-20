/**
 * [INPUT]: 依赖 pdfjs-dist 的 Node 兼容构建、随包 CMap/字体资源、中文书写体系归一和 EvidenceEligibility 的领域无关研究信号词
 * [OUTPUT]: 对外提供完整 PDF 字节到保留单页文档身份且按繁简体一致研究焦点选页的可检索纯文本与文档标题安全提取
 * [POS]: research/runtime 的通用 PDF 文本适配器，被 ResearchWebContent 用于网页 PDF；扫描整份文档但不参与来源评级和证据判断
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'
import { researchSignalTerms } from '../evidence/EvidenceEligibility.js'

const require = createRequire(import.meta.url)
const PDFJS_ROOT = dirname(require.resolve('pdfjs-dist/package.json'))
const MAX_RESEARCH_PDF_PAGES = 500
const MAX_SELECTED_PAGE_CHARS = 4_000

type ExtractedPdfPage = {
  pageNumber: number
  text: string
  score: number
}

export async function extractResearchPdfText(
  data: Uint8Array,
  maxChars = 16_000,
  focusText = ''
): Promise<{ title?: string; text: string }> {
  const loadingTask = getDocument({
    data,
    cMapUrl: `${join(PDFJS_ROOT, 'cmaps')}/`,
    cMapPacked: true,
    standardFontDataUrl: `${join(PDFJS_ROOT, 'standard_fonts')}/`,
    wasmUrl: `${join(PDFJS_ROOT, 'wasm')}/`,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0
  })
  const document = await loadingTask.promise
  try {
    const metadata = await document.getMetadata().catch(() => undefined)
    const info = metadata?.info as { Title?: unknown } | undefined
    const title = typeof info?.Title === 'string' ? info.Title.trim() : ''
    const focusTerms = researchSignalTerms(focusText)
    const pages: ExtractedPdfPage[] = []
    const pageLimit = Math.min(document.numPages, MAX_RESEARCH_PDF_PAGES)
    let sequentialTextLength = 0
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim()
      if (!pageText) continue
      pages.push({
        pageNumber,
        text: pageText,
        score: scorePdfPage(pageText, focusTerms)
      })
      sequentialTextLength += pageText.length + 1
      if (focusTerms.length === 0 && sequentialTextLength >= maxChars) break
    }
    const selectedPages = focusTerms.length > 0
      ? selectFocusedPdfPages(pages, maxChars)
      : pages
    return {
      ...(title ? { title } : {}),
      text: joinPdfPages(selectedPages, maxChars)
    }
  } finally {
    await document.destroy()
  }
}

function scorePdfPage(text: string, focusTerms: string[]): number {
  const normalized = normalizeResearchChineseScript(text).toLowerCase()
  let score = 0
  for (const term of focusTerms) {
    const normalizedTerm = normalizeResearchChineseScript(term).toLowerCase()
    if (!normalizedTerm || !normalized.includes(normalizedTerm)) continue
    score += normalizedTerm.length >= 4 ? 3 : 1
  }
  return score
}

function selectFocusedPdfPages(pages: ExtractedPdfPage[], maxChars: number): ExtractedPdfPage[] {
  if (pages.length === 0) return []
  const selected = new Map<number, ExtractedPdfPage>()
  // 首页保留文档身份；其余预算留给真正命中研究分面的页。
  for (const page of pages.slice(0, 1)) selected.set(page.pageNumber, page)
  const ranked = [...pages]
    .filter((page) => page.score > 0)
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber)
  let selectedChars = [...selected.values()]
    .reduce((total, page) => total + Math.min(page.text.length, MAX_SELECTED_PAGE_CHARS) + 1, 0)
  for (const page of ranked) {
    if (selected.has(page.pageNumber)) continue
    selected.set(page.pageNumber, page)
    selectedChars += Math.min(page.text.length, MAX_SELECTED_PAGE_CHARS) + 1
    if (selectedChars >= maxChars) break
  }
  if (selected.size <= 1) {
    for (const page of pages) {
      if (selected.has(page.pageNumber)) continue
      selected.set(page.pageNumber, page)
      selectedChars += Math.min(page.text.length, MAX_SELECTED_PAGE_CHARS) + 1
      if (selectedChars >= maxChars) break
    }
  }
  return [...selected.values()].sort((left, right) => left.pageNumber - right.pageNumber)
}

function joinPdfPages(pages: ExtractedPdfPage[], maxChars: number): string {
  const chunks: string[] = []
  let remaining = Math.max(0, maxChars)
  for (const page of pages) {
    if (remaining <= 0) break
    const chunk = page.text.slice(0, Math.min(remaining, MAX_SELECTED_PAGE_CHARS)).trim()
    if (!chunk) continue
    chunks.push(chunk)
    remaining -= chunk.length + 1
  }
  return chunks.join('\n').slice(0, maxChars).trim()
}
