import { basename, extname } from 'node:path'
import { createElement, Fragment, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resolveWriteMarkdownResource } from '../../shared/write-markdown-resource'

export const X_ARTICLE_CHAR_LIMIT = 100_000

const STATIC_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const LINK_MEDIA_EXTENSIONS = new Set([
  'gif',
  'svg',
  'bmp',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'html',
  'htm'
])

export type WriteXArticleClipboardFragment = {
  html: string
  text: string
  simplified: boolean
  overLimit: boolean
}

type MarkdownSanitizeResult = {
  text: string
  simplified: boolean
}

export function buildWriteXArticleClipboardFragment(options: {
  sourcePath: string
  content: string
}): WriteXArticleClipboardFragment {
  if (!isMarkdownFile(options.sourcePath)) {
    const text = options.content
    return {
      html: wrapArticleHtml(renderPlainTextFragment(text)),
      text,
      simplified: false,
      overLimit: text.length > X_ARTICLE_CHAR_LIMIT
    }
  }

  const sanitized = sanitizeWriteXArticleMarkdown(options.content)
  const body = renderMarkdownFragment(sanitized.text, options.sourcePath)
  return {
    html: wrapArticleHtml(body),
    text: sanitized.text,
    simplified: sanitized.simplified,
    overLimit: sanitized.text.length > X_ARTICLE_CHAR_LIMIT
  }
}

export function sanitizeWriteXArticleMarkdown(content: string): MarkdownSanitizeResult {
  const { text: withoutFences, simplified: fencesSimplified } = unwrapFencedCode(content)
  const { text: withoutTables, simplified: tablesSimplified } = flattenMarkdownTables(withoutFences)
  const { text: withoutDeepHeadings, simplified: headingsSimplified } =
    demoteDeepHeadings(withoutTables)
  const { text: withoutTasks, simplified: tasksSimplified } = unwrapTaskLists(withoutDeepHeadings)
  const { text: withoutUnsupportedMedia, simplified: mediaSimplified } =
    rewriteUnsupportedMedia(withoutTasks)
  const { text, simplified: inlineCodeSimplified } = unwrapInlineCode(withoutUnsupportedMedia)
  return {
    text,
    simplified:
      fencesSimplified ||
      tablesSimplified ||
      headingsSimplified ||
      tasksSimplified ||
      mediaSimplified ||
      inlineCodeSimplified
  }
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath)
}

function wrapArticleHtml(body: string): string {
  return `<article class="x-article-body">${body}</article>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPlainTextFragment(content: string): string {
  const paragraphs = content.length > 0 ? content.split(/\n{2,}/) : ['']
  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br/>')}</p>`)
    .join('')
}

function renderMarkdownFragment(content: string, sourcePath: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      components: {
        h4: headingAsH3,
        h5: headingAsH3,
        h6: headingAsH3,
        table: flattenTableNode,
        thead: passthroughChildren,
        tbody: passthroughChildren,
        tr: tableRowAsParagraph,
        th: strongCell,
        td: passthroughChildren,
        pre: unwrapPre,
        code: unwrapCode,
        input: omitNode,
        img: ({
          src,
          alt,
          ...props
        }: ComponentPropsWithoutRef<'img'> & { src?: string; alt?: string | null }): ReactNode => {
          const resolved = resolveWriteMarkdownResource(src, sourcePath) ?? src
          if (!isXArticleInlineImageSrc(resolved)) {
            const href = resolved?.trim() || src || '#'
            const label = alt?.trim() || fileNameFromSrc(href)
            return createElement('a', { href }, label)
          }
          return createElement('img', {
            ...props,
            src: resolved,
            alt: alt ?? ''
          })
        },
        a: ({
          href,
          children,
          ...props
        }: ComponentPropsWithoutRef<'a'> & { href?: string; children?: ReactNode }): ReactNode =>
          createElement(
            'a',
            {
              ...props,
              href: resolveWriteMarkdownResource(href, sourcePath) ?? href
            },
            children
          )
      }
    }, content)
  )
}

function headingAsH3({
  children,
  ...props
}: ComponentPropsWithoutRef<'h3'> & { children?: ReactNode }): ReactNode {
  return createElement('h3', props, children)
}

function passthroughChildren({ children }: { children?: ReactNode }): ReactNode {
  return createElement(Fragment, null, children)
}

function flattenTableNode({ children }: { children?: ReactNode }): ReactNode {
  return createElement(Fragment, null, children)
}

function tableRowAsParagraph({ children }: { children?: ReactNode }): ReactNode {
  return createElement('p', null, children)
}

function strongCell({ children }: { children?: ReactNode }): ReactNode {
  return createElement('strong', null, children)
}

function unwrapPre({ children }: { children?: ReactNode }): ReactNode {
  return createElement('p', null, children)
}

function unwrapCode({ children }: { children?: ReactNode }): ReactNode {
  return children
}

function omitNode(): ReactNode {
  return null
}

function unwrapFencedCode(source: string): MarkdownSanitizeResult {
  const lines = source.split('\n')
  const out: string[] = []
  let fenceMarker: string | null = null
  let simplified = false

  for (const line of lines) {
    if (fenceMarker) {
      if (isFenceClose(line, fenceMarker)) {
        fenceMarker = null
        continue
      }
      out.push(line)
      continue
    }
    const marker = fenceOpenMarker(line)
    if (marker) {
      fenceMarker = marker
      simplified = true
      continue
    }
    out.push(line)
  }

  return { text: out.join('\n'), simplified }
}

function fenceOpenMarker(line: string): string | null {
  const match = /^(```+|~~~+)/.exec(line)
  return match?.[1] ?? null
}

function isFenceClose(line: string, marker: string): boolean {
  const trimmed = line.trim()
  return trimmed === marker || (trimmed.startsWith(marker) && /^[`~]+$/.test(trimmed))
}

function flattenMarkdownTables(source: string): MarkdownSanitizeResult {
  const lines = source.split('\n')
  const out: string[] = []
  let simplified = false
  let index = 0

  while (index < lines.length) {
    const header = lines[index] ?? ''
    const separator = lines[index + 1] ?? ''
    if (isPipeRow(header) && isSeparatorRow(separator)) {
      simplified = true
      const headerCells = tableCells(header)
      if (headerCells.length > 0) {
        out.push(headerCells.map((cell) => `**${stripOuterBold(cell)}**`).join('  '))
      }
      index += 2
      while (index < lines.length && isPipeRow(lines[index] ?? '') && !isSeparatorRow(lines[index] ?? '')) {
        const cells = tableCells(lines[index] ?? '')
        if (cells.length > 0) out.push(cells.join('  '))
        index += 1
      }
      continue
    }
    out.push(header)
    index += 1
  }

  return { text: out.join('\n'), simplified }
}

function isPipeRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && !trimmed.startsWith('>')
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && /-{3,}/.test(trimmed) && /^[\s:|-]+$/.test(trimmed)
}

function tableCells(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim())
}

function stripOuterBold(value: string): string {
  const match = /^\*\*([\s\S]*)\*\*$/.exec(value.trim())
  return match?.[1] ?? value
}

function demoteDeepHeadings(source: string): MarkdownSanitizeResult {
  const text = source.replace(/^#{4,6}[ \t]+/gm, '### ')
  return { text, simplified: text !== source }
}

function unwrapTaskLists(source: string): MarkdownSanitizeResult {
  const text = source.replace(/^(\s*[-*+])[ \t]+\[[ xX]\][ \t]+/gm, '$1 ')
  return { text, simplified: text !== source }
}

function rewriteUnsupportedMedia(source: string): MarkdownSanitizeResult {
  const text = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt: string, target: string) => {
    const src = firstMarkdownTarget(target)
    if (isXArticleInlineImageSrc(src)) return full
    const label = alt.trim() || fileNameFromSrc(src)
    return `[${label}](${src})`
  })
  return { text, simplified: text !== source }
}

function unwrapInlineCode(source: string): MarkdownSanitizeResult {
  const text = source.replace(/`([^`\n]+)`/g, '$1')
  return { text, simplified: text !== source }
}

function firstMarkdownTarget(target: string): string {
  return target.trim().replace(/^<|>$/g, '').split(/\s+/)[0] ?? target.trim()
}

function extensionOf(src: string): string {
  const path = src.trim().split(/[?#]/)[0] ?? ''
  const base = basename(path)
  const extension = extname(base).replace(/^\./, '').toLowerCase()
  return extension
}

function fileNameFromSrc(src: string): string {
  const path = src.trim().split(/[?#]/)[0] ?? src
  const name = basename(path.replaceAll('\\', '/'))
  return name || src
}

function isXArticleInlineImageSrc(src: string | undefined): boolean {
  if (!src?.trim()) return false
  const value = src.trim()
  if (value.startsWith('data:image/gif') || value.startsWith('data:image/svg')) return false
  if (
    value.startsWith('data:image/png') ||
    value.startsWith('data:image/jpeg') ||
    value.startsWith('data:image/webp')
  ) {
    return true
  }
  const extension = extensionOf(value)
  if (!extension) return true
  if (LINK_MEDIA_EXTENSIONS.has(extension)) return false
  return STATIC_IMAGE_EXTENSIONS.has(extension)
}
