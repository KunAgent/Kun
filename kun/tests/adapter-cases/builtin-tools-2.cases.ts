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

it.skipIf(process.platform === 'win32')(
    'prefers the fd backend path when a POSIX executable candidate is provided',
    async () => {
    await mkdir(join(workspace, 'notes'), { recursive: true })
    await writeFile(join(workspace, 'notes', 'demo.txt'), 'demo\n', 'utf8')
    const fdHost = new LocalToolHost({
      tools: [
        createFindLocalTool({
          fdExecutableCandidates: ['/bin/echo'],
          rgExecutableCandidates: []
        })
      ]
    })
    const output = await executeTool(fdHost, workspace, 'find', {
      pattern: '*.txt',
      path: '.'
    })
    expect(output.backend).toBe('fd')
    expect(output.matches).toHaveLength(1)
    }
  )

it('writes, reads, edits, and searches workspace files', async () => {
    const writeOutput = await executeTool(host, workspace, 'write', {
      path: 'notes/demo.txt',
      content: 'alpha\nhello world\nsecond line\nomega\n'
    })
    expect(writeOutput.path).toBe(join(workspace, 'notes/demo.txt'))

    const disk = await readFile(join(workspace, 'notes/demo.txt'), 'utf8')
    expect(disk).toContain('hello world')

    const readOutput = await executeTool(host, workspace, 'read', {
      path: 'notes/demo.txt'
    })
    expect(readOutput).toMatchObject({
      path: join(workspace, 'notes/demo.txt'),
      relative_path: 'notes/demo.txt'
    })
    expect(String(readOutput.content)).toContain('hello world')

    const editOutput = await executeTool(host, workspace, 'edit', {
      path: 'notes/demo.txt',
      edits: [
        { oldText: 'hello world', newText: 'hello kun' },
        { oldText: 'omega', newText: 'done' }
      ]
    })
    expect(editOutput.replacements).toBe(2)

    const editedDisk = await readFile(join(workspace, 'notes/demo.txt'), 'utf8')
    expect(editedDisk).toContain('hello kun')
    expect(editedDisk).toContain('done')
    expect(String(editOutput.diff)).toContain('+2 hello kun')
    expect(String(editOutput.patch)).toContain('+++ b/notes/demo.txt')
    expect(typeof editOutput.first_changed_line === 'number' || editOutput.first_changed_line === undefined).toBe(true)

    const grepOutput = await executeTool(host, workspace, 'grep', {
      pattern: 'kun',
      path: '.',
      context: 1
    })
    expect(Array.isArray(grepOutput.matches)).toBe(true)
    expect((grepOutput.matches as Array<Record<string, unknown>>)[0]?.relative_path).toBe('notes/demo.txt')
    expect(Array.isArray((grepOutput.matches as Array<Record<string, unknown>>)[0]?.context_before)).toBe(true)
    expect(['rg', 'scan']).toContain(String(grepOutput.backend))

    const findOutput = await executeTool(host, workspace, 'glob', {
      pattern: '**/*.txt',
      path: '.'
    })
    expect((findOutput.matches as Array<Record<string, unknown>>)[0]?.relative_path).toBe('notes/demo.txt')
    expect(['fd', 'rg', 'scan']).toContain(String(findOutput.backend))

    const lsOutput = await executeTool(host, workspace, 'ls', {
      path: 'notes'
    })
    expect((lsOutput.entries as Array<Record<string, unknown>>)[0]?.name).toBe('demo.txt')
    expect((lsOutput.names as Array<string>)[0]).toBe('demo.txt')
  })

it('executes bash commands in the workspace', async () => {
    await writeFile(join(workspace, 'cmd.txt'), 'from bash\n', 'utf8')
    const output = await executeTool(host, workspace, 'bash', {
      command: 'cat cmd.txt'
    })
    expect(output.command).toBe('cat cmd.txt')
    expect(typeof output.shell).toBe('string')
    expect(String(output.output)).toContain('from bash')
    expect(output.truncation).toBe(null)
  })

it('keeps Bash timeouts runtime-owned with separate foreground and background ceilings', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: 'done' }))
    const bash = createBashLocalTool({ operations: { exec } })
    const properties = bash.inputSchema.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('timeout')
    expect(DEFAULT_BASH_TIMEOUT_SECONDS).toBe(900)
    expect(DEFAULT_BACKGROUND_BASH_TIMEOUT_SECONDS).toBe(86_400)

    await executeTool(new LocalToolHost({ tools: [bash] }), workspace, 'bash', {
      command: 'echo done'
    })
    expect(exec).toHaveBeenCalledWith(
      'echo done',
      workspace,
      expect.objectContaining({ timeoutSeconds: 900 })
    )
  })

it.skipIf(process.platform === 'win32')(
    'finishes POSIX shell commands after a background child keeps stdio open',
    async () => {
    const startedAt = Date.now()
    const output = await executeTool(host, workspace, 'bash', {
      command: 'sleep 5 & echo done'
    })

    expect(output.exit_code).toBe(0)
    expect(String(output.output)).toContain('done')
    expect(Date.now() - startedAt).toBeLessThan(1500)
    }
  )

it('blocks foreground bash commands until the process exits', async () => {
    const startedAt = Date.now()
    const output = await executeTool(host, workspace, 'bash', {
      command: 'echo ready; sleep 2; echo done'
    })

    expect(output.exit_code).toBe(0)
    expect(String(output.output)).toContain('ready')
    expect(String(output.output)).toContain('done')
    expect(output.session_id).toBeUndefined()
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1800)
  })

it('returns a running background bash session and keeps running after abort', async () => {
    const hooks = {
      started: [] as string[],
      settled: [] as string[]
    }
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool({
          backgroundShell: {
            onSessionStarted: async (record) => {
              hooks.started.push(record.id)
            },
            onSessionSettled: async (record) => {
              hooks.settled.push(record.id)
            },
            isDetachedSession: (sessionId) => hooks.started.includes(sessionId)
          }
        }),
        createBackgroundShellTool()
      ]
    })
    const abortController = new AbortController()
    const output = await backgroundHost.execute(
      {
        callId: 'call_bash_background',
        toolName: 'bash',
        arguments: {
          command: 'echo bg-ready; sleep 5; echo bg-done',
          background: true
        }
      },
      buildContext(workspace, { abortSignal: abortController.signal })
    )
    expect(output.item.kind).toBe('tool_result')
    if (output.item.kind !== 'tool_result') throw new Error('expected tool_result')
    const payload = output.item.output as Record<string, unknown>
    expect(payload.status).toBe('running')
    expect(typeof payload.session_id).toBe('string')
    expect(String(payload.session_id)).toMatch(/^[a-z0-9]{8}$/)
    expect(typeof payload.output_file).toBe('string')
    expect(String(payload.output_file)).toMatch(/\.output$/)
    expect(hooks.started).toHaveLength(1)

    abortController.abort()
    const read = await backgroundHost.execute(
      {
        callId: 'call_bash_background_read',
        toolName: 'background_shell',
        arguments: {
          action: 'read',
          session_id: String(payload.session_id)
        }
      },
      buildContext(workspace)
    )
    expect(read.item.kind).toBe('tool_result')
    if (read.item.kind !== 'tool_result') throw new Error('expected tool_result')
    const readPayload = read.item.output as Record<string, unknown>
    expect(readPayload.status).toBe('running')

    await backgroundHost.execute(
      {
        callId: 'call_bash_background_stop',
        toolName: 'background_shell',
        arguments: {
          action: 'stop',
          session_id: String(payload.session_id)
        }
      },
      buildContext(workspace)
    )
    await vi.waitFor(() => {
      expect(hooks.settled.length).toBeGreaterThanOrEqual(1)
    })
  })

it('blocks background shell control in a read-only sandbox', async () => {
    let listCalls = 0
    const backgroundHost = new LocalToolHost({
      tools: [createBackgroundShellTool({
        listBackgroundSessions: () => {
          listCalls += 1
          return []
        }
      })]
    })
    const context = buildContext(workspace, { sandboxMode: 'read-only' })

    const advertised = await backgroundHost.listTools(context)
    expect(advertised.map((tool) => tool.name)).not.toContain('background_shell')

    const result = await backgroundHost.execute({
      callId: 'call_background_shell_readonly',
      toolName: 'background_shell',
      arguments: { action: 'list' }
    }, context)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'sandbox_command_blocked' }
    })
    expect(listCalls).toBe(0)
  })

it('rejects a background shell once its running-session capacity is full', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool({
          maxBackgroundSessions: 1,
          maxBackgroundSessionsPerThread: 1
        }),
        createBackgroundShellTool()
      ]
    })
    const first = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_capacity_first',
        toolName: 'bash',
        arguments: { command: 'sleep 10', background: true }
      },
      buildContext(workspace)
    )
    expect(first.item.kind).toBe('tool_result')
    if (first.item.kind !== 'tool_result') throw new Error('expected tool_result')
    const sessionId = String((first.item.output as { session_id?: string }).session_id)

    const second = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_capacity_second',
        toolName: 'bash',
        arguments: { command: 'sleep 10', background: true }
      },
      buildContext(workspace)
    )
    expect(second.item.kind).toBe('tool_result')
    if (second.item.kind !== 'tool_result') throw new Error('expected tool_result')
    expect(second.item.isError).toBe(true)
    expect(second.item.output).toMatchObject({ error: expect.stringContaining('capacity reached') })

    await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'stop',
      session_id: sessionId
    })
  })

it('rejects a background shell timeout above its configured maximum', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool({ maxBackgroundTimeoutSeconds: 1 })
      ]
    })
    const result = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_timeout_limit',
        toolName: 'bash',
        arguments: { command: 'sleep 10', background: true }
      },
      buildContext(workspace)
    )
    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') throw new Error('expected tool_result')
    expect(result.item.isError).toBe(true)
    expect(result.item.output).toMatchObject({ error: expect.stringContaining('timeout exceeds 1 seconds') })
  })

it('does not expose a background shell session to another thread', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [createBackgroundBashLocalTool(), createBackgroundShellTool()]
    })
    const started = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_thread_owner',
        toolName: 'bash',
        arguments: { command: 'sleep 10', background: true }
      },
      buildContext(workspace, { threadId: 'thr_owner' })
    )
    expect(started.item.kind).toBe('tool_result')
    if (started.item.kind !== 'tool_result') throw new Error('expected tool_result')
    const sessionId = String((started.item.output as { session_id?: string }).session_id)

    const foreignRead = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_foreign_read',
        toolName: 'background_shell',
        arguments: { action: 'read', session_id: sessionId }
      },
      buildContext(workspace, { threadId: 'thr_other' })
    )
    expect(foreignRead.item.kind).toBe('tool_result')
    if (foreignRead.item.kind !== 'tool_result') throw new Error('expected tool_result')
    expect(foreignRead.item.isError).toBe(true)
    expect(foreignRead.item.output).toMatchObject({ error: 'background shell session not found' })

    await backgroundHost.execute(
      {
        callId: 'call_bash_bg_thread_owner_stop',
        toolName: 'background_shell',
        arguments: { action: 'stop', session_id: sessionId }
      },
      buildContext(workspace, { threadId: 'thr_owner' })
    )
  })

it('polls completed background shell sessions via background_shell', async () => {
    const backgroundHost = new LocalToolHost({
      tools: [createBackgroundBashLocalTool(), createBackgroundShellTool()]
    })
    const started = await backgroundHost.execute(
      {
        callId: 'call_bash_bg_poll',
        toolName: 'bash',
        arguments: {
          command: 'echo ready; sleep 2; echo done',
          background: true
        }
      },
      buildContext(workspace)
    )
    expect(started.item.kind).toBe('tool_result')
    if (started.item.kind !== 'tool_result') throw new Error('expected tool_result')
    const sessionId = String((started.item.output as { session_id?: string }).session_id)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const polled = await executeTool(backgroundHost, workspace, 'background_shell', {
      action: 'poll',
      session_id: sessionId,
      yield_seconds: 1
    })
    expect(polled.status).toBe('completed')
    expect(polled.exit_code).toBe(0)
    expect(String(polled.output)).toContain('done')
    expect(typeof polled.output_file).toBe('string')
  })

it('orders fast background shell lifecycle hooks from start through settlement', async () => {
    const lifecycle: string[] = []
    let resolveStartEntered: (() => void) | undefined
    const startEntered = new Promise<void>((resolve) => {
      resolveStartEntered = resolve
    })
    let releaseStart: (() => void) | undefined
    const holdStart = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool({
          backgroundShell: {
            onSessionStarted: async () => {
              resolveStartEntered?.()
              await holdStart
              lifecycle.push('started')
            },
            onSessionSettled: async () => {
              lifecycle.push('settled')
            }
          }
        })
      ]
    })
    const run = backgroundHost.execute(
      {
        callId: 'call_bash_bg_lifecycle_order',
        toolName: 'bash',
        arguments: { command: 'true', background: true }
      },
      buildContext(workspace)
    )

    await startEntered
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lifecycle).toEqual([])

    releaseStart?.()
    await run
    await vi.waitFor(() => expect(lifecycle).toEqual(['started', 'settled']))
  })

it('finalizes the background output writer when a shell exits without being polled', async () => {
    const closeWriter = vi.spyOn(BackgroundShellOutputWriter.prototype, 'close')
    let resolveSettled: (() => void) | undefined
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const backgroundHost = new LocalToolHost({
      tools: [
        createBackgroundBashLocalTool({
          backgroundShell: {
            onSessionSettled: async () => resolveSettled?.()
          }
        })
      ]
    })
    try {
      const started = await backgroundHost.execute(
        {
          callId: 'call_bash_bg_finalize_on_exit',
          toolName: 'bash',
          arguments: {
            command: "node -e \"setTimeout(() => process.stdout.write('closed-without-poll'), 10)\"",
            background: true
          }
        },
        buildContext(workspace)
      )
      expect(started.item.kind).toBe('tool_result')
      if (started.item.kind !== 'tool_result') throw new Error('expected tool_result')
      const outputFile = String((started.item.output as { output_file?: string }).output_file)

      await settled
      await vi.waitFor(() => expect(closeWriter).toHaveBeenCalled())
      await expect(readFile(outputFile, 'utf-8')).resolves.toContain('closed-without-poll')
    } finally {
      closeWriter.mockRestore()
    }
  })

})
