import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runAgentCommand } from './agent-cli.js'

const temporaryDirectories: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('kun run embedded runtime', () => {
  it('streams a mock provider tool call, writes the workspace, emits usage, and shuts down', async () => {
    const root = await temporaryDirectory()
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const baseUrl = await startMockProvider('result.txt')
    const stdout = writable()
    const stderr = writable()

    const code = await runAgentCommand('run', [
      '--data-dir', join(root, 'data'),
      '--workspace', workspace,
      '--api-key', 'mock-key',
      '--base-url', `${baseUrl}/v1`,
      '--model', 'mock-model',
      '--approval-policy', 'auto',
      '--sandbox-mode', 'workspace-write',
      '--jsonl',
      'Create the benchmark result file.'
    ], { stdout, stderr })

    expect(code).toBe(0)
    expect(stderr.text()).toBe('')
    expect(await readFile(join(workspace, 'result.txt'), 'utf8')).toBe('benchmark-ok\n')
    const records = jsonLines(stdout.text())
    expect(records[0]).toMatchObject({ type: 'run_started' })
    expect(records).toContainEqual(expect.objectContaining({
      type: 'runtime_event',
      event: expect.objectContaining({ kind: 'usage' })
    }))
    expect(records.at(-1)).toMatchObject({ type: 'run_finished', status: 'completed' })
  }, 20_000)

  it('preserves a failed tool result without misreporting the loop terminal status', async () => {
    const root = await temporaryDirectory()
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const baseUrl = await startMockProvider('../outside.txt')
    const stdout = writable()

    const code = await runAgentCommand('run', [
      '--data-dir', join(root, 'data'),
      '--workspace', workspace,
      '--api-key', 'mock-key',
      '--base-url', `${baseUrl}/v1`,
      '--model', 'mock-model',
      '--approval-policy', 'auto',
      '--sandbox-mode', 'workspace-write',
      '--jsonl',
      'Attempt the requested write.'
    ], { stdout, stderr: writable() })

    expect(code).toBe(0)
    const records = jsonLines(stdout.text())
    expect(records).toContainEqual(expect.objectContaining({
      type: 'runtime_event',
      event: expect.objectContaining({
        kind: 'item_created',
        item: expect.objectContaining({ kind: 'tool_result', isError: true })
      })
    }))
    expect(records.at(-1)).toMatchObject({ type: 'run_finished', status: 'completed' })
  }, 20_000)
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'kun-agent-cli-run-test-'))
  temporaryDirectories.push(path)
  return path
}

async function startMockProvider(writePath: string): Promise<string> {
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) as { messages?: Array<{ role?: string }> } : {}
    const hasToolResult = body.messages?.some((message) => message.role === 'tool') === true
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    if (hasToolResult) {
      sendEvent(response, chunk({ content: 'done' }))
      sendEvent(response, chunk({}, 'stop', usage(12, 2)))
    } else {
      sendEvent(response, chunk({
        tool_calls: [{
          index: 0,
          id: 'call_write_1',
          type: 'function',
          function: {
            name: 'write',
            arguments: JSON.stringify({ path: writePath, content: 'benchmark-ok\n' })
          }
        }]
      }))
      sendEvent(response, chunk({}, 'tool_calls', usage(10, 1)))
    }
    response.end('data: [DONE]\n\n')
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock provider did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  responseUsage?: Record<string, number>
): Record<string, unknown> {
  return {
    id: 'mock-chunk',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: finishReason }],
    ...(responseUsage ? { usage: responseUsage } : {})
  }
}

function usage(promptTokens: number, completionTokens: number): Record<string, number> {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  }
}

function sendEvent(response: import('node:http').ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
}

function writable(): { write(chunk: string): void; text(): string } {
  const chunks: string[] = []
  return {
    write: (chunk) => { chunks.push(chunk) },
    text: () => chunks.join('')
  }
}

function jsonLines(text: string): Array<Record<string, unknown>> {
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}
