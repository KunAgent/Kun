import { BrowserWindow, clipboard, dialog } from 'electron'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderWorkMarkdownToHtml } from '../../shared/markdown/render-html'
import { highlightExportCodeBlocks } from './write-export-highlight'
import type {
  WriteExportFormat,
  WriteExportPayload,
  WriteExportResult,
  WriteRichClipboardPayload,
  WriteRichClipboardResult
} from '../../shared/write-export'
import type { DesignExportPayload, DesignExportResult } from '../../shared/design-export'
import { resolveWriteMarkdownResource } from '../../shared/write-markdown-resource'
import { resolveWorkspaceFile } from './workspace-service'
import { copyWriteXArticleToSystemClipboard } from './write-x-article-clipboard'

type HtmlToDocxDocumentOptions = {
  title?: string
  creator?: string
  keywords?: string[]
  description?: string
  font?: string
  fontSize?: number
}

type HtmlToDocxConverter = (
  htmlString: string,
  headerHtmlString?: string | null,
  documentOptions?: HtmlToDocxDocumentOptions,
  footerHtmlString?: string | null
) => Promise<ArrayBuffer | Blob | Buffer | Uint8Array>

const require = createRequire(import.meta.url)
const htmlToDocx = require('html-to-docx') as HtmlToDocxConverter

const EXPORT_CSS = `
  :root {
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  html {
    background: #ffffff;
  }

  body {
    margin: 0;
    background: #ffffff;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.72;
  }

  a {
    color: #0f62fe;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .document-shell {
    padding: 22mm 18mm;
  }

  .markdown-body {
    max-width: 100%;
  }

  .markdown-body > :first-child {
    margin-top: 0;
  }

  .markdown-body > :last-child {
    margin-bottom: 0;
  }

  .markdown-body p,
  .markdown-body ul,
  .markdown-body ol,
  .markdown-body blockquote,
  .markdown-body pre,
  .markdown-body table {
    margin: 0 0 1em;
  }

  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3,
  .markdown-body h4,
  .markdown-body h5,
  .markdown-body h6 {
    margin: 1.45em 0 0.65em;
    line-height: 1.24;
    color: #0f172a;
    font-weight: 700;
  }

  .markdown-body h1 {
    font-size: 2em;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.3em;
  }

  .markdown-body h2 {
    font-size: 1.55em;
    border-bottom: 1px solid #edf2f7;
    padding-bottom: 0.24em;
  }

  .markdown-body h3 {
    font-size: 1.25em;
  }

  .markdown-body ul,
  .markdown-body ol {
    padding-left: 1.5em;
  }

  .markdown-body li + li {
    margin-top: 0.3em;
  }

  .markdown-body blockquote {
    padding: 0.3em 0 0.3em 1em;
    border-left: 4px solid #dbe4ff;
    color: #475569;
    background: #f8fbff;
  }

  .markdown-body code {
    font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
    font-size: 0.92em;
  }

  .markdown-body p code,
  .markdown-body li code,
  .markdown-body td code {
    padding: 0.12em 0.38em;
    border-radius: 0.42em;
    background: #f1f5f9;
    color: #0f172a;
  }

  .markdown-body pre {
    overflow-x: auto;
    padding: 0.95em 1.05em;
    border-radius: 0.9em;
    background: #0f172a;
    color: #e2e8f0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-body pre code {
    background: transparent;
    color: inherit;
    padding: 0;
  }

  .markdown-body hr {
    height: 1px;
    border: 0;
    background: #e5e7eb;
    margin: 1.6em 0;
  }

  .markdown-body table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95em;
  }

  .markdown-body th,
  .markdown-body td {
    border: 1px solid #dbe3ee;
    padding: 0.5em 0.7em;
    vertical-align: top;
    text-align: left;
  }

  .markdown-body th {
    background: #f8fafc;
    font-weight: 700;
  }

  .markdown-body img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1rem auto;
  }

  .plain-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
  }

  @page {
    size: A4;
    margin: 0;
  }
`

const LOCAL_IMAGE_PATTERN = /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath)
}

function basenameWithoutExtension(filePath: string): string {
  const name = basename(filePath)
  const extension = extname(name)
  return extension ? name.slice(0, -extension.length) : name
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function exportExtension(format: WriteExportFormat): string {
  if (format === 'html') return '.html'
  if (format === 'pdf') return '.pdf'
  if (format === 'png') return '.png'
  if (format === 'doc') return '.doc'
  return '.docx'
}

function exportDialogFilter(format: WriteExportFormat): Electron.FileFilter {
  if (format === 'html') return { name: 'HTML', extensions: ['html'] }
  if (format === 'pdf') return { name: 'PDF', extensions: ['pdf'] }
  if (format === 'png') return { name: 'PNG', extensions: ['png'] }
  if (format === 'doc') return { name: 'DOC', extensions: ['doc'] }
  return { name: 'DOCX', extensions: ['docx'] }
}

function mimeTypeForPath(filePath: string): string | null {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  if (extension === '.svg') return 'image/svg+xml'
  return null
}

function ensureExportExtension(targetPath: string, format: WriteExportFormat): string {
  const extension = exportExtension(format)
  return extname(targetPath).trim() ? targetPath : `${targetPath}${extension}`
}

function defaultExportPath(sourcePath: string, format: WriteExportFormat): string {
  return join(dirname(sourcePath), `${basenameWithoutExtension(sourcePath)}${exportExtension(format)}`)
}

async function localFileUrlToDataUri(value: string): Promise<string | null> {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'file:') return null
    const filePath = fileURLToPath(parsed)
    const mimeType = mimeTypeForPath(filePath)
    if (!mimeType) return null
    const buffer = await readFile(filePath)
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function inlineLocalImagesInHtml(html: string): Promise<string> {
  const matches = [...html.matchAll(LOCAL_IMAGE_PATTERN)]
  if (matches.length === 0) return html

  const replacements = new Map<string, string>()
  await Promise.all(
    matches.map(async (match) => {
      const rawSrc = match[2]
      if (!rawSrc || replacements.has(rawSrc)) return
      const dataUri = await localFileUrlToDataUri(rawSrc)
      if (dataUri) replacements.set(rawSrc, dataUri)
    })
  )

  if (replacements.size === 0) return html
  return html.replace(LOCAL_IMAGE_PATTERN, (fullMatch, prefix, rawSrc, suffix) => {
    return `${prefix}${replacements.get(rawSrc) ?? rawSrc}${suffix}`
  })
}

function renderPlainTextFragment(content: string): string {
  return renderToStaticMarkup(
    createElement(
      'pre',
      {
        className: 'plain-text'
      },
      content
    )
  )
}

async function renderMarkdownFragment(
  content: string,
  sourcePath: string,
  options?: {
    format?: WriteExportFormat
    renderedDiagrams?: Record<string, string>
    /** Export-document math: KaTeX HTML fallback beside MathML. */
    mathFallback?: boolean
  }
): Promise<string> {
  const mathMode = options?.format === 'doc' || options?.format === 'docx'
    ? 'latex'
    : options?.mathFallback ? 'mathmlDual' : 'mathml'
  const highlightedCode = await highlightExportCodeBlocks(content)
  return renderWorkMarkdownToHtml(content, {
    math: mathMode,
    highlightedCode,
    ...(options?.renderedDiagrams ? { renderedDiagrams: options.renderedDiagrams } : {}),
    resolveResource: (src) => resolveWriteMarkdownResource(src, sourcePath) ?? src
  })
}

export async function buildWriteClipboardHtmlFragment(options: {
  sourcePath: string
  content: string
  format?: WriteExportFormat
  renderedDiagrams?: Record<string, string>
  mathFallback?: boolean
}): Promise<string> {
  const fragment = isMarkdownFile(options.sourcePath)
    ? await renderMarkdownFragment(options.content, options.sourcePath, options)
    : renderPlainTextFragment(options.content)
  const body = await inlineLocalImagesInHtml(fragment)
  return `<article class="markdown-body">${body}</article>`
}

export function buildWriteExportFileName(sourcePath: string, format: WriteExportFormat): string {
  return `${basenameWithoutExtension(sourcePath)}${exportExtension(format)}`
}

/**
 * KaTeX stylesheet with font URLs rewritten to absolute file:// paths so
 * exported HTML/PDF render KaTeX markup even where no system math fonts
 * exist (common on Linux). Cached after first read; empty on failure —
 * the MathML output still covers fonted environments then.
 */
let katexCssCache: string | null = null

function katexExportCss(): string {
  if (katexCssCache !== null) return katexCssCache
  try {
    const cssPath = require.resolve('katex/dist/katex.min.css')
    const fontsBase = `${pathToFileURL(dirname(cssPath)).href}/`
    katexCssCache = readFileSync(cssPath, 'utf8')
      .replace(/url\(fonts\//g, `url(${fontsBase}fonts/`)
  } catch {
    katexCssCache = ''
  }
  return katexCssCache
}

export async function buildWriteExportHtmlDocument(options: {
  sourcePath: string
  content: string
  title?: string
  wordCompatible?: boolean
  format?: WriteExportFormat
  renderedDiagrams?: Record<string, string>
}): Promise<string> {
  const title = options.title?.trim() || basenameWithoutExtension(options.sourcePath)
  const body = await buildWriteClipboardHtmlFragment({
    sourcePath: options.sourcePath,
    content: options.content,
    mathFallback: true,
    ...(options.format ? { format: options.format } : {}),
    ...(options.renderedDiagrams ? { renderedDiagrams: options.renderedDiagrams } : {})
  })
  const baseHref = pathToFileURL(`${dirname(options.sourcePath)}/`).href
  const namespaces = options.wordCompatible
    ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"'
    : ''

  const katexCss = body.includes('katex') ? katexExportCss() : ''
  return [
    '<!DOCTYPE html>',
    `<html lang="en"${namespaces}>`,
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    `  <base href="${escapeHtml(baseHref)}" />`,
    `  <style>${EXPORT_CSS}</style>`,
    ...(katexCss ? [`  <style>${katexCss}</style>`] : []),
    '</head>',
    '<body>',
    '  <main class="document-shell">',
    `    ${body}`,
    '  </main>',
    '</body>',
    '</html>'
  ].join('\n')
}

export async function copyWriteDocumentAsRichText(
  payload: WriteRichClipboardPayload
): Promise<WriteRichClipboardResult> {
  try {
    const resolved = await resolveWorkspaceFile({
      path: payload.path,
      workspaceRoot: payload.workspaceRoot
    })
    if (!resolved.ok) {
      return {
        ok: false,
        message: resolved.message
      }
    }

    const profile = payload.profile ?? 'online-docs'
    if (profile === 'x-articles' || profile === 'x-articles-image') {
      return copyWriteXArticleToSystemClipboard(payload, resolved.path)
    }

    const html = await buildWriteClipboardHtmlFragment({
      sourcePath: resolved.path,
      content: payload.content
    })

    clipboard.write({
      html,
      text: payload.content
    })

    return {
      ok: true,
      copiedAt: new Date().toISOString(),
      profile
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function bufferFromDocxResult(result: ArrayBuffer | Blob | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(result)) {
    return result
  }
  if (ArrayBuffer.isView(result)) {
    return Buffer.from(result.buffer, result.byteOffset, result.byteLength)
  }
  if (typeof ArrayBuffer !== 'undefined' && result instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(result))
  }
  if (typeof Blob !== 'undefined' && result instanceof Blob) {
    return Buffer.from(await result.arrayBuffer())
  }
  throw new TypeError('Unsupported DOCX export result.')
}

async function renderHtmlDocument(html: string, format: 'pdf' | 'png'): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), 'kun-export-'))
  const tempHtmlPath = join(tempDir, 'document.html')
  await writeFile(tempHtmlPath, html, 'utf8')

  const hiddenWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    width: 1200,
    height: 900,
    webPreferences: {
      sandbox: true
    }
  })

  try {
    await hiddenWindow.loadURL(pathToFileURL(tempHtmlPath).href)
    await hiddenWindow.webContents.executeJavaScript(`
      Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        Promise.all(
          Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve()
            return new Promise((resolve) => {
              const done = () => resolve(undefined)
              image.addEventListener('load', done, { once: true })
              image.addEventListener('error', done, { once: true })
            })
          })
        )
      ]).then(() => undefined)
    `)
    await delay(120)
    if (format === 'png') {
      const size = await hiddenWindow.webContents.executeJavaScript(`
        ({
          width: Math.min(1600, Math.max(800, document.documentElement.scrollWidth)),
          height: Math.min(16384, Math.max(600, document.documentElement.scrollHeight))
        })
      `) as { width: number; height: number }
      hiddenWindow.setContentSize(size.width, size.height)
      await delay(50)
      const image = await hiddenWindow.webContents.capturePage()
      return image.toPNG()
    }
    const pdf = await hiddenWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    })
    return Buffer.from(pdf)
  } finally {
    if (!hiddenWindow.isDestroyed()) hiddenWindow.destroy()
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function renderMarkdownDocumentToPdf(options: {
  sourcePath: string
  content: string
  title: string
}): Promise<Buffer> {
  const html = await buildWriteExportHtmlDocument(options)
  return renderHtmlDocument(html, 'pdf')
}

async function showExportSaveDialog(
  sourcePath: string,
  format: WriteExportFormat,
  parentWindow?: BrowserWindow | null
): Promise<Electron.SaveDialogReturnValue> {
  const options: Electron.SaveDialogOptions = {
    title: 'Export document',
    defaultPath: defaultExportPath(sourcePath, format),
    filters: [exportDialogFilter(format)]
  }
  return parentWindow
    ? dialog.showSaveDialog(parentWindow, options)
    : dialog.showSaveDialog(options)
}

export async function exportWriteDocument(
  payload: WriteExportPayload,
  options?: { parentWindow?: BrowserWindow | null }
): Promise<WriteExportResult> {
  try {
    let sourcePath: string
    if (payload.path) {
      const resolved = await resolveWorkspaceFile({
        path: payload.path,
        workspaceRoot: payload.workspaceRoot
      })
      if (!resolved.ok) {
        return {
          ok: false,
          canceled: false,
          message: resolved.message
        }
      }
      sourcePath = resolved.path
    } else {
      const title = payload.title?.trim() || 'Kun answer'
      const safeTitle = Array.from(title, (character) => {
        const code = character.charCodeAt(0)
        return code <= 31 || '<>:"/\\|?*'.includes(character) ? '-' : character
      }).join('')
      sourcePath = join(payload.workspaceRoot?.trim() || tmpdir(), `${safeTitle}.md`)
    }

    const exportDialogResult = await showExportSaveDialog(sourcePath, payload.format, options?.parentWindow)
    if (exportDialogResult.canceled || !exportDialogResult.filePath) {
      return {
        ok: false,
        canceled: true
      }
    }

    const targetPath = ensureExportExtension(exportDialogResult.filePath, payload.format)
    const title = payload.title?.trim() || basenameWithoutExtension(sourcePath)
    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      content: payload.content,
      title,
      wordCompatible: payload.format === 'doc',
      format: payload.format,
      ...(payload.renderedDiagrams ? { renderedDiagrams: payload.renderedDiagrams } : {})
    })

    if (payload.format === 'html' || payload.format === 'doc') {
      await writeFile(targetPath, html, 'utf8')
    } else if (payload.format === 'docx') {
      const docx = await htmlToDocx(html, null, {
        title,
        creator: 'Kun',
        keywords: ['markdown', 'export'],
        description: `Exported from ${basename(sourcePath)}`,
        font: 'Arial',
        fontSize: 24
      })
      await writeFile(targetPath, await bufferFromDocxResult(docx))
    } else {
      await writeFile(targetPath, await renderHtmlDocument(html, payload.format))
    }

    return {
      ok: true,
      path: targetPath,
      format: payload.format,
      exportedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function designExportSaveDialog(
  sourcePath: string,
  format: DesignExportPayload['format'],
  suggestedName: string,
  parentWindow?: BrowserWindow | null
): Promise<Electron.SaveDialogReturnValue> {
  const ext = format === 'pdf' ? 'pdf' : 'html'
  const safe = suggestedName.replace(/[^\w.\- ]+/g, '').trim()
  const base = safe || basename(dirname(sourcePath)) || 'design'
  const options: Electron.SaveDialogOptions = {
    title: 'Export design',
    defaultPath: join(dirname(sourcePath), `${base}.${ext}`),
    filters: [{ name: format === 'pdf' ? 'PDF' : 'HTML', extensions: [ext] }]
  }
  return parentWindow ? dialog.showSaveDialog(parentWindow, options) : dialog.showSaveDialog(options)
}

/**
 * Export a design prototype (an already-complete single-file HTML document) to
 * a standalone .html or a .pdf (rendered via a hidden BrowserWindow). Reuses the
 * write-mode HTML render pipeline.
 */
export async function exportDesignPrototype(
  payload: DesignExportPayload,
  options?: { parentWindow?: BrowserWindow | null }
): Promise<DesignExportResult> {
  try {
    const resolved = await resolveWorkspaceFile({ path: payload.path, workspaceRoot: payload.workspaceRoot })
    if (!resolved.ok) return { ok: false, canceled: false, message: resolved.message }
    const html = await readFile(resolved.path, 'utf8')
    const dialogResult = await designExportSaveDialog(resolved.path, payload.format, payload.filename ?? '', options?.parentWindow)
    if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, canceled: true }
    const ext = payload.format === 'pdf' ? '.pdf' : '.html'
    const targetPath = dialogResult.filePath.toLowerCase().endsWith(ext)
      ? dialogResult.filePath
      : `${dialogResult.filePath}${ext}`
    if (payload.format === 'pdf') {
      await writeFile(targetPath, await renderHtmlDocument(html, 'pdf'))
    } else {
      await writeFile(targetPath, html, 'utf8')
    }
    return { ok: true, path: targetPath, format: payload.format, exportedAt: new Date().toISOString() }
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
