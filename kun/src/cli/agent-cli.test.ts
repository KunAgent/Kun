import { Readable } from 'node:stream'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { KUN_CLI_USAGE, MAX_RUN_PROMPT_BYTES, runAgentCommand, splitKunCliCommand } from './agent-cli.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Kun CLI TUI dispatch', () => {
  it('uses the TUI by default and requires explicit serve mode', () => {
    expect(splitKunCliCommand([])).toEqual({ command: 'tui', args: [] })
    expect(splitKunCliCommand(['tui', '--continue'])).toEqual({ command: 'tui', args: ['--continue'] })
    expect(splitKunCliCommand(['chat'])).toEqual({ command: 'chat', args: [] })
    expect(splitKunCliCommand(['--continue'])).toEqual({ command: 'tui', args: ['--continue'] })
    expect(splitKunCliCommand(['--graph', 'implement the board'])).toEqual({
      command: 'tui',
      args: ['--graph', 'implement the board']
    })
    expect(splitKunCliCommand(['-graph', 'implement the board'])).toEqual({
      command: 'tui',
      args: ['-graph', 'implement the board']
    })
    expect(splitKunCliCommand(['serve', '--port', '18899'])).toEqual({ command: 'serve', args: ['--port', '18899'] })
    expect(splitKunCliCommand(['runtime', 'status'])).toEqual({ command: 'runtime', args: ['status'] })
    expect(splitKunCliCommand(['update', '--check'])).toEqual({ command: 'update', args: ['--check'] })
    expect(KUN_CLI_USAGE).toContain('tui [options]')
    expect(KUN_CLI_USAGE).toContain('update [--check|--yes]')
  })
})

describe('Kun one-shot CLI', () => {
  it('reads a UTF-8 prompt file and forwards benchmark controls', async () => {
    const root = await temporaryDirectory()
    const promptPath = join(root, 'prompt.txt')
    await writeFile(promptPath, 'Implement the requested fix.\n', 'utf8')
    const harness = fakeRuntime()
    const output = writable()
    const error = writable()
    let runtimeOptions: unknown

    const code = await runAgentCommand('run', [
      '--data-dir', join(root, 'data'),
      '--workspace', root,
      '--prompt-file', promptPath,
      '--reasoning-effort', 'max',
      '--service-tier', 'priority',
      '--max-steps', '40',
      '--max-wall-time-ms', '120000',
      '--max-tool-calls-per-step', '8',
      '--jsonl'
    ], {
      stdout: output,
      stderr: error,
      createRuntime: async (options) => {
        runtimeOptions = options
        return harness.runtime
      }
    })

    expect(code).toBe(0)
    expect(error.text()).toBe('')
    expect(harness.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        prompt: 'Implement the requested fix.\n',
        clientSurface: 'cli',
        disableUserInput: true,
        reasoningEffort: 'max',
        serviceTier: 'priority'
      })
    }))
    expect(runtimeOptions).toMatchObject({
      runtime: {
        turnLimits: {
          maxSteps: 40,
          maxWallTimeMs: 120000,
          maxToolCallsPerStep: 8
        }
      }
    })
    expect(output.text()).toContain('"type":"run_started"')
    expect(output.text()).toContain('"kind":"usage"')
    expect(output.text()).toContain('"type":"run_finished"')
    expect(harness.shutdown).toHaveBeenCalledOnce()
  })

  it('reads stdin with --prompt-file -', async () => {
    const root = await temporaryDirectory()
    const harness = fakeRuntime()
    const code = await runAgentCommand('run', [
      '--data-dir', join(root, 'data'), '--workspace', root, '--prompt-file', '-', '--json'
    ], {
      stdin: Readable.from(['stdin benchmark prompt']),
      stdout: writable(),
      stderr: writable(),
      createRuntime: async () => harness.runtime
    })

    expect(code).toBe(0)
    expect(harness.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ prompt: 'stdin benchmark prompt' })
    }))
  })

  it('rejects conflicting and oversized prompt sources before runtime creation', async () => {
    const root = await temporaryDirectory()
    const createRuntime = vi.fn()
    const conflictError = writable()
    const conflict = await runAgentCommand('run', [
      '--data-dir', root, '--prompt-file', '-', 'positional prompt'
    ], {
      stdin: Readable.from(['file prompt']), stdout: writable(), stderr: conflictError, createRuntime
    })
    expect(conflict).toBe(64)
    expect(conflictError.text()).toContain('mutually exclusive')

    const sizeError = writable()
    const oversized = await runAgentCommand('run', [
      '--data-dir', root, '--prompt-file', '-'
    ], {
      stdin: Readable.from([Buffer.alloc(MAX_RUN_PROMPT_BYTES + 1, 0x61)]),
      stdout: writable(), stderr: sizeError, createRuntime
    })
    expect(oversized).toBe(78)
    expect(sizeError.text()).toContain('prompt exceeds')
    expect(createRuntime).not.toHaveBeenCalled()
  })

  it('rejects invalid UTF-8 and invalid run controls', async () => {
    const root = await temporaryDirectory()
    const utf8Error = writable()
    expect(await runAgentCommand('run', [
      '--data-dir', root, '--prompt-file', '-'
    ], {
      stdin: Readable.from([Buffer.from([0xff])]), stdout: writable(), stderr: utf8Error,
      createRuntime: vi.fn()
    })).toBe(78)
    expect(utf8Error.text()).toContain('valid UTF-8')

    const limitError = writable()
    expect(await runAgentCommand('run', [
      '--data-dir', root, '--max-steps', '0', 'prompt'
    ], { stdout: writable(), stderr: limitError, createRuntime: vi.fn() })).toBe(64)
    expect(limitError.text()).toContain('positive integer')
  })

  it('does not include endpoint-format values in a positional prompt', async () => {
    const root = await temporaryDirectory()
    const harness = fakeRuntime()
    const code = await runAgentCommand('run', [
      '--data-dir', root,
      '--endpoint-format', 'openai-chat-completions',
      'actual', 'prompt'
    ], { stdout: writable(), stderr: writable(), createRuntime: async () => harness.runtime })

    expect(code).toBe(0)
    expect(harness.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ prompt: 'actual prompt' })
    }))
  })

  it('emits a failed terminal status and returns a runtime exit code', async () => {
    const root = await temporaryDirectory()
    const harness = fakeRuntime('failed')
    const output = writable()
    const code = await runAgentCommand('run', [
      '--data-dir', root, '--jsonl', 'failing prompt'
    ], { stdout: output, stderr: writable(), createRuntime: async () => harness.runtime })

    expect(code).toBe(70)
    expect(output.text()).toContain('"status":"failed"')
    expect(harness.shutdown).toHaveBeenCalledOnce()
  })
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'kun-agent-cli-test-'))
  temporaryDirectories.push(path)
  return path
}

function writable(): { write(chunk: string): void; text(): string } {
  const chunks: string[] = []
  return {
    write: (chunk) => { chunks.push(chunk) },
    text: () => chunks.join('')
  }
}

function fakeRuntime(status: 'completed' | 'failed' = 'completed'): {
  runtime: ServerRuntime
  startTurn: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
} {
  let listener: ((event: RuntimeEvent) => void) | undefined
  const startTurn = vi.fn(async () => ({
    threadId: 'thr_cli', turnId: 'turn_cli', userMessageItemId: 'item_user'
  }))
  const shutdown = vi.fn(async () => undefined)
  const usage: RuntimeEvent = {
    seq: 1,
    timestamp: '2026-08-20T00:00:00.000Z',
    threadId: 'thr_cli',
    turnId: 'turn_cli',
    kind: 'usage',
    model: 'test-model',
    usage: {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cacheHitRate: null,
      turns: 1
    }
  }
  const runtime = {
    threadService: {
      create: vi.fn(async () => ({ id: 'thr_cli' }))
    },
    turnService: { startTurn },
    eventBus: {
      subscribe: vi.fn((_threadId: string, callback: (event: RuntimeEvent) => void) => {
        listener = callback
        return () => { listener = undefined }
      })
    },
    sessionStore: { loadItems: vi.fn(async () => []) },
    runTurn: vi.fn(async () => {
      listener?.(usage)
      return status
    }),
    shutdown
  } as unknown as ServerRuntime
  return { runtime, startTurn, shutdown }
}
