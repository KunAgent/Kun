import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalToolHost, defaultLocalTools } from '../../src/adapters/tool/local-tool-host.js'

import {
  allBuiltinToolNames,
  allToolNames,
  buildCodingBuiltinLocalTools,
  buildBuiltinLocalToolRecord,
  buildReadOnlyBuiltinLocalTools,
  createBashTool,
  createBashToolDefinition,
  createToolDefinition,
  createAllToolDefinitions,
  createAllTools,
  createEditTool,
  createEditToolDefinition,
  createFindTool,
  createFindToolDefinition,
  createGrepTool,
  createGrepToolDefinition,
  createLocalBashOperations,
  defaultFindLocalToolOperations,
  defaultGrepLocalToolOperations,
  defaultReadLocalToolOperations,
  defaultWriteLocalToolOperations,
  defaultEditLocalToolOperations,
  defaultLsLocalToolOperations,
  createBashLocalTool,
  createCodingToolDefinitions,
  createCodingTools,
  createFindLocalTool,
  createGrepLocalTool,
  createReadLocalTool,
  createReadTool,
  createReadToolDefinition,
  createReadOnlyToolDefinitions,
  createReadOnlyTools,
  createTool,
  createWriteTool,
  createWriteToolDefinition,
  createLsTool,
  createLsToolDefinition
} from '../../src/adapters/tool/builtin-tools.js'

import { createBackgroundShellTool } from '../../src/adapters/tool/background-shell-tool.js'

import {
  listBashSessionRecords,
  stopBashSessionById
} from '../../src/adapters/tool/builtin-bash-tool.js'

import { createReadTool as createReadToolFromModule } from '../../src/adapters/tool/read.js'

import { createBashTool as createBashToolFromModule } from '../../src/adapters/tool/bash.js'

import { createEditTool as createEditToolFromModule } from '../../src/adapters/tool/edit.js'

import { createFindTool as createFindToolFromModule } from '../../src/adapters/tool/find.js'

import { createGrepTool as createGrepToolFromModule } from '../../src/adapters/tool/grep.js'

import { createLsTool as createLsToolFromModule } from '../../src/adapters/tool/ls.js'

import { createWriteTool as createWriteToolFromModule } from '../../src/adapters/tool/write.js'

import { computeEditDiff } from '../../src/adapters/tool/edit-diff.js'

import { withFileMutationQueue } from '../../src/adapters/tool/file-mutation-queue.js'

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '../../src/adapters/tool/truncate.js'

import { BackgroundShellOutputWriter } from '../../src/services/background-shell-output.js'

import type { TurnItem } from '../../src/contracts/items.js'

import {
  DEFAULT_BACKGROUND_BASH_TIMEOUT_SECONDS,
  DEFAULT_BASH_TIMEOUT_SECONDS,
  type FsStats
} from '../../src/adapters/tool/builtin-tool-types.js'

import type { ToolHostContext } from '../../src/ports/tool-host.js'

function buildContext(workspace: string, overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    approvalPolicy: 'on-request',
    // These tests exercise the full builtin family; product defaults are
    // intentionally safer and are covered by policy/settings tests.
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

async function executeTool(
  host: LocalToolHost,
  workspace: string,
  toolName: string,
  args: Record<string, unknown>
) {
  const result = await host.execute(
    {
      callId: `call_${toolName}`,
      toolName,
      arguments: args
    },
    buildContext(workspace)
  )
  expect(result.item.kind).toBe('tool_result')
  if (result.item.kind !== 'tool_result') {
    throw new Error('expected tool_result')
  }
  return result.item.output as Record<string, unknown>
}

describe('Kun built-in tools', () => {

let workspace: string

let backgroundShellDataDir: string

let host: LocalToolHost

function createBackgroundBashLocalTool(
    options: Parameters<typeof createBashLocalTool>[0] = {}
  ): ReturnType<typeof createBashLocalTool> {
    return createBashLocalTool({
      ...options,
      backgroundShellDataDir
    })
  }

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-tools-'))
    backgroundShellDataDir = await mkdtemp(join(tmpdir(), 'kun-bg-shell-data-'))
    host = new LocalToolHost({ tools: defaultLocalTools })
  })

afterEach(async () => {
    const sessions = await listBashSessionRecords()
    await Promise.all(sessions.map((session) => stopBashSessionById(session.id, session.threadId)))
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    await rm(backgroundShellDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

it('coalesces slow background shell update notifications', async () => {
    let updateInFlight = 0
    let maxUpdatesInFlight = 0
    let updateCount = 0
    let resolveSettled: (() => void) | undefined
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool({
          backgroundShell: {
            onSessionUpdated: async () => {
              updateCount += 1
              updateInFlight += 1
              maxUpdatesInFlight = Math.max(maxUpdatesInFlight, updateInFlight)
              await new Promise((resolve) => setTimeout(resolve, 180))
              updateInFlight -= 1
            },
            onSessionSettled: async () => resolveSettled?.()
          }
        })
      ]
    })
    const started = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_coalesced_updates',
        toolName: 'bash',
        arguments: {
          command: "node -e \"let n = 0; const timer = setInterval(() => { process.stdout.write('x'); if (++n === 80) clearInterval(timer) }, 5)\"",
          background: true
        }
      },
      buildContext(workspace),
      async () => undefined
    )
    expect(started.item.kind).toBe('tool_result')

    await settled
    await vi.waitFor(() => expect(updateInFlight).toBe(0))
    expect(updateCount).toBeGreaterThan(0)
    expect(maxUpdatesInFlight).toBe(1)
  })

it('lists background shell sessions via background_shell', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool(),
        createBackgroundShellTool({
          listBackgroundSessions: () => [
            {
              id: 'abcd1234',
              threadId: 'thr_1',
              turnId: 'turn_1',
              command: 'sleep 10',
              cwd: workspace,
              shell: 'bash',
              status: 'running',
              startedAt: '2026-01-01T00:00:00.000Z',
              exitCode: null,
              output: 'running',
              detached: true
            }
          ]
        })
      ]
    })
    const listed = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'list',
      thread_only: false
    })
    expect(listed.running).toBe(1)
    expect((listed.sessions as Array<{ session_id?: string }>)?.[0]?.session_id).toBe('abcd1234')
  })

it('never exposes another thread\'s shell sessions when thread_only is false', async () => {
    const requestedThreadIds: Array<string | undefined> = []
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundShellTool({
          listBackgroundSessions: (threadId) => {
            requestedThreadIds.push(threadId)
            return [
              {
                id: 'owner001', threadId: 'thr_1', turnId: 'turn_1', command: 'safe', cwd: workspace,
                shell: 'bash', status: 'running' as const, startedAt: '2026-01-01T00:00:00.000Z',
                exitCode: null, output: 'owner output', detached: true
              },
              {
                id: 'other001', threadId: 'thr_2', turnId: 'turn_2', command: 'secret', cwd: '/other-workspace',
                shell: 'bash', status: 'running' as const, startedAt: '2026-01-01T00:00:00.000Z',
                exitCode: null, output: 'other output', detached: true
              }
            ].filter((session) => session.threadId === threadId)
          }
        })
      ]
    })

    const listed = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'list',
      thread_only: false,
      include_finished: true
    })

    expect(requestedThreadIds).toEqual(['thr_1'])
    expect((listed.sessions as Array<{ session_id?: string }>).map((session) => session.session_id)).toEqual(['owner001'])
  })

it('persists full background shell output to the thread record directory', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [createBackgroundBashLocalTool(), createBackgroundShellTool()]
    })
    const started = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_output_file',
        toolName: 'bash',
        arguments: {
          command: "node -e \"process.stdout.write('line-one\\n'); process.stdout.write('x'.repeat(10050))\"",
          background: true
        }
      },
      buildContext(workspace)
    )
    expect(started.item.kind).toBe('tool_result')
    if (started.item.kind !== 'tool_result') throw new Error('expected tool_result')
    const payload = started.item.output as Record<string, unknown>
    const outputFile = String(payload.output_file)
    expect(outputFile).toContain('background-shells')
    expect(outputFile.endsWith(`${String(payload.session_id)}.output`)).toBe(true)
    const completed = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'poll',
      session_id: String(payload.session_id),
      yield_seconds: 2
    })
    expect(completed.status).toBe('completed')
    const full = await readFile(outputFile, 'utf-8')
    expect(full.replace(/\r\n/g, '\n').startsWith('line-one\n')).toBe(true)
    expect([...full].length).toBeGreaterThan(10_000)
    const read = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'read',
      session_id: String(payload.session_id)
    })
    expect(String(read.output)).toContain('[background shell output truncated')
    expect(read.output_file).toBe(outputFile)
    expect(read.full_output_path).toBeUndefined()
    expect(read.truncation).toBeUndefined()
    expect(read.output_truncated).toBeUndefined()
  })

it('hides finished background shell sessions from list unless include_finished=true', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundShellTool({
          listBackgroundSessions: () => [
            {
              id: 'runng001',
              threadId: 'thr_1',
              turnId: 'turn_1',
              command: 'sleep 10',
              cwd: workspace,
              shell: 'bash',
              status: 'running',
              startedAt: '2026-01-01T00:00:00.000Z',
              exitCode: null,
              output: 'running',
              detached: true
            },
            {
              id: 'done0001',
              threadId: 'thr_1',
              turnId: 'turn_1',
              command: 'echo done',
              cwd: workspace,
              shell: 'bash',
              status: 'completed',
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:00:05.000Z',
              exitCode: 0,
              output: 'done',
              detached: true
            }
          ]
        })
      ]
    })
    const runningOnly = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'list',
      thread_only: false
    })
    expect(runningOnly.running).toBe(1)
    expect((runningOnly.sessions as Array<{ session_id?: string }>).map((s) => s.session_id)).toEqual(['runng001'])

    const withFinished = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'list',
      thread_only: false,
      include_finished: true
    })
    expect(withFinished.running).toBe(1)
    expect((withFinished.sessions as Array<{ session_id?: string }>).map((s) => s.session_id)).toEqual([
      'runng001',
      'done0001'
    ])
  })

it('includes the active shell in bash partial updates', async () => {
    const updates: TurnItem[] = []
    const result = await host.execute(
      {
        callId: 'call_bash_partial',
        toolName: 'bash',
        arguments: {
          command: 'node -e "process.stdout.write(\'partial-shell\')"'
        }
      },
      buildContext(workspace),
      (item) => {
        updates.push(item)
      }
    )

    expect(result.item.kind).toBe('tool_result')
    const partial = updates.find((item) => item.kind === 'tool_result')
    expect(partial?.kind === 'tool_result' ? (partial.output as { shell?: string }).shell : undefined).toEqual(
      expect.any(String)
    )
  })

it('rejects file paths outside the workspace root', async () => {
    const result = await host.execute(
      {
        callId: 'call_escape',
        toolName: 'read',
        arguments: { path: '../escape.txt' }
      },
      buildContext(workspace)
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'read',
      isError: true
    })
  })

it('rejects ambiguous multi-match edits like pi edit does', async () => {
    await writeFile(join(workspace, 'ambiguous.txt'), 'same\nsame\n', 'utf8')
    const result = await host.execute(
      {
        callId: 'call_edit_ambiguous',
        toolName: 'edit',
        arguments: {
          path: 'ambiguous.txt',
          oldText: 'same',
          newText: 'different'
        }
      },
      buildContext(workspace)
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'edit',
      isError: true
    })
  })

it('supports pi-style fuzzy text matching in edit', async () => {
    await writeFile(join(workspace, 'fuzzy.txt'), 'const title = “Hello World”;\n', 'utf8')
    const output = await executeTool(host, workspace, 'edit', {
      path: 'fuzzy.txt',
      oldText: 'const title = "Hello World";',
      newText: 'const title = "Hi";'
    })
    expect(output.replacements).toBe(1)
    const disk = await readFile(join(workspace, 'fuzzy.txt'), 'utf8')
    expect(disk).toContain('const title = "Hi";')
  })

it('preserves original CRLF line endings when editing', async () => {
    await writeFile(join(workspace, 'windows.txt'), 'alpha\r\nbeta\r\n', 'utf8')
    await executeTool(host, workspace, 'edit', {
      path: 'windows.txt',
      oldText: 'beta',
      newText: 'gamma'
    })
    const disk = await readFile(join(workspace, 'windows.txt'), 'utf8')
    expect(disk).toContain('\r\n')
    expect(disk).toBe('alpha\r\ngamma\r\n')
  })

it('reports pi-style read truncation hints for oversized first lines', async () => {
    const hugeLine = 'x'.repeat(DEFAULT_MAX_BYTES + 1024)
    await writeFile(join(workspace, 'huge.txt'), `${hugeLine}\nsecond line\n`, 'utf8')
    const output = await executeTool(host, workspace, 'read', {
      path: 'huge.txt'
    })
    expect(output.truncated).toBe(true)
    expect(output.first_line_exceeds_limit).toBe(true)
    expect(String(output.content)).toContain('first line exceeds')
  })

it('adds continuation guidance for user-limited reads like pi read', async () => {
    await writeFile(join(workspace, 'paged.txt'), 'one\ntwo\nthree\nfour\n', 'utf8')
    const output = await executeTool(host, workspace, 'read', {
      path: 'paged.txt',
      offset: 2,
      limit: 2
    })
    expect(output.start_line).toBe(2)
    expect(output.content).toBe('two\nthree')
    expect(output).toMatchObject({
      has_more: true,
      next_offset: 4,
      truncation_by: 'requested_limit'
    })
  })

it('allows an edit after a read window reaches EOF but omits leading lines', async () => {
    await writeFile(join(workspace, 'paged-edit.txt'), 'one\ntwo\nthree\nfour', 'utf8')
    const guardedHost = new LocalToolHost({
      tools: buildCodingBuiltinLocalTools(),
      readTracker: true
    })
    const context = buildContext(workspace)

    const read = await guardedHost.execute(
      {
        callId: 'call_read_paged_edit',
        toolName: 'read',
        arguments: { path: 'paged-edit.txt', offset: 3 }
      },
      context
    )
    expect(read.item).toMatchObject({
      kind: 'tool_result',
      isError: false,
      output: { start_line: 3, end_line: 4, total_lines: 4, truncated: false }
    })

    const edit = await guardedHost.execute(
      {
        callId: 'call_edit_paged_edit',
        toolName: 'edit',
        arguments: { path: 'paged-edit.txt', oldText: 'one', newText: 'ONE' }
      },
      context
    )
    expect(edit.item).toMatchObject({ kind: 'tool_result', isError: false })
    await expect(readFile(join(workspace, 'paged-edit.txt'), 'utf8')).resolves.toContain('ONE')
  })

it('reads supported images with pi-style structured image metadata', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02
    ])
    await writeFile(join(workspace, 'tiny.png'), png)
    const output = await executeTool(host, workspace, 'read', {
      path: 'tiny.png'
    })
    expect(output.kind).toBe('image')
    expect(output.mime_type).toBe('image/png')
    expect(output.width).toBe(1)
    expect(output.height).toBe(2)
    expect(typeof output.data_base64).toBe('string')
    expect(String(output.note)).toContain('Read image file')
  })

it('supports pi-style injected image resize handling for read', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x32
    ])
    await writeFile(join(workspace, 'resize.png'), png)
    const customRead = createReadLocalTool({
      autoResizeImages: true,
      operations: {
        resizeImage: async () => ({
          dataBase64: Buffer.from('tiny').toString('base64'),
          mimeType: 'image/png',
          width: 10,
          height: 5,
          originalWidth: 100,
          originalHeight: 50,
          wasResized: true
        })
      }
    })
    const customHost = new LocalToolHost({ tools: [customRead] })
    const output = await executeTool(customHost, workspace, 'read', { path: 'resize.png' })
    expect(output.resized).toBe(true)
    expect(output.width).toBe(10)
    expect(output.height).toBe(5)
    expect(String(output.note)).toContain('original 100x50')
  })

it('reports omitted images when injected resize fails', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ])
    await writeFile(join(workspace, 'omit.png'), png)
    const customRead = createReadLocalTool({
      autoResizeImages: true,
      operations: {
        resizeImage: async () => null
      }
    })
    const customHost = new LocalToolHost({ tools: [customRead] })
    const output = await executeTool(customHost, workspace, 'read', { path: 'omit.png' })
    expect(String(output.note)).toContain('Image omitted')
    expect(output.data_base64).toBeUndefined()
  })

it('classifies SKILL.md and AGENTS.md reads like pi resources', async () => {
    await mkdir(join(workspace, 'feature'), { recursive: true })
    await writeFile(join(workspace, 'feature', 'SKILL.md'), '# skill\n', 'utf8')
    await writeFile(join(workspace, 'AGENTS.md'), '# agents\n', 'utf8')
    const skillRead = await executeTool(host, workspace, 'read', {
      path: 'feature/SKILL.md'
    })
    const agentsRead = await executeTool(host, workspace, 'read', {
      path: 'AGENTS.md'
    })
    expect(skillRead.classification).toMatchObject({
      kind: 'skill',
      label: 'feature'
    })
    expect(agentsRead.classification).toMatchObject({
      kind: 'resource'
    })
  })

it('exposes pi-style shared edit diff helpers', async () => {
    await writeFile(join(workspace, 'preview.txt'), 'alpha\nbeta\n', 'utf8')
    const diff = await computeEditDiff('preview.txt', 'beta', 'gamma', workspace)
    expect('error' in diff).toBe(false)
    if ('error' in diff) return
    expect(diff.firstChangedLine).toBe(2)
    expect(diff.diff).toContain('+2 gamma')
  })

it('serializes same-file mutations like pi file-mutation-queue', async () => {
    const target = join(workspace, 'serial.txt')
    const order: string[] = []

    let markFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    let releaseFirst!: () => void
    const first = withFileMutationQueue(target, async () => {
      order.push('first:start')
      markFirstStarted()
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
    })

    const second = withFileMutationQueue(target, async () => {
      order.push('second:start')
      order.push('second:end')
    })

    await firstStarted
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

})
