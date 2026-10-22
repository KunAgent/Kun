import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { CreateThreadRequest } from '../contracts/threads.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { TaskSuggestionIntentSchema, type TaskSuggestionIntent, type TaskSuggestionTask } from '../contracts/task-suggestions.js'
import { TaskSuggestionLauncher, classifyTaskLaunchError, taskThreadId } from './task-suggestion-launcher.js'

const workspace = resolve('/tmp/kun-task-suggestion-workspace')

function harness() {
  const threadStore = new InMemoryThreadStore()
  const sessions = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-10-22T08:00:00.000Z'
  const events = new RuntimeEventRecorder({ eventBus, sessionStore: sessions,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso })
  const threads = new ThreadService({ threadStore, sessionStore: sessions, events, ids, nowIso })
  const turns = new TurnService({ threadStore, sessionStore: sessions, events, inflight: new InflightTracker(),
    steering: new SteeringQueue(), compactor: new ContextCompactor(), ids, nowIso })
  return { threads, turns }
}

function intentFor(parentId: string, overrides: Partial<TaskSuggestionTask> = {}): TaskSuggestionIntent {
  const task = (id: string, title: string): TaskSuggestionTask => ({ id, title, area: 'backend', state: 'starting', attempt: 0,
    brief: { goal: `Goal of ${title}`, scope: ['one file'], done: ['tests pass'] },
    route: { agentId: 'kun', model: 'deepseek-v4-pro' }, worktree: false, inheritContext: false })
  return TaskSuggestionIntentSchema.parse({ intentId: 'tsg_1', revision: 2, source: { threadId: parentId, turnId: 'turn_x', toolCallId: 'call_x' },
    state: 'active', workspace, tasks: [{ ...task('t1', 'Drop column'), ...overrides }, task('t2', 'Cache scans')],
    requestIds: [], createdAt: '2026-10-22T08:00:00.000Z', updatedAt: '2026-10-22T08:00:00.000Z' })
}

describe('TaskSuggestionLauncher', () => {
  it('creates a nested task thread and admits the brief as its first turn, idempotently', async () => {
    const { threads, turns } = harness()
    const parent = await threads.create(CreateThreadRequest.parse({ title: 'Speed up local loading', workspace, model: 'parent-model' }))
    const launcher = new TaskSuggestionLauncher({ threads, turns })
    const intent = intentFor(parent.id)
    const progress: unknown[] = []
    const outcome = await launcher.launch(intent, intent.tasks[0]!, async (entry) => { progress.push(entry) })
    expect(outcome.threadId).toBe(taskThreadId('tsg_1', 't1', 0))
    expect(progress).toEqual([{ threadId: outcome.threadId }])
    const child = (await threads.get(outcome.threadId))!
    expect(child).toMatchObject({ relation: 'task', parentThreadId: parent.id, title: 'Drop column', workspace,
      taskOrigin: { intentId: 'tsg_1', taskId: 't1', index: 1, total: 2 } })
    const turn = child.turns.find((entry) => entry.id === outcome.turnId)!
    expect(turn.prompt).toContain('## 1/2 · Drop column')
    expect(turn.prompt).toContain('### Done when\n- tests pass')
    expect(turn.prompt).toContain('split off from the conversation "Speed up local loading"')
    expect(turn.model).toBe('deepseek-v4-pro')
    const shown = (await threads.get(outcome.threadId))!.turns[0]!.items.find((item) => item.kind === 'user_message')
    expect(shown && 'displayText' in shown ? shown.displayText : '').toBe('1/2 · Drop column\nbackend\n\nGoal\nGoal of Drop column\n\nScope\n• one file\n\nDone when\n• tests pass')
    const again = await launcher.launch(intent, { ...intent.tasks[0]!, threadId: outcome.threadId }, async () => undefined)
    expect(again).toEqual(outcome)
    expect((await threads.get(outcome.threadId))!.turns).toHaveLength(1)
    const listed = await threads.list()
    expect(listed.map((entry) => entry.id)).toContain(outcome.threadId)
  })

  it('binds a ready worktree before the first turn and reports its branch', async () => {
    const { threads, turns } = harness()
    const parent = await threads.create(CreateThreadRequest.parse({ title: 'Parent', workspace, model: 'm' }))
    const records = new Map<string, TaskWorkspaceRecord>()
    let polls = 0
    const taskWorkspaces = {
      create: (input: { ownerThreadId: string; sourceRoot: string }) => {
        const record = { workspaceId: 'tws_abcdefgh12', ownerThreadId: input.ownerThreadId, isolation: 'worktree',
          sourceRoot: input.sourceRoot, path: resolve(workspace, '../wt-1'), startFrom: { kind: 'current-head' },
          branch: 'kun/drop-column', state: 'creating', setup: { status: 'pending' }, changedFiles: [],
          createdAt: '2026-10-22T08:00:00.000Z', updatedAt: '2026-10-22T08:00:00.000Z' } as TaskWorkspaceRecord
        records.set(record.workspaceId, record)
        return record
      },
      get: (id: string) => {
        const record = records.get(id)
        polls += 1
        return record && polls > 2 ? { ...record, state: 'ready' as const } : record
      }
    }
    const launcher = new TaskSuggestionLauncher({ threads, turns, taskWorkspaces, sleep: async () => undefined })
    const intent = intentFor(parent.id, { worktree: true })
    const progress: Record<string, unknown>[] = []
    const outcome = await launcher.launch(intent, intent.tasks[0]!, async (entry) => { progress.push(entry) })
    expect(outcome).toMatchObject({ taskWorkspaceId: 'tws_abcdefgh12', branch: 'kun/drop-column' })
    expect(progress).toEqual([{ threadId: outcome.threadId }, { taskWorkspaceId: 'tws_abcdefgh12' }, { branch: 'kun/drop-column' }])
    const child = (await threads.get(outcome.threadId))!
    expect(child.workspace).toBe(resolve(workspace, '../wt-1'))
    expect(child.turns[0]!.prompt).toContain('branch `kun/drop-column`')
  })

  it('refuses task and side threads as card owners and inspects settled turns', async () => {
    const { threads, turns } = harness()
    const parent = await threads.create(CreateThreadRequest.parse({ title: 'Parent', workspace, model: 'm' }))
    const launcher = new TaskSuggestionLauncher({ threads, turns })
    expect(await launcher.describeSource(parent.id, 'none')).toEqual({ workspace, route: { agentId: 'kun', model: 'm' } })
    const intent = intentFor(parent.id)
    const outcome = await launcher.launch(intent, intent.tasks[0]!, async () => undefined)
    expect(await launcher.describeSource(outcome.threadId, outcome.turnId)).toHaveProperty('refused')
    expect(await launcher.inspect({ ...intent.tasks[0]!, threadId: outcome.threadId, turnId: outcome.turnId }))
      .toEqual({ status: 'queued' })
    expect(await launcher.inspect({ ...intent.tasks[0]!, threadId: 'nope', turnId: 'nope' })).toEqual({ status: 'missing' })
  })

  it('detaches a task session into a primary thread and never turns a thread into a task by patch', async () => {
    const { threads, turns } = harness()
    const parent = await threads.create(CreateThreadRequest.parse({ title: 'Parent', workspace, model: 'm' }))
    const intent = intentFor(parent.id)
    const outcome = await new TaskSuggestionLauncher({ threads, turns }).launch(intent, intent.tasks[0]!, async () => undefined)
    await expect(threads.update(parent.id, { relation: 'task' })).rejects.toThrow(/suggestion card/)
    const detached = await threads.update(outcome.threadId, { relation: 'primary' })
    expect(detached.relation).toBe('primary')
    expect(detached.parentThreadId).toBeUndefined()
    expect(detached.taskOrigin).toBeUndefined()
  })

  it('maps launch errors to recovery codes', () => {
    expect(classifyTaskLaunchError(new Error('ENOSPC: no space left on device')).code).toBe('disk_space')
    expect(classifyTaskLaunchError(new Error("fatal: a branch named 'kun/x' already exists")).code).toBe('worktree_conflict')
    expect(classifyTaskLaunchError(new Error('Claude Code is not logged in')).code).toBe('agent_unavailable')
    expect(classifyTaskLaunchError(new Error('429 rate limit exceeded')).code).toBe('quota')
    expect(classifyTaskLaunchError(new Error('boom')).code).toBe('runtime')
  })
})
