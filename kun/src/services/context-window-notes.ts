import {
  CONTEXT_WINDOWS_PAGE_DEFAULT,
  NotesAppendToFileArgsSchema,
  NotesListFilesByPrefixArgsSchema,
  NotesReadFileArgsSchema,
  NotesSearchContentsArgsSchema,
  NotesWriteFileArgsSchema,
  type NotesAppendToFileResult,
  type NotesListFilesByPrefixResult,
  type NotesReadFileResult,
  type NotesSearchContentsResult,
  type NotesWriteFileResult
} from '../contracts/context-windows.js'
import type { ContextWindowStore } from '../ports/context-window-store.js'
import { decodeOffsetCursor, encodeOffsetCursor } from './context-window-cursor.js'
import { matchSnippet, segmentRead } from './context-window-text.js'

/**
 * Thread-private working notes on top of the ContextWindowStore port. All
 * listing/reading is paged and every result carries structured continuation
 * metadata; quota enforcement lives in the store under its per-thread queue
 * so checks and mutations cannot interleave. Every committed write/append
 * stores an immutable version stamped with the thread's public history
 * position so a fork can copy only the revisions available at the fork point.
 */
export class ContextWindowNotes {
  private readonly store: ContextWindowStore
  private readonly nowIso: () => string
  private readonly commitPosition?: (threadId: string) => Promise<number>

  constructor(deps: {
    store: ContextWindowStore
    nowIso?: () => string
    /**
     * Resolves the thread's current public history position for version
     * stamps. When omitted, commits are stamped as pre-fork content (0), so
     * every fork copies them; wire this in production for exact forks.
     */
    commitPosition?: (threadId: string) => Promise<number>
  }) {
    this.store = deps.store
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
    this.commitPosition = deps.commitPosition
  }

  private async positionOf(threadId: string): Promise<number> {
    return this.commitPosition ? this.commitPosition(threadId) : 0
  }

  async listFilesByPrefix(
    threadId: string,
    rawArgs: unknown
  ): Promise<NotesListFilesByPrefixResult> {
    const args = NotesListFilesByPrefixArgsSchema.parse(rawArgs ?? {})
    const pageSize = args.pageSize ?? CONTEXT_WINDOWS_PAGE_DEFAULT
    const offset = decodeOffsetCursor(args.cursor, `notes:list:${threadId}`)
    if (offset instanceof Error) throw offset
    const prefix = args.prefix ?? ''
    const files = (await this.store.listNoteFiles(threadId))
      .filter((file) => !prefix || file.path === prefix || file.path.startsWith(prefix))
    const page = files.slice(offset, offset + pageSize)
    const nextOffset = offset + page.length
    return {
      files: page.map((file) => ({
        path: file.path,
        byteSize: file.byteSize,
        revision: file.revision
      })),
      nextCursor: nextOffset < files.length
        ? encodeOffsetCursor(`notes:list:${threadId}`, nextOffset)
        : null
    }
  }

  async readFile(threadId: string, rawArgs: unknown): Promise<NotesReadFileResult> {
    const args = NotesReadFileArgsSchema.parse(rawArgs)
    const note = await this.store.readNote(threadId, args.path)
    if (!note) throw new Error(`note not found: ${args.path}`)
    const offset = args.cursor !== undefined
      ? decodeOffsetCursor(args.cursor, `notes:read:${threadId}:${args.path}`)
      : (args.offset ?? 0)
    if (offset instanceof Error) throw offset
    const read = segmentRead(note.content, offset)
    return {
      path: args.path,
      revision: note.revision,
      segments: read.segments,
      truncated: read.truncated,
      nextCursor: read.nextOffset !== null
        ? encodeOffsetCursor(`notes:read:${threadId}:${args.path}`, read.nextOffset)
        : null,
      nextOffset: read.nextOffset
    }
  }

  async searchContents(threadId: string, rawArgs: unknown): Promise<NotesSearchContentsResult> {
    const args = NotesSearchContentsArgsSchema.parse(rawArgs)
    const pageSize = args.pageSize ?? CONTEXT_WINDOWS_PAGE_DEFAULT
    const offset = decodeOffsetCursor(args.cursor, `notes:search:${threadId}:${args.query}`)
    if (offset instanceof Error) throw offset
    const needle = args.query.toLowerCase()
    const files = await this.store.listNoteFiles(threadId)
    const matches: NotesSearchContentsResult['matches'] = []
    let scanned = 0
    for (const file of files) {
      if (scanned < offset) { scanned += 1; continue }
      scanned += 1
      const note = await this.store.readNote(threadId, file.path)
      if (!note) continue
      const snippet = matchSnippet(note.content, needle)
      if (snippet) matches.push({ path: file.path, snippet })
      if (matches.length >= pageSize) break
    }
    return {
      query: args.query,
      matches,
      nextCursor: scanned < files.length
        ? encodeOffsetCursor(`notes:search:${threadId}:${args.query}`, scanned)
        : null
    }
  }

  async appendToFile(threadId: string, rawArgs: unknown): Promise<NotesAppendToFileResult> {
    const args = NotesAppendToFileArgsSchema.parse(rawArgs)
    const outcome = await this.store.appendNote(
      threadId, args.path, args.operationId, args.text, this.nowIso(),
      await this.positionOf(threadId)
    )
    return { path: args.path, revision: outcome.revision, operationId: args.operationId }
  }

  async writeFile(threadId: string, rawArgs: unknown): Promise<NotesWriteFileResult> {
    const args = NotesWriteFileArgsSchema.parse(rawArgs)
    return this.store.writeNote(
      threadId, args.path, args.expectedRevision, args.text, this.nowIso(),
      await this.positionOf(threadId)
    )
  }

  /**
   * Fork snapshot. `cutoffItemSeq` is the source thread's public item count
   * at the fork point: only note versions committed at or before it are
   * copied, so the child never sees decisions recorded after the branch.
   */
  async forkThreadData(
    sourceThreadId: string,
    targetThreadId: string,
    cutoffItemSeq?: number
  ): Promise<void> {
    await this.store.copyThreadData(sourceThreadId, targetThreadId, cutoffItemSeq)
  }

  async deleteThreadData(threadId: string): Promise<void> {
    await this.store.deleteThreadData(threadId)
  }
}
