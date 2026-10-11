import { describe, expect, it } from 'vitest'
import { runWorkerCallbackCommand } from './worker-callback-cli.js'

type CapturedRequest = { url: string; init: RequestInit }

function createIo(opts: {
  env?: Record<string, string | undefined>
  responder?: (url: string, init: RequestInit) => Promise<Response> | Response
  stdinText?: string
}) {
  let stdout = ''
  let stderr = ''
  const requests: CapturedRequest[] = []
  const stdinText = opts.stdinText
  const stdin = stdinText === undefined
    ? undefined
    : (async function* () { yield Buffer.from(stdinText) })() as unknown as NodeJS.ReadableStream
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk } },
      stderr: { write: (chunk: string) => { stderr += chunk } },
      env: opts.env ?? {},
      ...(stdin ? { stdin } : {}),
      fetch: (async (url: unknown, init?: RequestInit) => {
        requests.push({ url: String(url), init: init ?? {} })
        if (!opts.responder) throw new Error('no responder')
        return opts.responder(String(url), init ?? {})
      }) as unknown as typeof fetch
    },
    requests,
    output: () => stdout,
    errors: () => stderr
  }
}

const ENV = {
  KUN_WORKER_ENDPOINT: 'http://127.0.0.1:18899',
  KUN_WORKER_TOKEN: 'kgw_worker',
  KUN_HOOK_TOKEN: 'kgw_hook'
}

const okJson = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

describe('kun worker', () => {
  it('prints usage and exits 0/2 for help and unknown subcommands', async () => {
    const help = createIo({ env: ENV })
    expect(await runWorkerCallbackCommand(['--help'], help.io)).toBe(0)
    expect(help.output()).toContain('kun worker')
    const bogus = createIo({ env: ENV })
    expect(await runWorkerCallbackCommand(['frobnicate'], bogus.io)).toBe(2)
    expect(bogus.errors()).toContain('unknown subcommand')
  })

  it('fails with exit 2 when endpoint or token env vars are missing', async () => {
    const noEnv = createIo({ env: {} })
    expect(await runWorkerCallbackCommand(['progress', 'hi'], noEnv.io)).toBe(2)
    expect(noEnv.errors()).toContain('KUN_WORKER_ENDPOINT')
    const noToken = createIo({ env: { KUN_WORKER_ENDPOINT: ENV.KUN_WORKER_ENDPOINT } })
    expect(await runWorkerCallbackCommand(['progress', 'hi'], noToken.io)).toBe(2)
    expect(noToken.errors()).toContain('KUN_WORKER_TOKEN')
    const hookNoToken = createIo({
      env: { KUN_WORKER_ENDPOINT: ENV.KUN_WORKER_ENDPOINT, KUN_WORKER_TOKEN: 'kgw_worker' },
      stdinText: '{}'
    })
    expect(await runWorkerCallbackCommand(['hook', 'SessionStart'], hookNoToken.io)).toBe(2)
    expect(hookNoToken.errors()).toContain('KUN_HOOK_TOKEN')
  })

  it('posts progress with the bearer token and prints one JSON line', async () => {
    const { io, requests, output } = createIo({
      env: ENV,
      responder: () => okJson({ status: 'recorded' })
    })
    expect(await runWorkerCallbackCommand(
      ['progress', 'halfway there', '--phase', 'implementing'], io
    )).toBe(0)
    expect(requests).toHaveLength(1)
    const { url, init } = requests[0]!
    expect(url).toBe('http://127.0.0.1:18899/v1/worker-callbacks/progress')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer kgw_worker')
    expect(JSON.parse(String(init.body))).toEqual({ summary: 'halfway there', phase: 'implementing' })
    expect(output()).toBe('{"status":"recorded"}\n')
  })

  it('maps 401/403 responses to exit 3', async () => {
    const { io } = createIo({
      env: ENV,
      responder: () => new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 })
    })
    expect(await runWorkerCallbackCommand(['progress', 'hi'], io)).toBe(3)
  })

  it('maps unreachable endpoints and timeouts to exit 1/4', async () => {
    const down = createIo({
      env: ENV,
      responder: () => { throw new Error('connect ECONNREFUSED') }
    })
    expect(await runWorkerCallbackCommand(['context'], down.io)).toBe(1)
    const timedOut = createIo({
      env: ENV,
      responder: () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }
    })
    expect(await runWorkerCallbackCommand(['context'], timedOut.io)).toBe(4)
  })

  it('maps an answered ask to exit 0 and a timeout status to exit 4', async () => {
    const answered = createIo({
      env: ENV,
      responder: () => okJson({ status: 'answered', answer: 'staging', answeredBy: 'manager' })
    })
    expect(await runWorkerCallbackCommand(
      ['ask', 'which env?', '--options', 'staging,prod', '--timeout', '30'], answered.io
    )).toBe(0)
    const body = JSON.parse(String(answered.requests[0]!.init.body))
    expect(body).toEqual({ question: 'which env?', options: ['staging', 'prod'], timeoutSeconds: 30 })
    const timeout = createIo({
      env: ENV,
      responder: () => okJson({ status: 'timeout' })
    })
    expect(await runWorkerCallbackCommand(['ask', 'anyone?'], timeout.io)).toBe(4)
  })

  it('rejects malformed arguments with exit 2', async () => {
    const { io } = createIo({ env: ENV })
    expect(await runWorkerCallbackCommand(['progress'], io)).toBe(2)
    expect(await runWorkerCallbackCommand(['ask', 'q', '--timeout', 'abc'], io)).toBe(2)
    expect(await runWorkerCallbackCommand(['context', '--limit', 'nope'], io)).toBe(2)
    expect(await runWorkerCallbackCommand(
      ['result', '--outcome', 'succeeded', '--summary', 'x', '--check', 'lint=green'], io
    )).toBe(2)
    expect(await runWorkerCallbackCommand(['progress', 's', '--bogus', '1'], io)).toBe(2)
  })

  it('submits structured results with files, checks, and risks', async () => {
    const { io, requests } = createIo({ env: ENV, responder: () => okJson({ status: 'recorded' }) })
    expect(await runWorkerCallbackCommand([
      'result', '--outcome', 'succeeded', '--summary', 'done',
      '--files', 'a.ts,b.ts', '--check', 'typecheck=passed', '--check', 'lint=failed',
      '--risks', 'untested path'
    ], io)).toBe(0)
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
      outcome: 'succeeded',
      summary: 'done',
      filesChanged: ['a.ts', 'b.ts'],
      checks: [
        { name: 'typecheck', status: 'passed' },
        { name: 'lint', status: 'failed' }
      ],
      risks: ['untested path']
    })
  })

  it('posts trimmed hook events to /v1/activity/hooks with the hook token', async () => {
    const { io, requests, output } = createIo({
      env: ENV,
      stdinText: JSON.stringify({
        session_id: 'sess_1',
        tool_name: 'Write',
        timestamp: '2026-10-01T00:00:01Z',
        secret_field: 'dropped'
      }),
      responder: () => okJson({ status: 'recorded' })
    })
    expect(await runWorkerCallbackCommand(['hook', 'PostToolUse'], io)).toBe(0)
    const { url, init } = requests[0]!
    expect(url).toBe('http://127.0.0.1:18899/v1/activity/hooks')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer kgw_hook')
    expect(JSON.parse(String(init.body))).toEqual({
      event: 'PostToolUse',
      sessionId: 'sess_1',
      toolName: 'Write',
      timestamp: '2026-10-01T00:00:01Z'
    })
    expect(output()).toBe('{"status":"recorded"}\n')
  })

  it('rejects oversized or invalid hook payloads', async () => {
    const big = createIo({ env: ENV, stdinText: 'x'.repeat(70 * 1024) })
    expect(await runWorkerCallbackCommand(['hook', 'Stop'], big.io)).toBe(2)
    const invalid = createIo({ env: ENV, stdinText: 'not json' })
    expect(await runWorkerCallbackCommand(['hook', 'Stop'], invalid.io)).toBe(2)
  })
})
