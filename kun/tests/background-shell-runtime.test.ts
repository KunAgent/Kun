import { describe, expect, it, vi } from 'vitest'
import type { ThreadStore } from '../src/ports/thread-store.js'
import type { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { BackgroundShellRuntime } from '../src/services/background-shell-runtime.js'
import type { TurnService } from '../src/services/turn-service.js'

describe('BackgroundShellRuntime', () => {
  it('steers a running turn when a detached shell completes successfully', async () => {
    const steerTurn = vi.fn(async () => undefined)
    const startTurn = vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_new', userMessageItemId: 'item_1' }))
    const runTurn = vi.fn(async () => undefined)
    const runtime = new BackgroundShellRuntime({
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      threadStore: {
        get: vi.fn(async () => ({
          id: 'thr_1',
          status: 'running',
          turns: [{ id: 'turn_1', status: 'running' }]
        }))
      } as unknown as ThreadStore,
      turns: { steerTurn, startTurn } as unknown as TurnService,
      nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    runtime.bindAgentLoop({ runTurn })
    await runtime.bashHooks().onSessionSettled?.({
      id: 'abcd1234',
      threadId: 'thr_1',
      turnId: 'turn_1',
      command: 'npm test',
      cwd: '/tmp',
      shell: 'bash',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
      exitCode: 0,
      output: 'ok',
      detached: true
    })
    expect(steerTurn).toHaveBeenCalledWith({
      threadId: 'thr_1',
      turnId: 'turn_1',
      text: expect.stringContaining('<session_id>abcd1234</session_id>'),
      displayText: 'Background shell abcd1234 completed',
      messageSource: 'background_shell'
    })
    expect(startTurn).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('starts a new turn with messageSource when the thread is idle', async () => {
    const steerTurn = vi.fn(async () => undefined)
    const startTurn = vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_new', userMessageItemId: 'item_1' }))
    const runTurn = vi.fn(async () => undefined)
    const runtime = new BackgroundShellRuntime({
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      threadStore: {
        get: vi.fn(async () => ({
          id: 'thr_1',
          status: 'idle',
          turns: [{ id: 'turn_1', status: 'completed' }]
        }))
      } as unknown as ThreadStore,
      turns: { steerTurn, startTurn } as unknown as TurnService,
      nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    runtime.bindAgentLoop({ runTurn })
    await runtime.bashHooks().onSessionSettled?.({
      id: 'abcd1234',
      threadId: 'thr_1',
      turnId: 'turn_1',
      command: 'npm test',
      cwd: '/tmp',
      shell: 'bash',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
      exitCode: 0,
      output: 'ok',
      detached: true
    })
    expect(startTurn).toHaveBeenCalledWith({
      threadId: 'thr_1',
      request: {
        prompt: expect.stringContaining('<background_shell_completed>'),
        displayText: 'Background shell abcd1234 completed',
        messageSource: 'background_shell'
      }
    })
    expect(runTurn).toHaveBeenCalledWith('thr_1', 'turn_new')
    expect(steerTurn).not.toHaveBeenCalled()
  })
})
