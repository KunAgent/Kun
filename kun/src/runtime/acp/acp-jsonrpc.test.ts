import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { AcpError } from './acp-schema.js'
import { AcpJsonRpc, type AcpDebugLog } from './acp-jsonrpc.js'
import { startAcpProcess, type AcpProcess } from './acp-process.js'

const FIXTURE_AGENT = fileURLToPath(
  new URL('./__fixtures__/fake-acp-agent.mjs', import.meta.url)
)
const SCENARIOS = fileURLToPath(
  new URL('./__fixtures__/scenarios/', import.meta.url)
)

type Loopback = {
  rpc: AcpJsonRpc
  toAgent: PassThrough
  fromAgent: PassThrough
  nextFrame(): Promise<Record<string, unknown>>
  push(frame: unknown): void
  pushRaw(text: string): void
}

function makeLoopback(
  options: { maxLineBytes?: number; debug?: AcpDebugLog } = {}
): Loopback {
  const toAgent = new PassThrough()
  const fromAgent = new PassThrough()
  const rpc = new AcpJsonRpc({ stdin: toAgent, stdout: fromAgent, ...options })

  const queue: string[] = []
  const waiters: Array<() => void> = []
  let buffer = ''
  toAgent.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    for (;;) {
      const index = buffer.indexOf('\n')
      if (index < 0) break
      queue.push(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
    }
    for (const wake of waiters.splice(0)) wake()
  })

  return {
    rpc,
    toAgent,
    fromAgent,
    async nextFrame(): Promise<Record<string, unknown>> {
      for (;;) {
        const line = queue.shift()
        if (line !== undefined) return JSON.parse(line)
        await Promise.race([
          new Promise<void>((wake) => waiters.push(wake)),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('timed out waiting for frame')), 5_000)
          )
        ])
      }
    },
    push(frame: unknown) {
      fromAgent.write(JSON.stringify(frame) + '\n')
    },
    pushRaw(text: string) {
      fromAgent.write(text)
    }
  }
}

const spawned: AcpProcess[] = []
afterEach(async () => {
  for (const proc of spawned.splice(0)) {
    proc.child.kill('SIGKILL')
    await proc.exit.catch(() => undefined)
  }
})

async function spawnFixture(scenarioFile: string, extraEnv: Record<string, string> = {}) {
  const proc = await startAcpProcess({
    command: process.execPath,
    args: [FIXTURE_AGENT],
    env: { FAKE_ACP_SCENARIO: join(SCENARIOS, scenarioFile), ...extraEnv },
    spawn: async (command, args, options) =>
      spawn(command, [...args], {
        env: options.env as NodeJS.ProcessEnv,
        cwd: options.cwd,
        stdio: options.stdio as ['pipe', 'pipe', 'pipe']
      })
  })
  spawned.push(proc)
  return proc
}

describe('AcpJsonRpc', () => {
  test('routes 10 concurrent responses to the right callers', async () => {
    const { rpc, nextFrame, push } = makeLoopback()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const request = rpc.request<{ echo: number }>('test/echo', { i })
        return { i, request }
      })
        // Drive the agent side after all requests are queued.
        .map((entry) => entry)
    )
    expect(results).toHaveLength(10)

    // Agent: read every request, then answer in reverse order.
    const inbound: Array<{ id: number; params: { i: number } }> = []
    for (let n = 0; n < 10; n++) {
      const frame = (await nextFrame()) as { id: number; method: string; params: { i: number } }
      expect(frame.method).toBe('test/echo')
      inbound.push(frame)
    }
    for (const frame of [...inbound].reverse()) {
      push({ jsonrpc: '2.0', id: frame.id, result: { echo: frame.params.i } })
    }
    for (const { i, request } of results) {
      await expect(request).resolves.toEqual({ echo: i })
    }
    rpc.close()
  })

  test('agent-initiated requests hit the registered handler and answer under the same id', async () => {
    const { rpc, nextFrame, push } = makeLoopback()
    let seen: unknown
    rpc.onRequest('session/request_permission', async (params) => {
      seen = params
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    push({
      jsonrpc: '2.0',
      id: 'agent-call-9',
      method: 'session/request_permission',
      params: { sessionId: 's1', toolCall: { toolCallId: 't1' }, options: [] }
    })
    const reply = await nextFrame()
    expect(reply.id).toBe('agent-call-9')
    expect(reply.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    expect((seen as { sessionId: string }).sessionId).toBe('s1')
    rpc.close()
  })

  test('agent requests to undeclared client methods get JSON-RPC method-not-found', async () => {
    const { rpc, nextFrame, push } = makeLoopback()
    push({ jsonrpc: '2.0', id: 42, method: 'terminal/dance', params: {} })
    const reply = await nextFrame()
    expect(reply.id).toBe(42)
    expect((reply.error as { code: number }).code).toBe(-32601)
    rpc.close()
  })

  test('frames half-lines and coalesced packets correctly', async () => {
    const { rpc, nextFrame, pushRaw } = makeLoopback()
    const first = rpc.request('one')
    const second = rpc.request('two')
    await nextFrame()
    await nextFrame()

    // Half line first: no response can match until the '\n' arrives.
    const half = '{"jsonrpc":"2.0","id":1,"result":{"part":"a'
    pushRaw(half)
    const tail = '"}}\n'
    pushRaw(tail)
    await expect(first).resolves.toEqual({ part: 'a' })

    // Two responses coalesced into a single write.
    pushRaw(
      '{"jsonrpc":"2.0","id":2,"result":{"part":"b"}}\n{"jsonrpc":"2.0","method":"note/ping","params":{}}\n'
    )
    await expect(second).resolves.toEqual({ part: 'b' })
    rpc.close()
  })

  test('an oversized line closes the connection with harness_protocol_error', async () => {
    const { rpc, pushRaw } = makeLoopback({ maxLineBytes: 1_024 })
    const hanging = rpc.request('never')
    expect.assertions(4)
    const closed = new Promise<AcpError>((resolve) => rpc.onClose(resolve))
    pushRaw('{"big":"' + 'x'.repeat(2_048))
    const error = await closed
    expect(error.code).toBe('harness_protocol_error')
    expect(error.message).toContain('8 MiB')
    await expect(hanging).rejects.toMatchObject({ code: 'harness_protocol_error' })
    expect(rpc.closed).toBe(true)
  })

  test('a timed-out request leaves the pending map and its late response is dropped', async () => {
    const debug: string[] = []
    const { rpc, push } = makeLoopback({
      debug: (entry) => debug.push(`${entry.direction}:${entry.summary}`)
    })
    const timedOut = rpc.request('slow', undefined, { timeoutMs: 25 })
    await expect(timedOut).rejects.toMatchObject({ code: 'request_timeout' })
    push({ jsonrpc: '2.0', id: 1, result: { too: 'late' } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(debug.some((line) => line.includes('unknown/expired request id'))).toBe(true)
    rpc.close()
  })

  test('a malformed line fails the connection as a protocol error', async () => {
    const { rpc, pushRaw } = makeLoopback()
    const hanging = rpc.request('never')
    pushRaw('{"jsonrpc":"2.0", not json}\n')
    await expect(hanging).rejects.toMatchObject({ code: 'harness_protocol_error' })
  })
})

describe('AcpProcess', () => {
  test('process exit rejects every pending request with a sanitized stderr tail', async () => {
    const proc = await spawnFixture('crash.json')
    const rpc = new AcpJsonRpc({
      stdin: proc.stdin!,
      stdout: proc.stdout!,
      stderrTail: () => proc.sanitizedStderrTail(),
      exitPromise: proc.exit
    })
    const pending = rpc.request('session/prompt', {
      sessionId: 'sess-crash',
      prompt: [{ type: 'text', text: 'boom' }]
    })
    await expect(pending).rejects.toMatchObject({ code: 'harness_crashed' })
    const failure = (await pending.catch((error: unknown) => error)) as AcpError
    expect(failure.message).toContain('code 7')
    expect(failure.message).toContain('[redacted]')
    expect(failure.message).not.toContain('sk-testsecret123456789')
  })

  test('spawn env strips credential denylist keys but keeps launch env', async () => {
    let capturedEnv: Record<string, string | undefined> | undefined
    const proc = await startAcpProcess({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      env: { MY_FLAG: '1' },
      stripEnv: ['EXTRA_SECRET'],
      spawn: async (command, args, options) => {
        capturedEnv = options.env as Record<string, string | undefined>
        return spawn(command, [...args], {
          env: options.env as NodeJS.ProcessEnv,
          stdio: options.stdio as ['pipe', 'pipe', 'pipe']
        })
      }
    })
    spawned.push(proc)
    await proc.exit
    expect(capturedEnv?.MY_FLAG).toBe('1')
    expect(capturedEnv?.EXTRA_SECRET).toBeUndefined()
    expect(capturedEnv?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(capturedEnv?.KUN_BROWSER_USE_BRIDGE_TOKEN).toBeUndefined()
    expect(capturedEnv?.PATH ?? capturedEnv?.Path).toBeTruthy()
  })
})

describe('scenario fixture smoke', () => {
  test('runs initialize + prompt against the scripted agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-fixture-'))
    const journalPath = join(dir, 'journal.jsonl')
    try {
      const proc = await startAcpProcess({
        command: process.execPath,
        args: [FIXTURE_AGENT],
        env: {
          FAKE_ACP_SCENARIO: join(SCENARIOS, 'basic-chat.json'),
          FAKE_ACP_JOURNAL: journalPath
        },
        spawn: async (command, args, options) =>
          spawn(command, [...args], {
            env: options.env as NodeJS.ProcessEnv,
            stdio: options.stdio as ['pipe', 'pipe', 'pipe']
          })
      })
      spawned.push(proc)
      const rpc = new AcpJsonRpc({
        stdin: proc.stdin!,
        stdout: proc.stdout!,
        stderrTail: () => proc.sanitizedStderrTail(),
        exitPromise: proc.exit
      })
      const init = (await rpc.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }
      })) as { protocolVersion: number; agentCapabilities: { loadSession: boolean } }
      expect(init.protocolVersion).toBe(1)
      expect(init.agentCapabilities.loadSession).toBe(true)
      const result = (await rpc.request('session/prompt', {
        sessionId: 'sess-basic',
        prompt: [{ type: 'text', text: 'hi' }]
      })) as { stopReason: string }
      expect(result.stopReason).toBe('end_turn')
      rpc.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
