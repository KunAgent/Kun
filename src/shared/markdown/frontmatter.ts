/**
 * Helpers for YAML frontmatter that lives outside the document AST.
 * The editor keeps the block as a string and re-attaches it on save
 * (see {@link splitFrontmatter} / {@link joinFrontmatter}).
 *
 * Structured parse/serialize covers Obsidian-style simple properties:
 * text, list, checkbox, date. Nested maps and multi-line scalars fall
 * back to raw source editing.
 *
 * Ported from Agentero `src/lib/markdown/frontmatter.ts` (see
 * docs/work-markdown-implementation.zh-CN.md §4).
 */

const FRONTMATTER_RE = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export type MarkdownDoc = {
  /** Leading YAML frontmatter block, verbatim (incl. delimiters and trailing newline). Empty when absent. */
  frontmatter: string
  /** Markdown body after the frontmatter. */
  body: string
}

/**
 * Split a leading YAML frontmatter block (`---\n...\n---`) from a Markdown
 * document. The frontmatter is preserved byte-exact so it can be re-attached
 * on save without going through the document round-trip.
 */
export function splitFrontmatter(md: string): MarkdownDoc {
  if (!md.startsWith('---') && !md.startsWith('\uFEFF---')) return { frontmatter: '', body: md }
  const match = FRONTMATTER_RE.exec(md)
  if (!match) return { frontmatter: '', body: md }
  return { frontmatter: match[0], body: md.slice(match[0].length) }
}

/** Re-attach a preserved frontmatter block to a serialized body. */
export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter ? frontmatter + body : body
}

/** Keys that are always list-valued by convention. */
const FRONTMATTER_LIST_KEYS = new Set(['aliases', 'tags', 'cssclasses'])

export type FrontmatterPropertyKind = 'scalar' | 'list' | 'checkbox' | 'date'

export type FrontmatterProperty = {
  key: string
  kind: FrontmatterPropertyKind
  /** Scalar / date text, or checkbox `"true"` / `"false"`. Ignored for list. */
  value: string
  /** List items (ignored when kind is not list). */
  items: string[]
}

export type FrontmatterParseResult =
  | { ok: true; properties: FrontmatterProperty[] }
  | { ok: false }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Strip `---` fences; empty when there is no frontmatter block. */
export function frontmatterInterior(block: string): string {
  const trimmed = block.trim()
  if (!trimmed) return ''
  const lines = trimmed.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return trimmed
  lines.shift()
  const close = lines.findIndex((line) => line.trim() === '---' || line.trim() === '...')
  if (close >= 0) lines.splice(close)
  return lines.join('\n').replace(/\n+$/, '')
}

/**
 * Build a disk-ready frontmatter block from the YAML interior (no fences).
 * Empty / whitespace-only interior yields `""` (no frontmatter).
 */
export function wrapFrontmatter(interior: string): string {
  const body = interior.replace(/^\uFEFF/, '').replace(/\s+$/, '')
  if (!body.trim()) return ''
  return `---\n${body}\n---\n`
}

/** Count top-level `key:` lines for the collapsed Properties badge. */
export function countFrontmatterProperties(
  interior: string,
  parsed: FrontmatterParseResult = parseFrontmatterProperties(interior)
): number {
  if (parsed.ok) return parsed.properties.length
  let count = 0
  for (const line of interior.split(/\r?\n/)) {
    if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith('#')) continue
    if (/^[^:\s][^:]*:\s*/.test(line.trim())) count += 1
  }
  return count
}

function stripInlineComment(raw: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) {
      if (i === 0 || raw[i - 1] !== '\\') inDouble = !inDouble
    } else if (ch === '#' && !inSingle && !inDouble) {
      return raw.slice(0, i).trimEnd()
    }
  }
  return raw
}

function unquoteYamlScalar(raw: string): string {
  const value = stripInlineComment(raw).trim()
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    const inner = value.slice(1, -1)
    if (value.startsWith('"')) {
      return inner.replace(/\\(n|t|r|\\|")/g, (_, ch: string) => {
        if (ch === 'n') return '\n'
        if (ch === 't') return '\t'
        if (ch === 'r') return '\r'
        return ch
      })
    }
    return inner.replace(/''/g, "'")
  }
  return value
}

function quoteYamlScalar(value: string): string {
  if (value === '') return '""'
  if (
    /^[A-Za-z0-9_./+-][A-Za-z0-9_./+ -]*$/.test(value) &&
    !/^[-?:]/.test(value) &&
    !/:\s/.test(value) &&
    value !== 'true' &&
    value !== 'false' &&
    value !== 'null' &&
    value !== '~'
  ) {
    return value
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function parseInlineList(raw: string): string[] | null {
  const body = stripInlineComment(raw).trim()
  if (!body.startsWith('[') || !body.endsWith(']')) return null
  const inner = body.slice(1, -1).trim()
  if (!inner) return []
  const items: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      continue
    }
    if (ch === '"' && !inSingle) {
      if (i === 0 || inner[i - 1] !== '\\') inDouble = !inDouble
      current += ch
      continue
    }
    if (ch === ',' && !inSingle && !inDouble) {
      const item = unquoteYamlScalar(current)
      if (item) items.push(item)
      current = ''
      continue
    }
    current += ch
  }
  if (inSingle || inDouble) return null
  const last = unquoteYamlScalar(current)
  if (last) items.push(last)
  return items
}

/** Infer form kind from a bare YAML scalar (Obsidian-style heuristics). */
export function inferScalarKind(value: string): FrontmatterPropertyKind {
  const trimmed = value.trim()
  if (/^(true|false)$/i.test(trimmed)) return 'checkbox'
  if (ISO_DATE_RE.test(trimmed)) return 'date'
  return 'scalar'
}

function normalizeCheckboxValue(value: string): 'true' | 'false' {
  return /^(true|yes|1)$/i.test(value.trim()) ? 'true' : 'false'
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value.trim())) return false
  const [y, m, d] = value.trim().split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Parse simple top-level YAML properties. Returns `{ ok: false }` when the
 * document needs raw source editing (nested maps, multi-line scalars, etc.).
 */
export function parseFrontmatterProperties(interior: string): FrontmatterParseResult {
  const text = interior.replace(/\r\n/g, '\n')
  if (!text.trim()) return { ok: true, properties: [] }

  const lines = text.split('\n')
  const properties: FrontmatterProperty[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    if (line.trimStart().startsWith('#')) {
      index += 1
      continue
    }
    // Unexpected indent at top level → nested / continuation we do not model.
    if (/^\s/.test(line)) return { ok: false }

    const match = line.match(/^([^:#\s][^:]*?)\s*:\s*(.*)$/)
    if (!match) return { ok: false }
    const key = match[1].trim()
    if (!key) return { ok: false }
    const rest = match[2]
    const restTrimmed = rest.trim()

    // Multi-line scalars are not supported in form mode.
    if (restTrimmed === '|' || restTrimmed === '>' || restTrimmed === '|-' || restTrimmed === '>-') {
      return { ok: false }
    }

    // Block list: `key:` then indented `- item` lines.
    if (restTrimmed === '') {
      const items: string[] = []
      let cursor = index + 1
      while (cursor < lines.length) {
        const next = lines[cursor]
        if (!next.trim()) {
          cursor += 1
          continue
        }
        if (!/^\s/.test(next)) break
        const trimmed = next.trim()
        if (trimmed.startsWith('#')) {
          cursor += 1
          continue
        }
        const itemMatch = trimmed.match(/^-\s*(.*)$/)
        if (!itemMatch) return { ok: false }
        const item = unquoteYamlScalar(itemMatch[1] ?? '')
        if (item) items.push(item)
        cursor += 1
      }
      if (items.length > 0 || FRONTMATTER_LIST_KEYS.has(key)) {
        properties.push({ key, kind: 'list', value: '', items })
      } else {
        properties.push({ key, kind: 'scalar', value: '', items: [] })
      }
      index = cursor
      continue
    }

    // Inline list: `key: [a, b]`
    if (restTrimmed.startsWith('[')) {
      const items = parseInlineList(rest)
      if (items === null) return { ok: false }
      properties.push({ key, kind: 'list', value: '', items })
      index += 1
      continue
    }

    // Flow map / complex value → source mode.
    if (restTrimmed.startsWith('{')) return { ok: false }

    const value = unquoteYamlScalar(rest)
    const kind = inferScalarKind(value)
    if (kind === 'checkbox') {
      properties.push({ key, kind: 'checkbox', value: normalizeCheckboxValue(value), items: [] })
    } else if (kind === 'date' && isIsoDate(value)) {
      properties.push({ key, kind: 'date', value: value.trim(), items: [] })
    } else {
      properties.push({ key, kind: 'scalar', value, items: [] })
    }
    index += 1
  }

  return { ok: true, properties }
}

const FRONTMATTER_KEY_LINE_RE = /^([^:#\s][^:]*?)\s*:\s*(.*)$/

/**
 * Line ranges `[start, end)` of each top-level property in `interior`,
 * matched in order against `keys` (the parser's output). A property's range
 * covers its `key:` line plus indented continuation lines (block list
 * items, indented comments); blank lines inside a block list count too.
 * Returns null when the line walk disagrees with `keys` — callers then
 * fall back to a full re-serialize.
 */
function frontmatterPropertyRanges(
  lines: string[],
  keys: string[]
): { start: number; end: number }[] | null {
  const ranges: { start: number; end: number }[] = []
  let cursor = 0
  for (const key of keys) {
    // Skip blank lines and top-level comments — they belong to the gap
    // between properties, not to any property's range.
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (!line.trim() || line.trimStart().startsWith('#') || /^\s/.test(line)) {
        cursor += 1
        continue
      }
      const match = line.match(FRONTMATTER_KEY_LINE_RE)
      if (!match || match[1].trim() !== key) return null
      break
    }
    if (cursor >= lines.length) return null
    const start = cursor
    cursor += 1
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (/^\s/.test(line) && line.trim()) {
        cursor += 1
        continue
      }
      if (!line.trim()) {
        // A blank line belongs to this property only when another indented
        // line follows (blank-separated list items).
        let look = cursor
        while (look < lines.length && !lines[look].trim()) look += 1
        if (look < lines.length && /^\s/.test(lines[look]) && lines[look].trim()) {
          cursor = look + 1
          continue
        }
      }
      break
    }
    ranges.push({ start, end: cursor })
  }
  return ranges
}

function sameFrontmatterProperty(a: FrontmatterProperty, b: FrontmatterProperty): boolean {
  return a.key === b.key &&
    a.kind === b.kind &&
    a.value === b.value &&
    a.items.length === b.items.length &&
    a.items.every((item, index) => item === b.items[index])
}

/**
 * Apply a property-list edit to `interior` by patching only the affected
 * lines — untouched keys keep their original text byte-for-byte (comments,
 * quote styles, key spelling). The panel only ever performs single
 * operations (edit / remove / append); anything else falls back to
 * {@link serializeFrontmatterProperties}.
 */
export function patchFrontmatterInterior(
  interior: string,
  previous: FrontmatterProperty[],
  next: FrontmatterProperty[]
): string {
  const fallback = (): string => serializeFrontmatterProperties(next)
  const lines = interior.split('\n')
  const ranges = frontmatterPropertyRanges(lines, previous.map((p) => p.key))
  if (!ranges) return fallback()

  // Align next↔previous assuming a single edit / removal / insertion.
  let removedAt = -1
  let insertedAt = -1
  if (next.length === previous.length - 1) {
    let i = 0
    while (i < next.length && previous[i].key === next[i].key) i += 1
    removedAt = i
  } else if (next.length === previous.length + 1) {
    let i = 0
    while (i < previous.length && previous[i].key === next[i].key) i += 1
    insertedAt = i
  } else if (next.length !== previous.length) {
    return fallback()
  }

  const out: string[] = []
  let cursor = 0
  for (let pi = 0; pi < previous.length; pi += 1) {
    const range = ranges[pi]
    out.push(...lines.slice(cursor, range.start))
    if (pi === insertedAt) {
      // Mid-document insertion: emit the new property before this range.
      const fragment = serializeFrontmatterProperties([next[insertedAt]])
      if (fragment) out.push(...fragment.split('\n'))
    }
    const ni = removedAt >= 0 && pi > removedAt ? pi - 1 : insertedAt >= 0 && pi >= insertedAt ? pi + 1 : pi
    const incoming = pi === removedAt ? null : next[ni] ?? null
    if (incoming === null) {
      // Removed property: drop its lines entirely.
    } else if (sameFrontmatterProperty(previous[pi], incoming)) {
      out.push(...lines.slice(range.start, range.end))
    } else {
      const fragment = serializeFrontmatterProperties([incoming])
      if (fragment) out.push(...fragment.split('\n'))
    }
    cursor = range.end
  }
  out.push(...lines.slice(cursor))
  if (insertedAt === previous.length) {
    const fragment = serializeFrontmatterProperties([next[insertedAt]])
    if (fragment) out.push(...fragment.split('\n'))
  }
  return out.join('\n')
}

/** Serialize structured properties to a YAML interior (no fences). */
export function serializeFrontmatterProperties(properties: FrontmatterProperty[]): string {
  const lines: string[] = []
  for (const property of properties) {
    const key = property.key.trim()
    if (!key) continue
    if (property.kind === 'list') {
      lines.push(`${key}:`)
      for (const item of property.items) {
        const text = item.trim()
        if (!text) continue
        lines.push(`  - ${quoteYamlScalar(text)}`)
      }
      continue
    }
    if (property.kind === 'checkbox') {
      lines.push(`${key}: ${normalizeCheckboxValue(property.value) === 'true' ? 'true' : 'false'}`)
      continue
    }
    if (property.kind === 'date') {
      const date = property.value.trim()
      lines.push(date ? `${key}: ${date}` : `${key}:`)
      continue
    }
    const value = property.value
    lines.push(value === '' ? `${key}:` : `${key}: ${quoteYamlScalar(value)}`)
  }
  return lines.join('\n')
}

/** Prefer list kind for known multi-value keys when creating a row. */
function defaultPropertyKind(key: string): FrontmatterPropertyKind {
  return FRONTMATTER_LIST_KEYS.has(key.trim()) ? 'list' : 'scalar'
}

export function createEmptyProperty(
  key = '',
  kind?: FrontmatterPropertyKind
): FrontmatterProperty {
  const resolved = kind ?? defaultPropertyKind(key)
  return {
    key,
    kind: resolved,
    value: resolved === 'checkbox' ? 'false' : '',
    items: []
  }
}

/** Convert between form property kinds, preserving as much data as practical. */
export function convertPropertyKind(
  property: FrontmatterProperty,
  kind: FrontmatterPropertyKind
): FrontmatterProperty {
  if (property.kind === kind) return property

  const asText = (): string => {
    if (property.kind === 'list') return property.items.join(', ')
    if (property.kind === 'checkbox') return property.value === 'true' ? 'true' : 'false'
    return property.value
  }

  if (kind === 'list') {
    const text = asText().trim()
    return { ...property, kind: 'list', value: '', items: text ? [text] : [] }
  }
  if (kind === 'checkbox') {
    const text = asText().trim()
    return { ...property, kind: 'checkbox', value: normalizeCheckboxValue(text || 'false'), items: [] }
  }
  if (kind === 'date') {
    const text = asText().trim()
    return { ...property, kind: 'date', value: isIsoDate(text) ? text.trim() : '', items: [] }
  }
  return { ...property, kind: 'scalar', value: asText(), items: [] }
}
