import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { decodeOffsetCursor, encodeOffsetCursor } from './context-window-cursor.js'
import { fitUtf8, utf8Bytes } from '../handoff/utf8-budget.js'

/**
 * `read_thread_history` backing reader (docs/ade/08 §6). Lets a delegated
 * external harness page through the canonical turn items of its own thread
 * plus fork ancestors — thread identity always comes from the trusted tool
 * context, never from arguments.
 */

const MAX_ANCESTOR_DEPTH = 8
const MAX_OUTPUT_BYTES = 16 * 1024
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20
const EXCERPT_CAP = 240
const EXCERPT_CONTEXT = 100

const ArgsSchema = z.object({
  query: z.string().max(1024).optional(),
  turnRange: z
    .object({
      from: z.number().int().min(1).optional(),
      to: z.number().int().min(1).optional()
    })
    .strict()
    .optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).optional()
}).strict()

export type ThreadHistoryMatch = {
  turnNumber: number
  role: 'user' | 'assistant' | 'tool'
  excerpt: string
  itemId: string
}

export type ThreadHistoryReadResult = {
  matches: ThreadHistoryMatch[]
  nextCursor?: string
  truncated: boolean
}

function searchableText(item: TurnItem): { role: 'user' | 'assistant' | 'tool'; text: string } | null {
  switch (item.kind) {
    case 'user_message':
      return { role: 'user', text: item.displayText ?? item.text }
    case 'assistant_text':
      return { role: 'assistant', text: item.text }
    case 'tool_call':
      return {
        role: 'tool',
        text: `${item.toolName} ${stableArgsText(item.arguments)}`
      }
    case 'tool_result':
      return {
        role: 'tool',
        text: `${item.toolName} ${stableArgsText(item.output)}`.trim()
      }
    default:
      return null
  }
}

function stableArgsText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function excerptFor(text: string, query: string | undefined): { excerpt: string; clipped: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim()
  let start = 0
  if (query) {
    const index = flat.toLowerCase().indexOf(query.toLowerCase())
    if (index >= 0) start = Math.max(0, index - EXCERPT_CONTEXT)
  }
  const slice = [...flat.slice(start)]
  const clipped = start > 0 || slice.length > EXCERPT_CAP
  const prefix = start > 0 ? '…' : ''
  const suffix = slice.length > EXCERPT_CAP ? '…' : ''
  return {
    excerpt: prefix + slice.slice(0, EXCERPT_CAP).join('') + suffix,
    clipped
  }
}

export class ThreadHistoryReader {
  constructor(
    private readonly deps: {
      sessionStore: Pick<SessionStore, 'loadItems'>
      threadStore: Pick<ThreadStore, 'get'>
    }
  ) {}

  /**
   * Own thread plus fork ancestors (≤8 levels). Post-fork ancestor items are
   * appended after the child's copies — the child's own ordering dominates.
   */
  async readableItems(threadId: string): Promise<readonly TurnItem[]> {
    const seen = new Set<string>()
    const merged: TurnItem[] = []
    let current: string | undefined = threadId
    let depth = 0
    while (current && depth <= MAX_ANCESTOR_DEPTH) {
      const items = (await this.deps.sessionStore.loadItems(current))
        .filter(isPublicTurnItem)
      for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
      }
      const record = await this.deps.threadStore.get(current)
      current =
        depth < MAX_ANCESTOR_DEPTH &&
        record?.relation === 'fork' &&
        record.parentThreadId
          ? record.parentThreadId
          : undefined
      depth += 1
    }
    return merged
  }

  async search(
    threadId: string,
    rawArgs: unknown
  ): Promise<ThreadHistoryReadResult> {
    const parsed = ArgsSchema.safeParse(rawArgs)
    if (!parsed.success) {
      throw new Error(
        `invalid read_thread_history arguments: ${parsed.error.issues[0]?.message ?? 'bad input'}`
      )
    }
    const args = parsed.data
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const query = args.query?.trim().toLowerCase() || undefined
    const from = args.turnRange?.from
    const to = args.turnRange?.to
    const cursorKey = `thread-history:${threadId}:${createHash('sha256')
      .update(`${query ?? ''}${from ?? ''}:${to ?? ''}`)
      .digest('hex')
      .slice(0, 16)}`
    const offset = decodeOffsetCursor(args.cursor, cursorKey)
    if (offset instanceof Error) throw offset

    const items = await this.readableItems(threadId)
    const turnNumbers = new Map<string, number>()
    const candidates: Array<{ item: TurnItem; role: 'user' | 'assistant' | 'tool'; text: string; turnNumber: number }> = []
    for (const item of items) {
      const searchable = searchableText(item)
      if (!searchable) continue
      let turnNumber = turnNumbers.get(item.turnId)
      if (turnNumber === undefined) {
        turnNumber = turnNumbers.size + 1
        turnNumbers.set(item.turnId, turnNumber)
      }
      if (from !== undefined && turnNumber < from) continue
      if (to !== undefined && turnNumber > to) continue
      if (query && !searchable.text.toLowerCase().includes(query)) continue
      candidates.push({ item, role: searchable.role, text: searchable.text, turnNumber })
    }

    const matches: ThreadHistoryMatch[] = []
    let usedBytes = 0
    let truncated = false
    let scanned = offset
    for (; scanned < candidates.length && matches.length < limit; scanned += 1) {
      const candidate = candidates[scanned]!
      const { excerpt, clipped } = excerptFor(candidate.text, query)
      const entry: ThreadHistoryMatch = {
        turnNumber: candidate.turnNumber,
        role: candidate.role,
        excerpt,
        itemId: candidate.item.id
      }
      const entryBytes = utf8Bytes(JSON.stringify(entry)) + 1
      if (usedBytes + entryBytes > MAX_OUTPUT_BYTES) {
        truncated = true
        break
      }
      usedBytes += entryBytes
      truncated ||= clipped
      matches.push(entry)
    }
    const more = scanned < candidates.length
    return {
      matches,
      ...(more
        ? { nextCursor: encodeOffsetCursor(cursorKey, scanned) }
        : {}),
      truncated: truncated || (more && usedBytes + 64 > MAX_OUTPUT_BYTES)
    }
  }
}
