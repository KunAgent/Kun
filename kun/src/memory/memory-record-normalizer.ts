import { createHash } from 'node:crypto'
import {
  MEMORY_MAX_SOURCES,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryProvenance,
  type MemorySourceEvidence
} from '../contracts/memory.js'

export type MemoryNormalizationResult =
  | { ok: true; record: MemoryRecord }
  | { ok: false; identifier: string; reason: string }

export function normalizeMemoryRecord(value: unknown, identifier = 'unknown'): MemoryNormalizationResult {
  const parsed = MemoryRecord.safeParse(value)
  if (parsed.success) return { ok: true, record: parsed.data }
  return {
    ok: false,
    identifier: boundedIdentifier(identifier),
    reason: parsed.error.issues.slice(0, 3).map((issue) => issue.path.join('.') || 'record').join(', ')
  }
}

export function normalizeCreateSources(input: MemoryCreateRequest): MemorySourceEvidence[] {
  if (input.sources?.length) {
    return normalizeSourceIds(input.sources)
  }
  const provenance = input.provenance ?? defaultProvenance(input)
  const locator = provenance.file ?? provenance.origin
  const turnId = input.sourceTurnId ?? provenance.turnId
  return [{
    id: 'source_1',
    kind: provenance.kind,
    ...(input.sourceThreadId ? { threadId: input.sourceThreadId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(locator ? { locator } : {}),
    trust: provenance.kind === 'user'
      ? 'explicit-user'
      : provenance.kind === 'inference'
        ? 'inferred'
        : 'observed'
  }]
}

export function normalizeUpdateSources(
  sources: NonNullable<MemoryCreateRequest['sources']>
): MemorySourceEvidence[] {
  return normalizeSourceIds(sources)
}

export function canonicalMemoryHash(record: MemoryRecord): string {
  return createHash('sha256').update(stableJson(record)).digest('hex')
}

export function defaultProvenance(input: MemoryCreateRequest): MemoryProvenance {
  return {
    kind: 'user',
    ...(input.sourceTurnId ? { turnId: input.sourceTurnId } : {}),
    origin: 'memory'
  }
}

export function defaultLegacyProvenance(record: Pick<MemoryRecord, 'sourceTurnId'>): MemoryProvenance {
  return {
    kind: 'user',
    ...(record.sourceTurnId ? { turnId: record.sourceTurnId } : {}),
    origin: 'legacy'
  }
}

export function defaultMemoryConfidence(kind: MemoryProvenance['kind']): number {
  switch (kind) {
    case 'user': return 1
    case 'file': return 0.8
    case 'tool': return 0.7
    case 'web': return 0.5
    case 'inference': return 0.4
  }
}

function boundedIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128) || 'unknown'
}

function normalizeSourceIds(
  sources: NonNullable<MemoryCreateRequest['sources']>
): MemorySourceEvidence[] {
  const used = new Set<string>()
  return sources.slice(0, MEMORY_MAX_SOURCES).map((source, index) => {
    const preferred = source.id ?? `source_${index + 1}`
    let id = preferred
    let suffix = 2
    while (used.has(id)) {
      const marker = `_${suffix}`
      id = `${preferred.slice(0, 128 - marker.length)}${marker}`
      suffix += 1
    }
    used.add(id)
    return { ...source, id }
  })
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
