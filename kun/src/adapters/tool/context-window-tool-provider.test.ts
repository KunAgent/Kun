import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { FileContextWindowStore } from '../../adapters/file/file-context-window-store.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES,
  CONTEXT_WINDOW_TOOL_NAMES
} from '../../contracts/context-windows.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { ContextWindowNotes } from '../../services/context-window-notes.js'
import { ContextWindowTurnModes } from '../../services/context-window-turn-modes.js'
import { ContextWindowService } from '../../services/context-window-service.js'
import { CapabilityRegistry } from './capability-registry.js'
import { buildContextWindowToolProviders } from './context-window-tool-provider.js'
import type { LocalTool } from './local-tool-host-types.js'

function context(threadId: string): ToolHostContext {
  return {
    threadId,
    turnId: 'turn-1',
    workspace: '/tmp/ws',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow' as const
  }
}

describe('buildContextWindowToolProviders', () => {
  let dataDir: string
  let sessionStore: InMemorySessionStore
  let service: ContextWindowService
  let mode: 'summary' | 'windows'
  let tools: LocalTool[]

  const tool = (name: string) => tools.find((candidate) => candidate.name === name)

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-tools-'))
    sessionStore = new InMemorySessionStore()
    service = new ContextWindowService({
      sessionStore,
      notes: new ContextWindowNotes({
        store: new FileContextWindowStore({
          dataDir,
          limits: {
            maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
            maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
            maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
          }
        })
      })
    })
    mode = 'windows'
    tools = buildContextWindowToolProviders({ service, mode: () => mode })[0]!.tools as LocalTool[]
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  async function message(id: string, text: string, threadId = 'threadA'): Promise<TurnItem> {
    return {
      id, turnId: 'turn-1', threadId,
      kind: 'user_message', role: 'user', status: 'completed',
      createdAt: '2026-09-14T00:00:00.000Z', text
    }
  }

  it('declares all ten flat tools with contract schemas', () => {
    expect(tools.map((candidate) => candidate.name).sort())
      .toEqual([...CONTEXT_WINDOW_TOOL_NAMES].sort())
    for (const candidate of tools) {
      expect(candidate.inputSchema.type).toBe('object')
      expect(candidate.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('advertises in windows mode and works for non-GUI clients', () => {
    for (const candidate of tools) {
      expect(candidate.shouldAdvertise?.(context('threadA'))).toBe(true)
      expect(candidate.shouldAdvertise?.({
        ...context('threadA'),
        clientSurface: undefined,
        threadMode: undefined
      })).toBe(true)
    }
  })

  it('hides schemas and rejects direct invocation in summary mode', async () => {
    mode = 'summary'
    for (const candidate of tools) {
      expect(candidate.shouldAdvertise?.(context('threadA'))).toBe(false)
      const result = await candidate.execute({}, context('threadA'))
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.output)).toContain('window-mode')
    }
    const registry = new CapabilityRegistry(buildContextWindowToolProviders({
      service, mode: () => 'summary'
    }))
    expect(() => registry.resolveTool('history_list_windows', context('threadA')))
      .toThrow('tool history_list_windows is not advertised in this turn context')
  })

  it('executes history search against the trusted thread identity only', async () => {
    await sessionStore.appendItem('threadA', await message('u1', 'deploy strategy alpha'))
    await service.commitWindowCheckpoint({
      threadId: 'threadA', turnId: 'turn-1', windowId: 'win-1',
      reason: 'model', initializationRef: 'init', operationId: 'op-1'
    })
    await sessionStore.appendItem('threadA', await message('u2', 'current work'))
    const search = await tool('history_search_contents')!.execute(
      { query: 'strategy alpha' }, context('threadA'))
    expect(search.isError).toBeUndefined()
    const output = search.output as { matches: Array<{ windowId: string; itemId: string; snippets: unknown[] }> }
    expect(output.matches).toHaveLength(1)
    expect(output.matches[0]).toMatchObject({ windowId: 'win-0', itemId: 'u1' })

    // Same arguments under another trusted identity see nothing: arguments
    // cannot name a thread, and each thread has its own history.
    const foreign = await tool('history_search_contents')!.execute(
      { query: 'strategy alpha' }, context('threadB'))
    expect((foreign.output as { matches: unknown[] }).matches).toEqual([])
  })

  it('paginates, bounds output, and reports continuation through the tool boundary', async () => {
    for (let index = 0; index < 25; index += 1) {
      await sessionStore.appendItem('threadA', await message(`m${index}`, `line ${index}`))
    }
    await sessionStore.appendItem('threadA', await message('big', '汉'.repeat(6_000)))
    const list = await tool('history_list_items')!.execute(
      { windowId: 'win-0', pageSize: 5 }, context('threadA'))
    const page = list.output as { items: unknown[]; nextCursor: string | null }
    expect(page.items).toHaveLength(5)
    expect(page.nextCursor).toEqual(expect.any(String))
    const next = await tool('history_list_items')!.execute(
      { windowId: 'win-0', pageSize: 5, cursor: page.nextCursor }, context('threadA'))
    expect((next.output as { items: unknown[] }).items).toHaveLength(5)

    const read = await tool('history_read_item')!.execute(
      { windowId: 'win-0', itemId: 'big' }, context('threadA'))
    const readOutput = read.output as {
      truncated: boolean
      nextOffset: number | null
      segments: Array<{ text: string }>
    }
    expect(readOutput.truncated).toBe(true)
    expect(readOutput.nextOffset).toBeGreaterThan(0)
    expect(Buffer.byteLength(readOutput.segments[0]!.text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
  })

  it('enforces request-side limits before doing work', async () => {
    const oversized = await tool('notes_write_file')!.execute({
      path: 'a.md', text: 'x'.repeat(16 * 1024 + 1), expectedRevision: 0
    }, context('threadA'))
    expect(oversized.isError).toBe(true)
    expect(JSON.stringify(oversized.output)).toContain('UTF-8 bytes')
    expect((await service.notes.listFilesByPrefix('threadA', {})).files).toEqual([])

    const tooWide = await tool('history_list_windows')!.execute(
      { pageSize: 101 }, context('threadA'))
    expect(tooWide.isError).toBe(true)
  })

  it('notes tools stay inside the thread-private namespace', async () => {
    const write = await tool('notes_write_file')!.execute({
      path: 'progress/log.md', text: 'step done', expectedRevision: 0
    }, context('threadA'))
    expect(write.isError).toBeUndefined()
    const escape = await tool('notes_read_file')!.execute(
      { path: '../secret.md' }, context('threadA'))
    expect(escape.isError).toBe(true)
    const absolute = await tool('notes_read_file')!.execute(
      { path: '/etc/passwd' }, context('threadA'))
    expect(absolute.isError).toBe(true)
    // Another thread cannot see the note through the trusted identity.
    const foreign = await tool('notes_read_file')!.execute(
      { path: 'progress/log.md' }, context('threadB'))
    expect(foreign.isError).toBe(true)
  })

  it('new_context defers to the injected transition and errors until wired', async () => {
    const shell = await tool('new_context')!.execute({}, context('threadA'))
    expect(shell.isError).toBe(true)
    expect(JSON.stringify(shell.output)).toContain('not available')

    const transition = vi.fn(async () => ({ output: { ok: true } }))
    const wired = buildContextWindowToolProviders({
      service, mode: () => 'windows', newContextTransition: transition
    })[0]!.tools
    const newContext = wired.find((candidate) => candidate.name === 'new_context')!
    const toolContext = context('threadA')
    const result = await newContext.execute({}, toolContext)
    expect(transition).toHaveBeenCalledWith(toolContext, {})
    expect(result.output).toEqual({ ok: true })

    mode = 'summary'
    const gatedShell = await tool('new_context')!.execute({}, context('threadA'))
    expect(gatedShell.isError).toBe(true)
  })

  it('P1-5: resolves the mode per call from the frozen turn snapshot, not the live switch', async () => {
    let live: 'summary' | 'windows' = 'windows'
    const modes = new ContextWindowTurnModes(() => live)
    // Turn A is admitted while the switch is on; turn B after it flips off.
    modes.freeze({ threadId: 'threadA', turnId: 'turn-a' })
    live = 'summary'
    modes.freeze({ threadId: 'threadB', turnId: 'turn-b' })

    const registryWired = buildContextWindowToolProviders({
      service,
      mode: (callContext) => modes.modeFor(callContext.threadId, callContext.turnId)
    })[0]!.tools
    const registryTool = (name: string) =>
      registryWired.find((candidate) => candidate.name === name)!

    // The windows turn keeps its tools even though the live switch is off...
    expect(registryTool('history_list_windows').shouldAdvertise?.(context('threadA'))).toBe(true)
    const executed = await registryTool('notes_list_files_by_prefix').execute({}, {
      ...context('threadA'),
      turnId: 'turn-a'
    })
    expect(executed.isError).toBeUndefined()

    // ...and the summary turn stays gated even if the switch flips back on.
    live = 'windows'
    expect(registryTool('history_list_windows').shouldAdvertise?.({
      ...context('threadB'),
      turnId: 'turn-b'
    })).toBe(false)
    const rejected = await registryTool('notes_read_file').execute(
      { path: 'a.md' },
      { ...context('threadB'), turnId: 'turn-b' }
    )
    expect(rejected.isError).toBe(true)

    // A thread with no snapshot at all follows live config.
    expect(registryTool('history_list_windows').shouldAdvertise?.(context('thread-live'))).toBe(true)
  })
})
