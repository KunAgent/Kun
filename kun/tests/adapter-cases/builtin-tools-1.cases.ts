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

it('advertises the pi-style built-in tool family by default', async () => {
    const tools = await host.listTools(buildContext(workspace))
    const toolNames = new Set(tools.map((tool) => tool.name))
    expect([...allBuiltinToolNames].filter((name) => name !== 'find').every((name) => toolNames.has(name))).toBe(true)
    expect(toolNames).not.toContain('find')
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

    expect(names).toEqual(expect.arrayContaining(['read', 'grep', 'glob', 'ls']))
    expect(names).not.toContain('find')
    expect(names).not.toContain('bash')
    expect(names).not.toContain('lsp')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('write')
  })

it('advertises approved shell tools but keeps other process tools hidden in workspace-write', async () => {
    const tools = await host.listTools(buildContext(workspace, { sandboxMode: 'workspace-write' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining([
      'read',
      'grep',
      'glob',
      'ls',
      'edit',
      'write',
      'bash'
    ]))
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
    expect(String(output.hint)).toContain('ls, glob, or grep')
  })

it('requires approval before host shell execution in workspace-write sandbox mode', async () => {
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const result = await host.execute(
      {
        callId: 'call_bash',
        toolName: 'bash',
        arguments: { command: 'echo hello' }
      },
      buildContext(workspace, {
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write',
        awaitApproval
      })
    )

    expect(awaitApproval).toHaveBeenCalledOnce()
    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'bash',
      isError: false,
      output: {
        command: 'echo hello',
        exit_code: 0
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
    const requestInputTool = tools.find((tool) => tool.name === 'user_input')
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

it('keeps the canonical GUI input tool in the stable catalog without a user-input gate', async () => {
    const tools = await host.listTools(buildContext(workspace))
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('user_input')
    expect(names).not.toContain('request_user_input')
  })

it('exposes pi-style coding and read-only tool groups', () => {
    expect(buildCodingBuiltinLocalTools().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(buildReadOnlyBuiltinLocalTools().map((tool) => tool.name)).toEqual([
      'read',
      'grep',
      'glob',
      'find',
      'ls',
      'repo_map',
      'git_inspect'
    ])
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
      'git_inspect',
      'glob',
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
    expect(readOutput).toMatchObject({
      content: 'one',
      has_more: true,
      next_offset: 2,
      truncation_by: 'requested_limit'
    })
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
    expect(createReadOnlyTools().map((tool) => tool.name)).toEqual([
      'read',
      'grep',
      'glob',
      'find',
      'ls',
      'repo_map',
      'git_inspect'
    ])
    expect(createCodingToolDefinitions().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(createReadOnlyToolDefinitions().map((tool) => tool.name)).toEqual([
      'read',
      'grep',
      'glob',
      'find',
      'ls',
      'repo_map',
      'git_inspect'
    ])
    const allTools = createAllTools()
    const allDefinitions = createAllToolDefinitions()
    expect(Object.keys(allTools).sort()).toEqual([
      'bash',
      'edit',
      'find',
      'git_inspect',
      'glob',
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
      'git_inspect',
      'glob',
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
    expect(output).toMatchObject({
      content: 'a',
      has_more: true,
      next_offset: 2,
      truncation_by: 'requested_limit'
    })
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

})
