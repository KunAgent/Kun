import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThreadSchema } from '../../src/contracts/threads.js'
import type { RuntimeEvent } from '../../src/contracts/events.js'
import type { ModelConnectionSnapshot } from '../../src/contracts/model-connections.js'
import type { KunTuiClient, ThreadDetail, TuiConnection } from '../../src/tui/client.js'
import { TuiClientError } from '../../src/tui/client.js'
import { TuiController } from '../../src/tui/controller.js'
import type { TuiOptions } from '../../src/tui/options.js'
import { buildRuntimeCapabilityManifest } from '../../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../../src/loop/model-context-profile.js'
import { testGraphEnvelope, testGraphPlan } from '../../src/graph/graph-test-fixtures.test-support.js'
import { testTuiGraphRun } from '../../src/tui/graph-mode.test-support.js'

function detail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_1',
      title: 'Shared',
      workspace: '/tmp/project',
      model: 'model-a',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      relation: 'primary',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: [],
    ...overrides
  }
}

function options(): TuiOptions {
  return {
    runtimeToken: 'secret',
    dataDir: '/tmp/data',
    workspace: '/tmp/project',
    continueLatest: true,
    noStart: false,
    help: false
  }
}

const runtime = {
  baseUrl: 'http://127.0.0.1:18899',
  runtimeToken: 'secret',
  discovered: true,
  runtimeInfo: {
    model: 'model-a',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write'
  }
} as unknown as TuiConnection

function credentialSnapshot(
  credentialStatus: 'ready' | 'missing' | 'unreadable' | undefined
): ModelConnectionSnapshot {
  return {
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision: 9,
    providers: [{
      id: 'legacy-provider',
      accountId: 'account:legacy-provider',
      name: 'Legacy Provider',
      kind: 'http',
      authType: 'api-key',
      endpointFormat: 'chat_completions',
      useProxy: false,
      configured: true,
      ...(credentialStatus ? { credentialStatus } : {}),
      models: ['model-a'],
      selectedModel: 'model-a'
    }],
    defaultProviderId: 'legacy-provider',
    defaultAccountId: 'account:legacy-provider',
    defaultModel: 'model-a',
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  }
}

describe("TuiController workspace commands and goals", () => {
  it('persists permissions, plan mode, and an additional workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-controller-'))
    const extra = await mkdtemp(join(tmpdir(), 'kun-tui-controller-extra-'))
    let current = detail({ workspace: root })
    const updateThread = vi.fn(async (_id: string, patch: Partial<ThreadDetail>) => {
      current = { ...current, ...patch }
      return current
    })
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      updateThread
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options(), workspace: root }, runtime)
    try {
      await controller.start()
      await expect(controller.setPermissions('never', 'read-only', 'user')).resolves.toBe(true)
      await controller.setPlanMode('plan')
      await controller.addDirectory(extra)
      const canonicalExtra = await realpath(extra)
      expect(controller.state.projection?.thread).toMatchObject({
        approvalPolicy: 'never',
        sandboxMode: 'read-only',
        approvalReviewer: 'user',
        mode: 'plan',
        additionalWorkspaces: [canonicalExtra]
      })
      expect(updateThread).toHaveBeenCalledWith('thr_1', { additionalWorkspaces: [canonicalExtra] })
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
      await rm(extra, { recursive: true, force: true })
    }
  })

  it('activates a persistent goal as an agent turn and keeps it visible in the shared thread', async () => {
    let current = detail({ mode: 'plan' })
    const updateThread = vi.fn(async (_id: string, patch: Partial<ThreadDetail>) => {
      current = { ...current, ...patch }
      return current
    })
    const setThreadGoal = vi.fn(async (_id: string, request: { objective?: string; status?: string }) => {
      const now = '2026-07-22T00:00:01.000Z'
      current = {
        ...current,
        goal: {
          threadId: current.id,
          objective: request.objective ?? current.goal?.objective ?? '',
          status: request.status === 'active' ? 'active' : current.goal?.status ?? 'active',
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: now,
          updatedAt: now
        }
      }
      return { goal: current.goal }
    })
    const startTurn = vi.fn(async () => ({ turnId: 'turn_goal' }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      updateThread,
      setThreadGoal,
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()

    await expect(controller.activateGoal('Ship the complete TUI')).resolves.toBe(true)
    expect(updateThread).toHaveBeenCalledWith(current.id, { mode: 'agent' })
    expect(setThreadGoal).toHaveBeenCalledWith(current.id, {
      objective: 'Ship the complete TUI',
      status: 'active'
    })
    expect(startTurn).toHaveBeenCalledWith(current.id, expect.objectContaining({
      prompt: 'Ship the complete TUI',
      mode: 'agent'
    }))
    expect(controller.state.projection?.thread.goal?.objective).toBe('Ship the complete TUI')
    expect(controller.state.projection?.runningTurnId).toBe('turn_goal')
    await controller.stop()
  })

  it('pauses an active goal when the user explicitly switches to Plan mode', async () => {
    const now = '2026-07-22T00:00:00.000Z'
    let current = detail({
      goal: {
        threadId: 'thr_1',
        objective: 'Finish everything',
        status: 'active',
        tokensUsed: 10,
        timeUsedSeconds: 5,
        createdAt: now,
        updatedAt: now
      }
    })
    const setThreadGoal = vi.fn(async (_id: string, request: { status?: string }) => {
      current = {
        ...current,
        goal: current.goal ? { ...current.goal, status: request.status === 'paused' ? 'paused' : current.goal.status } : undefined
      }
      return { goal: current.goal ?? null }
    })
    const updateThread = vi.fn(async (_id: string, patch: Partial<ThreadDetail>) => {
      current = { ...current, ...patch }
      return current
    })
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      setThreadGoal,
      updateThread
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()

    await controller.setPlanMode('plan')
    expect(setThreadGoal).toHaveBeenCalledWith(current.id, { status: 'paused' })
    expect(updateThread).toHaveBeenCalledWith(current.id, { mode: 'plan' })
    expect(controller.state.projection?.thread).toMatchObject({
      mode: 'plan',
      goal: { status: 'paused' }
    })
    await controller.stop()
  })

  it('exposes runtime diagnostics and invokes workspace-visible skills through real turns', async () => {
    const source = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_skill' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      runtimeTools: vi.fn(async () => ({
        providers: [],
        mcpServers: [{
          id: 'git', enabled: true, transport: 'stdio', trustScope: 'workspace', available: true,
          status: 'connected', toolCount: 3, toolNames: ['diff', 'log', 'status']
        }]
      })),
      skills: vi.fn(async () => ({
        enabled: true, roots: [], validationErrors: [],
        skills: [{
          id: 'review', name: 'Review', version: '1', root: '/tmp/skill', source: 'project',
          legacy: false, allowedTools: [], description: 'Review code'
        }]
      })),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()

    await controller.showMcp()
    expect(controller.state.inspection?.lines).toEqual(expect.arrayContaining([
      'git: connected · 3 tools · stdio',
      '  Tools: diff, log, status'
    ]))
    controller.dismissInspection()
    await controller.invokeSkill('review', 'check the diff')
    expect(startTurn).toHaveBeenCalledWith('thr_1', expect.objectContaining({
      prompt: '/skill:review check the diff'
    }))
    await controller.stop()
  })

  it('aggregates plan, goal, task, context, and queue state from shared runtime APIs', async () => {
    const source = detail()
    source.status = 'running'
    source.turns = [{
      id: 'turn_queued', threadId: source.id, status: 'running', orchestration: 'direct', prompt: 'work', steering: ['check packaging'],
      createdAt: source.createdAt, items: [], attachmentIds: [], activeSkillIds: [],
      injectedMemoryIds: [], injectedMemorySummaries: [], injectedInstructionSources: []
    }]
    const todo = {
      id: 'todo_1', content: 'Ship tests', status: 'in_progress' as const,
      createdAt: source.createdAt, updatedAt: source.updatedAt
    }
    const setThreadGoal = vi.fn(async () => ({ goal: null }))
    const steerTurn = vi.fn(async () => ({ ok: true }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      threadTodos: vi.fn(async () => ({
        todos: { threadId: source.id, items: [todo], updatedAt: source.updatedAt }
      })),
      threadGoal: vi.fn(async () => ({ goal: {
        threadId: source.id, objective: 'Ship all P0/P1 commands', status: 'active',
        tokensUsed: 10, timeUsedSeconds: 5, createdAt: source.createdAt, updatedAt: source.updatedAt
      } })),
      setThreadGoal,
      steerTurn,
      steeringQueue: vi.fn(async () => ({
        threadId: source.id,
        turnId: 'turn_queued',
        entries: [{ id: 'steer_1', text: 'check packaging', queuedAt: source.updatedAt }]
      })),
      delegationDiagnostics: vi.fn(async () => ({
        enabled: true, active: 1, childRuns: [{
          id: 'child_1', parentThreadId: source.id, parentTurnId: 'turn_1', prompt: 'Review',
          status: 'running', createdAt: source.createdAt, updatedAt: source.updatedAt
        }], aggregates: []
      })),
      backgroundShells: vi.fn(async () => ({
        threadId: source.id, running: 1, sessions: [{
          id: 'shell_1', threadId: source.id, turnId: 'turn_1', command: 'npm test', cwd: source.workspace,
          shell: 'sh', status: 'running', startedAt: source.createdAt, detached: true, output: ''
        }]
      })),
      runtimeTools: vi.fn(async () => ({
        providers: [], mcpServers: [], extensions: { jobs: {
          activeCount: 1, subscriptionCount: 0, recent: [{
            jobId: 'job_1', ownerExtensionId: 'ext', kind: 'task', state: 'running',
            executionAttempt: 1, action: 'sync'
          }]
        } }
      })),
      usage: vi.fn(async () => ({ buckets: [{
        thread_id: source.id, input_tokens: 100, output_tokens: 20, reasoning_tokens: 5,
        cached_tokens: 50, total_tokens: 125, turns: 2
      }] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()

    await controller.showPlan()
    expect(controller.state.inspection?.lines).toContain('1. [in_progress] Ship tests')
    controller.dismissInspection()
    await controller.showTasks()
    expect(controller.state.inspection?.lines).toEqual(expect.arrayContaining([
      'Subagents: 1 active / 1 total',
      'Background shells: 1 active / 1 total',
      'Goal: active · Ship all P0/P1 commands',
      'Extension jobs: 1 active / 1 recent'
    ]))
    controller.dismissInspection()
    await controller.showContext()
    expect(controller.state.inspection?.lines).toContain(
      'Latest request: no request-local context snapshot yet'
    )
    expect(controller.state.inspection?.lines).toContain(
      'Cumulative usage (not context occupancy):'
    )
    expect(controller.state.inspection?.lines).toContain('Total: 125 tokens')
    controller.dismissInspection()
    await controller.showQueue()
    expect(controller.state.inspection?.lines).toContain('1. check packaging')
    await controller.manageGoal('Ship the TUI')
    expect(setThreadGoal).toHaveBeenCalledWith(source.id, { objective: 'Ship the TUI', status: 'active' })
    expect(steerTurn).toHaveBeenCalledWith(source.id, 'turn_queued', 'Ship the TUI')
    await controller.stop()
  })

  it('runs /init guidance as a normal authoritative turn', async () => {
    const source = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_init' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()
    await controller.initializeWorkspace('Use the repository package manager.')

    expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
      prompt: expect.stringMatching(/create or update.*AGENTS\.md[\s\S]*Use the repository package manager\./i)
    }))
    await controller.stop()
  })

  it('starts by-the-way questions in an isolated side thread', async () => {
    const source = detail()
    const side = detail({ id: 'thr_side', title: 'Shared · side', relation: 'side', parentThreadId: source.id })
    const forkThread = vi.fn(async () => side)
    const startTurn = vi.fn(async () => ({ turnId: 'turn_side' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async (id: string) => id === side.id ? side : source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      forkThread,
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()
    await controller.askSideQuestion('What does this API do?')

    expect(forkThread).toHaveBeenCalledWith(source.id, { relation: 'side', title: 'Shared · side' })
    expect(startTurn).toHaveBeenCalledWith(side.id, expect.objectContaining({
      prompt: 'What does this API do?',
      clientSurface: 'tui'
    }))
    expect(controller.state.projection?.thread.id).toBe(side.id)
    await controller.stop()
  })
})
