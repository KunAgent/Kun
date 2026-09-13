import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { z } from 'zod'
import type { ItemHistoryContentSchema } from '../contracts/item-history.js'
import type { TurnItem } from '../contracts/items.js'
import { TurnSchema, type Turn } from '../contracts/turns.js'
import {
  HistoryReferenceSchema, type HistoryReference, type HistorySourceStatus,
  type CodexSessionSummary, type HistoryCutoff
} from '../contracts/history-reference.js'
import { indexCodexFile, type CodexIndex, type IndexedItem, type IndexedTurn } from './codex-index.js'
import { HistorySourceError, readCodexLines, validateSourceFile } from './codex-jsonl.js'
import { clipped, projectCodexRecord, toTurnItem, type ItemContent } from './codex-projection.js'
import { isCodexPath, summarizeCodexFile, resolveCodexParentPath } from './codex-discovery.js'
import { getCachedCodexIndex } from './codex-index-cache.js'
import { historyTargetPage, resolveHistoryTargetRange, type HistoryTarget } from './codex-history-target.js'

export { discoverCodexSessions } from './codex-discovery.js'
export { HistorySourceError } from './codex-jsonl.js'
export { readSourceHistory } from './codex-history-tool.js'

export interface HistoryPageOptions {
  threadId: string
  cursor?: string
  limit?: number
  turnId?: string
  itemId?: string
  contentOffset?: number
  target?: boolean
  anchorItemId?: string
  targetCursor?: string
}
export interface HistoryPage {
  turns: Turn[]
  nextCursor?: string
  hasMore: boolean
  itemCount: number
  itemBytes: number
  status: HistorySourceStatus
  warnings: string[]
  content?: z.infer<typeof ItemHistoryContentSchema>
  target?: HistoryTarget
}
export interface HistoryPointer { turn: IndexedTurn; item: IndexedItem; id: string; turnIndex: number }

export async function inspectCodexSession(path: string): Promise<{
  session: CodexSessionSummary; cutoffs: HistoryCutoff[]; warnings: string[]
}> {
  assertPath(path)
  const index = await indexCodexFile(path)
  const session = await summarizeCodexFile(path)
  return {
    session: { ...session, title: index.title, workspace: index.workspace },
    cutoffs: index.turns.filter((turn) => turn.complete).map((turn) => ({
      turnId: turn.id, createdAt: turn.createdAt, workspace: turn.workspace, label: turn.label
    })), warnings: index.warnings
  }
}

function assertPath(path: string): void {
  if (!isCodexPath(path)) throw new HistorySourceError('partial', 'Select a Codex .jsonl or .jsonl.zst history file.')
}

export async function createHistoryReference(path: string, cutoffTurnId?: string): Promise<HistoryReference> {
  assertPath(path)
  const index = await indexCodexFile(path)
  const cutoff = cutoffTurnId
    ? index.turns.find((turn) => turn.id === cutoffTurnId && turn.complete)
    : [...index.turns].reverse().find((turn) => turn.complete)
  if (!cutoff) throw new HistorySourceError('partial', 'No completed Codex turn is available at the selected branch point.')
  return referenceFromIndex(index, cutoff)
}

function referenceFromIndex(index: CodexIndex, cutoff: IndexedTurn): HistoryReference {
  const primary = cutoff.filePath === index.path ? cutoff.boundary : index.files.find((file) => file.path === index.path)
  if (!primary) throw new HistorySourceError('partial', 'The Codex source has no complete records.')
  const files = [primary, ...index.files.filter((file) => file.path !== index.path)]
  const identity = JSON.stringify({ sessionId: index.sessionId, cutoff: cutoff.id,
    files: files.map(({ sessionId, byteLength, sha256 }) => ({ sessionId, byteLength, sha256 })) })
  return HistoryReferenceSchema.parse({
    id: `history_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`,
    provider: 'codex', sessionId: index.sessionId, title: index.title,
    workspace: cutoff.workspace, createdAt: new Date().toISOString(), cutoffTurnId: cutoff.id,
    files, parserVersion: 1, warnings: index.warnings
  })
}

/** Branch from the original fixed prefix, even when Codex later rolls back that turn. */
export async function createHistorySubreference(reference: HistoryReference, cutoffTurnId: string): Promise<HistoryReference> {
  const index = await frozenHistoryIndex(reference)
  const cutoff = index.turns.find((turn) => turn.id === cutoffTurnId && turn.complete)
  if (!cutoff) throw new HistorySourceError('partial', 'The selected completed turn is outside this branch history.')
  index.files = reference.files
  return referenceFromIndex(index, cutoff)
}

export async function frozenHistoryIndex(reference: HistoryReference): Promise<CodexIndex> {
  return getCachedCodexIndex(reference, () => buildFrozenHistoryIndex(reference))
}

async function buildFrozenHistoryIndex(reference: HistoryReference): Promise<CodexIndex> {
  const primary = reference.files[0]
  for (const file of reference.files) await validateSourceFile(file)
  const index = await indexCodexFile(primary.path, {
    byteLimit: primary.byteLength,
    parentLimits: new Map(reference.files.slice(1).map((file) => [resolve(file.path), file.byteLength])),
    parentPaths: new Map(reference.files.slice(1).map((file) => [file.sessionId, resolve(file.path)]))
  })
  if (index.sessionId !== reference.sessionId) throw new HistorySourceError('changed', 'The Codex source session identity changed.')
  for (const file of reference.files) {
    const actual = index.files.find((entry) => resolve(entry.path) === resolve(file.path))
    if (!actual || actual.sha256 !== file.sha256 || actual.byteLength !== file.byteLength) {
      throw new HistorySourceError('changed', 'Codex history changed while it was being read.')
    }
  }
  const position = index.turns.findIndex((turn) => turn.id === reference.cutoffTurnId)
  if (position < 0) throw new HistorySourceError('partial', 'The selected Codex branch point is unavailable.')
  index.turns = index.turns.slice(0, position + 1)
  index.warnings = [...new Set([...reference.warnings, ...index.warnings])]
  return index
}

export function historyPointers(index: CodexIndex): HistoryPointer[] {
  return index.turns.flatMap((turn, turnIndex) => turn.items.map((item) => ({
    turn, item, turnIndex, id: `${turn.id}:item:${item.ordinal}`
  })))
}

/** Hydrates selected records only. Every source is fingerprinted again before results escape. */
export async function hydrateHistory(
  reference: HistoryReference, pointers: HistoryPointer[], transform?: (item: ItemContent, pointer: HistoryPointer) => ItemContent | undefined
): Promise<Map<string, ItemContent>> {
  const values = new Map<string, ItemContent>()
  const orderedFiles = [...reference.files].sort((a, b) => pointers.findIndex((pointer) => pointer.turn.filePath === a.path) - pointers.findIndex((pointer) => pointer.turn.filePath === b.path))
  for (const file of orderedFiles) {
    const selected = new Map(pointers.filter((pointer) => resolve(pointer.turn.filePath) === resolve(file.path))
      .map((pointer) => [pointer.item.offset, pointer]))
    if (!selected.size) continue
    let sha256 = ''
    let byteLength = 0
    for await (const line of readCodexLines(file.path, file.byteLength)) {
      sha256 = line.sha256
      byteLength = line.end
      const pointer = selected.get(line.offset)
      if (!pointer) continue
      const item = projectCodexRecord(line.value, true)[0]
      if (!item) throw new HistorySourceError('changed', 'A Codex history record changed during reading.')
      if (item.kind === 'tool_call' && pointer.item.missingResult) item.summary = 'Read-only Codex tool call; result was not recorded.'
      if (item.kind === 'tool_result' && pointer.item.toolName) item.toolName = pointer.item.toolName
      const transformed = transform ? transform(item, pointer) : boundContent(item)
      if (transformed) values.set(pointer.id, transformed)
    }
    if (byteLength !== file.byteLength || sha256 !== file.sha256) {
      throw new HistorySourceError('changed', 'Codex history changed while it was being read.')
    }
  }
  return values
}

function boundContent(item: ItemContent): ItemContent {
  if ('text' in item) return { ...item, text: clipped(item.text) }
  if (item.kind === 'tool_result' && typeof item.output === 'string') return { ...item, output: clipped(item.output) }
  if (item.kind === 'tool_call') {
    const text = JSON.stringify(item.arguments)
    if (text.length > 16_384) return { ...item, arguments: { sourcePreview: clipped(text) } }
  }
  return item
}

export function historyCursor(reference: HistoryReference, position: number): string {
  return Buffer.from(JSON.stringify({ reference: reference.id, position })).toString('base64url')
}
export function parseHistoryCursor(reference: HistoryReference, cursor: string | undefined, fallback: number): number {
  if (!cursor) return fallback
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { reference?: unknown; position?: unknown }
    if (value.reference !== reference.id || typeof value.position !== 'number' || !Number.isSafeInteger(value.position) || value.position < 0) throw new Error()
    return value.position
  } catch { throw new HistorySourceError('partial', 'Invalid Codex history cursor for this branch.') }
}

export async function readHistoryPage(reference: HistoryReference, options: HistoryPageOptions): Promise<HistoryPage> {
  try {
    const index = await frozenHistoryIndex(reference)
    let pointers = historyPointers(index)
    if (options.turnId) pointers = pointers.filter((pointer) => pointer.turn.id === options.turnId)
    if (options.itemId) pointers = pointers.filter((pointer) => pointer.id === options.itemId)
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const target = options.target && options.turnId ? resolveHistoryTargetRange({
      reference, turnId: options.turnId, itemIds: pointers.map((pointer) => pointer.id), limit,
      itemId: options.anchorItemId, cursor: options.targetCursor
    }) : undefined
    let end = target?.end ?? Math.min(pointers.length, parseHistoryCursor(reference, options.cursor, pointers.length))
    let start = target?.start ?? Math.max(0, end - limit)
    let selected = pointers.slice(start, end)
    const offset = Math.max(0, Math.floor(options.contentOffset ?? 0))
    let content: HistoryPage['content']
    const values = await hydrateHistory(reference, selected, (item) => {
      if (options.itemId) {
        const field = 'text' in item ? 'text' : item.kind === 'tool_call' ? 'arguments' : 'output'
        const raw = 'text' in item ? item.text : item.kind === 'tool_call'
          ? JSON.stringify(item.arguments, null, 2) : typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
        const endOffset = Math.min(raw.length, offset + 16_384)
        content = { itemId: options.itemId, field, text: raw.slice(offset, endOffset), offset,
          ...(endOffset < raw.length ? { nextOffset: endOffset } : {}), totalChars: raw.length }
      }
      if ('text' in item) return { ...item, text: clipped(item.text.slice(offset)) }
      if (item.kind === 'tool_result' && typeof item.output === 'string') return { ...item, output: clipped(item.output.slice(offset)) }
      return boundContent(item)
    })
    const itemBase = (pointer: HistoryPointer) => ({
      id: pointer.id, turnId: pointer.turn.id, threadId: options.threadId, createdAt: pointer.turn.createdAt,
      sourceHistoryOrder: { referenceId: reference.id, turnIndex: pointer.turnIndex, itemIndex: pointer.item.ordinal }
    })
    const itemSize = (pointer: HistoryPointer): number => {
      const projected = values.get(pointer.id)
      return projected ? Buffer.byteLength(JSON.stringify(toTurnItem(projected, itemBase(pointer))), 'utf8') : 0
    }
    const maxBytes = 4 * 1024 * 1024 - 64 * 1024
    if (target) {
      let budgetBytes = selected.reduce((total, pointer) => total + itemSize(pointer), 0)
      const anchor = target.anchor ?? end - 1
      while (budgetBytes > maxBytes && end - start > 1) {
        if (anchor - start >= end - 1 - anchor && start < anchor) budgetBytes -= itemSize(pointers[start++]!)
        else budgetBytes -= itemSize(pointers[--end]!)
      }
      if (budgetBytes > maxBytes) throw new HistorySourceError('partial', 'The requested record exceeds the history page budget.')
      selected = pointers.slice(start, end)
    } else {
      let budgetBytes = 0
      let accepted = 0
      for (const pointer of [...selected].reverse()) {
        const bytes = itemSize(pointer)
        if (budgetBytes + bytes > maxBytes) break
        budgetBytes += bytes
        accepted += 1
      }
      selected = selected.slice(selected.length - accepted)
      start = end - selected.length
    }
    const turns: Turn[] = []
    let itemBytes = 0
    let itemCount = 0
    for (const pointer of selected) {
      const content = values.get(pointer.id)
      if (!content) continue
      const item: TurnItem = toTurnItem(content, itemBase(pointer))
      itemBytes += Buffer.byteLength(JSON.stringify(item), 'utf8')
      itemCount += 1
      let turn = turns.at(-1)
      if (!turn || turn.id !== pointer.turn.id) {
        turn = TurnSchema.parse({ id: pointer.turn.id, threadId: options.threadId, status: 'completed',
          prompt: pointer.turn.label, createdAt: pointer.turn.createdAt, finishedAt: pointer.turn.createdAt })
        turns.push(turn)
      }
      turn.items.push(item)
    }
    return { turns, hasMore: start > 0, ...(start > 0 ? { nextCursor: historyCursor(reference, start) } : {}),
      ...(target && options.turnId ? { target: historyTargetPage({ reference, turnId: options.turnId,
        itemId: options.anchorItemId, count: pointers.length, start, end, limit }) } : {}),
      itemCount, itemBytes, ...(content ? { content } : {}), status: index.warnings.length ? 'partial' : 'available', warnings: index.warnings }
  } catch (error) {
    const status = error instanceof HistorySourceError ? error.status
      : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'partial'
    return { turns: [], hasMore: false, itemCount: 0, itemBytes: 0, status,
      warnings: [error instanceof Error ? error.message : 'Unable to read Codex history.'] }
  }
}

export async function relinkHistoryReference(reference: HistoryReference, path: string): Promise<HistoryReference> {
  assertPath(path)
  const files = reference.files.map((file, position) => position === 0 ? { ...file, path: resolve(path) } : file)
  await validateSourceFile(files[0])
  for (let index = 1; index < files.length; index += 1) {
    try { await validateSourceFile(files[index]) } catch (error) {
      if (!(error instanceof HistorySourceError) || error.status !== 'missing') throw error
      const relocated = await resolveCodexParentPath(path, files[index].sessionId)
      if (!relocated) throw error
      files[index] = { ...files[index], path: relocated }
      await validateSourceFile(files[index])
    }
  }
  const candidate = { ...reference, files }
  await frozenHistoryIndex(candidate)
  return candidate
}

/** For explicit attachment reads only; callers must not persist this transient record. */
export async function readHistorySourceRecord(reference: HistoryReference, itemId: string): Promise<{
  record: Record<string, unknown>; sourcePath: string; workspace: string
} | undefined> {
  const index = await frozenHistoryIndex(reference)
  const pointer = historyPointers(index).find((entry) => entry.id === itemId)
  if (!pointer) return undefined
  const file = reference.files.find((entry) => entry.path === pointer.turn.filePath)
  if (!file) return undefined
  let record: Record<string, unknown> | undefined
  let workspace = pointer.turn.workspace
  let sourceWorkspace = workspace
  let digest = ''
  let bytes = 0
  for await (const line of readCodexLines(file.path, file.byteLength)) {
    if (line.value.type === 'session_meta' || line.value.type === 'turn_context') {
      const payload = line.value.payload as { cwd?: unknown } | undefined
      if (typeof payload?.cwd === 'string') sourceWorkspace = payload.cwd
    }
    if (line.offset === pointer.item.offset) { record = line.value; workspace = sourceWorkspace }
    digest = line.sha256
    bytes = line.end
  }
  if (bytes !== file.byteLength || digest !== file.sha256) throw new HistorySourceError('changed', 'Codex history changed while reading the attachment.')
  return record ? { record, sourcePath: file.path, workspace } : undefined
}
