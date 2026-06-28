import { describe, expect, test } from 'vitest'
import { createAgentSdkRuntime, resolveTurnPlanContext, waitForGate } from './agent-sdk-runtime-factory.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../../ports/user-input-gate.js'

function fakeGate(pending: Promise<UserInputResolution>): {
  gate: UserInputGate
  resolvedWith: UserInputResolution[]
} {
  const resolvedWith: UserInputResolution[] = []
  const gate = {
    request: () => pending,
    resolve: (_id: string, resolution: UserInputResolution) => {
      resolvedWith.push(resolution)
      return true
    },
    get: () => undefined,
    pending: () => []
  } as unknown as UserInputGate
  return { gate, resolvedWith }
}

const req: UserInputRequest = { id: 'in1', threadId: 'th', turnId: 'tn', itemId: 'it1', prompt: 'pick', questions: [] }

describe('waitForGate', () => {
  test('resolves with the gate answer when the user submits', async () => {
    const answer: UserInputResolution = { status: 'submitted', answers: [] }
    const { gate } = fakeGate(Promise.resolve(answer))
    expect(await waitForGate(gate, req, new AbortController().signal)).toEqual(answer)
  })

  test('an already-aborted turn cancels the request immediately', async () => {
    const { gate, resolvedWith } = fakeGate(new Promise(() => {})) // never resolves
    const ac = new AbortController()
    ac.abort()
    expect(await waitForGate(gate, req, ac.signal)).toEqual({ status: 'cancelled' })
    expect(resolvedWith).toEqual([{ status: 'cancelled' }])
  })

  test('aborting mid-wait cancels the pending request and rejects', async () => {
    const { gate, resolvedWith } = fakeGate(new Promise(() => {}))
    const ac = new AbortController()
    const waiting = waitForGate(gate, req, ac.signal)
    ac.abort()
    await expect(waiting).rejects.toThrow(/cancelled/)
    expect(resolvedWith).toEqual([{ status: 'cancelled' }])
  })
})

function threadWith(partial: Partial<ThreadRecord>): ThreadRecord {
  return {
    id: 'th',
    title: 't',
    workspace: '/ws',
    model: 'claude-haiku-4-5',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    relation: 'primary',
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
    turns: [],
    ...partial
  } as ThreadRecord
}

const planTurn = (id: string, workspaceRoot: string): ThreadRecord['turns'][number] =>
  ({
    id,
    prompt: 'plan it',
    guiPlan: { operation: 'draft', workspaceRoot, relativePath: '.kun/plan.md', planId: 'p1' }
  }) as ThreadRecord['turns'][number]

describe('resolveTurnPlanContext', () => {
  test('exposes the GUI plan + planMode for a plan turn in the same workspace', () => {
    const thread = threadWith({ workspace: '/ws', turns: [planTurn('tn', '/ws')] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.planMode).toBe(true)
    expect(resolved.guiPlan?.relativePath).toBe('.kun/plan.md')
    expect(resolved.guiPlan?.turnId).toBe('tn')
  })

  test('drops a stale plan whose workspace does not match the thread', () => {
    const thread = threadWith({ workspace: '/ws', turns: [planTurn('tn', '/other-ws')] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.guiPlan).toBeUndefined()
    // mode falls back to the thread mode (no live plan to force plan mode)
    expect(resolved.planMode).toBe(false)
  })

  test('plan mode via thread.mode without a GUI plan', () => {
    const thread = threadWith({ mode: 'plan', turns: [{ id: 'tn', prompt: 'x' } as ThreadRecord['turns'][number]] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.planMode).toBe(true)
    expect(resolved.guiPlan).toBeUndefined()
  })

  test('a normal agent turn is not a plan turn', () => {
    const thread = threadWith({ turns: [{ id: 'tn', prompt: 'x' } as ThreadRecord['turns'][number]] })
    expect(resolveTurnPlanContext(thread, 'tn')).toEqual({ planMode: false })
  })
})

// handlesProvider only reads providerConfigs / agentSdkProviderIds / defaultIsAgentSdk,
// so the heavy service deps can be stubbed for this routing test.
function make(opts: { agentSdk: string[]; http: string[]; defaultIsAgentSdk: boolean }): {
  handlesProvider(id: string | undefined): boolean
} {
  const providerConfigs: Record<string, { baseUrl?: string; apiKey: string; kind?: 'http' | 'agent-sdk' }> = {}
  for (const id of opts.agentSdk) providerConfigs[id] = { kind: 'agent-sdk', apiKey: 'tok' }
  for (const id of opts.http) providerConfigs[id] = { baseUrl: 'https://x', apiKey: 'key' }
  return createAgentSdkRuntime({
    registry: {} as never,
    turns: {} as never,
    sessionStore: {} as never,
    threadStore: {} as never,
    events: {} as never,
    ids: { next: (p: string) => p },
    prefix: { systemPrompt: '' },
    providerConfigs: providerConfigs as never,
    agentSdkProviderIds: new Set(opts.agentSdk),
    defaultApprovalPolicy: 'auto',
    defaultIsAgentSdk: opts.defaultIsAgentSdk,
    defaultToken: 'tok'
  })
}

describe('createAgentSdkRuntime handlesProvider', () => {
  test('claims only explicit agent-sdk providers when default is not agent-sdk', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: false })
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false)
    expect(r.handlesProvider(undefined)).toBe(false)
  })

  test('when the default provider is agent-sdk, also claims absent/default providerId', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: true })
    expect(r.handlesProvider(undefined)).toBe(true) // default turn → SDK (the reported 401 case)
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false) // an explicit HTTP provider stays HTTP
  })
})
