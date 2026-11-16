import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { createAdmissionHarness, admissionTestThread } from './chat-store-admission-test-support'
import { clearThreadSnapshotCache, getThreadSnapshot, threadSnapshotFingerprint } from './thread-snapshot-cache'
import { requestThreadPrewarm, resetThreadPrewarmState } from './thread-detail-prewarm'
import { useTaskWorkspaceStore } from './task-workspace-store'

const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registry.getProvider }))

const APP = '/workspace/deepseek-gui'
const SNAPSHOT = '/workspace/conversation-api'
const PROJECT = '/workspace/project-web'

function fixture() {
  const target = { ...admissionTestThread('thr_existing'), status: 'idle' as const, additionalWorkspaces: [SNAPSHOT] }
  const provider = {
    getThreadDetail: vi.fn(async () => ({
      blocks: [], latestSeq: 1, threadStatus: 'idle' as const, additionalWorkspaces: [SNAPSHOT]
    })),
    subscribeThreadEvents: vi.fn(async () => undefined),
    updateThreadAdditionalWorkspaces: vi.fn(async () => ({ ...target, additionalWorkspaces: [PROJECT] })),
    createThread: vi.fn(async (options: { workspace: string; additionalWorkspaces?: string[] }) => ({
      ...target, id: 'thr_new', workspace: options.workspace, additionalWorkspaces: options.additionalWorkspaces ?? [], turnCount: 0
    })),
    sendUserMessage: vi.fn(async (threadId: string) => ({ threadId, turnId: 'turn_1', userMessageItemId: 'user_1' }))
  }
  registry.getProvider.mockReturnValue(provider)
  const harness = createAdmissionHarness()
  Object.assign(harness.state, {
    busy: false, busyUnconfirmed: false, error: null, workspaceRoot: APP,
    composerModel: 'deepseek-v4-pro', composerProviderId: 'deepseek',
    composerPickList: [], composerModelGroups: [], threads: [target], adeThreads: [],
    codeWorkspaceFolderSets: { version: 1, sets: [{ primary: APP, displayName: 'Project', extraRoots: [PROJECT] }] }
  })
  return { ...harness, provider, target }
}

beforeEach(() => {
  clearThreadSnapshotCache()
  resetThreadPrewarmState()
  rendererRuntimeClient.invalidateSettings()
  useTaskWorkspaceStore.setState({ prepByThread: {} })
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }
  })
  vi.stubGlobal('window', { kunGui: {
    getSettings: vi.fn(async () => ({
      agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
      codePromptPrefix: '', chatWelcomeMessage: ''
    })),
    logError: vi.fn(async () => undefined)
  } })
})

afterEach(() => {
  clearThreadSnapshotCache()
  resetThreadPrewarmState()
  rendererRuntimeClient.invalidateSettings()
  useTaskWorkspaceStore.setState({ prepByThread: {} })
  vi.unstubAllGlobals()
})

describe('existing conversation workspace scope is opt-in', () => {
  it('preserves the snapshot when selecting a prewarmed idle conversation', async () => {
    const { actions, state, provider, target } = fixture()
    state.activeThreadId = 'other-thread'
    state.threads.unshift({ ...admissionTestThread('other-thread'), status: 'idle' })
    requestThreadPrewarm(target)
    await vi.waitFor(() => expect(getThreadSnapshot(target.id, threadSnapshotFingerprint(target))).not.toBeNull())
    await actions.selectThread(target.id)
    expect(provider.getThreadDetail).toHaveBeenCalledOnce()
    expect(provider.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
    expect(state.threads.find((thread) => thread.id === target.id)?.additionalWorkspaces).toEqual([SNAPSHOT])
  })

  it('preserves the snapshot when selecting an uncached idle conversation', async () => {
    const { actions, state, provider, target } = fixture()
    state.activeThreadId = 'other-thread'
    await actions.selectThread(target.id)
    expect(provider.getThreadDetail).toHaveBeenCalledOnce()
    expect(provider.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
    expect(state.threads[0]?.additionalWorkspaces).toEqual([SNAPSHOT])
  })

  it('preserves the snapshot during live detail hydration', async () => {
    const { actions, state, provider, target } = fixture()
    await actions.subscribeThreadEventsLive(target.id)
    expect(provider.getThreadDetail).toHaveBeenCalledOnce()
    expect(provider.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
    expect(state.threads[0]?.additionalWorkspaces).toEqual([SNAPSHOT])
  })

  it('sends an idle conversation without replacing its scope from the project registry', async () => {
    const { actions, state, provider } = fixture()
    await expect(actions.sendMessage('Continue this conversation', 'agent')).resolves.toBe(true)
    expect(provider.sendUserMessage).toHaveBeenCalledOnce()
    expect(provider.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
    expect(state.threads[0]?.additionalWorkspaces).toEqual([SNAPSHOT])
  })
})


describe('new conversations inherit the project scope', () => {
  it('does not reuse an empty conversation with a different directory snapshot', async () => {
    const { actions, state, provider, target } = fixture()
    Object.assign(state, { activeThreadId: null, threads: [{ ...target, title: 'New chat', titleAuto: true, turnCount: 0 }],
      adeDraftOpen: false, composerIsolation: 'local', refreshAdeThreads: vi.fn(async () => undefined) })
    await expect(actions.sendMessage('Start with the current project scope', 'agent')).resolves.toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({ additionalWorkspaces: [PROJECT] }))
    expect(state.activeThreadId).toBe('thr_new')
    expect(state.threads.find((thread) => thread.id === target.id)?.additionalWorkspaces).toEqual([SNAPSHOT])
  })

  it.each(['chat', 'ade'] as const)('passes every project directory on the first %s send', async (route) => {
    const { actions, state, provider } = fixture()
    Object.assign(state, { route, activeThreadId: null, threads: [], adeDraftOpen: route === 'ade',
      adeDraftRevision: 1, composerIsolation: 'local', refreshAdeThreads: vi.fn(async () => undefined) })
    await expect(actions.sendMessage('Start the project', 'agent')).resolves.toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: APP, additionalWorkspaces: [PROJECT], workspaceIsolation: 'local'
    }))
    expect(provider.updateThreadAdditionalWorkspaces).not.toHaveBeenCalled()
    expect(state.threads[0]?.additionalWorkspaces).toEqual([PROJECT])
  })

  it.each(['chat', 'ade'] as const)('rejects a multi-root isolated %s draft before creating a thread or worktree', async (route) => {
    const { actions, state, provider } = fixture()
    const createTaskWorkspace = vi.fn()
    Object.assign(provider, { createTaskWorkspace })
    Object.assign(window.kunGui, { getGitBranches: vi.fn(async () => ({ ok: true, branches: [] })) })
    Object.assign(state, { route, activeThreadId: null, threads: [], adeDraftOpen: true,
      adeDraftRevision: 1, composerIsolation: 'worktree', refreshAdeThreads: vi.fn(async () => undefined) })
    await expect(actions.sendMessage('Start an isolated project', 'agent')).resolves.toBe(false)
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(createTaskWorkspace).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.error).toContain(i18n.t('common:codeProjectWorktreeMultiRootBlocked'))
  })
})
