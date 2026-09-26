import { describe, expect, it } from 'vitest'
import type { ModelRequest } from '../ports/model-client.js'
import { createCompatRequestCodecs, normalizeToolSpecs } from '../adapters/model/compat-request-builder.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES,
  CONTEXT_WINDOWS_OUTPUT_MAX_TOKENS,
  CONTEXT_WINDOWS_PAGE_DEFAULT,
  CONTEXT_WINDOWS_PAGE_MAX,
  CONTEXT_WINDOWS_QUERY_MAX_CHARS,
  CONTEXT_WINDOWS_TEXT_MAX_BYTES,
  ContextWindowModeSchema,
  ContextWindowTurnModeSnapshotSchema,
  contextWindowToolSpecByName,
  contextWindowToolSpecs,
  CONTEXT_WINDOW_TOOL_NAMES,
  HistoryListItemsArgsSchema,
  HistoryListWindowsArgsSchema,
  HistoryListWindowsResultSchema,
  HistoryReadItemArgsSchema,
  HistorySearchContentsArgsSchema,
  NewContextArgsSchema,
  NotesAppendToFileArgsSchema,
  NotesListFilesByPrefixArgsSchema,
  NotesReadFileArgsSchema,
  NotesSearchContentsArgsSchema,
  NotesWriteFileArgsSchema,
  NotesWriteFileResultSchema,
  type ContextWindowToolSpec
} from './context-windows.js'
import {
  ContextWindowTurnItem,
  isPublicTurnItem,
  TurnItem
} from './items.js'
import { isPublicRuntimeEvent, RuntimeEvent } from './events.js'

const baseItem = {
  id: 'item-cw-1',
  turnId: 'turn-1',
  threadId: 'thread-1',
  role: 'system' as const,
  status: 'completed' as const,
  createdAt: '2026-09-14T00:00:00.000Z'
}

function contextWindowFixture(reason: string, overrides: Record<string, unknown> = {}) {
  return {
    ...baseItem,
    kind: 'context_window',
    schemaVersion: 1,
    windowId: 'win-3',
    previousWindowId: 'win-2',
    reason,
    sourceHistoryRevision: 41,
    splitBefore: { kind: 'item', itemId: 'item-user-9' },
    initializationRef: 'init:win-3',
    operationId: 'op-7',
    replacedTokens: 0,
    ...overrides
  }
}

describe('context window turn item contract', () => {
  it('round-trips through the TurnItem union for every reason variant', () => {
    for (const reason of ['model', 'pressure', 'overflow', 'manual-summary']) {
      const parsed = TurnItem.parse(contextWindowFixture(reason))
      expect(parsed.kind).toBe('context_window')
      const revived = TurnItem.parse(JSON.parse(JSON.stringify(parsed)))
      expect(revived).toEqual(parsed)
    }
  })

  it('accepts window 0 without a previous window and seq split positions', () => {
    const item = ContextWindowTurnItem.parse(contextWindowFixture('model', {
      windowId: 'win-0',
      previousWindowId: null,
      splitBefore: { kind: 'seq', seq: 12 }
    }))
    expect(item.previousWindowId).toBeNull()
    expect(item.splitBefore).toEqual({ kind: 'seq', seq: 12 })
    const absent = ContextWindowTurnItem.parse(contextWindowFixture('model', {
      windowId: 'win-0',
      previousWindowId: undefined,
      replacedTokens: 9_000
    }))
    expect(absent.previousWindowId).toBeUndefined()
  })

  it('rejects invalid boundaries instead of relying on replacedTokens semantics', () => {
    expect(ContextWindowTurnItem.safeParse(contextWindowFixture('nope')).success).toBe(false)
    expect(ContextWindowTurnItem.safeParse(contextWindowFixture('model', { schemaVersion: 2 })).success).toBe(false)
    expect(ContextWindowTurnItem.safeParse(contextWindowFixture('model', { replacedTokens: -1 })).success).toBe(false)
    expect(ContextWindowTurnItem.safeParse(contextWindowFixture('model', { sourceHistoryRevision: -1 })).success).toBe(false)
    expect(ContextWindowTurnItem.safeParse(contextWindowFixture('model', { splitBefore: { kind: 'item' } })).success).toBe(false)
  })

  it('parses old session JSON without window items unchanged and stays public', () => {
    const legacyItems = [
      { ...baseItem, id: 'u1', kind: 'user_message', role: 'user', text: 'hello' },
      { ...baseItem, id: 'a1', kind: 'assistant_text', role: 'assistant', text: 'hi' },
      {
        ...baseItem, id: 'c1', kind: 'compaction', role: 'system',
        summary: 'older summary', replacedTokens: 100, pinnedConstraints: []
      }
    ]
    const parsed = TurnItem.array().parse(legacyItems)
    expect(parsed).toEqual(legacyItems)

    const sessionJson = JSON.stringify([...legacyItems, contextWindowFixture('pressure')])
    const session = TurnItem.array().parse(JSON.parse(sessionJson))
    expect(session).toHaveLength(4)
    const boundary = session[3]!
    expect(boundary.kind).toBe('context_window')
    expect(isPublicTurnItem(boundary)).toBe(true)
  })

  it('replays the window transition event once in chronological position', () => {
    const item = ContextWindowTurnItem.parse(contextWindowFixture('overflow'))
    const event = RuntimeEvent.parse({
      seq: 88,
      timestamp: '2026-09-14T00:01:00.000Z',
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'context_window',
      item
    })
    expect(event.kind).toBe('context_window')
    expect(isPublicRuntimeEvent(event)).toBe(true)
    const revived = RuntimeEvent.parse(JSON.parse(JSON.stringify(event)))
    expect(revived).toEqual(event)
  })
})

describe('turn mode snapshot contract', () => {
  it('freezes mode, window id, and window seq for enabled and summary turns', () => {
    expect(ContextWindowModeSchema.parse('windows')).toBe('windows')
    expect(ContextWindowModeSchema.parse('summary')).toBe('summary')
    const enabled = ContextWindowTurnModeSnapshotSchema.parse({
      mode: 'windows', windowId: 'win-2', windowSeq: 2
    })
    expect(enabled.windowSeq).toBe(2)
    const summary = ContextWindowTurnModeSnapshotSchema.parse({
      mode: 'summary', windowId: null, windowSeq: null
    })
    expect(summary.windowId).toBeNull()
    expect(ContextWindowTurnModeSnapshotSchema.safeParse({ mode: 'windows', windowId: 'x' }).success).toBe(false)
  })

  it('exposes the design boundedness constants', () => {
    expect(CONTEXT_WINDOWS_PAGE_DEFAULT).toBe(20)
    expect(CONTEXT_WINDOWS_PAGE_MAX).toBe(100)
    expect(CONTEXT_WINDOWS_QUERY_MAX_CHARS).toBe(1024)
    expect(CONTEXT_WINDOWS_TEXT_MAX_BYTES).toBe(16 * 1024)
    expect(CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES).toBe(256 * 1024)
    expect(CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD).toBe(100)
    expect(CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(CONTEXT_WINDOWS_OUTPUT_MAX_TOKENS).toBe(4096)
  })
})

const request: ModelRequest = {
  threadId: 'thread',
  turnId: 'turn',
  model: 'relay-model',
  prefix: [],
  history: [],
  tools: [],
  abortSignal: new AbortController().signal
}

function wireSchemaFor(spec: ContextWindowToolSpec, endpointFormat: 'chat_completions' | 'messages' | 'responses') {
  const wire = createCompatRequestCodecs().build({
    request,
    model: request.model,
    messages: [],
    tools: normalizeToolSpecs([{ name: spec.name, description: spec.description, inputSchema: spec.inputSchema }]),
    stream: false,
    endpointFormat,
    baseUrl: 'https://relay.example/v1',
    isCodex: false,
    isCodexLite: false,
    codexNativeImageGeneration: false
  })
  const tools = wire.tools as Array<Record<string, unknown>>
  if (endpointFormat === 'messages') {
    return tools[0]!.input_schema as Record<string, unknown>
  }
  if (endpointFormat === 'responses') {
    return tools[0]!.parameters as Record<string, unknown>
  }
  return (tools[0] as { function: { parameters: Record<string, unknown> } }).function.parameters
}

describe('context window tool schemas', () => {
  it('declares the flat tool set with unique names', () => {
    expect(CONTEXT_WINDOW_TOOL_NAMES).toHaveLength(10)
    expect(new Set(CONTEXT_WINDOW_TOOL_NAMES).size).toBe(CONTEXT_WINDOW_TOOL_NAMES.length)
    expect(contextWindowToolSpecs.map((spec) => spec.name).sort())
      .toEqual([...CONTEXT_WINDOW_TOOL_NAMES].sort())
    for (const name of CONTEXT_WINDOW_TOOL_NAMES) {
      expect(contextWindowToolSpecByName[name].name).toBe(name)
    }
  })

  it('serializes for chat completions, messages, and responses without dialect loss', () => {
    for (const spec of contextWindowToolSpecs) {
      for (const endpointFormat of ['chat_completions', 'messages', 'responses'] as const) {
        const schema = wireSchemaFor(spec, endpointFormat)
        expect(schema.type).toBe('object')
        expect(schema).not.toHaveProperty('oneOf')
        expect(schema).not.toHaveProperty('anyOf')
        expect(schema).not.toHaveProperty('allOf')
        expect(schema.additionalProperties).toBe(false)
      }
    }
  })

  it('parses minimal valid arguments for every tool', () => {
    expect(NewContextArgsSchema.parse({})).toEqual({})
    expect(HistoryListWindowsArgsSchema.parse({})).toEqual({})
    expect(HistoryListItemsArgsSchema.parse({ windowId: 'win-1' })).toEqual({ windowId: 'win-1' })
    expect(HistoryReadItemArgsSchema.parse({ windowId: 'win-1', itemId: 'item-1' }))
      .toEqual({ windowId: 'win-1', itemId: 'item-1' })
    expect(HistorySearchContentsArgsSchema.parse({ query: 'budget' })).toEqual({ query: 'budget' })
    expect(NotesListFilesByPrefixArgsSchema.parse({})).toEqual({})
    expect(NotesReadFileArgsSchema.parse({ path: 'notes/log.md' })).toEqual({ path: 'notes/log.md' })
    expect(NotesSearchContentsArgsSchema.parse({ query: 'budget' })).toEqual({ query: 'budget' })
    expect(NotesAppendToFileArgsSchema.parse({
      path: 'notes/log.md', text: 'step done', operationId: 'op-1'
    })).toEqual({ path: 'notes/log.md', text: 'step done', operationId: 'op-1' })
    expect(NotesWriteFileArgsSchema.parse({
      path: 'notes/log.md', text: 'step done', expectedRevision: 0
    })).toEqual({ path: 'notes/log.md', text: 'step done', expectedRevision: 0 })
  })

  it('enforces boundedness constants in argument schemas', () => {
    expect(HistoryListWindowsArgsSchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(HistoryListWindowsArgsSchema.safeParse({ pageSize: 100 }).success).toBe(true)
    expect(HistoryListItemsArgsSchema.safeParse({ windowId: 'win-1', pageSize: 0 }).success).toBe(false)
    expect(HistorySearchContentsArgsSchema.safeParse({ query: 'x'.repeat(1025) }).success).toBe(false)
    expect(HistorySearchContentsArgsSchema.safeParse({ query: 'x'.repeat(1024) }).success).toBe(true)

    const oversizedText = 'x'.repeat(CONTEXT_WINDOWS_TEXT_MAX_BYTES + 1)
    expect(NotesAppendToFileArgsSchema.safeParse({
      path: 'notes/progress.md', text: oversizedText, operationId: 'op-1'
    }).success).toBe(false)
    // Multi-byte content under the char cap still respects the byte cap.
    const wideText = '汉'.repeat(Math.floor(CONTEXT_WINDOWS_TEXT_MAX_BYTES / 2))
    expect(NotesWriteFileArgsSchema.safeParse({
      path: 'notes/progress.md', text: wideText, expectedRevision: 0
    }).success).toBe(false)
    expect(NotesWriteFileArgsSchema.safeParse({
      path: 'notes/progress.md', text: 'done', expectedRevision: 0
    }).success).toBe(true)
  })

  it('rejects note paths outside the logical namespace', () => {
    for (const path of ['/abs.md', '../escape.md', 'a/../b.md', '']) {
      expect(NotesReadFileArgsSchema.safeParse({ path }).success).toBe(false)
      expect(NotesAppendToFileArgsSchema.safeParse({ path, text: 'x', operationId: 'op-1' }).success).toBe(false)
    }
    expect(NotesListFilesByPrefixArgsSchema.safeParse({ prefix: '' }).success).toBe(true)
    expect(NotesListFilesByPrefixArgsSchema.safeParse({ prefix: 'notes/' }).success).toBe(true)
    expect(NotesListFilesByPrefixArgsSchema.safeParse({ prefix: '/notes' }).success).toBe(false)
  })

  it('validates wire input schema limits against the zod argument contracts', () => {
    const windows = contextWindowToolSpecByName.history_list_windows.inputSchema as {
      properties: { pageSize: { maximum?: number; minimum?: number } }
    }
    expect(windows.properties.pageSize.maximum).toBe(CONTEXT_WINDOWS_PAGE_MAX)
    const search = contextWindowToolSpecByName.history_search_contents.inputSchema as {
      properties: { query: { maxLength?: number } }
      required: string[]
    }
    expect(search.properties.query.maxLength).toBe(CONTEXT_WINDOWS_QUERY_MAX_CHARS)
    expect(search.required).toEqual(['query'])
  })
})

describe('history and notes result contracts', () => {
  it('parses a paged window listing with item ranges', () => {
    const result = HistoryListWindowsResultSchema.parse({
      windows: [{
        windowId: 'win-1',
        windowSeq: 1,
        reason: 'model',
        createdAt: '2026-09-14T00:00:00.000Z',
        seq: 42,
        itemRange: { firstItemId: 'i1', lastItemId: 'i9', itemCount: 9 }
      }],
      nextCursor: null
    })
    expect(result.windows[0]?.itemRange.itemCount).toBe(9)
  })

  it('models write CAS conflict as an explicit result variant', () => {
    expect(NotesWriteFileResultSchema.parse({ status: 'ok', path: 'a.md', revision: 3 }).status).toBe('ok')
    const conflict = NotesWriteFileResultSchema.parse({
      status: 'conflict', path: 'a.md', expectedRevision: 2, actualRevision: 3
    })
    expect(conflict.status).toBe('conflict')
    expect(HistoryReadItemArgsSchema.safeParse({ windowId: 'w', itemId: 'i', offset: -1 }).success).toBe(false)
    expect(HistoryReadItemArgsSchema.safeParse({ windowId: 'w', itemId: 'i', offset: 4 }).success).toBe(true)
  })
})
