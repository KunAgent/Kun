import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { MEMORY_RELATION_MAX_RECORD_CHARS, MemoryRelationCommand, MemoryRelationSuggestion, type MemoryRelationResult } from '../contracts/memory-relations.js'
import type { MemoryRecord } from '../contracts/memory.js'
import { MemoryRelationContextRequest, emptyMemoryRelationContext, type MemoryRelationAnnotation } from '../contracts/memory-working-context.js'
import { assembleMemoryRelationContext } from './memory-working-context.js'
import type { MemoryAccess } from './memory-store.js'
import { MemoryErasureIncompleteError } from './memory-erasure-error.js'
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
  signal?: AbortSignal
}): Promise<MemoryRelationResult> {
  const { rootDir, authorize, now } = options
  const command = MemoryRelationCommand.parse(options.command)
  const assertCurrent = () => {
    options.signal?.throwIfAborted()
    if (command.action === 'propose' && command.deadlineAt !== undefined && Date.now() >= command.deadlineAt) {
      throw new Error('Memory relation analysis deadline expired')
    }
  }
  assertCurrent()
  const ledger = await readLedger(rootDir)
  const originalCount = ledger.suggestions.length
  const forgetting = await readMemoryForgetting(rootDir)
  const cache = new Map<string, MemoryRecord | undefined>()
  const involved = ledger.suggestions.filter((entry) => command.action === 'list'
    ? entry.proposal.source.id === command.memoryId || entry.proposal.target.id === command.memoryId
    : command.action === 'propose'
      ? command.proposals.some((proposal) => relationId(proposal) === entry.id)
      : entry.id === command.id)
  for (const entry of involved) {
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
  const removed = new Set(involved.filter((entry) =>
    [entry.proposal.source, entry.proposal.target].some((binding) => {
      const record = cache.get(binding.id)
      return !record || record.deletedAt
    })).map((entry) => entry.id))
  ledger.suggestions = ledger.suggestions.filter((entry) => !removed.has(entry.id))
  if (ledger.suggestions.length !== originalCount) await writeLedger(rootDir, ledger, options.signal, assertCurrent)

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
  if (command.action === 'withdraw') {
    const entry = ledger.suggestions.find((item) => item.id === command.id)
    if (!entry || entry.status === 'pending') throw new MemoryRelationConflictError()
    const result = await view(entry)
    if (entry.status === 'accepted') {
      entry.status = 'rejected'
      entry.decidedAt = now
      await writeLedger(rootDir, ledger, options.signal, assertCurrent)
    }
    return { relations: [result] }
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
      await writeLedger(rootDir, ledger, options.signal, assertCurrent)
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
  if (command.proposals.length) await writeLedger(rootDir, ledger, options.signal, assertCurrent)
  return { relations }
}

/** Read once, authorize selected endpoints only; no cleanup or content persistence. */
export async function projectMemoryRelations(options: {
  rootDir: string
  request: MemoryRelationContextRequest
  authorize: (id: string, access: MemoryAccess) => Promise<MemoryRecord>
  now: string
  enabled: boolean
  memoryEnabled: boolean
}) {
  const request = MemoryRelationContextRequest.parse(options.request)
  const automaticEnabled = options.memoryEnabled && options.enabled
  if (!options.memoryEnabled || (request.purpose === 'injection' && !automaticEnabled)) {
    return emptyMemoryRelationContext('disabled', automaticEnabled)
  }
  const selected = new Map(request.selected.map((record) => [record.id, record]))
  if (selected.size < 2) return emptyMemoryRelationContext('ready', automaticEnabled)
  const ledger = await readLedger(options.rootDir)
  const eligible = ledger.suggestions.filter((entry) => entry.status === 'accepted' &&
    selected.has(entry.proposal.source.id) && selected.has(entry.proposal.target.id))
  const current = new Map<string, MemoryRecord>()
  for (const id of new Set(eligible.flatMap((entry) => [entry.proposal.source.id, entry.proposal.target.id]))) {
    try {
      const record = await options.authorize(id, request.access)
      const snapshot = selected.get(id)!
      if (relationRecordEligible(record, Date.parse(options.now)) &&
          record.revision === snapshot.revision && record.content.startsWith(snapshot.content)) current.set(id, record)
    } catch { /* Missing, unreadable or hidden canonical records never become evidence. */ }
  }
  const annotations: MemoryRelationAnnotation[] = []
  for (const entry of eligible) {
    const { source: from, target: to, sourceEvidence, targetEvidence, kind } = entry.proposal
    const source = current.get(from.id)
    const target = current.get(to.id)
    if (!source || !target || !entry.decidedAt || !sameRelationScope(source, target) ||
        !relationBindingMatches(source, from) || !relationBindingMatches(target, to) ||
        !relationEvidenceValid(selected.get(from.id)!, sourceEvidence) ||
        !relationEvidenceValid(selected.get(to.id)!, targetEvidence)) continue
    annotations.push({
      id: entry.id, kind, source: { id: from.id, revision: from.revision },
      target: { id: to.id, revision: to.revision }, reviewedAt: entry.decidedAt
    })
  }
  return assembleMemoryRelationContext(annotations, request.remainingCharacters, automaticEnabled)
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
  if (!ids.length) return
  try {
    const ledger = await readLedger(rootDir)
    const removed = new Set(ids)
    const remaining = ledger.suggestions.filter((entry) =>
      !removed.has(entry.proposal.source.id) && !removed.has(entry.proposal.target.id))
    if (remaining.length !== ledger.suggestions.length) {
      await writeLedger(rootDir, { version: 1, suggestions: remaining })
    }
  } catch (error) {
    // Canonical removal has already committed. Keep unreadable decisions for recovery.
    throw new MemoryErasureIncompleteError(error, ids)
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

async function writeLedger(rootDir: string, ledger: Ledger, signal?: AbortSignal, beforeCommit?: () => void): Promise<void> {
  const directory = join(rootDir, 'relations')
  const text = JSON.stringify(Ledger.parse(ledger))
  if (Buffer.byteLength(text) > 2_000_000) throw new Error('Memory relation storage exceeds its limit')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await atomicWriteFile(join(directory, 'suggestions.json'), text, { signal, beforeCommit, allowDirectWriteFallback: false })
}
