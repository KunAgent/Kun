import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export type SlashCommand = {
  name: string
  description?: string
  argumentHint?: string
}

export type AutocompleteItem = {
  value: string
  label: string
  description?: string
}

export type AutocompleteSuggestions = {
  items: AutocompleteItem[]
  /** Text immediately before the cursor that a completion replaces. */
  prefix: string
}

export type AutocompleteResult = { lines: string[]; cursorLine: number; cursorCol: number }

export interface AutocompleteProvider {
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean }
  ): Promise<AutocompleteSuggestions | null>
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string
  ): AutocompleteResult
}

const PATH_DELIMITERS = new Set([' ', '\t', '"', "'", '='])

/** Lower score is better; undefined means the query does not match. */
export function fuzzyScore(query: string, text: string): number | undefined {
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  if (!needle) return 0
  if (needle.length > haystack.length) return undefined
  let queryIndex = 0
  let score = 0
  let lastMatch = -1
  let consecutive = 0
  for (let index = 0; index < haystack.length && queryIndex < needle.length; index += 1) {
    if (haystack[index] !== needle[queryIndex]) continue
    if (lastMatch === index - 1) {
      consecutive += 1
      score -= consecutive * 5
    } else {
      consecutive = 0
      if (lastMatch >= 0) score += (index - lastMatch - 1) * 2
    }
    if (index === 0 || /[\s\-_./:]/u.test(haystack[index - 1]!)) score -= 10
    score += index * 0.1
    lastMatch = index
    queryIndex += 1
  }
  if (queryIndex < needle.length) return undefined
  return needle === haystack ? score - 100 : score
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const tokens = query.trim().split(/[\s/]+/u).filter(Boolean)
  if (!tokens.length) return [...items]
  const scored: Array<{ item: T; score: number; length: number }> = []
  for (const item of items) {
    let total = 0
    let matched = true
    for (const token of tokens) {
      const score = fuzzyScore(token, text(item))
      if (score === undefined) { matched = false; break }
      total += score
    }
    if (matched) scored.push({ item, score: total, length: text(item).length })
  }
  // Equal scores prefer the shorter candidate: "/con" offers connect before continue.
  return scored
    .sort((left, right) => left.score - right.score || left.length - right.length)
    .map((entry) => entry.item)
}

function findLastDelimiter(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (PATH_DELIMITERS.has(text[index] ?? '')) return index
  }
  return -1
}

function findUnclosedQuoteStart(text: string): number | undefined {
  let open = false
  let start = -1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue
    open = !open
    if (open) start = index
  }
  return open ? start : undefined
}

function isTokenStart(text: string, index: number): boolean {
  return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? '')
}

function extractQuotedPrefix(text: string): string | undefined {
  const start = findUnclosedQuoteStart(text)
  if (start === undefined) return undefined
  if (start > 0 && text[start - 1] === '@') {
    return isTokenStart(text, start - 1) ? text.slice(start - 1) : undefined
  }
  return isTokenStart(text, start) ? text.slice(start) : undefined
}

function parsePathPrefix(prefix: string): { raw: string; at: boolean; quoted: boolean } {
  if (prefix.startsWith('@"')) return { raw: prefix.slice(2), at: true, quoted: true }
  if (prefix.startsWith('"')) return { raw: prefix.slice(1), at: false, quoted: true }
  if (prefix.startsWith('@')) return { raw: prefix.slice(1), at: true, quoted: false }
  return { raw: prefix, at: false, quoted: false }
}

function completionValue(path: string, at: boolean, quoted: boolean): string {
  const prefix = at ? '@' : ''
  return quoted || path.includes(' ') ? `${prefix}"${path}"` : `${prefix}${path}`
}

function toDisplayPath(value: string): string {
  return value.replaceAll('\\', '/')
}

/**
 * Slash-command and filesystem-path completion for the composer. `@` file
 * mentions are layered on top by WorkspaceFileAutocompleteProvider.
 */
export class SlashPathAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly commands: readonly SlashCommand[],
    private readonly basePath: string
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean }
  ): Promise<AutocompleteSuggestions | null> {
    const before = (lines[cursorLine] ?? '').slice(0, cursorCol)
    if (options.signal.aborted) return null
    if (!options.force && before.startsWith('/') && cursorLine === 0) {
      if (before.includes(' ')) return null
      const query = before.slice(1)
      const items = fuzzyFilter(this.commands, query, (command) => command.name).map((command) => {
        const description = command.argumentHint
          ? command.description ? `${command.argumentHint} — ${command.description}` : command.argumentHint
          : command.description
        return { value: command.name, label: command.name, ...(description ? { description } : {}) }
      })
      return items.length ? { items, prefix: before } : null
    }
    const prefix = this.extractPathPrefix(before, options.force ?? false)
    if (prefix === undefined) return null
    const items = this.fileSuggestions(prefix)
    return items.length ? { items, prefix } : null
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string
  ): AutocompleteResult {
    const line = lines[cursorLine] ?? ''
    const beforePrefix = line.slice(0, cursorCol - prefix.length)
    const afterCursor = line.slice(cursorCol)
    const quotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"')
    const after = quotedPrefix && item.value.endsWith('"') && afterCursor.startsWith('"')
      ? afterCursor.slice(1)
      : afterCursor
    const next = [...lines]
    if (prefix.startsWith('/') && beforePrefix.trim() === '' && !prefix.slice(1).includes('/')) {
      next[cursorLine] = `${beforePrefix}/${item.value} ${after}`
      return { lines: next, cursorLine, cursorCol: beforePrefix.length + item.value.length + 2 }
    }
    const isDirectory = item.label.endsWith('/')
    const cursorOffset = isDirectory && item.value.endsWith('"') ? item.value.length - 1 : item.value.length
    if (prefix.startsWith('@')) {
      const suffix = isDirectory ? '' : ' '
      next[cursorLine] = `${beforePrefix}${item.value}${suffix}${after}`
      return { lines: next, cursorLine, cursorCol: beforePrefix.length + cursorOffset + suffix.length }
    }
    next[cursorLine] = `${beforePrefix}${item.value}${after}`
    return { lines: next, cursorLine, cursorCol: beforePrefix.length + cursorOffset }
  }

  private extractPathPrefix(text: string, force: boolean): string | undefined {
    const quoted = extractQuotedPrefix(text)
    if (quoted !== undefined) return quoted
    const delimiter = findLastDelimiter(text)
    const prefix = delimiter === -1 ? text : text.slice(delimiter + 1)
    if (force) return prefix
    if (prefix.startsWith('@')) return undefined
    if (prefix.includes('/') || prefix.startsWith('.') || prefix.startsWith('~/')) return prefix
    return undefined
  }

  private expandHome(path: string): string {
    if (path === '~') return homedir()
    if (!path.startsWith('~/')) return path
    const expanded = join(homedir(), path.slice(2))
    return path.endsWith('/') && !expanded.endsWith('/') ? `${expanded}/` : expanded
  }

  private fileSuggestions(prefix: string): AutocompleteItem[] {
    try {
      const { raw, at, quoted } = parsePathPrefix(prefix)
      const expanded = raw.startsWith('~') ? this.expandHome(raw) : raw
      const absolute = raw.startsWith('~') || expanded.startsWith('/')
      const listsDirectory = raw === '' || raw.endsWith('/') || raw === '~'
      const searchDir = listsDirectory
        ? absolute ? expanded : join(this.basePath, expanded)
        : absolute ? dirname(expanded) : join(this.basePath, dirname(expanded))
      const searchPrefix = listsDirectory ? '' : basename(expanded)
      const items: AutocompleteItem[] = []
      for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
        if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) continue
        let directory = entry.isDirectory()
        if (!directory && entry.isSymbolicLink()) {
          try { directory = statSync(join(searchDir, entry.name)).isDirectory() } catch { directory = false }
        }
        let relative: string
        if (raw.endsWith('/')) relative = raw + entry.name
        else if (raw.includes('/') || raw.includes('\\')) {
          if (raw.startsWith('~/')) {
            const parent = dirname(raw.slice(2))
            relative = `~/${parent === '.' ? entry.name : join(parent, entry.name)}`
          } else if (raw.startsWith('/')) {
            const parent = dirname(raw)
            relative = parent === '/' ? `/${entry.name}` : `${parent}/${entry.name}`
          } else {
            relative = join(dirname(raw), entry.name)
            if (raw.startsWith('./') && !relative.startsWith('./')) relative = `./${relative}`
          }
        } else relative = raw.startsWith('~') ? `~/${entry.name}` : entry.name
        relative = toDisplayPath(relative)
        items.push({
          value: completionValue(directory ? `${relative}/` : relative, at, quoted),
          label: `${entry.name}${directory ? '/' : ''}`
        })
      }
      return items.sort((left, right) => {
        const leftDirectory = left.label.endsWith('/')
        const rightDirectory = right.label.endsWith('/')
        if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
        return left.label.localeCompare(right.label)
      })
    } catch {
      return []
    }
  }
}
