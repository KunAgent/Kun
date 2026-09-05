import { describe, expect, it, vi } from 'vitest'
import type { BackgroundShellRecordInput } from '../adapters/tool/builtin-tool-types.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { BackgroundShellRuntime, type BackgroundShellRuntimeDeps } from './background-shell-runtime.js'

function settledShell(
  status: BackgroundShellRecordInput['status']
): BackgroundShellRecordInput {
  return {
    id: 'shell001',
    threadId: 'thread_1',
    turnId: 'turn_source',
    command: 'npm run build',
    cwd: '/tmp/workspace',
    shell: '/bin/zsh',
    status,
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:01:00.000Z',
    exitCode: status === 'completed' ? 0 : 1,
    output: status === 'completed' ? 'build complete' : 'build failed',
    detached: true
  }
}

describe('BackgroundShellRuntime completion handoff', () => {
  it('marks retained session metadata expired after its output file is pruned', () => {
    const runtime = new BackgroundShellRuntime({
      events: { record: vi.fn() },
      threadStore: { get: vi.fn() },
      turns: { startTurn: vi.fn(), steerTurn: vi.fn() },
      nowIso: () => '2026-07-29T00:01:00.000Z'
    } as unknown as BackgroundShellRuntimeDeps)
    runtime.upsertSession({
      ...settledShell('completed'),
      outputFilePath: '/definitely/missing/background-shell.output'
    })

    expect(runtime.getSession('shell001')).toMatchObject({
      output: expect.stringContaining('expired by retention policy'),
      outputTruncated: true
    })
    expect(runtime.getSession('shell001')?.outputFilePath).toBeUndefined()
  })

  it.each(['completed', 'failed', 'stopped'] as const)(
    'automatically resumes the agent after a detached shell is %s (#1031)',
    async (status) => {
      const sourceTurn = createTurnRecord({
        id: 'turn_source',
        threadId: 'thread_1',
        prompt: 'Build the project.',
        clientSurface: 'gui',
        disableUserInput: true,
        status: 'completed'
      })
      const thread = {
        ...createThreadRecord({
          id: 'thread_1',
          title: 'Build',
          workspace: '/tmp/workspace',
          model: 'test-model',
          status: 'idle'
        }),
        turns: [sourceTurn]
      }
      const startTurn = vi.fn(async () => ({
        threadId: 'thread_1',
        turnId: 'turn_callback'
      }))
      const steerTurn = vi.fn(async () => undefined)
      const recordEvent = vi.fn(async (event: unknown) => event)
      const runTurn = vi.fn(async () => 'completed')
      const runtime = new BackgroundShellRuntime({
        events: { record: recordEvent },
        threadStore: { get: vi.fn(async () => thread) },
        turns: { startTurn, steerTurn },
        nowIso: () => '2026-07-29T00:01:00.000Z'
      } as unknown as BackgroundShellRuntimeDeps)
      runtime.bindAgentLoop({ runTurn })

      await runtime.bashHooks().onSessionSettled?.(settledShell(status))

      expect(startTurn).toHaveBeenCalledWith({
        threadId: 'thread_1',
        request: expect.objectContaining({
          prompt: expect.stringContaining('<background_shell_completed>'),
          displayText: expect.stringContaining('shell001'),
          messageSource: 'background_shell',
          clientSurface: 'gui',
          disableUserInput: true
        })
      })
      expect(runTurn).toHaveBeenCalledWith('thread_1', 'turn_callback')
    }
  )

  it('does not resume for a foreground shell settlement', async () => {
    const startTurn = vi.fn(async (_input: unknown) => ({
      threadId: 'thread_1',
      turnId: 'turn_callback'
    }))
    const runtime = new BackgroundShellRuntime({
      events: { record: vi.fn(async (event: unknown) => event) },
      threadStore: { get: vi.fn() },
      turns: { startTurn, steerTurn: vi.fn() },
      nowIso: () => '2026-07-29T00:01:00.000Z'
    } as unknown as BackgroundShellRuntimeDeps)
    const record = { ...settledShell('completed'), detached: false }

    await runtime.bashHooks().onSessionSettled?.(record)

    expect(startTurn).not.toHaveBeenCalled()
  })

  it('delivers both completions when two detached shells settle at once (#5)', async () => {
    const sourceTurn = createTurnRecord({
      id: 'turn_source',
      threadId: 'thread_1',
      prompt: 'Build the project.',
      clientSurface: 'gui',
      disableUserInput: true,
      status: 'completed'
    })
    const thread = {
      ...createThreadRecord({
        id: 'thread_1',
        title: 'Build',
        workspace: '/tmp/workspace',
        model: 'test-model',
        status: 'idle'
      }),
      turns: [sourceTurn]
    }
    const startTurn = vi.fn(async (_input: unknown) => ({
      threadId: 'thread_1',
      turnId: 'turn_callback'
    }))
    const steerTurn = vi.fn(async () => undefined)
    const runtime = new BackgroundShellRuntime({
      events: { record: vi.fn(async (event: unknown) => event) },
      threadStore: { get: vi.fn(async () => thread) },
      turns: { startTurn, steerTurn },
      nowIso: () => '2026-07-29T00:01:00.000Z'
    } as unknown as BackgroundShellRuntimeDeps)
    runtime.bindAgentLoop({ runTurn: vi.fn(async () => 'completed') })

    const first = runtime.bashHooks().onSessionSettled?.(settledShell('completed'))
    const second = runtime.bashHooks().onSessionSettled?.({
      ...settledShell('completed'),
      id: 'shell002',
      command: 'npm run test',
      output: 'tests passed'
    })
    await Promise.all([first, second])

    // Both session ids must reach the agent: two notices, no lost settlement.
    const notices = startTurn.mock.calls.map(
      (call) => (call[0] as { request: { prompt: string } }).request.prompt
    )
    expect(notices).toHaveLength(2)
    expect(notices[0]).toContain('shell001')
    expect(notices[1]).toContain('shell002')
  })

  it('steers the notice into the winning turn when startTurn conflicts', async () => {
    const sourceTurn = createTurnRecord({
      id: 'turn_source',
      threadId: 'thread_1',
      prompt: 'Build the project.',
      clientSurface: 'gui',
      status: 'completed'
    })
    const idleThread = {
      ...createThreadRecord({
        id: 'thread_1',
        title: 'Build',
        workspace: '/tmp/workspace',
        model: 'test-model',
        status: 'idle'
      }),
      turns: [sourceTurn]
    }
    const runningThread = {
      ...idleThread,
      status: 'running',
      turns: [sourceTurn, createTurnRecord({
        id: 'turn_winner',
        threadId: 'thread_1',
        prompt: 'Competing turn.',
        clientSurface: 'gui',
        status: 'running'
      })]
    }
    let getCallCount = 0
    const startTurn = vi.fn(async () => {
      throw new Error('thread already has an active turn')
    })
    const steerTurn = vi.fn(async () => undefined)
    const runtime = new BackgroundShellRuntime({
      events: { record: vi.fn(async (event: unknown) => event) },
      threadStore: {
        get: vi.fn(async () => {
          getCallCount += 1
          return getCallCount <= 1 ? idleThread : runningThread
        })
      },
      turns: { startTurn, steerTurn },
      nowIso: () => '2026-07-29T00:01:00.000Z'
    } as unknown as BackgroundShellRuntimeDeps)
    runtime.bindAgentLoop({ runTurn: vi.fn(async () => 'completed') })

    await runtime.bashHooks().onSessionSettled?.(settledShell('completed'))

    expect(startTurn).toHaveBeenCalledOnce()
    expect(steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1',
      turnId: 'turn_winner',
      text: expect.stringContaining('shell001')
    }))
  })
})
