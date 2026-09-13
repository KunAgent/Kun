import { z } from 'zod'
import { HistoryReferenceSchema, type HistoryReference } from '../contracts/history-reference.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { HistoryReferenceStore } from '../history/history-reference-store.js'
import type { ThreadStore } from '../ports/thread-store.js'

const StateSchema = z.object({
  references: z.record(z.string(), HistoryReferenceSchema).default({}),
  requiredIds: z.array(z.string()).default([]),
  introducedIds: z.array(z.string()).default([])
})
export type HistoryMigrationState = z.infer<typeof StateSchema>
export const parseHistoryMigrationState = (value: unknown): HistoryMigrationState => StateSchema.parse(value ?? {})

/** Source paths can differ after relinking; the immutable decoded prefix cannot. */
export function sameHistorySnapshot(a: HistoryReference, b: HistoryReference): boolean {
  const identity = (ref: HistoryReference) => JSON.stringify({ provider: ref.provider,
    sessionId: ref.sessionId, cutoffTurnId: ref.cutoffTurnId, parserVersion: ref.parserVersion,
    files: ref.files.map(({ path: _path, ...file }) => file) })
  return a.id === b.id && identity(a) === identity(b)
}

export function addHistoryMigrationReference(state: HistoryMigrationState, raw: unknown): void {
  const reference = HistoryReferenceSchema.parse(raw)
  const prior = state.references[reference.id]
  if (prior && !sameHistorySnapshot(prior, reference)) {
    throw new Error(`conflicting migration history reference: ${reference.id}`)
  }
  state.references[reference.id] = reference
}

export async function preflightHistoryReferences(
  state: HistoryMigrationState, threads: Iterable<ThreadRecord>, store?: HistoryReferenceStore
): Promise<void> {
  state.requiredIds = [...new Set([...threads].flatMap((thread) => thread.historyRefId ? [thread.historyRefId] : []))]
  for (const id of state.requiredIds) {
    if (!store) throw new Error('history reference storage is unavailable for migration')
    const existing = await store.get(id)
    const incoming = state.references[id]
    if (!existing && !incoming) throw new Error(`migration is missing history reference descriptor: ${id}`)
    if (incoming && existing && !sameHistorySnapshot(existing, incoming)) {
      throw new Error(`migration history reference identity conflict: ${id}`)
    }
  }
  // Only thread-reachable descriptors may become canonical data.
  state.references = Object.fromEntries(state.requiredIds.flatMap((id) =>
    state.references[id] ? [[id, state.references[id]!]] : []))
}

/** Caller owns the history lifecycle lock for the complete import transaction. */
export async function importHistoryReferences(
  state: HistoryMigrationState, store: HistoryReferenceStore | undefined, persist: () => Promise<void>
): Promise<void> {
  for (const id of state.requiredIds) {
    if (!store) throw new Error('history reference storage is unavailable for migration')
    const existing = await store.get(id)
    const incoming = state.references[id]
    if (existing) {
      if (incoming && !sameHistorySnapshot(existing, incoming)) {
        throw new Error(`migration history reference identity conflict: ${id}`)
      }
      continue // Preserve a locally relinked source and references shared by other branches.
    }
    if (!incoming) throw new Error(`migration is missing history reference descriptor: ${id}`)
    if (!state.introducedIds.includes(id)) {
      state.introducedIds.push(id)
      await persist() // Write-ahead intent makes interruption before/after put retryable.
    }
    await store.put(incoming) // Metadata only: do not resolve, read or copy source paths.
  }
}

export async function verifyHistoryReferences(state: HistoryMigrationState, store?: HistoryReferenceStore): Promise<void> {
  for (const id of state.requiredIds) {
    const current = await store?.get(id)
    if (!current || (state.references[id] && !sameHistorySnapshot(current, state.references[id]!))) {
      throw new Error(`imported history reference is missing or changed: ${id}`)
    }
  }
}

export async function rollbackHistoryReferences(
  state: HistoryMigrationState, store: HistoryReferenceStore | undefined, threads: ThreadStore, warnings: string[]
): Promise<void> {
  for (const id of state.introducedIds) {
    const current = await store?.get(id)
    if (!current) continue
    // A sidebar list can omit archived/side/orphan sessions and cannot prove non-use.
    const referenced = !threads.hasHistoryReference || await threads.hasHistoryReference(id)
    if (!referenced && state.references[id] && JSON.stringify(current) === JSON.stringify(state.references[id])) {
      await store!.remove(id)
    } else {
      warnings.push(`Preserved shared or modified history reference after migration import: ${id}`)
    }
  }
}
