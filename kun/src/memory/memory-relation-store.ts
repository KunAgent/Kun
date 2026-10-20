import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { MEMORY_RELATION_MAX_RECORD_CHARS, MemoryRelationCommand, MemoryRelationSuggestion, type MemoryRelationResult } from '../contracts/memory-relations.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { MemoryAccess } from './memory-store.js'
import { memoryRecordPath } from './memory-canonical-files.js'
import { normalizeMemoryRecord } from './memory-record-normalizer.js'
import { applyMemoryForgetting, readMemoryForgetting } from './memory-forgetting.js'
import {
  MemoryRelationConflictError, relationBindingMatches, relationEvidenceValid,
  relationId, relationRecordEligible, sameRelationScope
} from './memory-relations.js'

const MAX_RELATIONS = 2000
const Ledger = z.object({
  version: z.literal(1), suggestions: z.array(MemoryRelationSuggestion).max(MAX_RELATIONS)
}).strict()
type Ledger = z.infer<typeof Ledger>

// Only called under the canonical Memory mutation lock. Never a runtime-side writer.
export async function executeMemoryRelationCommand(options: {
  rootDir: string
  command: MemoryRelationCommand
  authorize: (id: string, access: MemoryAccess) => Promise<MemoryRecord>
  now: string
}): Promise<MemoryRelationResult> {
  const { rootDir, authorize, now } = options
  const command = MemoryRelationCommand.parse(options.command)
  const ledger = await readLedger(rootDir)
  const originalCount = ledger.suggestions.length
  const forgetting = await readMemoryForgetting(rootDir)
  const cache = new Map<string, MemoryRecord | undefined>()
  for (const entry of ledger.suggestions) {
    for (const binding of [entry.proposal.source, entry.proposal.target]) {
      if (cache.has(binding.id)) continue
      try {
        const raw = JSON.parse(await readFile(memoryRecordPath(rootDir, binding.id), 'utf8'))
        const parsed = normalizeMemoryRecord(raw, binding.id)
        if (!parsed.ok) throw new Error('Invalid relation endpoint')
        cache.set(binding.id, applyMemoryForgetting(forgetting, parsed.record))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // IO/parse failures are not deletion evidence. Preserve the ledger.
          throw new Error('Memory relation endpoint is unavailable', { cause: error })
        }
        cache.set(binding.id, undefined)
      }
    }
  }
  ledger.suggestions = ledger.suggestions.filter((entry) =>
    [entry.proposal.source, entry.proposal.target].every((binding) => {
      const record = cache.get(binding.id)
      return record && !record.deletedAt
    }))
  if (ledger.suggestions.length !== originalCount) await writeLedger(rootDir, ledger)

  const view = async (entry: MemoryRelationSuggestion) => {
    const [source, target] = await Promise.all([
      authorize(entry.proposal.source.id, command.access), authorize(entry.proposal.target.id, command.access)
    ])
    if (source.authority !== 'reference' || target.authority !== 'reference' ||
        !sameRelationScope(source, target)) throw new MemoryRelationConflictError()
    const stale = !relationRecordEligible(source, Date.parse(now)) ||
      !relationRecordEligible(target, Date.parse(now)) ||
      !relationBindingMatches(source, entry.proposal.source) ||
      !relationBindingMatches(target, entry.proposal.target)
    return { suggestion: entry, stale, source: endpoint(source, stale), target: endpoint(target, stale) }
  }
  if (command.action === 'list') {
    await authorize(command.memoryId, command.access)
    const relations: MemoryRelationResult['relations'] = []
    for (const entry of ledger.suggestions.filter((entry) =>
      entry.proposal.source.id === command.memoryId || entry.proposal.target.id === command.memoryId
    ).slice(-200).reverse()) {
      try { relations.push(await view(entry)) } catch { /* Never disclose a hidden endpoint. */ }
    }
    return { relations }
  }
  if (command.action === 'review') {
    const entry = ledger.suggestions.find((item) => item.id === command.id)
    if (!entry) throw new MemoryRelationConflictError()
    const result = await view(entry)
    if (result.stale || (entry.status !== 'pending' && entry.status !== command.decision)) {
      throw new MemoryRelationConflictError()
    }
    if (entry.status === 'pending') {
      entry.status = command.decision
      entry.decidedAt = now
      await writeLedger(rootDir, ledger)
    }
    return { relations: [result] }
  }
  const relations: MemoryRelationResult['relations'] = []
  // Validate every proposal before writing any of this batch.
  for (const proposal of command.proposals) {
    const entry: MemoryRelationSuggestion = {
      id: relationId(proposal), proposal, generator: 'model-relations-v1', status: 'pending', createdAt: now
    }
    const result = await view(entry)
    if (result.stale || !relationEvidenceValid(result.source, proposal.sourceEvidence) ||
        !relationEvidenceValid(result.target, proposal.targetEvidence)) throw new MemoryRelationConflictError()
    const previous = ledger.suggestions.find((item) => item.id === entry.id)
    if (previous) relations.push(await view(previous))
    else {
      ledger.suggestions.push(entry)
      relations.push(result)
    }
  }
  if (ledger.suggestions.length > MAX_RELATIONS) throw new Error('Memory relation storage is full')
  if (command.proposals.length) await writeLedger(rootDir, ledger)
  return { relations }
}

function endpoint(record: MemoryRecord, stale: boolean) {
  return {
    id: record.id, revision: record.revision, scope: record.scope,
    content: stale ? '' : record.content.slice(0, MEMORY_RELATION_MAX_RECORD_CHARS),
    sources: stale ? [] : record.sources,
    ...(!stale && record.consolidation ? { consolidation: record.consolidation } : {})
  }
}

export async function removeMemoryRelations(rootDir: string, ids: readonly string[]): Promise<void> {
  const ledger = await readLedger(rootDir)
  const removed = new Set(ids)
  const remaining = ledger.suggestions.filter((entry) =>
    !removed.has(entry.proposal.source.id) && !removed.has(entry.proposal.target.id))
  if (remaining.length !== ledger.suggestions.length) {
    await writeLedger(rootDir, { version: 1, suggestions: remaining })
  }
}

async function readLedger(rootDir: string): Promise<Ledger> {
  const path = join(rootDir, 'relations', 'suggestions.json')
  try {
    if ((await stat(path)).size > 2_000_000) throw new Error('Memory relation storage exceeds its limit')
    return Ledger.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, suggestions: [] }
    // Do not echo malformed payloads or overwrite unreadable state.
    throw new Error('Memory relation storage is unavailable', { cause: error })
  }
}

async function writeLedger(rootDir: string, ledger: Ledger): Promise<void> {
  const directory = join(rootDir, 'relations')
  const text = JSON.stringify(Ledger.parse(ledger))
  if (Buffer.byteLength(text) > 2_000_000) throw new Error('Memory relation storage exceeds its limit')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await atomicWriteFile(join(directory, 'suggestions.json'), text)
}
