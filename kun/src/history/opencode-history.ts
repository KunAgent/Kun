import { resolve } from 'node:path'
import { HistoryReferenceSchema, type OpenCodeSource, type OpenCodeHistoryReference, type HistoryCutoff } from '../contracts/history-reference.js'
import type { CodexIndex, IndexedTurn } from './codex-index.js'
import { HistorySourceError, object, string, type JsonObject } from './codex-jsonl.js'
import { projectOpenCodeRecord } from './opencode-projection.js'
import { digest, readOpenCodeSnapshot, recordManifest, resolveOpenCodeSource, sourceError, type OpenCodeSnapshot } from './opencode-source.js'

export interface OpenCodeIndex extends CodexIndex { records: JsonObject[]; messageIds: Map<string, Set<string>> }
const iso = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : new Date(0).toISOString()

/** Logical positions are independent of physical database pages, WAL or JSON file layout. */
export function indexOpenCodeSnapshot(snapshot: OpenCodeSnapshot, frozen = false): OpenCodeIndex {
  const { source, info } = snapshot
  const index: OpenCodeIndex = { path: source.path, sessionId: source.sessionId, title: string(info.title).slice(0, 120) || 'OpenCode conversation',
    workspace: string(info.directory), createdAt: iso(object(info.time).created), updatedAt: iso(object(info.time).updated),
    turns: [], files: [], warnings: [], records: [], messageIds: new Map() }
  const turns = new Map<string, IndexedTurn>()
  const warnings = new Set<string>()
  const revert = frozen ? {} : object(info.revert)
  let ordinal = 0
  for (const m of snapshot.messages) {
    const id = String(m.info.id)
    if (typeof revert.messageID === 'string' && id >= revert.messageID) {
      warnings.add('OpenCode reverted history is excluded from this branch preview.'); break
    }
    if (m.info.role === 'user') {
      const label = m.parts.filter((p) => p.type === 'text').map((p) => string(p.text)).join(' ').replace(/\s+/gu, ' ').slice(0, 160)
      const turn: IndexedTurn = { id: `opencode:${source.sessionId}:${id}`, label: label || 'OpenCode turn',
        createdAt: iso(object(m.info.time).created), filePath: source.path, workspace: string(object(m.info.path).cwd) || index.workspace,
        items: [], complete: false, countsAsUserTurn: m.parts.some((p) => p.type !== 'compaction'),
        boundary: { path: source.path, sessionId: source.sessionId, byteLength: 0, recordCount: 0, sha256: '0'.repeat(64) } }
      turns.set(id, turn); index.turns.push(turn); index.messageIds.set(turn.id, new Set())
    }
    const turn = m.info.role === 'user' ? turns.get(id) : turns.get(string(m.info.parentID))
    if (!turn) { warnings.add('OpenCode messages without their user parent were skipped.'); continue }
    index.messageIds.get(turn.id)!.add(id)
    turn.workspace = string(object(m.info.path).cwd) || turn.workspace
    if (m.info.role === 'assistant') turn.complete = false
    for (const part of m.parts) {
      const offset = index.records.length
      const record = { message: m.info, part }
      index.records.push(record)
      if (part.type === 'compaction' || object(object(part.state).time).compacted) warnings.add('Some OpenCode history was compacted; only recorded content is available.')
      for (const [blockIndex, item] of projectOpenCodeRecord(record).entries()) {
        turn.items.push({ offset, ordinal: ++ordinal, blockIndex, kind: item.kind,
          ...('callId' in item ? { callId: item.callId, toolName: item.toolName } : {}) })
      }
    }
    const calls = turn.items.filter((p) => p.kind === 'tool_call')
    const results = new Set(turn.items.filter((p) => p.kind === 'tool_result').map((p) => p.callId))
    if (m.info.role === 'assistant' && object(m.info.time).completed && !m.info.error &&
      !['tool-calls', 'tool_use', 'unknown', ''].includes(string(m.info.finish)) && calls.every((p) => results.has(p.callId))) turn.complete = true
  }
  if (index.turns.some((t) => !t.complete)) warnings.add('Unfinished OpenCode turns cannot be used as branch points.')
  index.warnings = [...warnings]
  return index
}

export function openCodeReference(snapshot: OpenCodeSnapshot, index: OpenCodeIndex, cutoff: IndexedTurn): OpenCodeHistoryReference {
  const turns = index.turns.slice(0, index.turns.indexOf(cutoff) + 1)
  const ids = new Set(turns.flatMap((t) => [...index.messageIds.get(t.id)!]))
  const records = recordManifest(snapshot.messages.filter((m) => ids.has(String(m.info.id))))
  const reference = HistoryReferenceSchema.parse({ id: `history_${digest({ provider: 'opencode', kind: snapshot.source.kind,
    sessionId: snapshot.source.sessionId, sourceWorkspace: string(snapshot.info.directory), cutoff: cutoff.id, records }).slice(0, 32)}`,
    provider: 'opencode', sessionId: snapshot.source.sessionId, title: index.title, workspace: cutoff.workspace,
    cutoffTurnId: cutoff.id, createdAt: new Date().toISOString(), parserVersion: 2, files: [], source: snapshot.source,
    records, sourceWorkspace: string(snapshot.info.directory), warnings: index.warnings })
  if (reference.provider !== 'opencode') throw sourceError('Invalid OpenCode reference.')
  return reference
}
export async function inspectOpenCode(path: string, sessionId?: string, kind?: OpenCodeSource['kind']) {
  const source = await resolveOpenCodeSource(path, sessionId, kind)
  const snapshot = await readOpenCodeSnapshot(source)
  const index = indexOpenCodeSnapshot(snapshot)
  const reference = index.turns.length ? openCodeReference(snapshot, index, index.turns.at(-1)!) : undefined
  const cutoffs: HistoryCutoff[] = index.turns.filter((t) => t.complete).map((t) => ({ turnId: t.id, label: t.label, createdAt: t.createdAt, workspace: t.workspace }))
  return { session: { sessionId: source.sessionId, path: source.path, sourceKind: source.kind,
    title: index.title, workspace: index.workspace, updatedAt: index.updatedAt, archived: Boolean(object(snapshot.info.time).archived) },
    cutoffs, warnings: index.warnings, reference }
}
export async function createOpenCodeReference(path: string, sessionId?: string, kind?: OpenCodeSource['kind'], cutoffId?: string) {
  const source = await resolveOpenCodeSource(path, sessionId, kind)
  const snapshot = await readOpenCodeSnapshot(source), index = indexOpenCodeSnapshot(snapshot)
  const cutoff = cutoffId ? index.turns.find((t) => t.id === cutoffId && t.complete) : [...index.turns].reverse().find((t) => t.complete)
  if (!cutoff) throw sourceError('No completed OpenCode turn is available at the selected branch point.')
  const reference = openCodeReference(snapshot, index, cutoff)
  await readOpenCodeSnapshot(source, reference.records)
  return reference
}
export async function frozenOpenCode(reference: OpenCodeHistoryReference) {
  const snapshot = await readOpenCodeSnapshot(reference.source, reference.records)
  // Session title/directory/revert remain the values captured at creation, not mutable UI state.
  snapshot.info = { ...snapshot.info, title: reference.title, directory: reference.sourceWorkspace }
  const index = indexOpenCodeSnapshot(snapshot, true)
  if (!index.turns.some((t) => t.id === reference.cutoffTurnId)) throw new HistorySourceError('changed', 'The OpenCode branch cutoff is unavailable.')
  index.warnings = [...new Set([...reference.warnings, ...index.warnings])]
  return { snapshot, index }
}
export async function subreferenceOpenCode(reference: OpenCodeHistoryReference, cutoffId: string) {
  const { snapshot, index } = await frozenOpenCode(reference)
  const cutoff = index.turns.find((t) => t.id === cutoffId && t.complete)
  if (!cutoff) throw sourceError('The completed OpenCode turn is outside this reference.')
  return openCodeReference(snapshot, index, cutoff)
}
export async function relinkOpenCode(reference: OpenCodeHistoryReference, path: string) {
  const source = await resolveOpenCodeSource(resolve(path), reference.sessionId, reference.source.kind)
  const candidate = { ...reference, source }
  await frozenOpenCode(candidate)
  return candidate
}
