import { describe, expect, it, vi } from 'vitest'
import { runCursorSdkTurnOwned } from './cursor-sdk-runtime-lifecycle.js'
import type { CursorSdkRuntimeDeps } from './cursor-sdk-runtime-support.js'

function fixture(input: {
  resumed?: boolean
  revokeAt?: 'load' | 'create' | 'resume' | 'dispose'
  authenticationFailure?: boolean
}) {
  let enabled = true
  let sendCount = 0
  const revoke = (stage: typeof input.revokeAt): void => {
    if (input.revokeAt === stage) enabled = false
  }
  const validateTurn = vi.fn(async (_threadId: string, _turnId: string, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (!enabled) throw new Error('Agent profile changed before launch; test it again')
    return 'checked-profile'
  })
  const send = vi.fn(async () => {
    sendCount += 1
    if (input.authenticationFailure && sendCount === 1) throw new Error('authentication transport expired')
    return {
      supports: () => false,
      wait: async () => ({ id: 'run', status: 'finished', result: 'hello' }),
      cancel: async () => undefined
    }
  })
  const agent = {
    agentId: 'persisted-agent', send, close: vi.fn(),
    [Symbol.asyncDispose]: async () => { revoke('dispose') }
  }
  const create = vi.fn(async () => { revoke('create'); return agent })
  const resume = vi.fn(async () => { revoke('resume'); return agent })
  const turn = { id: 'turn', model: 'auto', mode: 'agent', providerId: 'cursor-account' }
  const thread = {
    id: 'thread', title: 'Admission test', workspace: '/tmp', model: 'auto',
    mode: 'agent', approvalPolicy: 'auto', sandboxMode: 'danger-full-access',
    turns: [turn]
  }
  const finishTurn = vi.fn(async () => undefined)
  const deps = {
    readiness: { validateTurn },
    providerConfigs: { 'cursor-account': { kind: 'cursor-sdk', apiKey: 'test-key' } },
    providerIds: new Set(['cursor-account']), defaultIsCursor: false, defaultModel: 'auto',
    threadStore: { get: async () => thread },
    sessionStore: { loadItems: async () => [{
      id: 'user', threadId: 'thread', turnId: 'turn', role: 'user', status: 'completed',
      createdAt: '2026-10-03T00:00:00.000Z', kind: 'user_message', text: 'hello'
    }] },
    turns: {
      finishTurn, applyItem: async () => undefined,
      updateTurnMetadata: async (_threadId: string, _turnId: string, patch: object) => Object.assign(turn, patch)
    },
    events: { record: async () => undefined },
    ids: { next: (prefix: string) => `${prefix}-test` },
    deterministicHandoff: false,
    ...(input.resumed ? { sessionCoordinator: {
      prepare: async ({ route }: { route: object }) => ({
        threadId: 'thread', route, generation: 1, resumed: true, nativeSessionId: 'persisted-agent'
      }),
      store: { providerStateDir: () => '/tmp/cursor-admission-fixture' },
      commit: async () => undefined
    } } : {}),
    loadSdk: async () => {
      revoke('load')
      return { Agent: { create, resume }, JsonlLocalAgentStore: class {} }
    }
  } as unknown as CursorSdkRuntimeDeps
  return {
    send, create, resume, validateTurn, finishTurn,
    run: () => runCursorSdkTurnOwned(deps, 'thread', 'turn', new AbortController().signal, 'cursor-account', () => undefined)
  }
}

describe('Cursor final launch admission', () => {
  it('revalidates a persisted native session after asynchronous SDK loading', async () => {
    const f = fixture({ resumed: true, revokeAt: 'load' })
    expect(await f.run()).toBe('failed')
    expect(f.resume).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.send).not.toHaveBeenCalled()
  })

  it.each(['create', 'resume'] as const)('revalidates before sending after awaited %s', async (stage) => {
    const f = fixture({ resumed: stage === 'resume', revokeAt: stage })
    expect(await f.run()).toBe('failed')
    expect(stage === 'resume' ? f.resume : f.create).toHaveBeenCalledOnce()
    expect(f.send).not.toHaveBeenCalled()
  })

  it('revalidates before rebuilding an authentication-expired session', async () => {
    const f = fixture({ revokeAt: 'dispose', authenticationFailure: true })
    expect(await f.run()).toBe('failed')
    expect(f.send).toHaveBeenCalledOnce()
    expect(f.resume).not.toHaveBeenCalled()
  })

  it.each([false, true])('continues a current checked profile with resumed=%s', async (resumed) => {
    const f = fixture({ resumed })
    expect(await f.run()).toBe('completed')
    expect(f.send).toHaveBeenCalledOnce()
    expect(f.validateTurn).toHaveBeenCalledTimes(2)
  })
})
