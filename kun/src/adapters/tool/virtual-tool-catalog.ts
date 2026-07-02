import { createHash } from 'node:crypto'

export type VirtualToolKind = 'builtin' | 'mcp' | 'skill' | 'connector'

export type VirtualToolEntry<T = unknown> = {
  id: string
  name: string
  kind: VirtualToolKind
  description: string
  inputSchema?: Record<string, unknown>
  keywords?: string[]
  alwaysOn?: boolean
  metadata?: unknown
  value?: T
}

export type VirtualToolSearchResult<T = unknown> = {
  entry: VirtualToolEntry<T>
  score: number
}

export class VirtualToolCatalog<T = unknown> {
  private entries = new Map<string, VirtualToolEntry<T>>()
  private version = catalogVersion<T>([])

  constructor(entries: VirtualToolEntry<T>[] = []) {
    this.replaceAll(entries)
  }

  currentVersion(): string {
    return this.version
  }

  size(): number {
    return this.entries.size
  }

  replaceAll(entries: VirtualToolEntry<T>[]): string {
    this.entries = new Map(entries.map((entry) => [entry.id, entry]))
    this.version = catalogVersion([...this.entries.values()])
    return this.version
  }

  list(): VirtualToolEntry<T>[] {
    return [...this.entries.values()]
  }

  load(id: string): VirtualToolEntry<T> | undefined {
    return this.entries.get(id)
  }

  alwaysOn(): VirtualToolEntry<T>[] {
    return this.list().filter((entry) => entry.alwaysOn)
  }

  search(
    query: string,
    options: { topK?: number; kinds?: VirtualToolKind[] } = {}
  ): VirtualToolSearchResult<T>[] {
    const queryTokens = new Set(tokenize(query))
    if (queryTokens.size === 0) return []
    const kinds = options.kinds ? new Set(options.kinds) : null
    const results: VirtualToolSearchResult<T>[] = []
    for (const entry of this.entries.values()) {
      if (kinds && !kinds.has(entry.kind)) continue
      const haystack = new Set(tokenize([
        entry.name,
        entry.description,
        ...(entry.keywords ?? [])
      ].join(' ')))
      let overlap = 0
      for (const token of queryTokens) {
        if (haystack.has(token)) overlap += 1
      }
      if (overlap === 0) continue
      results.push({ entry, score: overlap / queryTokens.size })
    }
    return results
      .sort((a, b) => (b.score - a.score) || a.entry.name.localeCompare(b.entry.name))
      .slice(0, options.topK ?? 5)
  }

  freeze(): FrozenToolCatalogView<T> {
    return new FrozenToolCatalogView(this)
  }
}

export class FrozenToolCatalogView<T = unknown> {
  readonly frozenVersion: string
  private readonly snapshot: VirtualToolCatalog<T>

  constructor(private readonly catalog: VirtualToolCatalog<T>) {
    this.frozenVersion = catalog.currentVersion()
    this.snapshot = new VirtualToolCatalog(catalog.list().map(cloneEntry))
  }

  pendingUpdate(): boolean {
    return this.catalog.currentVersion() !== this.frozenVersion
  }

  size(): number {
    return this.snapshot.size()
  }

  list(): VirtualToolEntry<T>[] {
    return this.snapshot.list()
  }

  load(id: string): VirtualToolEntry<T> | undefined {
    return this.snapshot.load(id)
  }

  has(id: string): boolean {
    return this.snapshot.load(id) !== undefined
  }

  alwaysOn(): VirtualToolEntry<T>[] {
    return this.snapshot.alwaysOn()
  }

  search(
    query: string,
    options?: { topK?: number; kinds?: VirtualToolKind[] }
  ): VirtualToolSearchResult<T>[] {
    return this.snapshot.search(query, options)
  }
}

function cloneEntry<T>(entry: VirtualToolEntry<T>): VirtualToolEntry<T> {
  return {
    ...entry,
    ...(entry.inputSchema ? { inputSchema: structuredClone(entry.inputSchema) } : {}),
    ...(entry.keywords ? { keywords: [...entry.keywords] } : {}),
    ...(entry.metadata !== undefined ? { metadata: structuredClone(entry.metadata) } : {})
  }
}

function catalogVersion<T>(entries: readonly VirtualToolEntry<T>[]): string {
  const signatures = entries.map(entrySignature).sort()
  return createHash('sha256').update(signatures.join('\n')).digest('hex').slice(0, 16)
}

function entrySignature<T>(entry: VirtualToolEntry<T>): string {
  return JSON.stringify(canonicalize({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    description: entry.description,
    inputSchema: entry.inputSchema ?? {},
    keywords: [...(entry.keywords ?? [])].sort(),
    alwaysOn: entry.alwaysOn === true,
    metadata: entry.metadata
  }))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = (value as Record<string, unknown>)[key]
    if (next !== undefined) out[key] = canonicalize(next)
  }
  return out
}

function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
  const tokens: string[] = []
  for (const term of normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? []) {
    tokens.push(term)
    tokens.push(...term.split(/[_-]+/).filter(Boolean))
  }
  const han: string[] = normalized.match(/\p{Script=Han}+/gu) ?? []
  for (const segment of han) {
    const chars = [...segment]
    if (chars.length === 1) {
      tokens.push(chars[0])
      continue
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.push(chars.slice(index, index + 2).join(''))
    }
  }
  return tokens
}
