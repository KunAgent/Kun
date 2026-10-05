import { describe, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, spawn } from 'node:child_process'
import type { TurnItem } from '../contracts/items.js'
import type { RuntimeEvent } from '../contracts/events.js'
import { TurnSchema } from '../contracts/turns.js'
import { createThreadRecord } from '../domain/thread.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  type DelegatedSessionPreparation,
  type DelegatedSessionRoute
} from './delegated-session-binding.js'
import { buildTurnHandoff } from '../handoff/turn-handoff.js'
import { needsHandoff } from '../handoff/handoff-plan.js'
import { buildHandoffBrief } from '../handoff/handoff-brief.js'
import { extractWorkState } from '../handoff/work-state.js'
import { AntigravityCliRuntime } from './antigravity/antigravity-cli-runtime.js'
import { createAgentSdkRuntime } from './agent-sdk/agent-sdk-runtime-factory.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { handoffPreviewResponse } from '../server/routes/handoff-preview.js'
import { ThreadHistoryReader } from '../services/thread-history-reader.js'

function userItem(id: string, turnId: string, text: string, threadId = 'thread_1'): TurnItem {
  return {
    id,
    threadId,
    turnId,
    role: 'user',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    kind: 'user_message',
    text
  } as TurnItem
}

function assistantItem(id: string, turnId: string, text: string, threadId = 'thread_1'): TurnItem {
  return {
    id,
    threadId,
    turnId,
    role: 'assistant',
    status: 'completed',
    createdAt: '2026-01-01T00:00:30.000Z',
    kind: 'assistant_text',
    text
  } as TurnItem
}

function route(overrides: Partial<DelegatedSessionRoute> = {}): DelegatedSessionRoute {
  return {
    providerKind: 'agent-sdk',
    providerId: 'claude-subscription',
    credentialIdentity: 'cred',
    workspace: '/ws',
    model: 'claude-sonnet-4-6',
    capabilityFingerprint: 'fp',
    continuationMode: 'native',
    ...overrides
  }
}

function preparation(overrides: Partial<DelegatedSessionPreparation> = {}): DelegatedSessionPreparation {
  return {
    threadId: 'thread_1',
    generation: 1,
    route: route(),
    priorHistoryDigest: 'digest',
    resumed: false,
    ...overrides
  }
}

describe('needsHandoff', () => {
  const prior = [userItem('u1', 't1', 'earlier request')]

  test('returns null for a compatible native resume without a parked delta', () => {
    expect(needsHandoff(preparation({ resumed: true, nativeSessionId: 's1' }), prior)).toBeNull()
  })

  test('returns a delta plan when a parked session is restored', () => {
    const plan = needsHandoff(
      preparation({
        resumed: true,
        nativeSessionId: 's1',
        parkedDelta: { lastCommittedTurnId: 't1' }
      }),
      prior
    )
    expect(plan).toEqual({ mode: 'delta', sinceTurnId: 't1' })
  })

  test('returns null when there is no conversational history', () => {
    expect(needsHandoff(preparation(), [])).toBeNull()
  })

  test('maps route changes to harness-switch and other rebases to rebase', () => {
    expect(needsHandoff(preparation({ rebaseReason: 'route_changed' }), prior))
      .toEqual({ mode: 'full', reason: 'harness-switch' })
    expect(needsHandoff(preparation({ rebaseReason: 'capabilities_changed' }), prior))
      .toEqual({ mode: 'full', reason: 'rebase' })
  })
})

describe('buildTurnHandoff', () => {
  const items = [
    userItem('u1', 't1', 'first request'),
    assistantItem('a1', 't1', 'first answer'),
    userItem('u2', 't2', 'second request')
  ]

  test('builds a full brief and handoff_injected payload for a new generation', () => {
    const handoff = buildTurnHandoff({
      items,
      currentTurnId: 't2',
      preparation: preparation({
        rebaseReason: 'route_changed',
        rebasedFrom: {
          providerKind: 'cursor-sdk',
          providerId: 'cursor-subscription',
          model: 'auto'
        }
      }),
      workspacePath: '/ws'
    })
    expect(handoff).not.toBeNull()
    expect(handoff!.brief.text.startsWith('<kun_handoff')).toBe(true)
    expect(handoff!.brief.text).toContain('first request')
    expect(handoff!.event).toMatchObject({
      kind: 'handoff_injected',
      reason: 'harness-switch',
      mode: 'full',
      from: { harnessName: 'Cursor' },
      to: { harnessName: 'Claude Code', model: 'claude-sonnet-4-6' },
      briefDigest: handoff!.brief.digest
    })
  })

  test('labels the Kun loop as the source when no route was displaced', () => {
    const handoff = buildTurnHandoff({
      items,
      currentTurnId: 't2',
      preparation: preparation({ rebaseReason: 'new' })
    })
    expect(handoff!.event.from).toEqual({ harnessName: 'Kun' })
  })

  test('delta briefs only cover turns after the committed anchor', () => {
    const withMid = [
      userItem('u1', 't1', 'first request'),
      assistantItem('a1', 't1', 'first answer'),
      userItem('um', 'tm', 'mid request'),
      assistantItem('am', 'tm', 'mid answer'),
      userItem('u2', 't2', 'second request')
    ]
    const handoff = buildTurnHandoff({
      items: withMid,
      currentTurnId: 't2',
      preparation: preparation({
        resumed: true,
        nativeSessionId: 's1',
        parkedDelta: {
          lastCommittedTurnId: 't1',
          fromRoute: { providerKind: 'cursor-sdk', providerId: 'cursor-subscription', model: 'auto' }
        }
      })
    })
    expect(handoff!.event.mode).toBe('delta')
    expect(handoff!.event.sinceTurnId).toBe('t1')
    // Turns between the anchor and the live turn appear; anchor turns do not.
    expect(handoff!.brief.text).toContain('mid request')
    expect(handoff!.brief.text).not.toContain('first request')
  })

  test('merges task-workspace changed files into the work state', () => {
    const handoff = buildTurnHandoff({
      items,
      currentTurnId: 't2',
      preparation: preparation({ rebaseReason: 'new' }),
      taskWorkspace: { changedFiles: ['src/app.ts', 'README.md'], branch: 'task/ws' },
      workspaceBranch: 'task/ws'
    })
    expect(handoff!.event.workspace).toMatchObject({ path: '/ws', branch: 'task/ws' })
    expect(handoff!.brief.text).toContain('src/app.ts')
    expect(handoff!.brief.text).toContain('README.md')
  })
})

describe('agent-sdk handoff injection', () => {
  async function loadContext(
    items: TurnItem[],
    turnId: string,
    opts: { deterministicHandoff?: boolean; coordinator?: DelegatedSessionCoordinator } = {}
  ) {
    const thread = createThreadRecord({
      id: 'th',
      title: 'handoff',
      workspace: '/ws',
      model: 'claude-sonnet-4-6',
      providerId: 'claude-subscription'
    })
    thread.turns = items
      .map((item) => item.turnId)
      .filter((id, index, all) => all.indexOf(id) === index)
      .map((id) => ({ id, prompt: 'turn' })) as never
    const runtime = createAgentSdkRuntime({
      registry: CapabilityRegistry.fromLocalTools([]),
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: { loadItems: async () => items } as never,
      threadStore: { get: async () => thread } as never,
      events: {} as never,
      ids: { next: (prefix: string) => prefix },
      prefix: { systemPrompt: 'Kun system prompt' },
      providerConfigs: {
        'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-secret' }
      } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto',
      sessionCoordinator: opts.coordinator,
      ...(opts.deterministicHandoff !== undefined
        ? { deterministicHandoff: opts.deterministicHandoff }
        : {})
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          handoffBrief?: string
          handoffEvent?: { kind?: string; mode?: string; reason?: string }
          historyTranscript?: string
          resumeSessionId?: string
          sessionPreparation?: DelegatedSessionPreparation
        } | null>
      }
    }).deps
    return deps.loadTurnContext('th', turnId)
  }

  test('injects a deterministic brief and drops the raw transcript on a new generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sdk-handoff-'))
    try {
      const coordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const items = [userItem('u1', 't1', 'earlier work', 'th'), userItem('u2', 't2', 'now do this', 'th')]
      const context = await loadContext(items, 't2', { coordinator })
      expect(context?.handoffBrief?.startsWith('<kun_handoff')).toBe(true)
      expect(context?.handoffBrief).toContain('earlier work')
      expect(context?.historyTranscript).toBeUndefined()
      expect(context?.handoffEvent).toMatchObject({
        kind: 'handoff_injected',
        mode: 'full',
        reason: 'harness-switch'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('sends no brief on a compatible native resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sdk-resume-'))
    try {
      const coordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const items = [userItem('u1', 't1', 'earlier work', 'th'), userItem('u2', 't2', 'second', 'th')]
      const first = await loadContext(items, 't2', { coordinator })
      await coordinator.commit({
        preparation: first!.sessionPreparation!,
        committedItems: items,
        lastCommittedTurnId: 't2',
        nativeSessionId: 'sess_persisted'
      })
      const next = [
        ...items,
        userItem('u3', 't3', 'third', 'th')
      ]
      const second = await loadContext(next, 't3', { coordinator })
      expect(second?.resumeSessionId).toBe('sess_persisted')
      expect(second?.handoffBrief).toBeUndefined()
      expect(second?.handoffEvent).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('falls back to the raw transcript when deterministicHandoff is off', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sdk-legacy-'))
    try {
      const coordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const items = [userItem('u1', 't1', 'earlier work', 'th'), userItem('u2', 't2', 'now', 'th')]
      const context = await loadContext(items, 't2', { coordinator, deterministicHandoff: false })
      expect(context?.handoffBrief).toBeUndefined()
      expect(context?.handoffEvent).toBeUndefined()
      expect(context?.historyTranscript).toContain('earlier work')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function successfulSpawn(
  output: string,
  onSpawn?: (args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => void
): typeof spawn {
  return ((
    _command: string,
    args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv }
  ) => {
    onSpawn?.(args, options)
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: () => boolean
    }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      child.stdout.end(output)
      child.stderr.end()
      child.emit('exit', 0, null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
}

describe('AntigravityCliRuntime handoff', () => {
  async function run(opts: { deterministicHandoff?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'kun-agy-handoff-'))
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn_1',
      threadId: 'thread_1',
      status: 'running',
      prompt: 'continue the work',
      model: 'gemini-3.6-flash',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: 'thread_1',
        title: 'agy handoff',
        workspace: '/tmp',
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem('thread_1',
      userItem('item_prior', 'turn_0', 'earlier portable context') as never)
    await sessionStore.appendItem('thread_1',
      userItem('item_user', 'turn_1', 'continue the work') as never)
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const recorded: RuntimeEvent[] = []
    let spawnedArgs: readonly string[] = []
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns: {
        applyItem: vi.fn(async () => undefined),
        applyAssistantDelta: vi.fn(async () => undefined),
        updateTurnMetadata: vi.fn(async () => undefined),
        finishTurn: vi.fn(async () => undefined)
      } as unknown as TurnService,
      events: {
        record: vi.fn(async (draft: RuntimeEvent) => {
          recorded.push(draft)
        })
      } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant' },
      sessionCoordinator: coordinator,
      ...(opts.deterministicHandoff !== undefined
        ? { deterministicHandoff: opts.deterministicHandoff }
        : {}),
      spawnFn: successfulSpawn('done\n', (args) => {
        spawnedArgs = args
      })
    })
    const outcome = await runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'gemini-subscription'
    )
    return { outcome, recorded, spawnedArgs, coordinator, root }
  }

  test('injects the brief, emits handoff_injected, and audits the digest on the binding', async () => {
    const { outcome, recorded, spawnedArgs, coordinator, root } = await run()
    try {
      expect(outcome).toBe('completed')
      const prompt = String(spawnedArgs[1] ?? '')
      expect(prompt.startsWith('<kun_handoff')).toBe(true)
      expect(prompt).toContain('earlier portable context')
      const event = recorded.find((entry) => entry.kind === 'handoff_injected')
      expect(event).toMatchObject({
        kind: 'handoff_injected',
        mode: 'full',
        reason: 'harness-switch',
        harnessId: 'antigravity',
        to: { harnessName: 'Antigravity' }
      })
      const binding = await coordinator.store.load('thread_1')
      expect(binding?.handoffBriefDigest).toBe(
        (event as { briefDigest?: string })?.briefDigest
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('falls back to the plain transcript when deterministicHandoff is off', async () => {
    const { outcome, recorded, spawnedArgs, root } = await run({ deterministicHandoff: false })
    try {
      expect(outcome).toBe('completed')
      const prompt = String(spawnedArgs[1] ?? '')
      expect(prompt.startsWith('<kun_handoff')).toBe(false)
      expect(prompt).toContain('earlier portable context')
      expect(recorded.some((entry) => entry.kind === 'handoff_injected')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('GET /v1/threads/:id/handoff-preview', () => {
  const items = [
    userItem('u1', 't1', 'earlier request'),
    assistantItem('a1', 't1', 'earlier answer')
  ]

  function recordedEvent(itemsForDigest: TurnItem[]): Extract<RuntimeEvent, { kind: 'handoff_injected' }> {
    const brief = buildHandoffBrief({
      items: itemsForDigest,
      currentTurnId: 't2',
      reason: 'harness-switch',
      mode: 'full',
      from: { harnessName: 'Kun' },
      to: { harnessName: 'Claude Code' },
      workspace: { path: '/ws' },
      workState: extractWorkState(itemsForDigest, undefined)
    })
    return {
      kind: 'handoff_injected',
      threadId: 'thread_1',
      turnId: 't2',
      seq: 7,
      timestamp: '2026-01-01T00:01:00.000Z',
      reason: 'harness-switch',
      mode: 'full',
      from: { harnessName: 'Kun' },
      to: { harnessName: 'Claude Code' },
      workspace: { path: '/ws' },
      stats: brief.stats,
      briefDigest: brief.digest
    }
  }

  function depsFor(event: RuntimeEvent | null) {
    return {
      sessionStore: {
        loadItems: async () => items,
        loadEventsSince: async () => (event ? [event] : [])
      } as never,
      threadService: {
        get: async () => createThreadRecord({
          id: 'thread_1',
          title: 'preview',
          workspace: '/ws',
          model: 'auto'
        })
      } as never
    }
  }

  test('rebuilds the recorded brief byte-for-byte from the event payload', async () => {
    const event = recordedEvent(items)
    const response = await handoffPreviewResponse(
      depsFor(event),
      'thread_1',
      new URL('http://kun.local/v1/threads/thread_1/handoff-preview?turnId=t2')
    )
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as {
      brief: string
      briefDigest: string
      recordedBriefDigest: string
      reason: string
      mode: string
    }
    expect(body.briefDigest).toBe(event.briefDigest)
    expect(body.recordedBriefDigest).toBe(event.briefDigest)
    expect(body.brief.startsWith('<kun_handoff')).toBe(true)
    expect(body.brief).toContain('earlier request')
    expect(body.reason).toBe('harness-switch')
  })

  test('400s without turnId and 404s when no handoff was recorded for the turn', async () => {
    const event = recordedEvent(items)
    const missingQuery = await handoffPreviewResponse(
      depsFor(event),
      'thread_1',
      new URL('http://kun.local/v1/threads/thread_1/handoff-preview')
    )
    expect(missingQuery.status).toBe(400)
    const wrongTurn = await handoffPreviewResponse(
      depsFor(event),
      'thread_1',
      new URL('http://kun.local/v1/threads/thread_1/handoff-preview?turnId=t_other')
    )
    expect(wrongTurn.status).toBe(404)
    const noEvent = await handoffPreviewResponse(
      depsFor(null),
      'thread_1',
      new URL('http://kun.local/v1/threads/thread_1/handoff-preview?turnId=t2')
    )
    expect(noEvent.status).toBe(404)
  })

  test('does not mix later messages into an earlier handoff preview', async () => {
    const event = recordedEvent(items)
    const deps = depsFor(event)
    deps.sessionStore = { loadEventsSince: async () => [event], loadItems: async () => [...items,
      { ...userItem('later', 't3', 'future private request'), createdAt: '2026-01-01T00:02:00.000Z' }
    ] } as never
    const response = await handoffPreviewResponse(deps, 'thread_1', new URL('http://kun.local/v1/threads/thread_1/handoff-preview?turnId=t2'))
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.briefDigest).toBe(event.briefDigest)
    expect(body.brief).not.toContain('future private request')
  })
})

describe('ThreadHistoryReader', () => {
  function threadItems(): TurnItem[] {
    return [
      userItem('u1', 't1', 'deploy the web service'),
      assistantItem('a1', 't1', 'I deployed the service to staging'),
      userItem('u2', 't2', 'now roll back'),
      assistantItem('a2', 't2', 'rolled back cleanly')
    ]
  }

  test('searches user/assistant text with turn numbers and excerpts', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    for (const item of threadItems()) {
      await sessionStore.appendItem('thread_1', item)
    }
    await threadStore.upsert(createThreadRecord({
      id: 'thread_1', title: 't', workspace: '/ws', model: 'auto'
    }))
    const reader = new ThreadHistoryReader({ sessionStore, threadStore })
    const result = await reader.search('thread_1', { query: 'deploy' })
    expect(result.matches.length).toBeGreaterThan(0)
    expect(result.matches[0]!.role).toBe('user')
    expect(result.matches[0]!.excerpt.toLowerCase()).toContain('deploy')
    expect(result.matches[0]!.turnNumber).toBe(1)
  })

  test('turnRange filters by global turn numbers', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    for (const item of threadItems()) {
      await sessionStore.appendItem('thread_1', item)
    }
    const reader = new ThreadHistoryReader({ sessionStore, threadStore })
    const only2 = await reader.search('thread_1', { turnRange: { from: 2, to: 2 } })
    expect(only2.matches.every((m) => m.turnNumber === 2)).toBe(true)
    expect(only2.matches.length).toBe(2)
  })

  test('pages matches through an opaque cursor', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    for (const item of threadItems()) {
      await sessionStore.appendItem('thread_1', item)
    }
    const reader = new ThreadHistoryReader({ sessionStore, threadStore })
    const first = await reader.search('thread_1', { limit: 2 })
    expect(first.matches).toHaveLength(2)
    expect(first.nextCursor).toBeDefined()
    const second = await reader.search('thread_1', { limit: 2, cursor: first.nextCursor })
    expect(second.matches).toHaveLength(2)
    expect(second.matches.map((m) => m.itemId)).not.toEqual(first.matches.map((m) => m.itemId))
  })

  test('includes fork-ancestor items and never crosses into other threads', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    await sessionStore.appendItem('parent', userItem('p1', 'pt1', 'parent context', 'parent'))
    await sessionStore.appendItem('child', userItem('c1', 'ct1', 'child question', 'child'))
    await threadStore.upsert(createThreadRecord({
      id: 'parent', title: 'p', workspace: '/ws', model: 'auto'
    }))
    await threadStore.upsert({
      ...createThreadRecord({ id: 'child', title: 'c', workspace: '/ws', model: 'auto' }),
      relation: 'fork',
      parentThreadId: 'parent'
    })
    const reader = new ThreadHistoryReader({ sessionStore, threadStore })
    const childView = await reader.search('child', {})
    expect(childView.matches.map((m) => m.excerpt).join(' ')).toContain('child question')
    expect(childView.matches.map((m) => m.excerpt).join(' ')).toContain('parent context')
    // Search is anchored to the trusted thread id — a different thread sees only its own.
    const parentView = await reader.search('parent', {})
    expect(parentView.matches.map((m) => m.excerpt).join(' ')).not.toContain('child question')
  })
})
