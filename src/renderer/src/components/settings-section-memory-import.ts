import {
  buildMemoryImportContent,
  memoryImportObservedAt,
  parseMemoryImport
} from '@shared/memory-import-export'
import type { CoreMemoryRecordJson } from '../agent/kun-contract'
import { workspaceRootIdentityKey } from '../lib/workspace-path'

export type MemoryScope = 'user' | 'workspace' | 'project'

export type MemoryImportCreateInput = {
  content: string
  scope: MemoryScope
  targetPath?: string
  workspace?: string
  project?: string
  tags: string[]
  confidence: number
  type: NonNullable<CoreMemoryRecordJson['type']>
  importance: number
  observedAt?: string
  validFrom?: string
  validTo?: string
  expiresAt?: string
  sources: NonNullable<CoreMemoryRecordJson['sources']>
  disabled?: boolean
}

export type MemoryImportCandidate = {
  preview: string
  input: MemoryImportCreateInput
}

export type PreparedMemoryImport = {
  kind: 'portable' | 'profile' | 'invalid-portable'
  candidates: MemoryImportCandidate[]
  error?: string
}

export function prepareMemoryImport(
  raw: string,
  legacyScope: MemoryScope,
  legacyTargetPath: string
): PreparedMemoryImport {
  const parsed = parseMemoryImport(raw)
  if (parsed.kind === 'invalid-portable') {
    return { kind: parsed.kind, candidates: [], error: parsed.message }
  }
  if (parsed.kind === 'portable') {
    return {
      kind: parsed.kind,
      candidates: parsed.records.map((record) => ({
        preview: `[${record.type}] ${record.scope}: ${record.content}`,
        input: {
          content: record.content,
          scope: record.scope,
          ...(record.workspace ? { workspace: record.workspace } : {}),
          ...(record.project ? { project: record.project } : {}),
          tags: record.tags,
          confidence: record.confidence,
          type: record.type,
          importance: record.importance,
          observedAt: record.observedAt,
          ...(record.validFrom ? { validFrom: record.validFrom } : {}),
          ...(record.validTo ? { validTo: record.validTo } : {}),
          ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
          sources: record.sources,
          ...(record.disabled ? { disabled: true } : {})
        }
      }))
    }
  }
  return {
    kind: parsed.kind,
    candidates: parsed.entries.map((entry) => {
      const observedAt = memoryImportObservedAt(entry.date)
      const content = buildMemoryImportContent(entry)
      return {
        preview: content,
        input: {
          content,
          scope: legacyScope,
          ...(legacyScope === 'user' ? {} : { targetPath: legacyTargetPath }),
          tags: entry.tags,
          confidence: 1,
          importance: 0.6,
          type: entry.category === '偏好'
            ? 'preference'
            : entry.category === '项目'
              ? 'episode'
              : 'fact',
          ...(observedAt ? { observedAt } : {}),
          sources: [{
            id: 'source_imported_profile',
            kind: 'imported',
            locator: 'memory-profile-import',
            trust: 'imported'
          }]
        }
      }
    })
  }
}

export function filterDuplicateMemoryImports(input: {
  candidates: MemoryImportCandidate[]
  existingRecords: CoreMemoryRecordJson[]
  expandPath: (path: string) => string
}): { candidates: MemoryImportCandidate[]; skipped: number } {
  const existingKeys = new Set(input.existingRecords
    .filter((record) => !record.deletedAt)
    .map((record) => memoryImportDedupKey({
      content: record.content,
      scope: record.scope,
      targetPath: targetPathForRecord(record),
      expandPath: input.expandPath
    })))
  const batchKeys = new Set<string>()
  const candidates: MemoryImportCandidate[] = []
  let skipped = 0
  for (const candidate of input.candidates) {
    const key = memoryImportDedupKey({
      content: candidate.input.content,
      scope: candidate.input.scope,
      targetPath: targetPathForInput(candidate.input),
      expandPath: input.expandPath
    })
    if (existingKeys.has(key) || batchKeys.has(key)) {
      skipped += 1
      continue
    }
    batchKeys.add(key)
    candidates.push(candidate)
  }
  return { candidates, skipped }
}

function targetPathForRecord(record: CoreMemoryRecordJson): string | undefined {
  if (record.scope === 'project') return record.project ?? record.workspace
  return record.workspace
}

function targetPathForInput(input: MemoryImportCreateInput): string | undefined {
  if (input.scope === 'project') return input.project ?? input.workspace ?? input.targetPath
  return input.workspace ?? input.targetPath
}

function memoryImportDedupKey(input: {
  content: string
  scope: MemoryScope
  targetPath?: string
  expandPath: (path: string) => string
}): string {
  const target = input.scope === 'user'
    ? ''
    : workspaceRootIdentityKey(input.expandPath(input.targetPath ?? ''))
  return `${input.scope}\u0000${target}\u0000${input.content.trim()}`
}
