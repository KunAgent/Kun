import { expect, it, vi } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'
import { AcpClientHost } from './acp-client-host.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import type { AcpConnection } from './acp-connection.js'

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
    expect(broken.finished.at(-1)).toMatchObject({ code: 'harness_protocol_error', error: expect.stringContaining('toolCallId') })
  } finally {
    finishHealthy()
    await pool.dispose()
  }
})
