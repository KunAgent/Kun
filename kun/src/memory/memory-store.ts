import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryUpdateRequest
} from '../contracts/memory.js'

export interface MemoryStore {
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord>
  delete(id: string, access?: MemoryAccess): Promise<MemoryRecord>
  list(filter?: { workspace?: string; includeDeleted?: boolean; all?: boolean }): Promise<MemoryRecord[]>
  retrieve(input: { query: string; workspace?: string; limit: number }): Promise<MemoryRecord[]>
  diagnostics(): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void
}

export type MemoryAccess = { workspace?: string }

export class FileMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []

  constructor(
    private readonly options: {
      rootDir: string
      config: MemoryCapabilityConfig
      nowIso?: () => string
      idGenerator?: () => string
    }
  ) {}

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    await mkdir(this.options.rootDir, { recursive: true })
    const now = this.now()
    const scope = input.scope ?? 'workspace'
    const workspace = normalizeScopePath(input.workspace)
    const project = normalizeScopePath(input.project ?? (scope === 'project' ? input.workspace : undefined))
    const parsed = MemoryRecord.parse({
      id: this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      content: input.content,
      scope,
      ...(scope !== 'user' && workspace ? { workspace } : {}),
      ...(scope === 'project' && project ? { project } : {}),
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 1,
      createdAt: now,
      updatedAt: now
    })
    await this.write(parsed)
    return parsed
  }

  async update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.disabled === true ? { disabledAt: current.disabledAt ?? now } : {}),
      ...(patch.disabled === false ? { disabledAt: undefined } : {}),
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async delete(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    const current = await this.mustGet(id, access)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async list(filter: { workspace?: string; includeDeleted?: boolean; all?: boolean } = {}): Promise<MemoryRecord[]> {
    const records = await this.readAll()
    return records
      .filter((record) => filter.includeDeleted || !record.deletedAt)
      .filter((record) => filter.all || inScope(record, filter.workspace))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async retrieve(input: { query: string; workspace?: string; limit: number }): Promise<MemoryRecord[]> {
    if (!this.options.config.enabled) return []
    const active = (await this.list({ workspace: input.workspace }))
      .filter((record) => !record.disabledAt)
    // User-scope memories are persistent identity facts (name, preferences,
    // account) — small in number, high in value, and frequently queried by
    // semantic prompts ("who am I?", "what do you know about me") that share
    // zero keyword overlap with the stored content. Keyword retrieval will
    // always miss them, so inject every active user memory unconditionally and
    // reserve scored retrieval for the larger workspace/project pool.
    const userMemories = active.filter((record) => record.scope === 'user')
    const scored = active
      .filter((record) => record.scope !== 'user')
      .map((record) => ({ record, score: scoreMemory(record, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .map((entry) => entry.record)
    return [...userMemories, ...scored].slice(0, input.limit)
  }

  async diagnostics(): Promise<MemoryDiagnostics> {
    const records = await this.readAll()
    return {
      enabled: this.options.config.enabled,
      rootDir: this.options.rootDir,
      activeCount: records.filter((record) => !record.deletedAt && !record.disabledAt).length,
      tombstoneCount: records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: [...this.lastInjectedIds]
    }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  private async mustGet(id: string, access?: MemoryAccess): Promise<MemoryRecord> {
    const record = (await this.readAll()).find((candidate) => candidate.id === id)
    if (!record || (access && !inScope(record, access.workspace))) {
      throw new Error(`memory not found: ${id}`)
    }
    return record
  }

  private async readAll(): Promise<MemoryRecord[]> {
    await mkdir(this.options.rootDir, { recursive: true })
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(this.options.rootDir, entry), 'utf8')
        .then((text) => MemoryRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records.filter((record): record is MemoryRecord => Boolean(record))
  }

  private write(record: MemoryRecord): Promise<void> {
    return atomicWriteFile(
      join(this.options.rootDir, `${record.id}.json`),
      JSON.stringify(record, null, 2)
    )
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function inScope(record: MemoryRecord, workspace: string | undefined): boolean {
  if (record.scope === 'user') return true
  const currentWorkspace = normalizeScopePath(workspace)
  if (!currentWorkspace) return false
  if (record.scope === 'workspace') {
    return normalizeScopePath(record.workspace) === currentWorkspace
  }
  const project = normalizeScopePath(record.project ?? record.workspace)
  return Boolean(project && project === currentWorkspace)
}

function normalizeScopePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const normalized = resolve(trimmed)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function scoreMemory(record: MemoryRecord, query: string): number {
  // Build n-gram fingerprints so matching works for both Latin words and CJK
  // text. The previous implementation split on `[^a-z0-9_]+`, which treated
  // every Chinese/Japanese/Korean character as a separator and produced an
  // empty token set for CJK queries — memories were never retrieved.
  const queryGrams = ngrams(query)
  if (queryGrams.size === 0) return 0
  const textGrams = ngrams(`${record.content} ${record.tags.join(' ')}`)
  let overlap = 0
  for (const gram of queryGrams) {
    if (textGrams.has(gram)) overlap += 1
  }
  // Normalize by query coverage so long queries do not drown out short ones.
  const coverage = overlap / queryGrams.size
  return (overlap + coverage) * record.confidence
}

/**
 * Produce a fingerprint of overlapping n-grams for a string. ASCII/Latin
 * segments are tokenized on word boundaries and down to trigrams, while CJK
 * runs are split into bigrams. Lower-cased, de-spaced. This keeps matching
 * language-agnostic without pulling in a tokenizer dependency.
 */
function ngrams(input: string): Set<string> {
  const grams = new Set<string>()
  const normalized = input.toLowerCase()
  // Pull out ASCII words (letters/digits/underscore) and CJK runs separately.
  const asciiWords = normalized.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let i = 0; i + 3 <= word.length; i += 1) {
      grams.add(word.slice(i, i + 3))
    }
    if (word.length < 3) grams.add(word)
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      grams.add(run.slice(i, i + 2))
    }
    if (run.length < 2) grams.add(run)
  }
  return grams
}
