import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileGraphPlanningDraftStore } from '../graph/graph-planning-draft-store.js'
import { createThreadRecord } from '../domain/thread.js'
import type { GraphPlanningDraftV1 } from '../contracts/graph-planning.js'
import type { GraphPlanningLifecycle } from '../contracts/turns.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { buildGraphDefinePlanTool } from '../adapters/tool/graph-define-plan-tool.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

const roots: string[] = []
const threadId = 'thr_graph_queue'
const nowIso = () => new Date().toISOString()

function lifecycle(draft: GraphPlanningDraftV1): GraphPlanningLifecycle {
  return {
    version: 1,
    draftId: draft.id,
    reservedRunId: draft.reservedRunId,
    state: draft.status,
    draftRevision: draft.revision
  }
}

function harness(root: string) {
  const threadStore = new FileThreadStore({ dataDir: root })
  const sessionStore = new FileSessionStore({ dataDir: root })
  const eventBus = new InMemoryEventBus()
  const drafts = new FileGraphPlanningDraftStore({ rootDir: root, nowIso })
  const createGraphPlanningDraft = vi.fn(async (input: {
    threadId: string; sourceTurnId: string; goal: string; workspace?: string
  }) => lifecycle(await drafts.create({
    ...input,
    id: `draft_${input.sourceTurnId}`,
    reservedRunId: `run_${input.sourceTurnId}`,
    projectId: 'project_queue'
  })))
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events: new RuntimeEventRecorder({
      eventBus, sessionStore, nowIso,
      allocateSeq: (id) => eventBus.allocateSeq(id)
    }),
    ids: new SequentialIdGenerator(),
    nowIso,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    createGraphPlanningDraft,
    resolveGraphPlanningDraft: async ({ threadId: id, sourceTurnId }) => {
      const draft = await drafts.findBySourceTurn(sourceTurnId)
      return draft?.threadId === id ? lifecycle(draft) : null
    }
  })
  return { turns, threadStore, drafts, eventBus, createGraphPlanningDraft }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'kun-graph-queue-'))
  roots.push(root)
  const h = harness(root)
  await h.threadStore.upsert(createThreadRecord({
    id: threadId, title: 'Graph queue', workspace: root, model: 'deepseek-v4-pro'
  }))
  return { ...h, root }
}

async function expectFirstPlanCommits(h: ReturnType<typeof harness>, turnId: string) {
  const draft = await h.drafts.findBySourceTurn(turnId)
  expect(draft).not.toBeNull()
  expect(await h.turns.getTurn(threadId, turnId)).toMatchObject({
    status: 'running', graphPlanningLifecycle: lifecycle(draft!)
  })
  const create = vi.fn().mockResolvedValue({
    run: { id: draft!.reservedRunId, status: 'ready' },
    validation: { valid: true, issues: [] }
  })
  const tool = buildGraphDefinePlanTool({
    control: {
      create,
      get: vi.fn().mockResolvedValue({ id: draft!.reservedRunId, status: 'ready' }),
      start: vi.fn().mockResolvedValue({ id: draft!.reservedRunId, status: 'running' }),
      cancel: vi.fn()
    } as never,
    drafts: h.drafts,
    registry: {
      identify: async () => ({ projectId: 'project_queue', canonicalWorkspaceRoot: '/workspace' })
    } as never,
    events: { record: vi.fn() } as never,
    shouldAdvertise: () => true,
    nowIso,
    nextId: () => 'command_queue'
  })
  await expect(tool.execute({
    plan: {
      tasks: [{
        key: 'implement', kind: 'work', title: 'Implement',
        objective: 'Implement the requested change.', dependsOn: [], dataFrom: [],
        acceptanceCriteria: ['The requested behavior works.'],
        readScopes: ['.'], writeScopes: ['src']
      }]
    }
  }, {
    threadId, turnId, workspace: '/workspace', orchestration: 'graph',
    approvalPolicy: 'never', abortSignal: new AbortController().signal,
    awaitApproval: async () => 'deny'
  })).resolves.toMatchObject({ output: { status: 'committed' } })
  expect(create).toHaveBeenCalledTimes(1)
  expect(await h.drafts.list()).toHaveLength(1)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Graph planning admission', () => {
  it('initializes an immediate Graph turn before turn_started', async () => {
    const h = await setup()
    const observed: Array<Promise<GraphPlanningDraftV1 | null>> = []
    h.eventBus.subscribe(threadId, (event) => {
      if (event.kind === 'turn_started' && event.turnId) observed.push(h.drafts.findBySourceTurn(event.turnId))
    })
    const started = await h.turns.startTurn({
      threadId, request: { prompt: 'Implement it', orchestration: 'graph' }
    })
    expect(await Promise.all(observed)).toHaveLength(1)
    expect((await Promise.all(observed))[0]).toMatchObject({ sourceTurnId: started.turnId })
    await expectFirstPlanCommits(h, started.turnId)
  })

  it('initializes an ordinary queued Graph turn before turn_started', async () => {
    const h = await setup()
    const blocker = await h.turns.startTurn({ threadId, request: { prompt: 'First' } })
    const queued = await h.turns.enqueueTurn({
      threadId, request: { prompt: 'Implement it', orchestration: 'graph' }
    })
    expect(await h.drafts.list()).toHaveLength(0)
    await h.turns.finishTurn({ threadId, turnId: blocker.turnId, status: 'completed' })
    const observed: Array<Promise<GraphPlanningDraftV1 | null>> = []
    h.eventBus.subscribe(threadId, (event) => {
      if (event.kind === 'turn_started' && event.turnId) observed.push(h.drafts.findBySourceTurn(event.turnId))
    })
    expect(await h.turns.startNextQueuedTurn({ threadId })).toEqual({ turnId: queued.turnId })
    expect(await Promise.all(observed)).toHaveLength(1)
    expect((await Promise.all(observed))[0]).toMatchObject({ sourceTurnId: queued.turnId })
    await expectFirstPlanCommits(h, queued.turnId)
  })

  it('initializes a persisted queued Graph turn after stores and service restart', async () => {
    const h = await setup()
    const queued = await h.turns.enqueueTurn({
      threadId, request: { prompt: 'Implement it', orchestration: 'graph' }
    })
    const restarted = harness(h.root)
    expect(await restarted.turns.startNextQueuedTurn({ threadId })).toEqual({ turnId: queued.turnId })
    await expectFirstPlanCommits(restarted, queued.turnId)
    expect(restarted.createGraphPlanningDraft).toHaveBeenCalledTimes(1)
  })

  it('reuses the durable draft when promotion CAS retries without lifecycle metadata', async () => {
    const h = await setup()
    const queued = await h.turns.enqueueTurn({
      threadId, request: { prompt: 'Implement it', orchestration: 'graph' }
    })
    const originalCommit = h.threadStore.upsertIfRevision.bind(h.threadStore)
    const commit = vi.spyOn(h.threadStore, 'upsertIfRevision')
      .mockImplementationOnce((record, revision) => originalCommit(record, revision + 1))
    expect(await h.turns.startNextQueuedTurn({ threadId })).toEqual({ turnId: queued.turnId })
    expect(commit).toHaveBeenCalledTimes(2)
    expect(h.createGraphPlanningDraft).toHaveBeenCalledTimes(1)
    expect(await h.turns.startNextQueuedTurn({ threadId })).toBeNull()
    await expectFirstPlanCommits(h, queued.turnId)
  })

  it('keeps the queued turn unstarted on initialization failure and reuses its draft after restart', async () => {
    const h = await setup()
    const queued = await h.turns.enqueueTurn({
      threadId, request: { prompt: 'Implement it', orchestration: 'graph' }
    })
    const create = h.createGraphPlanningDraft.getMockImplementation()!
    h.createGraphPlanningDraft.mockImplementationOnce(async (input) => {
      await create(input)
      throw new Error('draft acknowledgment lost')
    })
    await expect(h.turns.startNextQueuedTurn({ threadId })).rejects.toThrow('draft acknowledgment lost')
    expect(await h.turns.getTurn(threadId, queued.turnId)).toMatchObject({ status: 'queued' })
    const restarted = harness(h.root)
    await restarted.turns.startNextQueuedTurn({ threadId })
    expect(restarted.createGraphPlanningDraft).not.toHaveBeenCalled()
    await expectFirstPlanCommits(restarted, queued.turnId)
  })
})
