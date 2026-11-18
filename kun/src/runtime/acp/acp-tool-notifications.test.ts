import { expect, it, vi } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'
import { AcpClientHost } from './acp-client-host.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import type { AcpConnection } from './acp-connection.js'
import { parseAcpSessionUpdate } from './acp-schema.js'
import { mapAcpFailure } from './acp-runtime-support.js'
import { AcpError } from './acp-schema.js'

it('finishes a turn with a long command as its tool title and preserves its raw input', async () => {
  const command = `printf '%s' '${'a'.repeat(5_770)}'`
  const call = { toolCallId: 'command-1', title: command, kind: 'execute' }
  const harness = await makeHarness({ turns: [{ steps: [
    { update: { sessionUpdate: 'tool_call', ...call, status: 'pending', rawInput: { CommandLine: command } } },
    { update: { sessionUpdate: 'tool_call_update', ...call, status: 'in_progress' } },
    { update: { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed', rawOutput: 'ok' } },
    { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All done.' } } }
  ] }] })

  expect(await harness.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
  const started = harness.recorded.find((event) => event.kind === 'tool_call_started')
  expect(started).toMatchObject({ item: {
    callId: call.toolCallId,
    arguments: { title: command.slice(0, 4_093) + '...', rawInput: { CommandLine: command } }
  } })
  expect(harness.applied.filter((item) => item.kind === 'tool_result')).toMatchObject([
    { callId: call.toolCallId, status: 'completed', output: 'ok' }
  ])
  expect(harness.deltas.map(({ delta }) => delta).join('')).toBe('All done.')
  expect(harness.requests('session/prompt')).toHaveLength(1)
})

it('fails only the owning session for a malformed update while a sibling prompt is in flight', async () => {
  const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
  let finishHealthy!: () => void
  const barrier = new Promise<void>((resolve) => { finishHealthy = resolve })
  const waiting = vi.fn()
  class FixtureHost extends AcpClientHost {
    override attach(connection: AcpConnection): void {
      super.attach(connection)
      connection.rpc.onRequest('fixture/wait', async () => { waiting(); await barrier; return {} })
    }
  }
  const deps = { connectionPool: pool, clientHost: new FixtureHost() }
  const healthy = await makeHarness({ turns: [
    { promptIncludes: 'hello agent', steps: [
      { clientRequest: { method: 'fixture/wait' } },
      { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Still here.' } } }
    ] },
    { promptIncludes: 'broken prompt', steps: [
      { update: { sessionUpdate: 'tool_call', title: 'Missing identity' } }
    ], neverRespond: true }
  ] }, { deps })
  const broken = await makeHarness('basic-chat.json', {
    deps, definition: { launch: healthy.definition.launch }, thread: { id: 'thread_2', workspace: healthy.workspace },
    items: [{ id: 'second-user', threadId: 'thread_2', turnId: 'turn_1', kind: 'user_message', role: 'user',
      text: 'broken prompt', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' }]
  })

  const healthyTurn = healthy.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)
  try {
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledOnce())
    expect(await broken.runtime.runTurn('thread_2', 'turn_1', new AbortController().signal)).toBe('failed')
    finishHealthy()
    expect(await healthyTurn).toBe('completed')
    expect(healthy.deltas.map(({ delta }) => delta).join('')).toBe('Still here.')
    expect(healthy.requests('initialize')).toHaveLength(1)
    expect(healthy.requests('session/cancel').map(({ params }) => params?.sessionId)).toEqual(['sess-2'])
    expect(broken.finished.at(-1)).toMatchObject({
      code: 'harness_protocol_error',
      error: expect.stringContaining('toolCallId'),
      details: {
        issues: [
          expect.objectContaining({
            path: 'toolCallId',
            code: 'invalid_type',
            message: expect.stringContaining('expected string')
          })
        ]
      }
    })
  } finally {
    finishHealthy()
    await pool.dispose()
  }
})

it('handles 4096/4097/5223/7496 title boundaries, surrogate pairs, and oversized informational updates cleanly', () => {
  const exact4096 = 'k'.repeat(4_096)
  expect(parseAcpSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: exact4096 })).toMatchObject({
    title: exact4096
  })

  for (const len of [4_097, 5_223, 7_496]) {
    const over = 'q'.repeat(len)
    const parsed = parseAcpSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: `c_${len}`, title: over }) as { title: string }
    expect(parsed.title).toHaveLength(4_096)
    expect(parsed.title.endsWith('...')).toBe(true)
  }

  // Place an emoji (UTF-16 surrogate pair) straddling index 4092..4093 so naive slice(0, 4093) would split it.
  const surrogateBoundary = `${'a'.repeat(4_092)}🚀${'b'.repeat(20)}`
  const truncatedEmoji = parseAcpSessionUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'c_emoji',
    title: surrogateBoundary
  }) as { title: string }
  expect(truncatedEmoji.title).toBe(`${'a'.repeat(4_092)}...`)
  expect(/[\uD800-\uDFFF]/.test(truncatedEmoji.title)).toBe(false)

  // Oversized session_info_update titles and command descriptions must not fail the turn.
  expect(parseAcpSessionUpdate({
    sessionUpdate: 'session_info_update',
    title: 's'.repeat(7_496)
  })).toMatchObject({ sessionUpdate: 'session_info_update', title: `${'s'.repeat(4_093)}...` })

  expect(parseAcpSessionUpdate({
    sessionUpdate: 'available_commands_update',
    availableCommands: [{
      name: 'deploy',
      description: 'd'.repeat(5_223),
      input: { hint: 'h'.repeat(5_223) }
    }]
  })).toMatchObject({
    sessionUpdate: 'available_commands_update',
    availableCommands: [{
      name: 'deploy',
      description: `${'d'.repeat(4_093)}...`,
      input: { hint: `${'h'.repeat(4_093)}...` }
    }]
  })
})

it('reports too_big field details accurately and redacts secrets in ACP error details', () => {
  let caught: AcpError | undefined
  try {
    parseAcpSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'id'.repeat(600),
      title: 'Run check'
    })
  } catch (error) {
    caught = error as AcpError
  }
  expect(caught).toBeInstanceOf(AcpError)
  expect(caught?.message).not.toContain('missing required fields')
  expect(caught?.message).toContain('toolCallId')
  expect(caught?.message).toContain('too_big')
  expect(caught?.data).toEqual({
    issues: [
      expect.objectContaining({
        path: 'toolCallId',
        code: 'too_big',
        message: expect.stringContaining('<=1024')
      })
    ]
  })

  const mapped = mapAcpFailure(
    new AcpError('agent_error', 'Internal error', {
      rpcCode: -32603,
      data: {
        reason: 'upstream rejected request',
        apiKey: 'sk-supersecretvalue123456',
        note: 'Authorization: Bearer topsecretbearer999'
      }
    }),
    false,
    'qoder'
  )
  expect(mapped).toMatchObject({
    code: 'agent_error',
    message: 'Internal error',
    details: {
      rpcCode: -32603,
      data: {
        reason: 'upstream rejected request',
        apiKey: '[redacted]'
      }
    }
  })
  expect(JSON.stringify(mapped.details)).not.toContain('sk-supersecretvalue123456')
  expect(JSON.stringify(mapped.details)).not.toContain('topsecretbearer999')
})
