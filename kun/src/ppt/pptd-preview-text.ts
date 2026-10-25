import { asBoolean, asNumber, asRecord, asString, resolveTokenColor } from './pptd-deck.js'

/**
 * Text helpers for the built-in PPTD preview renderer. PPTD rich text is a
 * small HTML dialect; previews rebuild it as XHTML from an allow-list so the
 * SVG stays well-formed and cannot carry scripts, links or remote resources.
 */

const FALLBACK_FONTS = [
  '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Noto Sans CJK SC"',
  '"Source Han Sans SC"', '"Helvetica Neue"', 'Arial', 'sans-serif'
].join(', ')

const TEXT_STYLE_FIELDS = [
  'color', 'fontSize', 'fontFamily', 'bold', 'italic', 'backgroundColor',
  'lineHeight', 'lineHeightPx', 'letterSpacing', 'marginTop'
] as const

export type PptdTextStyle = {
  color?: string
  fontSize?: number
  fontFamily?: unknown
  bold?: boolean
  italic?: boolean
  backgroundColor?: string
  lineHeight?: number
  lineHeightPx?: number
  letterSpacing?: number
  marginTop?: number
}

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'li'])
const ALLOWED_TAGS = new Set(['p', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'a', 'ul', 'ol', 'li', 'br'])
const STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-size', 'font-weight', 'font-style', 'font-family',
  'text-decoration', 'text-align', 'line-height', 'margin-top', 'margin-left', 'margin-right',
  'letter-spacing'
])
const COLOR_PROPERTIES = new Set(['color', 'background-color'])

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos' || lower === '#39') return "'"
    if (lower === 'nbsp') return '\u00a0'
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : match
  })
}

/** Merge text style layers; earlier layers win (highest priority first). */
export function mergePptdTextStyle(
  layers: ReadonlyArray<Record<string, unknown> | undefined>,
  textStyles: Record<string, unknown>
): PptdTextStyle {
  const expanded: Array<Record<string, unknown>> = []
  for (const layer of layers) {
    if (!layer) continue
    expanded.push(layer)
    const reference = asString(layer.style) ?? asString(layer.textStyle)
    const named = reference?.startsWith('$') ? asRecord(textStyles[reference.slice(1)]) : undefined
    if (named) expanded.push(named)
  }
  const merged: Record<string, unknown> = {}
  for (const field of TEXT_STYLE_FIELDS) {
    const source = expanded.find((layer) => layer[field] !== undefined)
    if (source) merged[field] = source[field]
  }
  return {
    color: asString(merged.color),
    fontSize: asNumber(merged.fontSize),
    fontFamily: merged.fontFamily,
    bold: asBoolean(merged.bold),
    italic: asBoolean(merged.italic),
    backgroundColor: asString(merged.backgroundColor),
    lineHeight: asNumber(merged.lineHeight),
    lineHeightPx: asNumber(merged.lineHeightPx),
    letterSpacing: asNumber(merged.letterSpacing),
    marginTop: asNumber(merged.marginTop)
  }
}

export function fontFamilyCss(value: unknown): string {
  const names: string[] = []
  const record = asRecord(value)
  if (typeof value === 'string') names.push(value)
  else if (record) {
    const latin = asString(record.latin)
    const ea = asString(record.ea)
    if (latin) names.push(latin)
    if (ea) names.push(ea)
  }
  const safe = names
    .map((name) => name.replace(/["'<>;{}\\]/g, '').trim())
    .filter(Boolean)
    .map((name) => `"${name}"`)
  return [...safe, FALLBACK_FONTS].join(', ')
}

/** CSS declarations for a text container (values are XML-escaped by the caller's attribute writer). */
export function pptdTextStyleCss(style: PptdTextStyle, colors: Record<string, unknown>, defaultSize = 18): string {
  const fontSize = style.fontSize ?? defaultSize
  const declarations = [
    `font-family:${fontFamilyCss(style.fontFamily)}`,
    `font-size:${fontSize}px`,
    `color:${cssColor(resolveTokenColor(style.color, colors)) ?? '#000000'}`,
    `font-weight:${style.bold ? 700 : 400}`,
    `font-style:${style.italic ? 'italic' : 'normal'}`,
    style.lineHeightPx !== undefined
      ? `line-height:${style.lineHeightPx}px`
      : `line-height:${round((style.lineHeight ?? 1) * 1.2)}`
  ]
  if (style.letterSpacing !== undefined) declarations.push(`letter-spacing:${style.letterSpacing}px`)
  const background = cssColor(resolveTokenColor(style.backgroundColor, colors))
  if (background) declarations.push(`background-color:${background}`)
  return declarations.join(';')
}

export function cssColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return /^#[0-9a-f]{3,8}$/i.test(trimmed) ? trimmed : undefined
}

function sanitizeStyle(raw: string, colors: Record<string, unknown>): string {
  const declarations: string[] = []
  for (const part of decodeEntities(raw).split(';')) {
    const colon = part.indexOf(':')
    if (colon <= 0) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    let value = part.slice(colon + 1).trim()
    if (!STYLE_PROPERTIES.has(property) || !value) continue
    if (COLOR_PROPERTIES.has(property)) {
      const color = cssColor(resolveTokenColor(value, colors))
      if (!color) continue
      value = color
    }
    if (/url\s*\(|expression|[<>"\\{}@]/i.test(value)) continue
    if (property === 'line-height' && /^\d+(\.\d+)?$/.test(value)) value = String(round(Number(value) * 1.2))
    declarations.push(`${property}:${value}`)
  }
  return declarations.join(';')
}

function styleAttribute(attributes: string): string {
  const match = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attributes)
  return match ? (match[2] ?? match[3] ?? '') : ''
}

function openTag(tag: string, style: string): string {
  switch (tag) {
    case 'p':
      return `<p style="${escapeXml(['margin:0', style].filter(Boolean).join(';'))}">`
    case 'ul':
    case 'ol':
      return `<${tag} style="margin:0;padding-left:1.4em">`
    case 'li':
      return `<li${style ? ` style="${escapeXml(style)}"` : ''}>`
    case 'a':
      return '<span style="color:#2563EB;text-decoration:underline">'
    case 'b':
    case 'strong':
      return '<strong>'
    case 'i':
    case 'em':
      return '<em>'
    case 'span':
      return style ? `<span style="${escapeXml(style)}">` : '<span>'
    default:
      return `<${tag}>`
  }
}

function closeTag(tag: string): string {
  if (tag === 'a' || tag === 'span') return '</span>'
  if (tag === 'b' || tag === 'strong') return '</strong>'
  if (tag === 'i' || tag === 'em') return '</em>'
  return `</${tag}>`
}

/** Convert PPTD rich text into sanitized XHTML content. */
export function pptdRichTextToXhtml(raw: unknown, colors: Record<string, unknown>): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const source = raw.replace(/\r\n?/g, '\n').trim()
  const hasMarkup = /<\/?(p|span|strong|b|em|i|u|s|sup|sub|a|ul|ol|li|br)\b/i.test(source)
  if (!hasMarkup) {
    return source.split('\n').map((line) => escapeXml(decodeEntities(line))).join('<br/>')
  }
  const output: string[] = []
  const stack: string[] = []
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|(<)/g
  for (const match of source.matchAll(pattern)) {
    const [token, rawTag, attributes, text, stray] = match
    if (text !== undefined || stray !== undefined) {
      const value = text ?? stray ?? ''
      if (!value.trim() && value.includes('\n')) continue
      output.push(escapeXml(decodeEntities(value.replace(/\n+/g, ' '))))
      continue
    }
    const tag = rawTag.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) continue
    if (tag === 'br') {
      output.push('<br/>')
      continue
    }
    if (token.startsWith('</')) {
      const position = stack.lastIndexOf(tag)
      if (position < 0) continue
      while (stack.length > position) output.push(closeTag(stack.pop() as string))
      continue
    }
    if (token.endsWith('/>')) continue
    if (BLOCK_TAGS.has(tag) && tag !== 'li' && stack.includes('p')) {
      while (stack.includes('p')) output.push(closeTag(stack.pop() as string))
    }
    output.push(openTag(tag, sanitizeStyle(styleAttribute(attributes), colors)))
    stack.push(tag)
  }
  while (stack.length > 0) output.push(closeTag(stack.pop() as string))
  return output.join('')
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}
