import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Shared PPTD project reader. Both deterministic consumers of a deck (the
 * whiteboard projection and the built-in preview renderer) load the same
 * manifest, page list and theme through here so they never disagree about
 * which pages exist or how big a page is.
 */

export type PptdRect = { x: number; y: number; width: number; height: number }

export type PptdPage = {
  index: number
  /** Page file path as written in the manifest. */
  file: string
  /** Absolute page file path. */
  path: string
  record: Record<string, unknown>
}

export type PptdDeck = {
  manifestPath: string
  deckDir: string
  title: string
  pageSize: { width: number; height: number }
  theme: Record<string, unknown>
  colors: Record<string, unknown>
  pages: PptdPage[]
}

export function pptdError(message: string, cause?: unknown): Error {
  const error = new Error(`pptd: ${message}`)
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause
  return error
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Parse "#RRGGBBAA" into a HEX6 color plus opacity. Falls back to opacity 1. */
export function splitColorAlpha(raw: string): { color: string; opacity: number } {
  const trimmed = raw.trim()
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(trimmed)
  if (match) {
    const alpha = Number.parseInt(match[2], 16) / 255
    return { color: `#${match[1].toUpperCase()}`, opacity: Math.round(alpha * 1000) / 1000 }
  }
  return { color: trimmed, opacity: 1 }
}

/** Strip PPTD rich-text markup down to plain text with paragraph newlines. */
export function stripRichText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export function resolveBounds(value: unknown): PptdRect | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const [x, y, width, height] = value
    if ([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return { x, y, width, height }
    }
  }
  const record = asRecord(value)
  if (!record) return undefined
  const x = asNumber(record.x)
  const y = asNumber(record.y)
  const width = asNumber(record.width)
  const height = asNumber(record.height)
  return x !== undefined && y !== undefined && width !== undefined && height !== undefined
    ? { x, y, width, height }
    : undefined
}

/** Resolve a `$token` theme color reference; unknown tokens stay visible as-is. */
export function resolveTokenColor(value: unknown, colors: Record<string, unknown>): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('$')) return trimmed
  return asString(colors[trimmed.slice(1)]) ?? trimmed
}

export async function readYamlFile(filePath: string): Promise<Record<string, unknown>> {
  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch (cause) {
    throw pptdError(`无法读取 ${filePath}: ${(cause as Error).message}`, cause)
  }
  const record = asRecord(parseYaml(source, { prettyErrors: true }))
  if (!record) throw pptdError(`不是有效的 YAML 映射: ${filePath}`)
  return record
}

/**
 * Resolve a `.pptd` manifest from a manifest path or a project directory.
 * Directory lookup is non-recursive, matching the bundled exporter, so
 * sample decks kept in subdirectories never make the main project ambiguous.
 */
export async function resolvePptdManifest(input: string): Promise<string> {
  const info = await stat(input).catch((cause: unknown) => {
    throw pptdError(`输入不存在: ${input}`, cause)
  })
  if (info.isFile()) {
    if (!input.toLowerCase().endsWith('.pptd')) throw pptdError(`输入必须是 .pptd 文件或项目目录: ${input}`)
    return input
  }
  const manifests = (await readdir(input)).filter((name) => name.toLowerCase().endsWith('.pptd')).sort()
  if (manifests.length === 0) throw pptdError(`目录中没有 .pptd 文件: ${input}`)
  if (manifests.length > 1) throw pptdError(`目录中有多个 .pptd 文件: ${manifests.join(', ')}`)
  return join(input, manifests[0])
}

function parsePageSize(value: unknown): { width: number; height: number } {
  if (Array.isArray(value) && value.length >= 2) {
    const width = asNumber(value[0])
    const height = asNumber(value[1])
    if (width !== undefined && height !== undefined) return { width, height }
    throw pptdError(`deck.pptd size 非法: ${JSON.stringify(value)}`)
  }
  const record = asRecord(value)
  if (record) {
    const width = asNumber(record.width)
    const height = asNumber(record.height)
    if (width !== undefined && height !== undefined) return { width, height }
    throw pptdError(`deck.pptd size 非法: ${JSON.stringify(value)}`)
  }
  // Default 16:9 like the PPTD spec.
  return { width: 960, height: 540 }
}

export async function loadPptdDeck(manifestPath: string): Promise<PptdDeck> {
  const deckDir = dirname(manifestPath)
  const deck = await readYamlFile(manifestPath)
  const pageFiles = (Array.isArray(deck.pages) ? deck.pages : [])
    .map((page) => asString(page))
    .filter((page): page is string => page !== undefined)
  if (pageFiles.length === 0) throw pptdError('deck.pptd 没有 pages 列表')
  const theme = asRecord(deck.theme) ?? {}
  const pages: PptdPage[] = []
  for (const [index, file] of pageFiles.entries()) {
    const path = isAbsolute(file) ? file : join(deckDir, file)
    pages.push({ index, file, path, record: await readYamlFile(path) })
  }
  return {
    manifestPath,
    deckDir,
    title: stripRichText(deck.title),
    pageSize: parsePageSize(deck.size),
    theme,
    colors: asRecord(theme.colors) ?? {},
    pages
  }
}
