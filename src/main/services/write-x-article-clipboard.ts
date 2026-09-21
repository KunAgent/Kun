import { clipboard, nativeImage } from 'electron'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { resolveWriteMarkdownResource, resolveWriteMarkdownResourcePath } from '../../shared/write-markdown-resource'
import {
  X_ARTICLE_IMAGE_MISSING,
  type WriteRichClipboardPayload,
  type WriteRichClipboardResult
} from '../../shared/write-export'

export const X_ARTICLE_CHAR_LIMIT = 100_000
export { X_ARTICLE_IMAGE_MISSING }

const STATIC_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+)$/
const UNORDERED_LIST_PATTERN = /^[-*+][ \t]+(.+)$/
const ORDERED_LIST_PATTERN = /^\d+[.)][ \t]+(.+)$/
const BLOCKQUOTE_PATTERN = /^>[ \t]?(.*)$/
const HORIZONTAL_RULE_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})$/
const TWEET_URL_PATTERN =
  /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+)(?:[?#][^\s]*)?$/i
const INLINE_TOKEN_PATTERN =
  /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*(?:[^*]|\*(?!\*))+?\*\*|~~[^~]+?~~|\*[^*\n]+?\*)/g

export type XArticleClipboardImage = {
  label: string
  filePath: string
}

export type WriteXArticleClipboardFragment = {
  html: string
  text: string
  title: string
  simplified: boolean
  overLimit: boolean
  images: XArticleClipboardImage[]
}

type MarkdownSanitizeResult = {
  text: string
  simplified: boolean
}

type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'strike'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'image'; alt: string; src: string; placeholder?: string }

type XArticleBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: InlineToken[] }
  | { type: 'paragraph'; content: InlineToken[] }
  | { type: 'blockquote'; content: InlineToken[] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'hr' }

export function buildWriteXArticleClipboardFragment(options: {
  sourcePath: string
  content: string
}): WriteXArticleClipboardFragment {
  if (!isMarkdownFile(options.sourcePath)) {
    return buildPlainTextFragment(options.content)
  }

  const sanitized = sanitizeWriteXArticleMarkdown(options.content)
  const blocks = parseXArticleBlocks(sanitized.text)
  const titleBlock =
    blocks[0]?.type === 'heading' && blocks[0].level === 1 ? blocks[0] : undefined
  const title = titleBlock ? inlineToText(titleBlock.content) : ''
  const bodyBlocks = titleBlock ? blocks.slice(1) : blocks
  const images = bindXArticleLocalImages(bodyBlocks, options.sourcePath)
  const text = serializeXArticleText(bodyBlocks)
  const html = wrapXArticleClipboardHtml(
    serializeXArticleHtml(bodyBlocks, options.sourcePath)
  )
  return {
    html,
    text,
    title,
    simplified: sanitized.simplified,
    overLimit: text.length >= X_ARTICLE_CHAR_LIMIT,
    images
  }
}

export function resolveXArticleImageClipboardWrite(
  fragment: WriteXArticleClipboardFragment,
  imageIndex: number
):
  | { ok: true; filePath: string; label: string; imageIndex: number; imageCount: number }
  | { ok: false; message: string } {
  const image = fragment.images[imageIndex]
  if (!image) return { ok: false, message: X_ARTICLE_IMAGE_MISSING }
  return {
    ok: true,
    filePath: image.filePath,
    label: image.label,
    imageIndex,
    imageCount: fragment.images.length
  }
}

export async function writeXArticleImageToClipboard(filePath: string): Promise<void> {
  let image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) {
    image = nativeImage.createFromBuffer(await sharp(filePath).png().toBuffer())
  }
  if (image.isEmpty()) {
    throw new Error(`Unable to copy image ${basename(filePath)}`)
  }
  clipboard.writeImage(image)
}

export async function copyWriteXArticleToSystemClipboard(
  payload: WriteRichClipboardPayload,
  sourcePath: string
): Promise<WriteRichClipboardResult> {
  const fragment = buildWriteXArticleClipboardFragment({
    sourcePath,
    content: payload.content
  })
  const profile = payload.profile === 'x-articles-image' ? 'x-articles-image' : 'x-articles'
  if (profile === 'x-articles-image') {
    const selected = resolveXArticleImageClipboardWrite(fragment, payload.imageIndex ?? 0)
    if (!selected.ok) return selected
    await writeXArticleImageToClipboard(selected.filePath)
    return {
      ok: true,
      copiedAt: new Date().toISOString(),
      profile,
      imageIndex: selected.imageIndex,
      imageCount: selected.imageCount
    }
  }
  clipboard.write({
    html: fragment.html,
    text: fragment.text
  })
  return {
    ok: true,
    copiedAt: new Date().toISOString(),
    profile,
    title: fragment.title,
    simplified: fragment.simplified,
    overLimit: fragment.overLimit,
    imageCount: fragment.images.length
  }
}

export function wrapXArticleClipboardHtml(inner: string): string {
  return [
    '<meta charset="utf-8">',
    '<html><body>',
    '<!--StartFragment-->',
    inner,
    '<!--EndFragment-->',
    '</body></html>'
  ].join('\n')
}

export function sanitizeWriteXArticleMarkdown(content: string): MarkdownSanitizeResult {
  const normalized = content.replaceAll('\r\n', '\n')
  const { text: withoutFences, simplified: fencesSimplified } = unwrapFencedCode(normalized)
  const { text: withoutTables, simplified: tablesSimplified } = flattenMarkdownTables(withoutFences)
  const { text: withoutTasks, simplified: tasksSimplified } = unwrapTaskLists(withoutTables)
  const { text, simplified: inlineCodeSimplified } = unwrapInlineCode(withoutTasks)
  return {
    text,
    simplified: fencesSimplified || tablesSimplified || tasksSimplified || inlineCodeSimplified
  }
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath)
}

function buildPlainTextFragment(content: string): WriteXArticleClipboardFragment {
  const blocks: XArticleBlock[] = content
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))
  const text = serializeXArticleText(blocks)
  return {
    html: wrapXArticleClipboardHtml(serializeXArticleHtml(blocks, '')),
    text,
    title: '',
    simplified: false,
    overLimit: text.length >= X_ARTICLE_CHAR_LIMIT,
    images: []
  }
}

function parseXArticleBlocks(source: string): XArticleBlock[] {
  const lines = source.split('\n')
  const blocks: XArticleBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = HEADING_PATTERN.exec(line)
    if (heading) {
      const level = Math.min(heading[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ type: 'heading', level, content: parseInline(heading[2].trim()) })
      index += 1
      continue
    }

    if (HORIZONTAL_RULE_PATTERN.test(line.trim())) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (BLOCKQUOTE_PATTERN.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const match = BLOCKQUOTE_PATTERN.exec(lines[index] ?? '')
        if (!match) break
        quoteLines.push(match[1].trim())
        index += 1
      }
      blocks.push({ type: 'blockquote', content: parseInline(quoteLines.join(' ')) })
      continue
    }

    if (UNORDERED_LIST_PATTERN.test(line) || ORDERED_LIST_PATTERN.test(line)) {
      const ordered = ORDERED_LIST_PATTERN.test(line)
      const items: InlineToken[][] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const match = ordered
          ? ORDERED_LIST_PATTERN.exec(current)
          : UNORDERED_LIST_PATTERN.exec(current)
        if (!match) break
        items.push(parseInline(match[1].trim()))
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    blocks.push({ type: 'paragraph', content: parseInline(line.trim()) })
    index += 1
  }

  return blocks
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0
  INLINE_TOKEN_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push({ type: 'text', text: text.slice(cursor, match.index) })
    }
    const raw = match[0]
    if (raw.startsWith('![')) {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(raw)
      if (image) {
        tokens.push({ type: 'image', alt: image[1], src: firstMarkdownTarget(image[2]) })
      }
    } else if (raw.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)
      if (link) {
        tokens.push({ type: 'link', text: link[1], href: firstMarkdownTarget(link[2]) })
      }
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({ type: 'bold', text: raw.slice(2, -2) })
    } else if (raw.startsWith('~~') && raw.endsWith('~~')) {
      tokens.push({ type: 'strike', text: raw.slice(2, -2) })
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ type: 'italic', text: raw.slice(1, -1) })
    }
    cursor = match.index + raw.length
  }
  if (cursor < text.length) tokens.push({ type: 'text', text: text.slice(cursor) })
  return tokens.length > 0 ? tokens : [{ type: 'text', text }]
}

function serializeXArticleHtml(blocks: XArticleBlock[], sourcePath: string): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading': {
          const tag = block.level <= 2 ? 'h2' : 'h3'
          return `<${tag}>${inlineToHtml(block.content, sourcePath)}</${tag}>`
        }
        case 'paragraph':
          return serializeParagraphHtml(block.content, sourcePath)
        case 'blockquote':
          return `<blockquote>${inlineToHtml(block.content, sourcePath)}</blockquote>`
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul'
          const items = block.items
            .map((item) => `<li>${inlineToHtml(item, sourcePath)}</li>`)
            .join('')
          return `<${tag}>${items}</${tag}>`
        }
        case 'hr':
          return '<hr>'
      }
    })
    .filter(Boolean)
    .join('\n')
}

function serializeParagraphHtml(content: InlineToken[], sourcePath: string): string {
  if (content.length === 1 && content[0]?.type === 'image') {
    return imageToHtml(content[0], true)
  }
  if (content.length === 1 && content[0]?.type === 'text' && TWEET_URL_PATTERN.test(content[0].text.trim())) {
    const url = content[0].text.trim()
    return `<p><a href="${escapeAttribute(url)}">${escapeHtml(url)}</a></p>`
  }
  if (content.length === 1 && content[0]?.type === 'text') {
    const autolink = autolinkBareUrl(content[0].text.trim())
    if (autolink) return `<p>${autolink}</p>`
  }
  return `<p>${inlineToHtml(content, sourcePath)}</p>`
}

function serializeXArticleText(blocks: XArticleBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
        case 'blockquote':
          return inlineToText(block.content)
        case 'list':
          return block.items
            .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlineToText(item)}`)
            .join('\n')
        case 'hr':
          return '---'
      }
    })
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
}

function inlineToHtml(tokens: InlineToken[], sourcePath: string): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'text':
          return escapeHtml(token.text)
        case 'bold':
          return `<b>${escapeHtml(token.text)}</b>`
        case 'italic':
          return `<i>${escapeHtml(token.text)}</i>`
        case 'strike':
          return `<s>${escapeHtml(token.text)}</s>`
        case 'link':
          return `<a href="${escapeAttribute(resolveHref(token.href, sourcePath))}">${escapeHtml(token.text)}</a>`
        case 'image':
          return imageToHtml(token, false)
      }
    })
    .join('')
}

function inlineToText(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'link') return token.text
      if (token.type === 'image') {
        if (token.placeholder) return token.placeholder
        if (isRemoteHttpUrl(token.src)) return token.alt || fileNameFromSrc(token.src)
        return `📷 ${token.alt || fileNameFromSrc(token.src)}`
      }
      return token.text
    })
    .join('')
}

function imageToHtml(token: Extract<InlineToken, { type: 'image' }>, block: boolean): string {
  if (isRemoteHttpUrl(token.src)) {
    const img = `<img src="${escapeAttribute(token.src)}" alt="${escapeAttribute(token.alt)}">`
    return block ? `<p>${img}</p>` : img
  }
  if (token.placeholder) {
    return block ? `<p>${escapeHtml(token.placeholder)}</p>` : escapeHtml(token.placeholder)
  }
  const label = token.alt.trim() || fileNameFromSrc(token.src)
  return block ? `<p>📷 ${escapeHtml(label)}</p>` : `📷 ${escapeHtml(label)}`
}

function autolinkBareUrl(text: string): string | null {
  if (!/^https?:\/\/\S+$/i.test(text)) return null
  return `<a href="${escapeAttribute(text)}">${escapeHtml(text)}</a>`
}

function resolveHref(href: string, sourcePath: string): string {
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) return href
  return resolveWriteMarkdownResource(href, sourcePath) ?? href
}

function bindXArticleLocalImages(blocks: XArticleBlock[], sourcePath: string): XArticleClipboardImage[] {
  const images: XArticleClipboardImage[] = []
  visitXArticleTokens(blocks, (token) => {
    if (token.type !== 'image') return
    const filePath = resolveCopyableLocalImagePath(token.src, sourcePath)
    if (!filePath) return
    token.placeholder = xArticleImagePlaceholderLabel(images.length + 1)
    images.push({ label: token.placeholder, filePath })
  })
  return images
}

function visitXArticleTokens(blocks: XArticleBlock[], visit: (token: InlineToken) => void): void {
  for (const block of blocks) {
    if (block.type === 'hr') continue
    if (block.type === 'list') {
      for (const item of block.items) {
        for (const token of item) visit(token)
      }
      continue
    }
    for (const token of block.content) visit(token)
  }
}

function xArticleImagePlaceholderLabel(index: number): string {
  return `图片 ${index}`
}

function resolveCopyableLocalImagePath(src: string, sourcePath: string): string | undefined {
  const value = src.trim()
  if (!value || isRemoteHttpUrl(value) || value.startsWith('data:')) return undefined
  let filePath: string | undefined
  if (/^file:/i.test(value)) {
    try {
      filePath = fileURLToPath(value)
    } catch {
      return undefined
    }
  } else {
    filePath = resolveWriteMarkdownResourcePath(value, sourcePath)
  }
  if (!filePath) return undefined
  return STATIC_IMAGE_EXTENSIONS.has(extensionOf(filePath)) ? filePath : undefined
}

function isRemoteHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src.trim())
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

function unwrapTaskLists(source: string): MarkdownSanitizeResult {
  const text = source.replace(/^(\s*[-*+])[ \t]+\[[ xX]\][ \t]+/gm, '$1 ')
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
  return extname(base).replace(/^\./, '').toLowerCase()
}

function fileNameFromSrc(src: string): string {
  const path = src.trim().split(/[?#]/)[0] ?? src
  const name = basename(path.replaceAll('\\', '/'))
  return name || src
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
