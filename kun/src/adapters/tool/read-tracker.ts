import { isAbsolute, relative, resolve } from 'node:path'
import type { ToolCallLike, ToolHostContext } from '../../ports/tool-host.js'
import { normalizeForFuzzyMatch } from './edit-diff.js'

export type ReadTrackerOptions = {
  enabled?: boolean
  requireOldTextInRead?: boolean
}

export const MAX_READ_TRACKER_THREADS = 128
export const MAX_READ_TRACKER_FILES_PER_THREAD = 128

type ReadRecord = {
  absolutePath: string
  relativePath?: string
  content?: string
  partial: boolean
  turnId: string
}

export class ReadTracker {
  private readonly records = new Map<string, Map<string, ReadRecord>>()

  constructor(private readonly options: Required<ReadTrackerOptions>) {}

  observeToolResult(input: {
    context: ToolHostContext
    call: ToolCallLike
    output: unknown
    isError?: boolean
  }): void {
    if (!this.options.enabled || input.isError || input.call.toolName !== 'read') return
    if (!input.output || typeof input.output !== 'object') return
    const output = input.output as Record<string, unknown>
    const rawPath = typeof output.path === 'string' ? output.path : ''
    if (!rawPath) return
    const absolutePath = normalizePath(rawPath, input.context.workspace)
    const record: ReadRecord = {
      absolutePath,
      // A bounded read, an explicit line window, or a first line that is too
      // large is not a complete snapshot. The edit tool still validates the
      // requested oldText against current bytes before writing.
      partial: isPartialRead(output),
      turnId: input.context.turnId,
      ...(typeof output.relative_path === 'string' ? { relativePath: output.relative_path } : {}),
      ...(typeof output.content === 'string' ? { content: output.content } : {})
    }
    const threadRecords = this.records.get(input.context.threadId) ?? new Map<string, ReadRecord>()
    threadRecords.delete(absolutePath)
    threadRecords.set(absolutePath, record)
    if (threadRecords.size > MAX_READ_TRACKER_FILES_PER_THREAD) {
      const oldest = threadRecords.keys().next().value
      if (oldest !== undefined) threadRecords.delete(oldest)
    }
    this.records.delete(input.context.threadId)
    this.records.set(input.context.threadId, threadRecords)
    if (this.records.size > MAX_READ_TRACKER_THREADS) {
      const oldest = this.records.keys().next().value
      if (oldest !== undefined) this.records.delete(oldest)
    }
  }

  validateBeforeTool(input: { context: ToolHostContext; call: ToolCallLike }): { ok: true } | { ok: false; message: string } {
    if (!this.options.enabled || !isEditTool(input.call)) return { ok: true }
    const rawPath = typeof input.call.arguments.path === 'string' ? input.call.arguments.path : ''
    if (!rawPath.trim()) return { ok: true }
    const absolutePath = normalizePath(rawPath, input.context.workspace)
    const record = this.records.get(input.context.threadId)?.get(absolutePath)
    if (!record) {
      return {
        ok: false,
        message:
          `read-before-edit guard blocked edit for ${displayPath(rawPath, input.context.workspace)}. ` +
          'Read the current file contents in this turn before editing so SEARCH text is based on fresh bytes.'
      }
    }
    // A read from an earlier turn still counts: agent responses routinely span
    // multiple turns (a long reply, or tool results arriving as separate turn
    // items), so read-in-turn-A then edit-in-turn-B is a legitimate sequence.
    // Hard-blocking it forced a fallback to sed/bash, which mangles code (#640).
    // Freshness is still enforced below — `requireOldTextInRead` checks the
    // oldText fragments against the cached read content, and the edit's own
    // fuzzy matching runs against the current bytes on disk, so a stale SEARCH
    // string fails there with a clear error instead of corrupting the file.
    if (!this.options.requireOldTextInRead || record.partial) return { ok: true }
    const missing = oldTextFragments(input.call.arguments).filter((fragment) => {
      if (!fragment.trim()) return false
      return !record.content || !containsNormalized(record.content, fragment)
    })
    if (missing.length === 0) return { ok: true }
    return {
      ok: false,
      message:
        `read-before-edit guard blocked edit for ${record.relativePath ?? displayPath(rawPath, input.context.workspace)}. ` +
        'At least one oldText fragment was not present in the latest read output; read a narrower range that includes the exact text before editing.'
    }
  }

  clear(threadId?: string): void {
    if (threadId) {
      this.records.delete(threadId)
      return
    }
    this.records.clear()
  }
}

function isPartialRead(output: Record<string, unknown>): boolean {
  if (output.truncated === true || output.first_line_exceeds_limit === true) return true
  const startLine = typeof output.start_line === 'number' ? output.start_line : undefined
  const endLine = typeof output.end_line === 'number' ? output.end_line : undefined
  const totalLines = typeof output.total_lines === 'number' ? output.total_lines : undefined
  // A window can reach EOF while still omitting the beginning of the file.
  // `end_line === total_lines` therefore does not by itself prove that the
  // cached content is a complete snapshot.
  return (startLine !== undefined && startLine > 1) ||
    (endLine !== undefined && totalLines !== undefined && endLine < totalLines)
}

function containsNormalized(content: string, fragment: string): boolean {
  return normalizeForFuzzyMatch(content).includes(normalizeForFuzzyMatch(fragment))
}

export function normalizeReadTrackerOptions(input: boolean | ReadTrackerOptions | undefined): Required<ReadTrackerOptions> {
  if (input === true) return { enabled: true, requireOldTextInRead: true }
  if (input === false || input === undefined) return { enabled: false, requireOldTextInRead: true }
  return {
    enabled: input.enabled === true,
    requireOldTextInRead: input.requireOldTextInRead !== false
  }
}

function isEditTool(call: ToolCallLike): boolean {
  return call.toolName === 'edit' || call.toolName === 'edit_file' || call.toolName === 'apply_patch'
}

function oldTextFragments(args: Record<string, unknown>): string[] {
  const out: string[] = []
  if (typeof args.oldText === 'string') out.push(args.oldText)
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (edit && typeof edit === 'object' && typeof (edit as Record<string, unknown>).oldText === 'string') {
        out.push((edit as Record<string, string>).oldText)
      }
    }
  }
  return out
}

function normalizePath(path: string, workspace: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(workspace || '.', path)
}

function displayPath(path: string, workspace: string): string {
  const absolutePath = normalizePath(path, workspace)
  const rel = workspace ? relative(resolve(workspace), absolutePath) : ''
  return rel && !rel.startsWith('..') ? rel : absolutePath
}
