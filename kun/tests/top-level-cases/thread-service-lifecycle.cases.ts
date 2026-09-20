import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import { ThreadService } from '../../src/services/thread-service.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { createThreadRecord, touchThread } from '../../src/domain/thread.js'
import { createTurnRecord, startTurn } from '../../src/domain/turn.js'
import { makeAssistantTextItem, makeToolCallItem, makeToolResultItem, makeUserItem } from '../../src/domain/item.js'
import type { TurnItem } from '../../src/contracts/items.js'
import { DEFAULT_KUN_MODEL } from '../../src/config/kun-config.js'
import { buildService, seedParentWithTurns, withId } from '../support/thread-service-fixtures.js'

describe('ThreadService runtime defaults', () => {
  it('uses runtime defaults for policy and Agent Perspective capture on new threads only', async () => {
    const bus = new InMemoryEventBus()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const service = new ThreadService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus: bus,
        sessionStore,
        allocateSeq: (threadId) => bus.allocateSeq(threadId),
        nowIso: () => '2026-07-10T00:00:00.000Z'
      }),
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-07-10T00:00:00.000Z',
      defaultApprovalPolicy: 'never',
      defaultSandboxMode: 'read-only',
      defaultModelRequestCaptureEnabled: true
    })

    const thread = await service.create({ workspace: '/tmp', model: 'm', mode: 'agent' })
    expect(thread).toMatchObject({
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      approvalReviewer: 'user',
      modelRequestCaptureEnabled: true
    })

    const explicitlyDisabled = await service.create({
      workspace: '/tmp',
      model: 'm',
      mode: 'agent',
      modelRequestCaptureEnabled: false
    })
    expect(explicitlyDisabled.modelRequestCaptureEnabled).toBe(false)

    service.updateRuntimeDefaults({
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      approvalReviewer: 'agent',
      modelRequestCaptureEnabled: false
    })
    const later = await service.create({ workspace: '/tmp', model: 'm', mode: 'agent' })
    expect(later.modelRequestCaptureEnabled).toBe(false)
    expect(later.approvalReviewer).toBe('agent')
    expect((await service.get(thread.id))?.modelRequestCaptureEnabled).toBe(true)

    const toggled = await service.update(thread.id, { modelRequestCaptureEnabled: false })
    expect(toggled.modelRequestCaptureEnabled).toBe(false)
  })
})

describe('ThreadService status updates', () => {
  it('only treats archive state as mutable and derives restored execution state from turns', async () => {
    const { service, threadStore, nowIso } = buildService()
    const thread = await service.create(
      { workspace: '/tmp/status', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_status', title: 'Status' }
    )
    const active = startTurn(createTurnRecord({
      id: 'turn_active',
      threadId: thread.id,
      prompt: 'still running',
      createdAt: nowIso()
    }), nowIso())
    await threadStore.upsert({ ...thread, status: 'running', turns: [active] })

    const archived = await service.update(thread.id, { status: 'archived' })
    expect(archived.status).toBe('archived')

    const restored = await service.update(thread.id, { status: 'idle' })
    expect(restored.status).toBe('running')

    await expect(service.update(thread.id, { status: 'deleted' } as never))
      .rejects.toThrow('thread status is managed by the runtime')
    expect((await threadStore.get(thread.id))?.status).toBe('running')
  })
})

describe('ThreadService.fork with side relation', () => {
  it('sets parentThreadId and side relation on the new thread', async () => {
    const { service, threadStore } = buildService()
    await service.create(
      {
        workspace: '/tmp/p',
        model: 'deepseek-chat',
        mode: 'agent',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent'
      },
      { id: 'thr_1', title: 'Parent' }
    )
    const side = await service.fork('thr_1', { relation: 'side' })
    expect(side.relation).toBe('side')
    expect(side.parentThreadId).toBe('thr_1')
    expect(side.forkedFromThreadId).toBe('thr_1')
    expect(side.title).toBe('Parent · side')
    expect(side).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'agent'
    })
    await expect(service.fork('thr_1', {
      relation: 'side',
      approvalReviewer: 'user'
    })).rejects.toThrow(/reviewer/i)
    // The parent record must not be mutated by the spawn.
    const parent = await threadStore.get('thr_1')
    expect(parent?.relation ?? 'primary').toBe('primary')
    expect(parent?.parentThreadId).toBeUndefined()
  })

  it('tolerates a running parent turn and drops unfinished assistant/tool items from the clone', async () => {
    const { service, threadStore, sessionStore, nowIso } = buildService()
    await seedParentWithTurns(service, threadStore, sessionStore, nowIso, {
      parentId: 'thr_run',
      inflight: true
    })
    const parentTurnsBefore = (await threadStore.get('thr_run'))!.turns
    const parentItemsBefore = parentTurnsBefore.flatMap((turn) => turn.items)

    const side = await service.fork('thr_run', { relation: 'side' })

    expect(side.relation).toBe('side')
    expect(side.parentThreadId).toBe('thr_run')

    const clonedInflight = side.turns.find((turn) => turn.id === 'turn_inflight')
    expect(clonedInflight).toBeDefined()
    expect(clonedInflight?.status).toBe('aborted')
    // Only the user prompt survives; assistant/tool items are dropped.
    expect(clonedInflight?.items).toHaveLength(1)
    const surviving = clonedInflight?.items[0]
    expect(surviving?.kind).toBe('user_message')
    if (surviving && surviving.kind === 'user_message') {
      expect(surviving.text).toBe('mid-flight ask')
    }

    // Parent is untouched.
    const parentAfter = await threadStore.get('thr_run')
    const parentTurnsAfter = parentAfter!.turns
    expect(parentTurnsAfter).toEqual(parentTurnsBefore)
    expect(parentTurnsAfter.flatMap((turn) => turn.items)).toEqual(parentItemsBefore)
  })

  it('isolates side turns from the parent: side thread mutating its own items leaves parent items unchanged', async () => {
    const { service, threadStore, sessionStore, nowIso } = buildService()
    await seedParentWithTurns(service, threadStore, sessionStore, nowIso, {
      parentId: 'thr_iso',
      inflight: false
    })
    const side = await service.fork('thr_iso', { relation: 'side' })
    // Append a side-only item; parent's session store is untouched.
    const sideItem = withId(
      makeAssistantTextItem({
        id: 'item_side_a',
        turnId: 'turn_side',
        threadId: side.id,
        text: 'side-only reply'
      }),
      'item_side_a'
    )
    await sessionStore.appendItem(side.id, sideItem)
    const sideItems = await sessionStore.loadItems(side.id)
    expect(sideItems).toHaveLength(2)
    const parentItems = await sessionStore.loadItems('thr_iso')
    expect(parentItems).toHaveLength(2)
    expect(parentItems.map((item) => item.kind)).toEqual(['user_message', 'assistant_text'])
    expect(parentItems.find((item) => item.kind === 'user_message')).toMatchObject({
      text: 'first ask'
    })
  })

  it('defaults relation to fork for bodyless fork calls', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_f', title: 'Forker' }
    )
    const fork = await service.fork('thr_f')
    expect(fork.relation).toBe('fork')
    expect(fork.parentThreadId).toBe('thr_f')
    expect(fork.title).toBe('Forker fork')
  })

  it('preserves pinned model routing, persona, and additional roots on forks', async () => {
    const { service } = buildService()
    await service.create(
      {
        workspace: '/tmp/p', additionalWorkspaces: ['/tmp/shared'], model: 'pinned-model',
        providerId: 'provider-a', accountId: 'account-a', agentId: 'reviewer',
        systemPrompt: 'Review carefully', mode: 'agent'
      },
      { id: 'thr_pinned', title: 'Pinned' }
    )
    const fork = await service.fork('thr_pinned')
    expect(fork).toMatchObject({
      model: 'pinned-model', providerId: 'provider-a', accountId: 'account-a',
      agentId: 'reviewer', systemPrompt: 'Review carefully', additionalWorkspaces: ['/tmp/shared']
    })
  })

  it('forks a plan-mode thread as a fresh agent conversation', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'plan' },
      { id: 'thr_plan', title: 'Planner' }
    )
    // A fork must NOT inherit plan mode, or a forked "new conversation" runs as
    // a plan turn bound to a stale plan context (workspace mismatch + malformed
    // plan-mode model requests). It starts a fresh agent conversation instead.
    const fork = await service.fork('thr_plan')
    expect(fork.mode).toBe('agent')
    const side = await service.fork('thr_plan', { relation: 'side' })
    expect(side.mode).toBe('agent')
  })

  it('forks history through a requested turn only', async () => {
    const { service, sessionStore, threadStore, nowIso } = buildService()
    await seedParentWithTurns(service, threadStore, sessionStore, nowIso, {
      parentId: 'thr_branch',
      inflight: true
    })

    const fork = await service.fork('thr_branch', { turnId: 'turn_completed' })
    const forkItems = await sessionStore.loadItems(fork.id)

    expect(fork.turns.map((turn) => turn.id)).toEqual(['turn_completed'])
    expect(forkItems.map((item) => item.id)).toEqual(['item_user_1', 'item_a_1'])
    expect(fork.forkedFromThreadId).toBe('thr_branch')
    expect(fork.forkedFromTurnCount).toBe(1)
    expect(fork.forkedFromTurnId).toBe('turn_completed')
    expect(fork.forkedFromMessageCount).toBe(1)
  })

  it('forks immediately before a requested turn for non-destructive undo', async () => {
    const { service, sessionStore, threadStore, nowIso } = buildService()
    await seedParentWithTurns(service, threadStore, sessionStore, nowIso, {
      parentId: 'thr_undo',
      inflight: true
    })

    const beforeFirst = await service.fork('thr_undo', { turnId: 'turn_completed', beforeTurn: true })
    expect(beforeFirst.turns).toEqual([])
    expect(beforeFirst.forkedFromThreadId).toBe('thr_undo')
    expect(beforeFirst.forkedFromTurnCount).toBe(0)
    expect(beforeFirst.forkedFromTurnId).toBeUndefined()

    const beforeSecond = await service.fork('thr_undo', { turnId: 'turn_inflight', beforeTurn: true })
    expect(beforeSecond.turns.map((turn) => turn.id)).toEqual(['turn_completed'])
    expect((await threadStore.get('thr_undo'))?.turns).toHaveLength(2)
  })

  it('repairs malformed tool-call history when cloning a fork', async () => {
    const { service, threadStore, sessionStore, nowIso } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_tools', title: 'Tool Parent' }
    )
    const turn = startTurn(
      createTurnRecord({
        id: 'turn_tools',
        threadId: 'thr_tools',
        prompt: 'use tools',
        createdAt: nowIso()
      }),
      nowIso()
    )
    const items: TurnItem[] = [
      makeUserItem({ id: 'item_user_tools', turnId: turn.id, threadId: 'thr_tools', text: 'use tools' }),
      makeToolResultItem({
        id: 'item_orphan_result',
        turnId: turn.id,
        threadId: 'thr_tools',
        callId: 'call_orphan',
        toolName: 'echo',
        output: 'orphan'
      }),
      makeToolCallItem({
        id: 'item_missing_call',
        turnId: turn.id,
        threadId: 'thr_tools',
        callId: 'call_missing',
        toolName: 'echo',
        arguments: { text: 'missing' }
      }),
      makeToolCallItem({
        id: 'item_valid_call',
        turnId: turn.id,
        threadId: 'thr_tools',
        callId: 'call_valid',
        toolName: 'echo',
        arguments: { text: 'ok' }
      }),
      makeToolResultItem({
        id: 'item_valid_result',
        turnId: turn.id,
        threadId: 'thr_tools',
        callId: 'call_valid',
        toolName: 'echo',
        output: 'ok'
      })
    ]
    turn.items = items
    const parent = await threadStore.get('thr_tools')
    if (!parent) throw new Error('parent missing')
    await threadStore.upsert(touchThread({ ...parent, turns: [turn] }, nowIso()))
    for (const item of items) {
      await sessionStore.appendItem('thr_tools', item)
    }

    const fork = await service.fork('thr_tools')
    const forkItems = fork.turns.flatMap((clonedTurn) => clonedTurn.items)
    const parentItems = await sessionStore.loadItems('thr_tools')

    expect(parentItems.some((item) => item.kind === 'tool_result' && item.callId === 'call_orphan')).toBe(true)
    expect(forkItems.some((item) => item.kind === 'tool_result' && item.callId === 'call_orphan')).toBe(false)
    expect(forkItems.some((item) => item.kind === 'tool_call' && item.callId === 'call_missing')).toBe(false)
    // Calls emitted by one assistant response form an atomic round. The
    // preceding missing result therefore invalidates the otherwise matching
    // call_valid pair instead of letting a partial round reach a provider.
    expect(forkItems.some((item) => item.kind === 'tool_call' && item.callId === 'call_valid')).toBe(false)
    expect(forkItems.some((item) => item.kind === 'tool_result' && item.callId === 'call_valid')).toBe(false)
  })

  it('respects a custom side title when provided', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_t', title: 'Parent' }
    )
    const side = await service.fork('thr_t', { relation: 'side', title: 'My aside' })
    expect(side.title).toBe('My aside')
  })
})
