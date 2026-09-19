import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeUserItem } from '../domain/item.js'
import { DesignTaskProfileInputSchema } from '../contracts/design-task-profile.js'
import { StartTurnRequest } from '../contracts/turns.js'
import {
  DesignProfileLockedError,
  TaskSurfaceLockedError,
} from './turn-service.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import {
  ControlledFailureSessionStore,
  FailFirstAppendStore,
  harness,
  nowIso,
  profile,
  target
} from './design-task-profile.test-helpers.js'

describe('Design task profile contracts', () => {
  it('accepts missing legacy metadata and rejects malformed new profiles', () => {
    expect(DesignTaskProfileInputSchema.safeParse(profile()).success).toBe(true)
    expect(StartTurnRequest.safeParse({ prompt: 'legacy' }).success).toBe(true)
    expect(DesignTaskProfileInputSchema.safeParse({
      ...profile(),
      preset: 'unknown'
    }).success).toBe(false)
    expect(StartTurnRequest.safeParse({
      prompt: 'mismatch',
      agentSurface: 'design',
      designProfile: profile(),
      designDocumentTarget: target('other')
    }).success).toBe(false)
    expect(StartTurnRequest.safeParse({
      prompt: 'misrouted placement', agentSurface: 'design',
      designProfile: profile(), designDocumentTarget: target(),
      designImagePlacementTarget: {
        shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect'
      }
    }).success).toBe(false)
    expect(DesignTaskProfileInputSchema.safeParse({
      ...profile(),
      extra: true
    }).success).toBe(false)
    expect(DesignTaskProfileInputSchema.safeParse({
      ...profile(),
      canvasEngine: 'excalidraw'
    }).success).toBe(true)
    expect(DesignTaskProfileInputSchema.safeParse({
      ...profile(),
      canvasEngine: 'unknown'
    }).success).toBe(false)
    expect(DesignTaskProfileInputSchema.safeParse({
      ...profile(),
      preset: 'none',
      presetSource: 'root-design-md'
    }).success).toBe(true)
    expect(DesignTaskProfileInputSchema.safeParse({
      ...profile(),
      styleSnapshot: {
        version: 1,
        source: 'root-design-md',
        sourceHash: 'hash',
        sourceName: 'Project',
        content: '{}'
      }
    }).success).toBe(false)
  })

  it('persists a locked profile through the file thread store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-design-profile-'))
    try {
      const store = new FileThreadStore({ dataDir: root })
      const record = createThreadRecord({
        id: 'thr_design_persist',
        title: 'Design',
        workspace: '/tmp/workspace',
        model: 'test',
        agentSurface: 'design',
        designProfile: { ...profile(), lockedAtTurnId: 'turn_lock' }
      })
      await store.upsert(record)
      expect((await store.get(record.id))?.designProfile).toEqual(record.designProfile)
      expect((await store.list())[0]?.designProfile).toEqual(record.designProfile)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists a bounded primary-image placement intent on the user item', async () => {
    const state = harness()
    const thread = createThreadRecord({
      id: 'thr_image_placement', title: 'Image placement',
      workspace: '/tmp/workspace', model: 'test', agentSurface: 'code'
    })
    await state.threadStore.upsert(thread)
    const submitted = profile(target('image-placement'), 'image')
    const designImagePlacementTarget = {
      shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect' as const
    }
    const accepted = await state.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'Generate the hero', agentSurface: 'design',
        designProfile: submitted, designDocumentTarget: submitted.documentTarget,
        designImagePlacementTarget
      }
    })

    expect((await state.sessionStore.loadItems(thread.id))[0]).toMatchObject({
      designImagePlacementTarget, workspace: '/tmp/workspace'
    })
    await state.turns.finishTurn({
      threadId: thread.id, turnId: accepted.turnId, status: 'completed'
    })
  })
})

describe('Design task admission and fork', () => {
  it('atomically locks and snapshots the first profile, then rejects conflicts', async () => {
    const state = harness()
    const thread = createThreadRecord({
      id: 'thr_design_admission',
      title: 'Design',
      workspace: '/tmp/workspace',
      model: 'test',
      agentSurface: 'design'
    })
    await state.threadStore.upsert(thread)
    const submitted = profile()
    const request = {
      prompt: 'Design a dashboard',
      clientRequestId: 'design_request_1',
      agentSurface: 'design' as const,
      designProfile: submitted,
      designDocumentTarget: submitted.documentTarget
    }
    const accepted = await state.turns.startTurn({ threadId: thread.id, request })
    const replay = await state.turns.startTurn({ threadId: thread.id, request })
    expect(replay).toEqual(accepted)

    const locked = await state.threadStore.get(thread.id)
    expect(locked?.agentSurface).toBe('design')
    expect(locked?.designProfile).toEqual({
      ...submitted,
      lockedAtTurnId: accepted.turnId
    })
    expect(locked?.turns[0]).toMatchObject({
      agentSurface: 'design',
      designProfile: locked?.designProfile,
      designDocumentTarget: submitted.documentTarget
    })
    expect(locked?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      designProfile: locked?.designProfile,
      designDocumentTarget: submitted.documentTarget
    })
    expect(state.eventBus.snapshotSince(thread.id, 0)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'turn_started',
        designProfile: locked?.designProfile,
        designDocumentTarget: submitted.documentTarget
      })
    ]))

    await state.turns.finishTurn({
      threadId: thread.id,
      turnId: accepted.turnId,
      status: 'completed'
    })
    await expect(state.turns.startTurn({
      threadId: thread.id,
      request: { prompt: 'run code', agentSurface: 'code' }
    })).rejects.toBeInstanceOf(TaskSurfaceLockedError)
    await expect(state.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'change lane',
        agentSurface: 'design',
        designProfile: profile(target(), 'image'),
        designDocumentTarget: target()
      }
    })).rejects.toBeInstanceOf(DesignProfileLockedError)
  })

  it('keeps Code ownership while accepting Code -> Design -> Code -> Design turns', async () => {
    const state = harness()
    const thread = createThreadRecord({
      id: 'thr_mixed_surface', title: 'Unified workbench',
      workspace: '/tmp/workspace', model: 'test', agentSurface: 'code'
    })
    await state.threadStore.upsert(thread)

    const firstCode = await state.turns.startTurn({
      threadId: thread.id,
      request: { prompt: 'Inspect code', agentSurface: 'code' }
    })
    await state.turns.finishTurn({ threadId: thread.id, turnId: firstCode.turnId, status: 'completed' })

    const submitted = profile()
    const firstDesign = await state.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'Design UI', agentSurface: 'design',
        designProfile: submitted, designDocumentTarget: submitted.documentTarget
      }
    })
    expect(firstDesign).toMatchObject({
      agentSurface: 'design',
      threadAgentSurface: 'code',
      designProfile: submitted,
      designDocumentTarget: submitted.documentTarget
    })
    await state.turns.finishTurn({
      threadId: thread.id,
      turnId: firstDesign.turnId,
      status: 'completed'
    })
    const lockedProfile = (await state.threadStore.get(thread.id))?.designProfile
    expect(lockedProfile).toMatchObject(submitted)

    const secondCode = await state.turns.startTurn({
      threadId: thread.id,
      request: { prompt: 'Implement UI', agentSurface: 'code' }
    })
    expect(secondCode).toMatchObject({ agentSurface: 'code', threadAgentSurface: 'code' })
    expect((await state.threadStore.get(thread.id))?.turns.at(-1)?.designProfile).toBeUndefined()
    await state.turns.finishTurn({ threadId: thread.id, turnId: secondCode.turnId, status: 'completed' })

    const secondDesign = await state.turns.startTurn({
      threadId: thread.id,
      request: { prompt: 'Refine the Design', agentSurface: 'design' }
    })
    expect(secondDesign).toMatchObject({
      agentSurface: 'design',
      threadAgentSurface: 'code',
      designProfile: lockedProfile,
      designDocumentTarget: submitted.documentTarget
    })
    await state.turns.finishTurn({
      threadId: thread.id,
      turnId: secondDesign.turnId,
      status: 'completed'
    })
    const persisted = await state.threadStore.get(thread.id)
    expect(persisted?.agentSurface).toBe('code')
    expect(persisted?.designProfile).toEqual(lockedProfile)
  })

  it('rolls back task/profile locks when durable admission fails', async () => {
    const state = harness(new FailFirstAppendStore())
    const thread = createThreadRecord({
      id: 'thr_design_rollback',
      title: 'Design',
      workspace: '/tmp/workspace',
      model: 'test'
    })
    await state.threadStore.upsert(thread)
    const submitted = profile()
    await expect(state.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'first attempt',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })).rejects.toThrow('first append failed')
    const failed = await state.threadStore.get(thread.id)
    expect(failed?.agentSurface).toBeUndefined()
    expect(failed?.designProfile).toBeUndefined()
  })

  it('recovers a crashed pending Design admission without locking the profile', async () => {
    const state = harness()
    const submitted = profile()
    const locked = { ...submitted, lockedAtTurnId: 'turn_pending_design' }
    const pendingTurn = createTurnRecord({
      id: 'turn_pending_design',
      threadId: 'thr_pending_design',
      prompt: 'Design before crash',
      status: 'running',
      admissionPending: true,
      agentSurface: 'design',
      designProfile: locked,
      designDocumentTarget: submitted.documentTarget
    })
    const pendingItem = makeUserItem({
      id: 'item_pending_design_user',
      turnId: pendingTurn.id,
      threadId: pendingTurn.threadId,
      text: pendingTurn.prompt,
      threadAgentSurface: 'code',
      designProfile: locked,
      designDocumentTarget: submitted.documentTarget
    })
    await state.threadStore.upsert({
      ...createThreadRecord({
        id: pendingTurn.threadId,
        title: 'Pending Design',
        workspace: '/tmp/workspace',
        model: 'test',
        agentSurface: 'code'
      }),
      status: 'running',
      designProfile: locked,
      turns: [{ ...pendingTurn, items: [pendingItem] }]
    })
    await state.sessionStore.appendItem(pendingTurn.threadId, pendingItem)

    await expect(state.turns.reconcileOrphanedTurns()).resolves.toEqual([])
    expect((await state.threadStore.get(pendingTurn.threadId))?.turns).toEqual([])
    expect((await state.threadStore.get(pendingTurn.threadId))?.designProfile).toBeUndefined()
    expect(await state.sessionStore.loadItems(pendingTurn.threadId)).toEqual([])
  })

  it('keeps an accepted Design admission when event persistence fails afterward', async () => {
    const sessionStore = new ControlledFailureSessionStore()
    const state = harness(sessionStore)
    const thread = createThreadRecord({
      id: 'thr_design_event_failure',
      title: 'Code workbench',
      workspace: '/tmp/workspace',
      model: 'test',
      agentSurface: 'code'
    })
    await state.threadStore.upsert(thread)
    sessionStore.failNextEvent = true
    const submitted = profile()
    const accepted = await state.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'Persist despite event failure',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })
    const persisted = await state.threadStore.get(thread.id)
    expect(accepted).toMatchObject({ agentSurface: 'design', threadAgentSurface: 'code' })
    expect(persisted?.designProfile?.lockedAtTurnId).toBe(accepted.turnId)
    expect(persisted?.turns.at(-1)).toMatchObject({ admissionCompletedAt: nowIso() })
    expect(persisted?.turns.at(-1)?.admissionPending).toBeUndefined()
    await state.turns.finishTurn({ threadId: thread.id, turnId: accepted.turnId, status: 'completed' })
  })

  it('returns the committed admission when dispatch setup throws', async () => {
    const state = harness()
    const thread = createThreadRecord({
      id: 'thr_design_dispatch_failure',
      title: 'Code workbench',
      workspace: '/tmp/workspace',
      model: 'test',
      agentSurface: 'code'
    })
    await state.threadStore.upsert(thread)
    const submitted = profile()
    const accepted = await state.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'Accept before dispatch',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    }, {
      onAdmitted: () => {
        throw new Error('injected dispatch failure')
      }
    })
    expect(accepted).toMatchObject({ agentSurface: 'design', threadAgentSurface: 'code' })
    expect((await state.threadStore.get(thread.id))?.designProfile?.lockedAtTurnId)
      .toBe(accepted.turnId)
  })

  it('retargets the locked profile and every historical snapshot on fork', async () => {
    const state = harness()
    const source = await state.threads.create({
      workspace: '/tmp/workspace',
      title: 'Design source',
      model: 'test',
      mode: 'agent',
      agentSurface: 'design'
    })
    const submitted = profile()
    const accepted = await state.turns.startTurn({
      threadId: source.id,
      request: {
        prompt: 'Design a page',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })
    await state.turns.finishTurn({
      threadId: source.id,
      turnId: accepted.turnId,
      status: 'completed'
    })

    const forkTarget = target('fork')
    const fork = await state.threads.fork(source.id, {
      designDocumentTarget: forkTarget, designCloneOperationId: 'fork-retarget'
    })
    expect(fork.designProfile).toMatchObject({ documentTarget: forkTarget })
    expect(fork.turns[0]).toMatchObject({
      designProfile: { documentTarget: forkTarget },
      designDocumentTarget: forkTarget
    })
    expect(fork.turns[0]?.items[0]).toMatchObject({
      designProfile: { documentTarget: forkTarget },
      designDocumentTarget: forkTarget
    })
    expect((await state.sessionStore.loadItems(fork.id))[0]).toMatchObject({
      designProfile: { documentTarget: forkTarget },
      designDocumentTarget: forkTarget
    })
    await expect(state.threads.fork(source.id)).rejects.toThrow(/cloned document target/i)
    await expect(state.threads.fork(source.id, {
      designDocumentTarget: submitted.documentTarget,
      designCloneOperationId: 'fork-same-target'
    })).rejects.toThrow(/different document target/i)
  })

  it('resumes a locked Design task only onto an independent target and rewrites history', async () => {
    const state = harness()
    const source = await state.threads.create({
      workspace: '/tmp/workspace',
      title: 'Design source',
      model: 'test',
      mode: 'agent',
      agentSurface: 'design'
    })
    const submitted = profile()
    const accepted = await state.turns.startTurn({
      threadId: source.id,
      request: {
        prompt: 'Design a page',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })
    await state.turns.finishTurn({
      threadId: source.id,
      turnId: accepted.turnId,
      status: 'completed'
    })

    await expect(state.threads.resumeSession(source.id)).rejects.toThrow(/cloned document target/i)
    await expect(state.threads.resumeSession(source.id, {
      designDocumentTarget: submitted.documentTarget,
      designCloneOperationId: 'resume-same-target'
    })).rejects.toThrow(/different document target/i)

    const resumedTarget = target('resumed')
    const resumed = (await state.threads.resumeSession(source.id, {
      workspace: source.workspace,
      designDocumentTarget: resumedTarget,
      designCloneOperationId: 'resume-retarget'
    })).thread
    expect(resumed.designProfile).toMatchObject({
      documentTarget: resumedTarget,
      presetSource: 'explicit'
    })
    expect(resumed.turns[0]).toMatchObject({
      designProfile: { documentTarget: resumedTarget },
      designDocumentTarget: resumedTarget
    })
    expect(resumed.turns[0]?.items[0]).toMatchObject({
      designProfile: { documentTarget: resumedTarget },
      designDocumentTarget: resumedTarget
    })
    expect((await state.sessionStore.loadItems(resumed.id))[0]).toMatchObject({
      designProfile: { documentTarget: resumedTarget },
      designDocumentTarget: resumedTarget
    })
  })

  it('returns committed fork, side, and resume targets after injected post-commit failures', async () => {
    const sessionStore = new ControlledFailureSessionStore()
    const state = harness(sessionStore)
    const source = await state.threads.create({
      workspace: '/tmp/workspace',
      title: 'Design lifecycle source',
      model: 'test',
      mode: 'agent',
      agentSurface: 'code'
    })
    const submitted = profile()
    const accepted = await state.turns.startTurn({
      threadId: source.id,
      request: {
        prompt: 'Design a page',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })
    await state.turns.finishTurn({
      threadId: source.id,
      turnId: accepted.turnId,
      status: 'completed'
    })

    sessionStore.failNextEvent = true
    const forked = await state.threads.fork(source.id, {
      designDocumentTarget: target('post-commit-fork'),
      designCloneOperationId: 'post-commit-fork'
    })
    expect(await state.threadStore.get(forked.id)).not.toBeNull()

    const callbackFailureThreads = new ThreadService({
      threadStore: state.threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus: state.eventBus,
        sessionStore,
        allocateSeq: (threadId) => state.eventBus.allocateSeq(threadId),
        nowIso
      }),
      ids: state.ids,
      nowIso,
      onForked: () => {
        throw new Error('injected side callback failure')
      }
    })
    const side = await callbackFailureThreads.fork(source.id, {
      relation: 'side',
      designDocumentTarget: target('post-commit-side'),
      designCloneOperationId: 'post-commit-side'
    })
    expect(await state.threadStore.get(side.id)).not.toBeNull()

    sessionStore.failNextSessionSnapshot = true
    const resumed = await state.threads.resumeSession(source.id, {
      workspace: source.workspace,
      designDocumentTarget: target('post-commit-resume'),
      designCloneOperationId: 'post-commit-resume'
    })
    expect(await state.threadStore.get(resumed.thread.id)).not.toBeNull()
  })

  it('recovers a Design profile from session items and retargets a resumed thread', async () => {
    const state = harness()
    const source = await state.threads.create({
      workspace: '/tmp/workspace',
      title: 'Design source',
      model: 'test',
      mode: 'agent',
      agentSurface: 'code'
    })
    const submitted = profile()
    const accepted = await state.turns.startTurn({
      threadId: source.id,
      request: {
        prompt: 'Design a page',
        agentSurface: 'design',
        designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })
    await state.turns.finishTurn({
      threadId: source.id,
      turnId: accepted.turnId,
      status: 'completed'
    })
    expect((await state.sessionStore.loadItems(source.id))[0]).toMatchObject({
      workspace: '/tmp/workspace'
    })
    await state.threadStore.delete(source.id)

    await expect(state.threads.getResumeSessionMetadata(source.id)).resolves.toMatchObject({
      sessionId: source.id,
      sourceAgentSurface: 'code',
      workspace: '/tmp/workspace',
      sourceDesignProfile: { documentTarget: submitted.documentTarget },
      sourceDesignDocumentTarget: submitted.documentTarget,
      requiresIndependentDesignTarget: true
    })

    const resumedTarget = target('session-only')
    const resumed = (await state.threads.resumeSession(source.id, {
      workspace: '/tmp/workspace',
      designDocumentTarget: resumedTarget,
      designCloneOperationId: 'resume-session-only'
    })).thread
    expect(resumed.agentSurface).toBe('code')
    expect(resumed.designProfile?.documentTarget).toEqual(resumedTarget)
    expect(resumed.turns[0]?.designProfile?.documentTarget).toEqual(resumedTarget)
    expect((await state.sessionStore.loadItems(resumed.id))[0]).toMatchObject({
      designProfile: { documentTarget: resumedTarget },
      workspace: '/tmp/workspace'
    })
  })

  it('fails closed when a session-only Design task predates workspace snapshots', async () => {
    const state = harness()
    const source = await state.threads.create({
      workspace: '/tmp/source-workspace', title: 'Legacy Design', model: 'test',
      mode: 'agent', agentSurface: 'code'
    })
    const submitted = profile()
    await state.turns.startTurn({
      threadId: source.id,
      request: {
        prompt: 'Design a page', agentSurface: 'design', designProfile: submitted,
        designDocumentTarget: submitted.documentTarget
      }
    })
    const items = await state.sessionStore.loadItems(source.id)
    await state.sessionStore.rewriteItems(source.id, items.map((item) => {
      if (item.kind !== 'user_message') return item
      const withoutWorkspace = { ...item }
      delete withoutWorkspace.workspace
      return withoutWorkspace
    }))
    await state.threadStore.delete(source.id)

    await expect(state.threads.resumeSession(source.id, {
      workspace: '/tmp/current-workspace',
      designDocumentTarget: target('legacy-session-clone'),
      designCloneOperationId: 'legacy-session-clone'
    })).rejects.toThrow('persisted source workspace')
  })
})
