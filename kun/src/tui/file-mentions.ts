import {
  SlashPathAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteResult,
  type AutocompleteSuggestions,
  type SlashCommand
} from './autocomplete.js'
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, posix } from 'node:path'

const MAX_INDEX_ENTRIES = 10_000
const MAX_NORMALIZED_ENTRIES = 20_000
const MAX_SUGGESTIONS = 20
const MAX_SEARCH_OUTPUT_BYTES = 4 * 1024 * 1024
const DEFAULT_CACHE_TTL_MS = 2_000

export type TuiFileMention = {
  raw: string
  relativePath: string
}

export type InvalidTuiFileMention = {
  raw: string
  reason: string
}

export type ParsedTuiFileMentions = {
  mentions: TuiFileMention[]
  invalid: InvalidTuiFileMention[]
}

export type WorkspaceFileEntry = {
  path: string
  isDirectory: boolean
}

export type WorkspaceFileLister = (
  workspace: string,
  signal: AbortSignal
) => Promise<WorkspaceFileEntry[]>

/**
 * Parse only explicit file-reference tokens. The original prompt is not
 * rewritten; relative paths are returned for the attachment preparation step.
 */
export function parseTuiFileMentions(text: string): ParsedTuiFileMentions {
  const mentions: TuiFileMention[] = []
  const invalid: InvalidTuiFileMention[] = []
  const seen = new Set<string>()

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '@' || (index > 0 && !/\s/u.test(text[index - 1]!))) continue
    const start = index
    index += 1
    if (index >= text.length || /\s/u.test(text[index]!)) continue

    let value = ''
    if (text[index] === '"') {
      index += 1
      let closed = false
      while (index < text.length) {
        const character = text[index]!
        if (character === '"') {
          closed = true
          break
        }
        if (character === '\\' && index + 1 < text.length) {
          const escaped = text[index + 1]!
          if (escaped === '"' || escaped === '\\') {
            value += escaped
            index += 2
            continue
          }
        }
        value += character
        index += 1
      }
      if (!closed) {
        invalid.push({
          raw: text.slice(start),
          reason: 'quoted file mention is missing its closing quote'
        })
        break
      }
    } else {
      const valueStart = index
      while (index < text.length && !/\s/u.test(text[index]!)) index += 1
      value = text.slice(valueStart, index)
      index -= 1
    }

    const raw = text.slice(start, index + 1)
    const normalized = normalizeMentionPath(value)
    if (!normalized.path) {
      invalid.push({ raw, reason: normalized.reason ?? 'invalid workspace-relative path' })
      continue
    }
    if (seen.has(normalized.path)) continue
    seen.add(normalized.path)
    mentions.push({ raw, relativePath: normalized.path })
  }

  return { mentions, invalid }
}

function normalizeMentionPath(value: string): { path?: string; reason?: string } {
  if (!value || value.includes('\0')) return { reason: 'file mention is empty or invalid' }
  const portable = value.replaceAll('\\', '/')
  if (
    portable.startsWith('/') ||
    portable.startsWith('~') ||
    /^[a-zA-Z]:\//u.test(portable) ||
    portable.startsWith('//')
  ) {
    return { reason: 'file mentions must be relative to the active workspace' }
  }
  const segments = portable.split('/')
  if (segments.includes('..')) {
    return { reason: 'file mentions cannot traverse outside the active workspace' }
  }
  if (segments.includes('.git')) {
    return { reason: 'repository metadata under .git cannot be mentioned' }
  }
  const normalized = posix.normalize(portable).replace(/^\.\/+/u, '')
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    return { reason: 'file mentions must name a workspace file' }
  }
  return { path: normalized }
}

export type WorkspaceFileAutocompleteOptions = {
  listFiles?: WorkspaceFileLister
  cacheTtlMs?: number
  maxSuggestions?: number
}

/**
 * Slash/skill and path completion with Kun's standalone-safe `@` file index
 * (no fd/fzf dependency).
 */
export class WorkspaceFileAutocompleteProvider implements AutocompleteProvider {
  readonly triggerCharacters = ['@']
  private readonly delegate: SlashPathAutocompleteProvider
  private readonly listFiles: WorkspaceFileLister
  private readonly cacheTtlMs: number
  private readonly maxSuggestions: number
  private cache?: { expiresAt: number; entries: WorkspaceFileEntry[] }

  constructor(
    commands: readonly SlashCommand[],
    private readonly workspace: string,
    options: WorkspaceFileAutocompleteOptions = {}
  ) {
    this.delegate = new SlashPathAutocompleteProvider(commands, workspace)
    this.listFiles = options.listFiles ?? listWorkspaceFiles
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.maxSuggestions = options.maxSuggestions ?? MAX_SUGGESTIONS
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean }
  ): Promise<AutocompleteSuggestions | null> {
    const line = lines[cursorLine] ?? ''
    const prefix = extractAtPrefix(line.slice(0, cursorCol))
    if (prefix === undefined) {
      return this.delegate.getSuggestions(lines, cursorLine, cursorCol, options)
    }
    if (options.signal.aborted) return null
    const query = mentionQuery(prefix)
    const entries = await this.entries(options.signal)
    if (options.signal.aborted) return null
    const items = scoreWorkspaceEntries(entries, query)
      .slice(0, this.maxSuggestions)
      .map((entry) => completionItem(entry, prefix.startsWith('@"')))
    return items.length ? { items, prefix } : null
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string
  ): AutocompleteResult {
    return this.delegate.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  private async entries(signal: AbortSignal): Promise<WorkspaceFileEntry[]> {
    if (this.cache && this.cache.expiresAt >= Date.now()) return this.cache.entries
    const entries = await this.listFiles(this.workspace, signal)
    if (!signal.aborted) {
      this.cache = {
        entries,
        expiresAt: Date.now() + this.cacheTtlMs
      }
    }
    return entries
  }
}

export async function listWorkspaceFiles(
  workspace: string,
  signal: AbortSignal
): Promise<WorkspaceFileEntry[]> {
  const fast = await listWorkspaceFilesWithRipgrep(workspace, signal)
  if (signal.aborted) return []
  if (fast !== undefined && fast.length > 0) return normalizeEntries(fast)
  return normalizeEntries(await walkWorkspaceFilesFallback(workspace, signal))
}

function extractAtPrefix(text: string): string | undefined {
  const quoted = /(?:^|\s)(@"(?:\\.|[^"\\])*)$/u.exec(text)
  if (quoted?.[1]) return quoted[1]
  const unquoted = /(?:^|\s)(@[^\s"]*)$/u.exec(text)
  return unquoted?.[1]
}

function mentionQuery(prefix: string): string {
  const raw = prefix.startsWith('@"') ? prefix.slice(2) : prefix.slice(1)
  return raw.replaceAll('\\', '/').toLocaleLowerCase()
}

function scoreWorkspaceEntries(
  entries: readonly WorkspaceFileEntry[],
  query: string
): Array<WorkspaceFileEntry & { score: number }> {
  return entries
    .flatMap((entry) => {
      const score = fuzzyPathScore(entry, query)
      return score === undefined ? [] : [{ ...entry, score }]
    })
    .sort((left, right) =>
      left.score - right.score ||
      Number(right.isDirectory) - Number(left.isDirectory) ||
      left.path.localeCompare(right.path)
    )
}

function fuzzyPathScore(entry: WorkspaceFileEntry, query: string): number | undefined {
  const path = entry.path.toLocaleLowerCase()
  const pathWithoutSlash = entry.isDirectory ? path.slice(0, -1) : path
  const name = basename(pathWithoutSlash)
  if (!query) {
    const depth = pathWithoutSlash.split('/').length
    return depth * 10 + (entry.isDirectory ? 0 : 1)
  }
  if (query.endsWith('/')) {
    if (!path.startsWith(query)) return undefined
    const remainder = path.slice(query.length).replace(/\/$/u, '')
    if (!remainder || remainder.includes('/')) return undefined
    return entry.isDirectory ? 0 : 1
  }
  if (name === query) return -1_000
  if (name.startsWith(query)) return -800 + name.length
  if (pathWithoutSlash.startsWith(query)) return -700 + pathWithoutSlash.length
  const nameIndex = name.indexOf(query)
  if (nameIndex >= 0) return -500 + nameIndex
  const pathIndex = pathWithoutSlash.indexOf(query)
  if (pathIndex >= 0) return -300 + pathIndex
  const subsequence = subsequenceScore(query, pathWithoutSlash)
  return subsequence === undefined ? undefined : 100 + subsequence
}

function subsequenceScore(query: string, candidate: string): number | undefined {
  let queryIndex = 0
  let lastMatch = -1
  let score = 0
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) continue
    if (lastMatch >= 0) score += index - lastMatch - 1
    if (index === 0 || /[._\-/]/u.test(candidate[index - 1]!)) score -= 3
    lastMatch = index
    queryIndex += 1
  }
  return queryIndex === query.length ? score : undefined
}

function completionItem(
  entry: WorkspaceFileEntry & { score: number },
  quotedPrefix: boolean
): AutocompleteItem {
  const displayPath = entry.path
  const needsQuotes = quotedPrefix || /\s/u.test(displayPath) || displayPath.includes('"')
  const escaped = displayPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  const value = needsQuotes ? `@"${escaped}"` : `@${displayPath}`
  const pathWithoutSlash = entry.isDirectory ? displayPath.slice(0, -1) : displayPath
  return {
    value,
    label: `${basename(pathWithoutSlash)}${entry.isDirectory ? '/' : ''}`,
    description: pathWithoutSlash
  }
}

async function listWorkspaceFilesWithRipgrep(
  workspace: string,
  signal: AbortSignal
): Promise<WorkspaceFileEntry[] | undefined> {
  return new Promise((resolveResult) => {
    if (signal.aborted) {
      resolveResult([])
      return
    }
    const child = spawn('rg', [
      '--files',
      '--hidden',
      '--glob',
      '!.git',
      '--glob',
      '!.git/**'
    ], {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let stdout = ''
    let settled = false
    const finish = (result: WorkspaceFileEntry[] | undefined): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      resolveResult(result)
    }
    const abort = (): void => {
      if (child.exitCode === null) child.kill('SIGKILL')
      finish([])
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_SEARCH_OUTPUT_BYTES) {
        if (child.exitCode === null) child.kill('SIGKILL')
        finish(undefined)
      }
    })
    child.once('error', () => finish(undefined))
    child.once('close', (code) => {
      if (signal.aborted) {
        finish([])
        return
      }
      if (code !== 0 && code !== 1) {
        finish(undefined)
        return
      }
      const files = stdout
        .split(/\r?\n/gu)
        .filter(Boolean)
        .slice(0, MAX_INDEX_ENTRIES)
        .map((path) => ({ path, isDirectory: false }))
      finish(files)
    })
  })
}

export async function walkWorkspaceFilesFallback(
  workspace: string,
  signal: AbortSignal
): Promise<WorkspaceFileEntry[]> {
  const entries: WorkspaceFileEntry[] = []
  const directories = ['']
  while (directories.length && entries.length < MAX_INDEX_ENTRIES && !signal.aborted) {
    const directory = directories.shift()!
    let children
    try {
      children = await readdir(directory ? `${workspace}/${directory}` : workspace, { withFileTypes: true })
    } catch {
      continue
    }
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      if (signal.aborted || entries.length >= MAX_INDEX_ENTRIES) break
      if (child.name === '.git') continue
      const path = directory ? `${directory}/${child.name}` : child.name
      if (child.isDirectory()) {
        entries.push({ path: `${path}/`, isDirectory: true })
        directories.push(path)
      } else {
        entries.push({ path, isDirectory: false })
      }
    }
  }
  return entries
}

function normalizeEntries(entries: readonly WorkspaceFileEntry[]): WorkspaceFileEntry[] {
  const normalized = new Map<string, WorkspaceFileEntry>()
  for (const entry of entries) {
    if (normalized.size >= MAX_NORMALIZED_ENTRIES) break
    const raw = entry.path.replaceAll('\\', '/').replace(/^\.\/+/u, '')
    if (!raw || raw === '.git' || raw.startsWith('.git/') || raw.includes('/.git/')) continue
    const path = entry.isDirectory
      ? `${raw.replace(/\/+$/u, '')}/`
      : raw.replace(/\/+$/u, '')
    if (!path) continue
    normalized.set(path, { path, isDirectory: entry.isDirectory })
    if (entry.isDirectory) continue
    let parent = posix.dirname(path)
    while (parent && parent !== '.') {
      const directoryPath = `${parent}/`
      if (!normalized.has(directoryPath) && normalized.size < MAX_NORMALIZED_ENTRIES) {
        normalized.set(directoryPath, { path: directoryPath, isDirectory: true })
      }
      parent = posix.dirname(parent)
    }
  }
  return [...normalized.values()]
}
