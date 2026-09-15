import { z } from 'zod'
import {
  ContextWindowTransitionReasonSchema,
  TurnItemRole
} from './items.js'

/**
 * Boundedness limits for the opt-in context-window history and notes tools.
 * Requests are validated before execution and responses are capped before
 * they are retained in model history, so a page never exceeds these values.
 */
export const CONTEXT_WINDOWS_PAGE_DEFAULT = 20
export const CONTEXT_WINDOWS_PAGE_MAX = 100
export const CONTEXT_WINDOWS_QUERY_MAX_CHARS = 1024
/** Single read/write text limit, in UTF-8 bytes. */
export const CONTEXT_WINDOWS_TEXT_MAX_BYTES = 16 * 1024
/** JSON Schema `maxLength` counterpart; the byte limit is enforced in zod. */
export const CONTEXT_WINDOWS_TEXT_MAX_CHARS = 16 * 1024
export const CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES = 256 * 1024
export const CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD = 100
export const CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES = 2 * 1024 * 1024
/** Response output cap in tokens, combined with min(existing tool token cap, this). */
export const CONTEXT_WINDOWS_OUTPUT_MAX_TOKENS = 4096

export const ContextWindowModeSchema = z.enum(['summary', 'windows'])
export type ContextWindowMode = z.infer<typeof ContextWindowModeSchema>

/**
 * Mode frozen when a turn is accepted. Hot config updates only take effect
 * from the next turn; auto-resume and child tasks inherit the initiating
 * turn's snapshot but keep independent window state.
 */
export const ContextWindowTurnModeSnapshotSchema = z.object({
  mode: ContextWindowModeSchema,
  /** Active window identity; null in summary mode. */
  windowId: z.string().min(1).nullable(),
  /** 0-based window ordinal; null in summary mode. */
  windowSeq: z.number().int().nonnegative().nullable()
})
export type ContextWindowTurnModeSnapshot = z.infer<typeof ContextWindowTurnModeSnapshotSchema>

export const HistoryWindowItemRangeSchema = z.object({
  firstItemId: z.string().min(1).nullable(),
  lastItemId: z.string().min(1).nullable(),
  itemCount: z.number().int().nonnegative()
})
export type HistoryWindowItemRange = z.infer<typeof HistoryWindowItemRangeSchema>

/**
 * Windows opened by a transition keep the transition reason; the synthetic
 * window 0 that holds history retained before the first boundary uses
 * 'initial'.
 */
export const ContextWindowListingReasonSchema = z.enum([
  ...ContextWindowTransitionReasonSchema.options,
  'initial'
])
export type ContextWindowListingReason = z.infer<typeof ContextWindowListingReasonSchema>

export const HistoryWindowSummarySchema = z.object({
  windowId: z.string().min(1),
  windowSeq: z.number().int().nonnegative(),
  reason: ContextWindowListingReasonSchema,
  createdAt: z.string(),
  seq: z.number().int().nonnegative(),
  itemRange: HistoryWindowItemRangeSchema
})
export type HistoryWindowSummary = z.infer<typeof HistoryWindowSummarySchema>

export const HistoryListWindowsResultSchema = z.object({
  windows: z.array(HistoryWindowSummarySchema),
  nextCursor: z.string().min(1).nullable()
})
export type HistoryListWindowsResult = z.infer<typeof HistoryListWindowsResultSchema>

export const HistoryItemSummarySchema = z.object({
  itemId: z.string().min(1),
  kind: z.string().min(1),
  role: TurnItemRole,
  seq: z.number().int().nonnegative(),
  createdAt: z.string()
})
export type HistoryItemSummary = z.infer<typeof HistoryItemSummarySchema>

export const HistoryListItemsResultSchema = z.object({
  windowId: z.string().min(1),
  items: z.array(HistoryItemSummarySchema),
  nextCursor: z.string().min(1).nullable()
})
export type HistoryListItemsResult = z.infer<typeof HistoryListItemsResultSchema>

/**
 * Access-controlled reference for large attachments. History reads never
 * inline binary content; the reference stays subject to the existing
 * attachment access rules.
 */
export const HistoryAttachmentReferenceSchema = z.object({
  attachmentId: z.string().min(1),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  byteSize: z.number().int().nonnegative(),
  access: z.enum(['allowed', 'denied'])
})
export type HistoryAttachmentReference = z.infer<typeof HistoryAttachmentReferenceSchema>

export const TextSegmentSchema = z.object({
  text: z.string(),
  truncated: z.boolean()
})
export type TextSegment = z.infer<typeof TextSegmentSchema>

export const HistoryItemReadResultSchema = z.object({
  windowId: z.string().min(1),
  itemId: z.string().min(1),
  segments: z.array(TextSegmentSchema),
  attachments: z.array(HistoryAttachmentReferenceSchema),
  truncated: z.boolean(),
  nextCursor: z.string().min(1).nullable(),
  nextOffset: z.number().int().nonnegative().nullable()
})
export type HistoryItemReadResult = z.infer<typeof HistoryItemReadResultSchema>

export const HistoryContentMatchSchema = z.object({
  windowId: z.string().min(1),
  itemId: z.string().min(1),
  snippets: z.array(TextSegmentSchema)
})
export type HistoryContentMatch = z.infer<typeof HistoryContentMatchSchema>

export const HistorySearchContentsResultSchema = z.object({
  query: z.string().min(1),
  matches: z.array(HistoryContentMatchSchema),
  nextCursor: z.string().min(1).nullable()
})
export type HistorySearchContentsResult = z.infer<typeof HistorySearchContentsResultSchema>

export const NoteFileSummarySchema = z.object({
  path: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative()
})
export type NoteFileSummary = z.infer<typeof NoteFileSummarySchema>

export const NotesListFilesByPrefixResultSchema = z.object({
  files: z.array(NoteFileSummarySchema),
  nextCursor: z.string().min(1).nullable()
})
export type NotesListFilesByPrefixResult = z.infer<typeof NotesListFilesByPrefixResultSchema>

export const NotesReadFileResultSchema = z.object({
  path: z.string().min(1),
  revision: z.number().int().nonnegative(),
  segments: z.array(TextSegmentSchema),
  truncated: z.boolean(),
  nextCursor: z.string().min(1).nullable(),
  nextOffset: z.number().int().nonnegative().nullable()
})
export type NotesReadFileResult = z.infer<typeof NotesReadFileResultSchema>

export const NoteContentMatchSchema = z.object({
  path: z.string().min(1),
  snippet: TextSegmentSchema
})
export type NoteContentMatch = z.infer<typeof NoteContentMatchSchema>

export const NotesSearchContentsResultSchema = z.object({
  query: z.string().min(1),
  matches: z.array(NoteContentMatchSchema),
  nextCursor: z.string().min(1).nullable()
})
export type NotesSearchContentsResult = z.infer<typeof NotesSearchContentsResultSchema>

export const NotesAppendToFileResultSchema = z.object({
  path: z.string().min(1),
  revision: z.number().int().nonnegative(),
  operationId: z.string().min(1)
})
export type NotesAppendToFileResult = z.infer<typeof NotesAppendToFileResultSchema>

/** Whole-file replace is revision CAS; a stale revision reports conflict. */
export const NotesWriteFileResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    path: z.string().min(1),
    revision: z.number().int().nonnegative()
  }),
  z.object({
    status: z.literal('conflict'),
    path: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    actualRevision: z.number().int().nonnegative()
  })
])
export type NotesWriteFileResult = z.infer<typeof NotesWriteFileResultSchema>

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isSafeNoteLogicalPath(value: string): boolean {
  if (value.startsWith('/') || value.includes('\0')) return false
  return value.split('/').every((segment) => segment !== '..' && segment !== '')
}

function isSafeNoteLogicalPrefix(value: string): boolean {
  const trimmed = value.replace(/\/+$/, '')
  return trimmed === '' || isSafeNoteLogicalPath(trimmed)
}

const CursorArgSchema = z.string().min(1).max(1024)
const PageSizeArgSchema = z.number().int().min(1).max(CONTEXT_WINDOWS_PAGE_MAX).optional()
const WindowIdArgSchema = z.string().min(1).max(256)
const QueryArgSchema = z.string().min(1).max(CONTEXT_WINDOWS_QUERY_MAX_CHARS)
const NotePathArgSchema = z.string().min(1).max(512).refine(isSafeNoteLogicalPath, {
  message: 'note path must be a relative logical path without .. segments'
})
const NoteTextArgSchema = z.string().min(1).max(CONTEXT_WINDOWS_TEXT_MAX_CHARS).refine(
  (value) => utf8ByteLength(value) <= CONTEXT_WINDOWS_TEXT_MAX_BYTES,
  { message: `note text must be at most ${CONTEXT_WINDOWS_TEXT_MAX_BYTES} UTF-8 bytes` }
)

/** Zod argument contracts mirroring the wire input schemas below. */
export const NewContextArgsSchema = z.object({}).strict()
export const HistoryListWindowsArgsSchema = z.object({
  pageSize: PageSizeArgSchema,
  cursor: CursorArgSchema.optional()
}).strict()
export const HistoryListItemsArgsSchema = z.object({
  windowId: WindowIdArgSchema,
  pageSize: PageSizeArgSchema,
  cursor: CursorArgSchema.optional()
}).strict()
export const HistoryReadItemArgsSchema = z.object({
  windowId: WindowIdArgSchema,
  itemId: z.string().min(1).max(256),
  offset: z.number().int().nonnegative().optional(),
  cursor: CursorArgSchema.optional()
}).strict()
export const HistorySearchContentsArgsSchema = z.object({
  query: QueryArgSchema,
  windowId: WindowIdArgSchema.optional(),
  pageSize: PageSizeArgSchema,
  cursor: CursorArgSchema.optional()
}).strict()
export const NotesListFilesByPrefixArgsSchema = z.object({
  prefix: z.string().max(512).refine(isSafeNoteLogicalPrefix, {
    message: 'note prefix must be a relative logical path without .. segments'
  }).optional(),
  pageSize: PageSizeArgSchema,
  cursor: CursorArgSchema.optional()
}).strict()
export const NotesReadFileArgsSchema = z.object({
  path: NotePathArgSchema,
  offset: z.number().int().nonnegative().optional(),
  cursor: CursorArgSchema.optional()
}).strict()
export const NotesSearchContentsArgsSchema = z.object({
  query: QueryArgSchema,
  pageSize: PageSizeArgSchema,
  cursor: CursorArgSchema.optional()
}).strict()
export const NotesAppendToFileArgsSchema = z.object({
  path: NotePathArgSchema,
  text: NoteTextArgSchema,
  operationId: z.string().min(1).max(256)
}).strict()
export const NotesWriteFileArgsSchema = z.object({
  path: NotePathArgSchema,
  text: NoteTextArgSchema,
  expectedRevision: z.number().int().nonnegative()
}).strict()

export const CONTEXT_WINDOW_TOOL_NAMES = [
  'new_context',
  'history_list_windows',
  'history_list_items',
  'history_read_item',
  'history_search_contents',
  'notes_list_files_by_prefix',
  'notes_read_file',
  'notes_search_contents',
  'notes_append_to_file',
  'notes_write_file'
] as const
export type ContextWindowToolName = (typeof CONTEXT_WINDOW_TOOL_NAMES)[number]
export const contextWindowToolNameSet: ReadonlySet<string> = new Set(CONTEXT_WINDOW_TOOL_NAMES)

export type ContextWindowToolSpec = {
  name: ContextWindowToolName
  description: string
  /** Plain JSON Schema; identical across chat completions/messages/responses. */
  inputSchema: Record<string, unknown>
}

const pageSizeProperty = {
  type: 'number',
  minimum: 1,
  maximum: CONTEXT_WINDOWS_PAGE_MAX,
  description: `Optional page size (default ${CONTEXT_WINDOWS_PAGE_DEFAULT}, max ${CONTEXT_WINDOWS_PAGE_MAX}).`
}
const cursorProperty = {
  type: 'string',
  description: 'Opaque cursor from a previous result for the same query.'
}
const queryProperty = {
  type: 'string',
  minLength: 1,
  maxLength: CONTEXT_WINDOWS_QUERY_MAX_CHARS
}
const notePathProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 512,
  description: 'Thread-private logical note path; relative, no .. segments.'
}
const noteTextProperty = {
  type: 'string',
  minLength: 1,
  maxLength: CONTEXT_WINDOWS_TEXT_MAX_CHARS,
  description: `Text; must be at most ${CONTEXT_WINDOWS_TEXT_MAX_BYTES} UTF-8 bytes.`
}

export const contextWindowToolSpecs: readonly ContextWindowToolSpec[] = [
  {
    name: 'new_context',
    description: 'Start a fresh context window for the current task without generating a summary. Call it exclusively, never mixed with other tool calls in one batch.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    name: 'history_list_windows',
    description: 'List context windows of the current thread with reason and item range, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: pageSizeProperty,
        cursor: cursorProperty
      },
      required: [],
      additionalProperties: false
    }
  },
  {
    name: 'history_list_items',
    description: 'List message metadata of one context window in sequence order.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: { type: 'string', minLength: 1 },
        pageSize: pageSizeProperty,
        cursor: cursorProperty
      },
      required: ['windowId'],
      additionalProperties: false
    }
  },
  {
    name: 'history_read_item',
    description: 'Read one retained history item by id as bounded text segments or access-controlled attachment references.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
        offset: { type: 'number', minimum: 0, description: 'Optional segment offset; ignored when cursor is set.' },
        cursor: cursorProperty
      },
      required: ['windowId', 'itemId'],
      additionalProperties: false
    }
  },
  {
    name: 'history_search_contents',
    description: 'Search retained conversation text and return window/item ids with truncated snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: queryProperty,
        windowId: { type: 'string', minLength: 1 },
        pageSize: pageSizeProperty,
        cursor: cursorProperty
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'notes_list_files_by_prefix',
    description: 'List thread-private note files under a logical path prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { ...notePathProperty, minLength: 0 },
        pageSize: pageSizeProperty,
        cursor: cursorProperty
      },
      required: [],
      additionalProperties: false
    }
  },
  {
    name: 'notes_read_file',
    description: 'Read a thread-private note file as bounded text segments with revision and continuation metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: notePathProperty,
        offset: { type: 'number', minimum: 0, description: 'Optional segment offset; ignored when cursor is set.' },
        cursor: cursorProperty
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'notes_search_contents',
    description: 'Search thread-private note text and return paths with truncated snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: queryProperty,
        pageSize: pageSizeProperty,
        cursor: cursorProperty
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'notes_append_to_file',
    description: 'Idempotently append text to a thread-private note file. Retrying the same operationId does not duplicate content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: notePathProperty,
        text: noteTextProperty,
        operationId: { type: 'string', minLength: 1 }
      },
      required: ['path', 'text', 'operationId'],
      additionalProperties: false
    }
  },
  {
    name: 'notes_write_file',
    description: 'Replace a thread-private note file wholesale when the expected revision matches; a stale revision reports a conflict.',
    inputSchema: {
      type: 'object',
      properties: {
        path: notePathProperty,
        text: noteTextProperty,
        expectedRevision: { type: 'number', minimum: 0 }
      },
      required: ['path', 'text', 'expectedRevision'],
      additionalProperties: false
    }
  }
]

export const contextWindowToolSpecByName = Object.fromEntries(
  contextWindowToolSpecs.map((spec) => [spec.name, spec])
) as Record<ContextWindowToolName, ContextWindowToolSpec>
