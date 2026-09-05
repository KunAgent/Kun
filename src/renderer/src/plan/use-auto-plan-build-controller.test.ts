import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import {
  createAutoPlanBuildIntent,
  listAutoPlanBuildIntents,
  saveAutoPlanBuildIntent
} from './auto-plan-build-intents'
import {
  AUTO_PLAN_RECOVERY_MISMATCH_ERROR,
  LEGACY_AUTO_PLAN_DUPLICATE_ERROR,
  autoPlanBuildControllerTestApi,
  resetAutoPlanBuildControllerForTests
} from './use-auto-plan-build-controller'
import { runAutomaticSubmitLifecycle } from './auto-plan-build-submit-lifecycle'
import type { GuiPlanToolMeta } from './plan-tool'

const provider = vi.hoisted(() => ({
  sendUserMessage: vi.fn(),
  getThreadDetail: vi.fn()
}))

vi.mock('../agent/registry', () => ({ getProvider: () => provider }))

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const meta: GuiPlanToolMeta = {
  planId: '/repo:.kunsdd/plan/automatic.md',
  workspaceRoot: '/repo',
  relativePath: '.kunsdd/plan/automatic.md',
  absolutePath: '/repo/.kunsdd/plan/automatic.md',
  operation: 'draft',
  sourceRequest: 'Build automatic mode',
  title: 'Automatic mode'
}

function planBlock(planMeta: GuiPlanToolMeta = meta, turnId = 'turn-plan') {
  return {
    kind: 'tool' as const,
    id: 'tool-plan',
    status: 'success' as const,
    summary: 'created',
    turnId,
    meta: {
      toolName: 'create_plan',
      plan: {
        plan_id: planMeta.planId,
        workspace_root: planMeta.workspaceRoot,
        relative_path: planMeta.relativePath,
        absolute_path: planMeta.absolutePath,
        operation: planMeta.operation,
        source_request: planMeta.sourceRequest,
        title: planMeta.title
      }
    }
  }
}

function directIntent(useWorktree = false, requestText = '') {
  return createAutoPlanBuildIntent({
    planId: meta.planId,
    relativePath: meta.relativePath,
    workspaceRoot: meta.workspaceRoot,
    threadId: 'thread-1',
    requestText,
    selection: { buildMode: 'direct', useWorktree }
  })
}

function installWindow(settings = normalizeAppSettings({} as never)): void {
  vi.stubGlobal('window', {
    localStorage: new MemoryStorage(),
    kunGui: {
      getSettings: vi.fn(async () => settings),
      readWorkspaceFile: vi.fn(async () => ({
        ok: true,
        path: meta.absolutePath,
        content: '# Automatic mode\n\n- [ ] Implement'
      })),
      writeWorkspaceFile: vi.fn(async () => ({ ok: true, path: meta.absolutePath })),
      getGitBranches: vi.fn(async () => ({
        ok: true,
        repositoryRoot: '/repo',
        primaryRepositoryRoot: '/repo',
        currentBranch: 'develop',
        dirtyCount: 0,
        branches: [{ name: 'develop', current: true }]
      })),
      createScheduleTask: vi.fn()
    }
  })
}

describe('Automatic plan-build orchestration', () => {
  beforeEach(() => {
    resetAutoPlanBuildControllerForTests()
    provider.sendUserMessage.mockReset().mockResolvedValue({ threadId: 'thread-1', turnId: 'build-turn' })
    provider.getThreadDetail.mockReset()
    useChatStore.setState({
      activeThreadId: null,
      error: null,
      sendMessage: vi.fn(async () => false) as never
    })
    rendererRuntimeClient.invalidateSettings()
  })

  afterEach(() => {
    resetAutoPlanBuildControllerForTests()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('binds the admitted plan turn even when the user switches tasks', () => {
    expect(autoPlanBuildControllerTestApi.admittedPlanIdentity('', {
      activeThreadId: 'thread-new',
      currentTurnId: 'turn-new',
      threads: []
    })).toEqual({ threadId: 'thread-new', planTurnId: 'turn-new' })
    expect(autoPlanBuildControllerTestApi.admittedPlanIdentity('thread-source', {
      activeThreadId: 'thread-other',
      currentTurnId: 'turn-other',
      threads: [{
        id: 'thread-source', title: 'Source', model: 'model', mode: 'plan', updatedAt: '',
        latestTurnId: 'turn-source', latestTurnStatus: 'running'
      }]
    })).toEqual({ threadId: 'thread-source', planTurnId: 'turn-source' })
  })

  it('serializes Automatic admission by task scope', () => {
    const release = autoPlanBuildControllerTestApi.acquireAutomaticStartScope('thread:thread-1')
    expect(release).toBeTypeOf('function')
    expect(autoPlanBuildControllerTestApi.acquireAutomaticStartScope('thread:thread-1')).toBeNull()
    release?.()
    expect(autoPlanBuildControllerTestApi.acquireAutomaticStartScope('thread:thread-1')).toBeTypeOf('function')
  })

  it('consumes a duplicate Automatic draft without another send or error', async () => {
    const existing = directIntent(false, 'same request')
    const sendMessage = vi.fn(async () => true)
    const onStarted = vi.fn()
    const routed = await autoPlanBuildControllerTestApi.routeExistingAutomaticIntent(
      existing,
      { text: 'same request', onStarted },
      sendMessage as never
    )
    expect(routed).toBe(true)
    expect(onStarted).toHaveBeenCalledOnce()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('clears the obsolete duplicate-intent banner for a healthy running intent', () => {
    const existing = directIntent(false, 'same request')
    useChatStore.setState({ error: LEGACY_AUTO_PLAN_DUPLICATE_ERROR })
    autoPlanBuildControllerTestApi.clearLegacyDuplicateError(existing)
    expect(useChatStore.getState().error).toBeNull()
  })

  it('routes distinct input through ordinary Agent queue behavior', async () => {
    const existing = directIntent(false, 'original request')
    const sendMessage = vi.fn(async () => true)
    const onStarted = vi.fn()
    const routed = await autoPlanBuildControllerTestApi.routeExistingAutomaticIntent(
      existing,
      {
        text: 'add this guidance',
        overrides: { attachmentIds: ['attachment-1'] },
        onStarted
      },
      sendMessage as never
    )
    expect(routed).toBe(true)
    expect(sendMessage).toHaveBeenCalledWith('add this guidance', 'agent', {
      attachmentIds: ['attachment-1'],
      expectedThreadId: 'thread-1',
      orchestration: 'direct',
      agentSurface: 'code'
    })
    expect(onStarted).toHaveBeenCalledOnce()
  })

  it('runs the Automatic submit lifecycle in order on a successful send', async () => {
    const calls: string[] = []
    const onSubmitting = vi.fn(() => calls.push('submitting'))
    const onStarted = vi.fn(() => calls.push('started'))
    const onRejected = vi.fn(() => calls.push('rejected'))
    const result = await runAutomaticSubmitLifecycle(
      { onSubmitting, onStarted, onRejected },
      vi.fn(async () => true)
    )
    expect(result).toBe(true)
    expect(calls).toEqual(['submitting', 'started'])
  })

  it('rejects the Automatic submit lifecycle without marking it started', async () => {
    const calls: string[] = []
    const onSubmitting = vi.fn(() => calls.push('submitting'))
    const onStarted = vi.fn(() => calls.push('started'))
    const onRejected = vi.fn(() => calls.push('rejected'))
    const result = await runAutomaticSubmitLifecycle(
      { onSubmitting, onStarted, onRejected },
      vi.fn(async () => false)
    )
    expect(result).toBe(false)
    expect(calls).toEqual(['submitting', 'rejected'])
  })

  it('rejects the Automatic submit lifecycle and rethrows when the send throws', async () => {
    const calls: string[] = []
    const onSubmitting = vi.fn(() => calls.push('submitting'))
    const onStarted = vi.fn(() => calls.push('started'))
    const onRejected = vi.fn(() => calls.push('rejected'))
    const failure = new Error('send failed')
    await expect(runAutomaticSubmitLifecycle(
      { onSubmitting, onStarted, onRejected },
      vi.fn(async () => { throw failure })
    )).rejects.toBe(failure)
    expect(calls).toEqual(['submitting', 'rejected'])
  })

  it('fires submitting before routing a distinct follow-up and rejects on failure', async () => {
    const existing = directIntent(false, 'original request')
    const calls: string[] = []
    const onSubmitting = vi.fn(() => calls.push('submitting'))
    const onStarted = vi.fn(() => calls.push('started'))
    const onRejected = vi.fn(() => calls.push('rejected'))
    const sendMessage = vi.fn(async () => false)
    const routed = await autoPlanBuildControllerTestApi.routeExistingAutomaticIntent(
      existing,
      { text: 'add this guidance', onSubmitting, onStarted, onRejected },
      sendMessage as never
    )
    expect(routed).toBe(false)
    expect(calls).toEqual(['submitting', 'rejected'])
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  it('matches only the exact successful plan identity', () => {
    installWindow()
    const intent = directIntent()
    expect(autoPlanBuildControllerTestApi.matchingSuccessfulPlan([planBlock()], intent)?.meta).toEqual(meta)
    expect(autoPlanBuildControllerTestApi.matchingSuccessfulPlan([
      planBlock({ ...meta, relativePath: '.kunsdd/plan/old.md' })
    ], intent)).toBeNull()
  })

  it('accepts the reserved artifact when runtime plan-id casing differs', () => {
    installWindow()
    const intent = directIntent()
    const runtimeMeta = { ...meta, planId: '/repo:.KUNSDD/PLAN/AUTOMATIC.MD' }
    expect(autoPlanBuildControllerTestApi.matchingSuccessfulPlan([
      planBlock(runtimeMeta)
    ], intent)?.meta).toEqual(runtimeMeta)
  })

  it('matches the re-derived draft path when scoped to the plan turn', () => {
    installWindow()
    const intent = { ...directIntent(), planTurnId: 'turn-plan' }
    const runtimeMeta = {
      ...meta,
      planId: '/repo:.kunsdd/plan/titled.md',
      relativePath: '.kunsdd/plan/titled.md'
    }
    expect(autoPlanBuildControllerTestApi.matchingSuccessfulPlan([
      planBlock(runtimeMeta)
    ], intent)?.meta).toEqual(runtimeMeta)
  })

  it('dispatches one target-thread Direct build with a stable request id', async () => {
    installWindow()
    const intent = directIntent(true)
    saveAutoPlanBuildIntent(intent)
    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)

    expect(provider.sendUserMessage).toHaveBeenCalledOnce()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('<prompt_managed_worktree_protocol>'),
      expect.objectContaining({
        clientRequestId: intent.buildClientRequestId,
        mode: 'agent',
        orchestration: 'direct',
        agentSurface: 'code'
      })
    )
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('uses the normal active-task send path so Automatic build progress stays visible', async () => {
    installWindow()
    const intent = directIntent()
    saveAutoPlanBuildIntent(intent)
    const sendMessage = vi.fn(async () => true)
    useChatStore.setState({
      activeThreadId: 'thread-1',
      route: 'chat',
      runtimeConnection: 'ready',
      sendMessage: sendMessage as never
    })
    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)

    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('<plan_execution_context>'),
      'agent',
      expect.objectContaining({
        clientRequestId: intent.buildClientRequestId,
        waitForRuntimeAdmission: true,
        expectedThreadId: 'thread-1',
        orchestration: 'direct'
      })
    )
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('retries a transient busy rejection instead of stopping Automatic mode', async () => {
    installWindow()
    const intent = directIntent()
    saveAutoPlanBuildIntent(intent)
    provider.sendUserMessage.mockRejectedValueOnce(new Error(JSON.stringify({
      code: 'thread_busy',
      message: 'The plan turn is still settling.'
    })))
    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)
    expect(listAutoPlanBuildIntents()[0]).toMatchObject({ status: 'planning', error: '' })

    provider.sendUserMessage.mockResolvedValueOnce({ threadId: 'thread-1', turnId: 'build-turn' })
    await autoPlanBuildControllerTestApi.dispatchIntent(
      listAutoPlanBuildIntents()[0]!,
      meta
    )
    expect(provider.sendUserMessage).toHaveBeenCalledTimes(2)
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('creates a one-shot scheduled build and does not send an immediate turn', async () => {
    const createScheduleTask = vi.fn(async (input) => ({
      ok: true,
      task: { id: 'scheduled-1', ...input }
    }))
    const settings = normalizeAppSettings({} as never)
    installWindow(settings)
    window.kunGui.createScheduleTask = createScheduleTask as never
    const intent = createAutoPlanBuildIntent({
      planId: meta.planId,
      relativePath: meta.relativePath,
      workspaceRoot: meta.workspaceRoot,
      threadId: 'thread-1',
      selection: {
        buildMode: 'scheduled',
        useWorktree: false,
        scheduled: {
          providerId: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
          schedule: {
            kind: 'at',
            atTime: new Date(Date.now() + 3_600_000).toISOString(),
            timeZone: 'Asia/Shanghai'
          }
        }
      }
    })
    saveAutoPlanBuildIntent(intent)
    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)

    expect(createScheduleTask).toHaveBeenCalledWith(expect.objectContaining({
      sourcePlanId: intent.planId,
      sourceThreadId: 'thread-1',
      orchestration: 'direct',
      schedule: intent.scheduled?.schedule
    }))
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('marks an expired scheduled intent as needs attention without dispatching', async () => {
    installWindow()
    const intent = createAutoPlanBuildIntent({
      planId: meta.planId,
      relativePath: meta.relativePath,
      workspaceRoot: meta.workspaceRoot,
      threadId: 'thread-1',
      selection: {
        buildMode: 'scheduled',
        useWorktree: false,
        scheduled: {
          providerId: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
          schedule: {
            kind: 'at',
            atTime: new Date(Date.now() - 60_000).toISOString(),
            timeZone: 'Asia/Shanghai'
          }
        }
      }
    })
    saveAutoPlanBuildIntent(intent)
    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(window.kunGui.createScheduleTask).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()[0]).toMatchObject({
      status: 'needs_attention',
      error: expect.stringContaining('passed')
    })
  })

  it('keeps clarification pending instead of dispatching', async () => {
    installWindow()
    const intent = directIntent()
    saveAutoPlanBuildIntent(intent)
    provider.getThreadDetail.mockResolvedValue({
      blocks: [{
        kind: 'user_input', id: 'input-1', requestId: 'request-1', questions: [], status: 'pending'
      }],
      latestSeq: 1,
      threadStatus: 'running',
      latestTurnStatus: 'running'
    })
    await autoPlanBuildControllerTestApi.reconcileIntent(intent)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()[0]?.status).toBe('planning')
  })

  it('waits for the plan turn to finish even after create_plan succeeds', async () => {
    installWindow()
    const intent = directIntent()
    saveAutoPlanBuildIntent(intent)
    provider.getThreadDetail.mockResolvedValue({
      blocks: [planBlock()],
      latestSeq: 2,
      threadStatus: 'running',
      latestTurnId: 'turn-plan',
      latestTurnStatus: 'running'
    })
    await autoPlanBuildControllerTestApi.reconcileIntent(intent)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()[0]?.status).toBe('planning')
  })

  it('loads recovery timelines with background priority', async () => {
    installWindow()
    const intent = directIntent()
    saveAutoPlanBuildIntent(intent)
    provider.getThreadDetail.mockResolvedValue({
      blocks: [],
      latestSeq: 1,
      threadStatus: 'idle'
    })

    await autoPlanBuildControllerTestApi.reconcileIntent(intent)

    expect(provider.getThreadDetail).toHaveBeenCalledWith(
      'thread-1',
      { priority: 'background' }
    )
  })

  it('fails closed when a terminal plan turn has no matching plan result', async () => {
    installWindow()
    const intent = { ...directIntent(), planTurnId: 'turn-plan' }
    saveAutoPlanBuildIntent(intent)
    useChatStore.setState({ activeThreadId: 'thread-1', error: null })
    provider.getThreadDetail.mockResolvedValue({
      blocks: [],
      latestSeq: 2,
      threadStatus: 'idle',
      latestTurnId: 'turn-plan',
      latestTurnStatus: 'failed'
    })
    await autoPlanBuildControllerTestApi.reconcileIntent(intent)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()[0]?.status).toBe('needs_attention')
    expect(useChatStore.getState().error).toContain('matching successful plan')
  })

  it('ignores a stale terminal status from another turn while planning', async () => {
    installWindow()
    const intent = { ...directIntent(), planTurnId: 'turn-plan' }
    saveAutoPlanBuildIntent(intent)
    provider.getThreadDetail.mockResolvedValue({
      blocks: [],
      latestSeq: 2,
      threadStatus: 'idle',
      latestTurnId: 'turn-previous',
      latestTurnStatus: 'completed'
    })
    await autoPlanBuildControllerTestApi.reconcileIntent(intent)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()[0]).toMatchObject({ status: 'planning', error: '' })
  })

  it('self-heals the legacy recovery mismatch when its plan result arrives', async () => {
    installWindow()
    const intent = {
      ...directIntent(),
      status: 'needs_attention' as const,
      error: AUTO_PLAN_RECOVERY_MISMATCH_ERROR
    }
    saveAutoPlanBuildIntent(intent)
    useChatStore.setState({ activeThreadId: 'thread-1', error: AUTO_PLAN_RECOVERY_MISMATCH_ERROR })
    provider.getThreadDetail.mockResolvedValue({
      blocks: [planBlock()],
      latestSeq: 3,
      threadStatus: 'completed',
      latestTurnId: 'turn-plan',
      latestTurnStatus: 'completed'
    })
    await autoPlanBuildControllerTestApi.reconcileIntent(intent)
    expect(provider.sendUserMessage).toHaveBeenCalledOnce()
    expect(listAutoPlanBuildIntents()).toEqual([])
    expect(useChatStore.getState().error).toBeNull()
  })

  it('retires a legacy mismatch after the user has already moved to a later turn', async () => {
    installWindow()
    const intent = {
      ...directIntent(),
      status: 'needs_attention' as const,
      error: AUTO_PLAN_RECOVERY_MISMATCH_ERROR
    }
    saveAutoPlanBuildIntent(intent)
    provider.getThreadDetail.mockResolvedValue({
      blocks: [planBlock()],
      latestSeq: 4,
      threadStatus: 'completed',
      latestTurnId: 'turn-later',
      latestTurnStatus: 'completed'
    })
    await autoPlanBuildControllerTestApi.reconcileIntent(intent)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('clears the stale plan completion marker when handing off a direct build', async () => {
    installWindow()
    const intent = directIntent()
    saveAutoPlanBuildIntent(intent)
    useChatStore.setState({ unreadThreadIds: { 'thread-1': 'completed' } })

    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)

    expect(useChatStore.getState().unreadThreadIds).toEqual({})
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('clears the stale plan completion marker when scheduling a one-shot build', async () => {
    const createScheduleTask = vi.fn(async (input) => ({
      ok: true,
      task: { id: 'scheduled-1', ...input }
    }))
    installWindow()
    window.kunGui.createScheduleTask = createScheduleTask as never
    const intent = createAutoPlanBuildIntent({
      planId: meta.planId,
      relativePath: meta.relativePath,
      workspaceRoot: meta.workspaceRoot,
      threadId: 'thread-1',
      selection: {
        buildMode: 'scheduled',
        useWorktree: false,
        scheduled: {
          providerId: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
          schedule: {
            kind: 'at',
            atTime: new Date(Date.now() + 3_600_000).toISOString(),
            timeZone: 'Asia/Shanghai'
          }
        }
      }
    })
    saveAutoPlanBuildIntent(intent)
    useChatStore.setState({ unreadThreadIds: { 'thread-1': 'completed' } })

    await autoPlanBuildControllerTestApi.dispatchIntent(intent, meta)

    expect(useChatStore.getState().unreadThreadIds).toEqual({})
    expect(listAutoPlanBuildIntents()).toEqual([])
  })
})
