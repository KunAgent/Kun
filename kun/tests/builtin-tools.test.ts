import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalToolHost, defaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
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
} from '../src/adapters/tool/builtin-tools.js'
import { createBackgroundShellTool } from '../src/adapters/tool/background-shell-tool.js'
import { createReadTool as createReadToolFromModule } from '../src/adapters/tool/read.js'
import { createBashTool as createBashToolFromModule } from '../src/adapters/tool/bash.js'
import { createEditTool as createEditToolFromModule } from '../src/adapters/tool/edit.js'
import { createFindTool as createFindToolFromModule } from '../src/adapters/tool/find.js'
import { createGrepTool as createGrepToolFromModule } from '../src/adapters/tool/grep.js'
import { createLsTool as createLsToolFromModule } from '../src/adapters/tool/ls.js'
import { createWriteTool as createWriteToolFromModule } from '../src/adapters/tool/write.js'
import { computeEditDiff } from '../src/adapters/tool/edit-diff.js'
import { withFileMutationQueue } from '../src/adapters/tool/file-mutation-queue.js'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '../src/adapters/tool/truncate.js'
import { BackgroundShellOutputWriter } from '../src/services/background-shell-output.js'
import type { TurnItem } from '../src/contracts/items.js'
import type { FsStats } from '../src/adapters/tool/builtin-tool-types.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

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
    await rm(workspace, { recursive: true, force: true })
    await rm(backgroundShellDataDir, { recursive: true, force: true })
  })

  it('advertises the pi-style built-in tool family by default', async () => {
    const tools = await host.listTools(buildContext(workspace))
    const toolNames = new Set(tools.map((tool) => tool.name))
    expect([...allBuiltinToolNames].every((name) => toolNames.has(name))).toBe(true)
  })

  it('uses 500kb and 20000 lines as the default tool output caps', () => {
    expect(DEFAULT_MAX_BYTES).toBe(500 * 1024)
    expect(DEFAULT_MAX_LINES).toBe(20_000)
  })

  it('converts a throwing tool execute into an error tool result instead of failing the turn', async () => {
    const explosive = LocalToolHost.defineTool({
      name: 'explode',
      description: 'always throws',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => {
        throw new Error('MCP error -32603: Validation Error: Validation Failed')
      }
    })
    const throwingHost = new LocalToolHost({ tools: [explosive] })

    const result = await throwingHost.execute(
      { callId: 'call_explode', toolName: 'explode', arguments: {} },
      buildContext(workspace)
    )

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') throw new Error('expected tool_result')
    expect(result.item.isError).toBe(true)
    expect(result.item.output).toMatchObject({
      code: 'tool_execution_failed',
      error: expect.stringContaining('-32603')
    })
  })

  it('still propagates aborts raised while a tool executes', async () => {
    const abortController = new AbortController()
    const abortingTool = LocalToolHost.defineTool({
      name: 'abort_self',
      description: 'aborts mid-flight',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => {
        abortController.abort()
        throw new Error('aborted mid tool')
      }
    })
    const abortHost = new LocalToolHost({ tools: [abortingTool] })

    await expect(
      abortHost.execute(
        { callId: 'call_abort', toolName: 'abort_self', arguments: {} },
        buildContext(workspace, { abortSignal: abortController.signal })
      )
    ).rejects.toThrow('aborted mid tool')
  })

  it('hides mutating and shell tools in read-only sandbox mode', async () => {
    const tools = await host.listTools(buildContext(workspace, { sandboxMode: 'read-only' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls']))
    expect(names).not.toContain('bash')
    expect(names).not.toContain('lsp')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('write')
  })

  it('allows file tools but hides host shell commands in workspace-write sandbox mode', async () => {
    const tools = await host.listTools(buildContext(workspace, { sandboxMode: 'workspace-write' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls', 'edit', 'write']))
    expect(names).not.toContain('bash')
    expect(names).not.toContain('lsp')
  })

  it('blocks direct file writes in read-only sandbox mode', async () => {
    const result = await host.execute(
      {
        callId: 'call_write',
        toolName: 'write',
        arguments: { path: 'blocked.md', content: 'nope' }
      },
      buildContext(workspace, { sandboxMode: 'read-only' })
    )

    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'write',
      isError: true,
      output: {
        code: 'sandbox_read_only'
      }
    })
    await expect(readFile(join(workspace, 'blocked.md'), 'utf8')).rejects.toThrow()
  })

  it('answers truncated tool arguments with actionable chunking guidance', async () => {
    // tool-argument-repair wraps unparseable JSON (usually cut off by the
    // model output limit mid-payload) as { __raw }.
    const truncated = '{"content": "<!DOCTYPE html><html><body>cut off mid stri'
    const writeResult = await host.execute(
      {
        callId: 'call_write_raw',
        toolName: 'write',
        arguments: { __raw: truncated }
      },
      buildContext(workspace)
    )
    expect(writeResult.item).toMatchObject({ kind: 'tool_result', isError: true })
    const writeError = String((writeResult.item as { output?: { error?: string } }).output?.error)
    expect(writeError).toContain('truncated')
    expect(writeError).toContain('smaller')

    const editResult = await host.execute(
      {
        callId: 'call_edit_raw',
        toolName: 'edit',
        arguments: { __raw: truncated }
      },
      buildContext(workspace)
    )
    expect(editResult.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(String((editResult.item as { output?: { error?: string } }).output?.error)).toContain('truncated')
  })

  it('gives recovery guidance when read is called without a path', async () => {
    const result = await host.execute(
      {
        callId: 'call_read_missing_path',
        toolName: 'read',
        arguments: {}
      },
      buildContext(workspace)
    )

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'read',
      isError: true,
      output: {
        code: 'missing_path',
        error: 'path is required',
        expected_argument: { path: 'relative/path/from/workspace' }
      }
    })
    const output = result.item.kind === 'tool_result'
      ? result.item.output as { hint?: string }
      : {}
    expect(String(output.hint)).toContain('ls, find, or grep')
  })

  it('blocks host shell execution in workspace-write sandbox mode', async () => {
    const result = await host.execute(
      {
        callId: 'call_bash',
        toolName: 'bash',
        arguments: { command: 'echo hello' }
      },
      buildContext(workspace, { sandboxMode: 'workspace-write' })
    )

    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'bash',
      isError: true,
      output: {
        code: 'sandbox_command_blocked'
      }
    })
  })

  it('blocks language-server process startup in a read-only sandbox', async () => {
    const result = await host.execute(
      {
        callId: 'call_lsp',
        toolName: 'lsp',
        arguments: { operation: 'getDiagnostics', filePath: 'app.ts' }
      },
      buildContext(workspace, { sandboxMode: 'read-only' })
    )

    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'lsp',
      isError: true,
      output: { code: 'sandbox_command_blocked' }
    })
  })

  it('advertises structured GUI input choices and normalizes single-question options', async () => {
    const tools = await host.listTools(
      buildContext(workspace, { awaitUserInput: async () => ({ status: 'cancelled' }) })
    )
    const requestInputTool = tools.find((tool) => tool.name === 'request_user_input')
    expect(requestInputTool?.inputSchema).toMatchObject({
      properties: {
        options: { type: 'array' },
        questions: { type: 'array' }
      }
    })

    const seenInputs: Array<{ questions: Array<{ options: Array<{ label: string; description: string }> }> }> = []
    const result = await host.execute(
      {
        callId: 'call_input',
        toolName: 'request_user_input',
        arguments: {
          prompt: 'Pick a direction',
          question: 'North or south?',
          options: ['South', { label: 'North', description: 'Cooler weather' }]
        }
      },
      {
        ...buildContext(workspace),
        awaitUserInput: async (input) => {
          seenInputs.push(input)
          return {
            status: 'submitted',
            answers: [{ id: input.questions[0]?.id ?? 'choice', label: 'South', value: 'South' }]
          }
        }
      }
    )

    expect(seenInputs[0]?.questions[0]?.options).toEqual([
      { label: 'South', description: '' },
      { label: 'North', description: 'Cooler weather' }
    ])
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'request_user_input',
      isError: false
    })
  })

  it('keeps GUI input tools in the stable catalog without a user-input gate', async () => {
    const tools = await host.listTools(buildContext(workspace))
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('user_input')
    expect(names).toContain('request_user_input')
  })

  it('exposes pi-style coding and read-only tool groups', () => {
    expect(buildCodingBuiltinLocalTools().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(buildReadOnlyBuiltinLocalTools().map((tool) => tool.name)).toEqual(['read', 'grep', 'find', 'ls', 'repo_map'])
  })

  it('supports pi-style configurable built-in tool factory APIs', async () => {
    const toolRecord = buildBuiltinLocalToolRecord({
      read: { maxLines: 1 },
      grep: { defaultLimit: 1 },
      find: { defaultLimit: 1 },
      ls: { defaultLimit: 1 },
      bash: { defaultTimeoutSeconds: 5, maxLines: 1, maxBytes: 64 }
    })
    expect(Object.keys(toolRecord).sort()).toEqual([
      'bash',
      'edit',
      'find',
      'grep',
      'ls',
      'lsp',
      'read',
      'repo_map',
      'send_im_attachment',
      'verify_changes',
      'write'
    ])

    await writeFile(join(workspace, 'limited.txt'), 'one\ntwo\nthree\n', 'utf8')
    const customHost = new LocalToolHost({ tools: [toolRecord.read, toolRecord.ls] })
    const readOutput = await executeTool(customHost, workspace, 'read', { path: 'limited.txt' })
    expect(String(readOutput.content)).toContain('Use offset=2 to continue')
  })

  it('exposes pi-style alias composition helpers and tool-name set', async () => {
    expect(allToolNames).toBe(allBuiltinToolNames)
    expect(defaultReadLocalToolOperations.readFile).toBeTypeOf('function')
    expect(defaultWriteLocalToolOperations.writeFile).toBeTypeOf('function')
    expect(defaultEditLocalToolOperations.readFile).toBeTypeOf('function')
    expect(defaultFindLocalToolOperations).toEqual({})
    expect(defaultGrepLocalToolOperations).toEqual({})
    expect(defaultLsLocalToolOperations.readdir).toBeTypeOf('function')
    expect(createCodingTools().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(createReadOnlyTools().map((tool) => tool.name)).toEqual(['read', 'grep', 'find', 'ls', 'repo_map'])
    expect(createCodingToolDefinitions().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(createReadOnlyToolDefinitions().map((tool) => tool.name)).toEqual(['read', 'grep', 'find', 'ls', 'repo_map'])
    const allTools = createAllTools()
    const allDefinitions = createAllToolDefinitions()
    expect(Object.keys(allTools).sort()).toEqual([
      'bash',
      'edit',
      'find',
      'grep',
      'ls',
      'lsp',
      'read',
      'repo_map',
      'send_im_attachment',
      'verify_changes',
      'write'
    ])
    expect(Object.keys(allDefinitions).sort()).toEqual([
      'bash',
      'edit',
      'find',
      'grep',
      'ls',
      'lsp',
      'read',
      'repo_map',
      'send_im_attachment',
      'verify_changes',
      'write'
    ])
    expect(createReadTool).toBe(createReadLocalTool)
    expect(createReadToolDefinition).toBe(createReadLocalTool)
    expect(createWriteTool).toBeTypeOf('function')
    expect(createWriteToolDefinition).toBeTypeOf('function')
    expect(createEditTool).toBeTypeOf('function')
    expect(createEditToolDefinition).toBeTypeOf('function')
    expect(createFindTool).toBeTypeOf('function')
    expect(createFindToolDefinition).toBeTypeOf('function')
    expect(createGrepTool).toBeTypeOf('function')
    expect(createGrepToolDefinition).toBeTypeOf('function')
    expect(createLsTool).toBeTypeOf('function')
    expect(createLsToolDefinition).toBeTypeOf('function')
    expect(createBashTool).toBeTypeOf('function')
    expect(createBashToolDefinition).toBeTypeOf('function')
    expect(createReadToolFromModule).toBe(createReadTool)
    expect(createBashToolFromModule).toBe(createBashTool)
    expect(createEditToolFromModule).toBe(createEditTool)
    expect(createFindToolFromModule).toBe(createFindTool)
    expect(createGrepToolFromModule).toBe(createGrepTool)
    expect(createLsToolFromModule).toBe(createLsTool)
    expect(createWriteToolFromModule).toBe(createWriteTool)

    const singleToolHost = new LocalToolHost({
      tools: [
        createTool('read', { read: { maxLines: 1 } }),
        createToolDefinition('ls', { ls: { defaultLimit: 1 } })
      ]
    })
    await writeFile(join(workspace, 'alias.txt'), 'a\nb\n', 'utf8')
    const output = await executeTool(singleToolHost, workspace, 'read', { path: 'alias.txt' })
    expect(String(output.content)).toContain('Use offset=2 to continue')
  })

  it('supports injected backend operations like pi tool factories', async () => {
    const customRead = createReadLocalTool({
      operations: {
        stat: async (): Promise<FsStats> =>
          ({
            isDirectory: () => false
          } as FsStats),
        readFile: async () => Buffer.from('virtual file\n', 'utf8')
      }
    })
    const customFind = createFindLocalTool({
      operations: {
        glob: async () => [{ path: '/virtual/demo.ts', relative_path: 'demo.ts' }]
      }
    })
    const customGrep = createGrepLocalTool({
      operations: {
        search: async () => [
          {
            path: '/virtual/demo.ts',
            relative_path: 'demo.ts',
            line: 1,
            column: 1,
            text: 'needle'
          }
        ]
      }
    })
    const customBash = createBashLocalTool({
      maxLines: 1,
      operations: {
        exec: async (_command, _cwd, options) => {
          options.onData?.(Buffer.from('first custom bash line\nstreamed from custom bash\n'))
          return { exitCode: 0 }
        }
      }
    })
    const customHost = new LocalToolHost({
      tools: [customRead, customFind, customGrep, customBash]
    })
    const readOutput = await executeTool(customHost, workspace, 'read', { path: 'virtual.txt' })
    expect(String(readOutput.content)).toContain('virtual file')
    const findOutput = await executeTool(customHost, workspace, 'find', { pattern: '*.ts' })
    expect(findOutput.backend).toBe('custom')
    const grepOutput = await executeTool(customHost, workspace, 'grep', { pattern: 'needle' })
    expect(grepOutput.backend).toBe('custom')
    const bashOutput = await executeTool(customHost, workspace, 'bash', { command: 'echo ignored' })
    expect(String(bashOutput.output)).toContain('streamed from custom bash')
    expect(String(bashOutput.output)).not.toContain('first custom bash line')
    expect(bashOutput.truncation).toMatchObject({ total_lines: 2, output_lines: 1 })
  })

  it('exposes a reusable local bash backend constructor like pi', async () => {
    await writeFile(join(workspace, 'local-bash.txt'), 'hello local bash\n', 'utf8')
    const hostWithLocalBash = new LocalToolHost({
      tools: [
        createBashLocalTool({
          operations: createLocalBashOperations()
        })
      ]
    })
    const output = await executeTool(hostWithLocalBash, workspace, 'bash', {
      command: 'cat local-bash.txt'
    })
    expect(String(output.output)).toContain('hello local bash')
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

    const findOutput = await executeTool(host, workspace, 'find', {
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

  it.skipIf(process.platform === 'win32')(
    'finishes POSIX shell commands after a background child keeps stdio open',
    async () => {
    const startedAt = Date.now()
    const output = await executeTool(host, workspace, 'bash', {
      command: 'sleep 5 & echo done',
      timeout: 2
    })

    expect(output.exit_code).toBe(0)
    expect(String(output.output)).toContain('done')
    expect(Date.now() - startedAt).toBeLessThan(1500)
    }
  )

  it('blocks foreground bash commands until the process exits', async () => {
    const startedAt = Date.now()
    const output = await executeTool(host, workspace, 'bash', {
      command: 'echo ready; sleep 2; echo done',
      timeout: 10
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
          background: true,
          timeout: 10
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
        arguments: { command: 'sleep 10', background: true, timeout: 10 }
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
        arguments: { command: 'sleep 10', background: true, timeout: 10 }
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
        arguments: { command: 'sleep 10', background: true, timeout: 2 }
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
        arguments: { command: 'sleep 10', background: true, timeout: 10 }
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
          background: true,
          timeout: 10
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
        arguments: { command: 'true', background: true, timeout: 10 }
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
            background: true,
            timeout: 10
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
          background: true,
          timeout: 10
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
          background: true,
          timeout: 10
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
    expect(String(output.content)).toContain('Use offset=4 to continue')
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

  it('persists a full bash output file when truncated', async () => {
    const output = await executeTool(host, workspace, 'bash', {
      command: "node -e \"for (let i = 0; i < 8000; i++) console.log('line-' + i)\""
    })
    expect(output.full_output_path === null || typeof output.full_output_path === 'string').toBe(true)
    expect(output.truncation === null || typeof output.truncation === 'object').toBe(true)
    if (output.truncation) {
      expect(output.full_output_path).not.toBe(null)
      expect(String(output.output)).toContain('truncated')
    }
  })
})
