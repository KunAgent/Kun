/**
 * Minimal byte-preserving TOML editing for agent configs (Codex).
 *
 * Supported edits are deliberately narrow: top-level scalar keys and whole
 * tables of scalar keys (`[model_providers.kun]`). Every other line, comment
 * and table stays untouched. Multi-line strings are skipped as opaque spans
 * so a `[` inside one is never mistaken for a header.
 */
export type TomlScalar = string | number | boolean
export type TomlTable = Record<string, TomlScalar | string[] | Record<string, string>>

type Line = { text: string; header?: string; key?: string; inMultiline: boolean }

const HEADER = /^\s*\[\s*([^\][]+?)\s*\]\s*(?:#.*)?$/
const ARRAY_HEADER = /^\s*\[\[/
const KEY = /^\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=/

function splitLines(text: string): { lines: string[]; eol: string; trailing: boolean } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const trailing = text.endsWith('\n')
  const body = trailing ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text
  return { lines: body ? body.split(/\r?\n/) : [], eol, trailing }
}

function unquoteKey(raw: string): string {
  if (raw.startsWith('"')) return JSON.parse(raw) as string
  if (raw.startsWith("'")) return raw.slice(1, -1)
  return raw
}

/** Splits a dotted key into its parts, keeping dots inside quoted parts (`models."kun/glm-4.6"`). */
export function splitTomlKey(name: string): string[] {
  const parts: string[] = []
  let index = 0
  while (index < name.length) {
    while (name[index] === ' ' || name[index] === '\t') index += 1
    const quote = name[index]
    if (quote === '"' || quote === "'") {
      let end = index + 1
      while (end < name.length && name[end] !== quote) end += quote === '"' && name[end] === '\\' ? 2 : 1
      parts.push(unquoteKey(name.slice(index, end + 1)))
      index = end + 1
    } else {
      let end = index
      while (end < name.length && name[end] !== '.') end += 1
      parts.push(name.slice(index, end).trim())
      index = end
    }
    while (name[index] === ' ' || name[index] === '\t') index += 1
    if (name[index] === '.') index += 1
  }
  return parts
}

function canonicalTable(name: string): string {
  return JSON.stringify(splitTomlKey(name))
}

function scan(lines: string[]): Line[] {
  const out: Line[] = []
  let multiline: '"""' | "'''" | null = null
  for (const text of lines) {
    if (multiline) {
      out.push({ text, inMultiline: true })
      if (text.includes(multiline)) multiline = null
      continue
    }
    const header = ARRAY_HEADER.test(text) ? undefined : HEADER.exec(text)?.[1]
    const key = header ? undefined : KEY.exec(text)?.[1]
    out.push({ text, inMultiline: false, ...(header ? { header: canonicalTable(header) } : {}),
      ...(key ? { key: unquoteKey(key) } : {}) })
    for (const quote of ['"""', "'''"] as const) {
      const count = text.split(quote).length - 1
      if (count % 2 === 1) { multiline = quote; break }
    }
  }
  return out
}

function firstHeader(lines: Line[]): number {
  const index = lines.findIndex((line) => line.header !== undefined || ARRAY_HEADER.test(line.text))
  return index < 0 ? lines.length : index
}

export function formatTomlValue(value: TomlScalar | string[] | Record<string, string>): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => JSON.stringify(entry)).join(', ')}]`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `{ ${Object.entries(value).map(([key, entry]) => `${formatTomlKey(key)} = ${JSON.stringify(entry)}`).join(', ')} }`
}

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)
}

function parseScalar(raw: string): TomlScalar | string[] | undefined {
  const value = raw.replace(/\s+#.*$/, '').trim()
  if (/^\[\s*(?:"(?:[^"\\]|\\.)*"\s*,?\s*)*\]$/.test(value)) {
    return [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`) as string)
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) return JSON.parse(value) as string
  if (/^'[^']*'$/.test(value)) return value.slice(1, -1)
  if (value === 'true' || value === 'false') return value === 'true'
  if (/^[+-]?\d[\d_]*(?:\.\d+)?$/.test(value)) return Number(value.replace(/_/g, ''))
  return undefined
}

function lineValue(text: string): TomlScalar | string[] | undefined {
  const index = text.indexOf('=')
  return index < 0 ? undefined : parseScalar(text.slice(index + 1))
}

export function getTomlTopLevel(text: string, key: string): TomlScalar | undefined {
  const lines = scan(splitLines(text).lines)
  const end = firstHeader(lines)
  for (let index = 0; index < end; index += 1) {
    if (lines[index]!.key !== key) continue
    const value = lineValue(lines[index]!.text)
    return Array.isArray(value) ? undefined : value
  }
  return undefined
}

/** Set or (with undefined) delete a top-level key; new keys go before the first table. */
export function setTomlTopLevel(text: string, key: string, value: TomlScalar | undefined): string {
  const { lines: raw, eol, trailing } = splitLines(text)
  const lines = scan(raw)
  const end = firstHeader(lines)
  const index = lines.slice(0, end).findIndex((line) => line.key === key)
  const rendered = value === undefined ? undefined : `${formatTomlKey(key)} = ${formatTomlValue(value)}`
  if (index >= 0) {
    if (rendered === undefined) raw.splice(index, 1)
    else raw[index] = rendered
  } else if (rendered !== undefined) {
    // Insert after the last top-level key line so comments above tables stay attached.
    let at = 0
    for (let cursor = 0; cursor < end; cursor += 1) if (lines[cursor]!.key) at = cursor + 1
    raw.splice(at, 0, rendered)
    if (at === end && end < raw.length - 1 && raw[at + 1]?.trim()) raw.splice(at + 1, 0, '')
  } else return text
  return raw.join(eol) + (trailing || !text ? eol : '')
}

function tableRange(lines: Line[], name: string): { start: number; end: number } | null {
  const wanted = canonicalTable(name)
  const start = lines.findIndex((line) => line.header === wanted)
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && lines[end]!.header === undefined && !ARRAY_HEADER.test(lines[end]!.text)) end += 1
  // Keep trailing blank lines with the following table.
  while (end > start + 1 && !lines[end - 1]!.text.trim()) end -= 1
  return { start, end }
}

export function getTomlTable(text: string, name: string): Record<string, TomlScalar | string[]> | undefined {
  const lines = scan(splitLines(text).lines)
  const range = tableRange(lines, name)
  if (!range) return undefined
  const out: Record<string, TomlScalar | string[]> = {}
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index]!
    if (!line.key || line.inMultiline) continue
    const value = lineValue(line.text)
    if (value !== undefined) out[line.key] = value
  }
  return out
}

/** Replace a whole table with the given keys, or remove it with undefined. */
export function setTomlTable(text: string, name: string, table: TomlTable | undefined): string {
  const { lines: raw, eol, trailing } = splitLines(text)
  const lines = scan(raw)
  const range = tableRange(lines, name)
  const header = `[${splitTomlKey(name).map(formatTomlKey).join('.')}]`
  const body = table ? [header, ...Object.entries(table).map(([key, value]) => `${formatTomlKey(key)} = ${formatTomlValue(value)}`)] : []
  if (range) {
    raw.splice(range.start, range.end - range.start, ...body)
    if (!table) {
      // Collapse the blank line the removed table leaves behind.
      if (range.start >= raw.length) while (raw.length && !raw.at(-1)!.trim()) raw.pop()
      else if (!raw[range.start]?.trim() && (range.start === 0 || !raw[range.start - 1]?.trim())) raw.splice(range.start, 1)
    }
  } else if (table) {
    while (raw.length && !raw.at(-1)!.trim()) raw.pop()
    if (raw.length) raw.push('')
    raw.push(...body)
  } else return text
  return raw.join(eol) + (trailing || !text || table ? eol : '')
}

/** Every `[table]` header in the file, each as its key parts. */
export function listTomlTables(text: string): string[][] {
  return scan(splitLines(text).lines).flatMap((line) => line.header ? [JSON.parse(line.header) as string[]] : [])
}

/** Formats key parts as a table name `setTomlTable` accepts. */
export function tomlTableName(parts: readonly string[]): string {
  return parts.map(formatTomlKey).join('.')
}
