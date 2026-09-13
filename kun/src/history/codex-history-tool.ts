import type { HistoryReference, HistorySourceStatus } from '../contracts/history-reference.js'
import { frozenHistoryIndex, historyCursor, historyPointers, hydrateHistory, parseHistoryCursor } from './codex-history.js'
import { HistorySourceError } from './codex-jsonl.js'
import { itemText } from './codex-projection.js'

export interface ReadSourceHistoryOptions {
  operation: 'recent' | 'search' | 'read'
  query?: string
  turnId?: string
  cursor?: string
  limit?: number
  contentOffset?: number
}
export interface ReadSourceHistoryResult {
  text: string
  nextCursor?: string
  nextOperation?: 'recent' | 'search' | 'read'
  nextContentOffset?: number
  status: HistorySourceStatus
  warnings: string[]
}
const MAX_RESULT_CHARS = 24_000
const RECORD_CHARS = 6_000

interface SourceCursor {
  position: number
  endPosition?: number
  olderTurnEnd?: number
  turnId?: string
  contentOffset?: number
}

function sourceCursor(reference: HistoryReference, value: SourceCursor): string {
  return Buffer.from(JSON.stringify({ reference: reference.id, ...value })).toString('base64url')
}

function parseSourceCursor(reference: HistoryReference, cursor: string | undefined, fallback: number): SourceCursor {
  const position = parseHistoryCursor(reference, cursor, fallback)
  if (!cursor) return { position }
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as SourceCursor
  for (const field of ['endPosition', 'olderTurnEnd', 'contentOffset'] as const) {
    if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) || value[field]! < 0)) {
      throw new HistorySourceError('partial', 'Invalid Codex source history continuation.')
    }
  }
  if (value.turnId !== undefined && typeof value.turnId !== 'string') {
    throw new HistorySourceError('partial', 'Invalid Codex source history turn.')
  }
  if (value.endPosition !== undefined && value.endPosition < position) {
    throw new HistorySourceError('partial', 'Invalid Codex source history range.')
  }
  return { ...value, position }
}

/** The model's explicit read is the only historical text allowed into new tool history. */
export async function readSourceHistory(
  reference: HistoryReference, options: ReadSourceHistoryOptions
): Promise<ReadSourceHistoryResult> {
  try {
    const index = await frozenHistoryIndex(reference)
    const all = historyPointers(index)
    const limit = Math.min(20, Math.max(1, options.limit ?? 3))
    const query = options.query?.trim().toLocaleLowerCase()
    if (options.operation === 'read' && !options.turnId && !options.cursor) {
      throw new HistorySourceError('partial', 'Use recent or search first, then read a specific turnId.')
    }
    if (options.operation === 'search' && !query) throw new HistorySourceError('partial', 'A non-empty search query is required.')
    const continuation = parseSourceCursor(reference, options.cursor, options.operation === 'recent' ? index.turns.length : 0)
    let start = continuation.position
    let endPosition = continuation.endPosition ?? all.length
    let olderTurnEnd = continuation.olderTurnEnd ?? 0
    const turnId = options.operation === 'recent' ? undefined : continuation.turnId ?? options.turnId
    let pointers = all
    if (options.operation === 'recent') {
      const end = Math.min(index.turns.length, start)
      olderTurnEnd = Math.max(0, end - limit)
      const turnIds = new Set(index.turns.slice(olderTurnEnd, end).map((turn) => turn.id))
      pointers = all.filter((pointer) => turnIds.has(pointer.turn.id))
      start = pointers.length ? all.indexOf(pointers[0]) : all.length
      endPosition = start + pointers.length
    } else {
      pointers = all.slice(start, endPosition).filter((pointer) => !turnId || pointer.turn.id === turnId)
    }
    let contentOffset = continuation.contentOffset ?? Math.max(0, Math.floor(options.contentOffset ?? 0))
    const results: string[] = []
    let chars = 0
    let nextPosition: number | undefined
    let nextContentOffset: number | undefined
    const positions = new Map(all.map((pointer, position) => [pointer.id, position]))
    // One stream per referenced file, regardless of match count. Retain only bounded snippets.
    await hydrateHistory(reference, pointers, (item, pointer) => {
      if (nextPosition !== undefined) return undefined
      const position = positions.get(pointer.id)!
      const raw = itemText(item)
      let text: string
      if (options.operation === 'search') {
        const match = raw.toLocaleLowerCase().indexOf(query!)
        if (match < 0) return undefined
        text = raw.slice(Math.max(0, match - 120), match + 500)
      } else {
        text = raw.slice(contentOffset, contentOffset + RECORD_CHARS)
      }
      const entry = `[${pointer.turn.id} / ${pointer.id} / ${pointer.item.kind}]\n${text}`
      if (chars + entry.length > MAX_RESULT_CHARS || (options.operation === 'search' && results.length >= limit)) {
        nextPosition = position
        return undefined
      }
      results.push(entry)
      chars += entry.length
      if (options.operation !== 'search' && contentOffset + RECORD_CHARS < raw.length) {
        nextPosition = position
        nextContentOffset = contentOffset + RECORD_CHARS
      }
      contentOffset = 0
      return undefined
    })
    let nextOperation: ReadSourceHistoryResult['nextOperation']
    let nextCursor: string | undefined
    if (nextPosition !== undefined) {
      nextCursor = sourceCursor(reference, {
        position: nextPosition, endPosition, olderTurnEnd,
        ...(turnId ? { turnId } : {}), ...(nextContentOffset === undefined ? {} : { contentOffset: nextContentOffset })
      })
      nextOperation = options.operation === 'search' ? 'search' : 'read'
    } else if (olderTurnEnd > 0) {
      nextCursor = historyCursor(reference, olderTurnEnd)
      nextOperation = 'recent'
    }
    return {
      text: results.join('\n\n') || 'No matching history records within this branch reference.',
      ...(nextCursor ? { nextCursor, nextOperation } : {}),
      ...(nextContentOffset === undefined ? {} : { nextContentOffset }),
      status: index.warnings.length ? 'partial' : 'available', warnings: index.warnings
    }
  } catch (error) {
    const status = error instanceof HistorySourceError ? error.status
      : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'partial'
    return { text: 'Codex source history is unavailable. Continue using the new conversation or relink its original source.',
      status, warnings: [error instanceof Error ? error.message : 'Unable to read history.'] }
  }
}
