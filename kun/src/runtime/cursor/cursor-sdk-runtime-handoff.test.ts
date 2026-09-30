import { describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKMessage
} from '@cursor/sdk'
import type { TurnItem } from '../../contracts/items.js'
import {
  CursorSdkRuntime,
  cursorSdkCapabilities,
  type CursorKunTurnContext,
  type CursorSdkApi,
  type CursorSdkRuntimeDeps
} from './cursor-sdk-runtime.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedHistoryDigest
} from '../delegated-session-binding.js'

function messages(values: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  return (async function* () {
    for (const value of values) yield value
  })()
}

function fakeRun(input: {
  stream?: SDKMessage[]
  result?: Partial<RunResult>
} = {}): Run {
  const result: RunResult = {
    id: 'run_1',
    status: 'finished',
    result: 'hello',
    ...input.result
  }
  return {
    id: 'run_1',
    agentId: 'agent_1',
    supports: (operation) => operation === 'stream' || operation === 'wait' || operation === 'cancel',
    unsupportedReason: () => undefined,
    stream: () => messages(input.stream ?? [{
      type: 'assistant',
      agent_id: 'agent_1',
      run_id: 'run_1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    }]),
    conversation: async () => [],
    wait: async () => result,
    cancel: async () => undefined,
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: result.error,
    model: result.model,
    durationMs: result.durationMs,
    usage: result.usage,
    git: result.git,
    createdAt: 1
  }
}

function harness(input: {
  items?: Array<Record<string, unknown>>
  thread?: Record<string, unknown>
  sessionCoordinator?: CursorSdkRuntimeDeps['sessionCoordinator']
  taskWorkspaces?: CursorSdkRuntimeDeps['taskWorkspaces']
  deterministicHandoff?: boolean
  resumeError?: Error
  createError?: Error
}) {
  const recorded: unknown[] = []
  const applied: unknown[] = []
  const finished: unknown[] = []
  const createOptions: AgentOptions[] = []
  const sentMessages: unknown[] = []
  const resumedAgentIds: string[] = []
  const loadItems = vi.fn(async () => input.items ?? [{
    id: 'user_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    role: 'user',
    status: 'completed',
    createdAt: new Date().toISOString(),
    kind: 'user_message',
    text: 'hi'
  }])
  const agent = {
    agentId: 'agent_1',
    model: { id: 'auto' },
    send: async (message: unknown) => {
      sentMessages.push(message)
      return fakeRun()
    },
    close: vi.fn(),
    reload: vi.fn(async () => undefined),
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    [Symbol.asyncDispose]: vi.fn(async () => undefined)
  } as unknown as SDKAgent
  const sdk: CursorSdkApi = {
    Agent: {
      create: async (options) => {
        createOptions.push(options)
        if (input.createError) throw input.createError
        return agent
      },
      resume: async (agentId, options) => {
        resumedAgentIds.push(agentId)
        if (input.resumeError) throw input.resumeError
        return agent
      }
    },
    ...(input.sessionCoordinator
      ? {
          JsonlLocalAgentStore: class {
            constructor(readonly rootDir: string) {}
          } as never
        }
      : {})
  }
  const thread = {
    id: 'thread_1',
    title: 'Cursor handoff test',
    workspace: '/tmp/cursor-workspace',
    model: 'auto',
    mode: 'agent',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    systemPrompt: '',
    turns: [{ id: 'turn_1', model: 'auto', mode: 'agent' }],
    ...input.thread
  }
  const deps = {
    providerConfigs: {
      'cursor-subscription': {
        kind: 'cursor-sdk',
        apiKey: 'cursor-secret'
      }
    },
    providerIds: new Set(['cursor-subscription']),
    defaultIsCursor: false,
    defaultModel: 'auto',
    systemPrompt: 'Kun system prompt',
    threadStore: { get: async () => thread },
    sessionStore: { loadItems },
    turns: {
      applyItem: async (_threadId: string, item: TurnItem) => {
        applied.push(item)
      },
      updateItem: async () => null,
      updateTurnMetadata: async () => undefined,
      finishTurn: async (value: unknown) => { finished.push(value) }
    },
    events: {
      record: async (value: unknown) => {
        recorded.push(value)
      }
    },
    ids: { next: (prefix: string) => `${prefix}_1` },
    loadSdk: async () => sdk,
    sessionCoordinator: input.sessionCoordinator,
    taskWorkspaces: input.taskWorkspaces,
    ...(input.deterministicHandoff !== undefined
      ? { deterministicHandoff: input.deterministicHandoff }
      : {})
  } as unknown as CursorSdkRuntimeDeps
  return {
    runtime: new CursorSdkRuntime(deps),
    recorded,
    applied,
    finished,
    createOptions,
    sentMessages,
    resumedAgentIds
  }
}

const priorUser = {
  id: 'user_old',
  threadId: 'thread_1',
  turnId: 'turn_old',
  role: 'user',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  kind: 'user_message',
  text: 'portable old context'
}

const currentUser = {
  id: 'user_1',
  threadId: 'thread_1',
  turnId: 'turn_1',
  role: 'user',
  status: 'completed',
  createdAt: '2026-01-01T00:01:00.000Z',
  kind: 'user_message',
  text: 'current only'
}

function cursorRoute() {
  return {
    providerKind: 'cursor-sdk' as const,
    providerId: 'cursor-subscription',
    credentialIdentity: delegatedCredentialIdentity({
      providerId: 'cursor-subscription',
      credentialSecret: 'cursor-secret'
    }),
    workspace: '/tmp/cursor-workspace',
    model: 'auto',
    capabilityFingerprint: delegatedCapabilityFingerprint({
      systemPrompt: 'Kun system prompt',
      threadPersona: '',
      mode: 'agent',
      sandbox: false,
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      settingSources: [],
      capabilities: cursorSdkCapabilities()
    }),
    continuationMode: 'native' as const
  }
}

async function committedBinding(root: string, items: readonly TurnItem[]) {
  const coordinator = new DelegatedSessionCoordinator(
    new FileDelegatedSessionBindingStore(root)
  )
  const prepared = await coordinator.prepare({
    threadId: 'thread_1',
    route: cursorRoute(),
    priorItems: []
  })
  await coordinator.commit({
    preparation: prepared,
    committedItems: items,
    lastCommittedTurnId: 'turn_old',
    nativeSessionId: 'agent_persisted'
  })
  return coordinator
}

describe('CursorSdkRuntime handoff', () => {
  test('fresh delegated generation injects the brief and records handoff_injected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-handoff-'))
    try {
      const coordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const h = harness({
        sessionCoordinator: coordinator,
        items: [priorUser, currentUser]
      })
      await expect(h.runtime.runTurn(
        'thread_1', 'turn_1', new AbortController().signal, 'cursor-subscription'
      )).resolves.toBe('completed')
      const prompt = String(h.sentMessages[0])
      expect(prompt.startsWith('<kun_handoff')).toBe(true)
      expect(prompt).toContain('portable old context')
      expect(prompt).not.toContain('Earlier conversation in this thread')
      const events = h.recorded.filter(
        (event) => (event as { kind?: string }).kind === 'handoff_injected'
      )
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        kind: 'handoff_injected',
        mode: 'full',
        reason: 'harness-switch',
        harnessId: 'cursor',
        to: { harnessName: 'Cursor', model: 'auto' }
      })
      const binding = await coordinator.store.load('thread_1')
      expect(binding?.handoffBriefDigest).toBe(
        (events[0] as { briefDigest?: string }).briefDigest
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('compatible native resume sends no handoff and records no event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-resume-handoff-'))
    try {
      const coordinator = await committedBinding(root, [priorUser] as never)
      const h = harness({
        sessionCoordinator: coordinator,
        items: [priorUser, currentUser]
      })
      await expect(h.runtime.runTurn(
        'thread_1', 'turn_1', new AbortController().signal, 'cursor-subscription'
      )).resolves.toBe('completed')
      expect(h.resumedAgentIds).toEqual(['agent_persisted'])
      const prompt = String(h.sentMessages[0])
      expect(prompt).toContain('current only')
      expect(prompt).not.toContain('portable old context')
      expect(prompt).not.toContain('<kun_handoff')
      expect(
        h.recorded.some((event) => (event as { kind?: string }).kind === 'handoff_injected')
      ).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('failed native resume rebases to a full handoff and records a fresh event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-retry-handoff-'))
    try {
      const coordinator = await committedBinding(root, [priorUser] as never)
      const h = harness({
        sessionCoordinator: coordinator,
        resumeError: new Error('stale native session'),
        items: [priorUser, currentUser]
      })
      await expect(h.runtime.runTurn(
        'thread_1', 'turn_1', new AbortController().signal, 'cursor-subscription'
      )).resolves.toBe('completed')
      expect(h.resumedAgentIds).toEqual(['agent_persisted'])
      const prompt = String(h.sentMessages[0])
      expect(prompt.startsWith('<kun_handoff')).toBe(true)
      expect(prompt).toContain('portable old context')
      const events = h.recorded.filter(
        (event) => (event as { kind?: string }).kind === 'handoff_injected'
      )
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        kind: 'handoff_injected',
        mode: 'full',
        reason: 'rebase'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('deterministicHandoff off restores the raw transcript without the event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-legacy-handoff-'))
    try {
      const coordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const h = harness({
        sessionCoordinator: coordinator,
        deterministicHandoff: false,
        items: [priorUser, currentUser]
      })
      await expect(h.runtime.runTurn(
        'thread_1', 'turn_1', new AbortController().signal, 'cursor-subscription'
      )).resolves.toBe('completed')
      const prompt = String(h.sentMessages[0])
      expect(prompt).toContain('portable old context')
      expect(prompt.startsWith('<kun_handoff')).toBe(false)
      expect(
        h.recorded.some((event) => (event as { kind?: string }).kind === 'handoff_injected')
      ).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
