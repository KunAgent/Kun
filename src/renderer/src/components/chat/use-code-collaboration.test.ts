import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'

const controls = vi.hoisted(() => ({ enabled: true, update: vi.fn(), enable: vi.fn() }))
vi.mock('./enable-kun-collaboration', () => ({ enableKunCollaboration: controls.enable }))
vi.mock('../ade/use-ade-enabled', () => ({ useAdeEnabled: () => ({ enabled: controls.enabled }) }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ updateThreadCollaboration: controls.update }) }))
import { useCodeCollaboration } from './use-code-collaboration'
import { useChatStore } from '../../store/chat-store'

let rendered: ReactTestRenderer | undefined
let result: ReturnType<typeof useCodeCollaboration>
const thread = { id: 'task', workspaceMode: 'code', title: 'Original' } as NormalizedThread

async function mount(activeThread: NormalizedThread | null, harnessId = 'kun'): Promise<void> {
  function Consumer() {
    result = useCodeCollaboration({ activeThread, activeThreadId: activeThread?.id ?? null, harnessId, busy: false })
    return null
  }
  await act(async () => { rendered = create(createElement(Consumer)) })
}

beforeEach(() => {
  controls.enabled = true
  controls.update.mockReset()
  controls.enable.mockReset()
  useChatStore.setState({
    activeThreadId: null, composerHarnessId: '', workspaceRoot: '/repo', composerModel: 'model', composerProviderId: 'provider',
    composerCollaborationEnabled: false, refreshThreads: vi.fn(async () => undefined), threads: [thread], adeThreads: [],
    input: 'Keep this draft', attachments: [{ id: 'image' }], createThread: vi.fn(), openSettings: vi.fn()
  } as never)
})
afterEach(async () => { await act(async () => rendered?.unmount()) })

describe('Code collaboration intent', () => {
  it('keeps new task opt-in local and preserves the draft and attachments', async () => {
    await mount(null)
    await act(async () => result.toggleCollaboration())
    expect(useChatStore.getState().composerCollaborationEnabled).toBe(true)
    expect(useChatStore.getState().createThread).not.toHaveBeenCalled()
    expect(controls.update).not.toHaveBeenCalled()
    expect(useChatStore.getState()).toMatchObject({ input: 'Keep this draft', attachments: [{ id: 'image' }] })
    await act(async () => result.toggleCollaboration())
    expect(useChatStore.getState().composerCollaborationEnabled).toBe(false)
  })

  it('updates only the target task policy, preserving later metadata', async () => {
    useChatStore.setState({ activeThreadId: 'task' })
    controls.update.mockResolvedValue({ ...thread, title: 'Old server title', collaboration: { enabled: true } })
    await mount(thread)
    await act(async () => result.toggleCollaboration())
    expect(controls.update).toHaveBeenCalledWith('task', true)
    expect(useChatStore.getState().threads[0]).toMatchObject({ title: 'Original', collaboration: { enabled: true } })
  })

  it('updates external root delegation without changing the selected Agent', async () => {
    const external = { ...thread, harnessId: 'codex' }
    useChatStore.setState({ activeThreadId: 'task', composerHarnessId: 'codex', threads: [external] })
    controls.update.mockResolvedValue({ ...external, collaboration: { enabled: true } })
    await mount(external, 'codex')
    await act(async () => result.toggleCollaboration())
    expect(controls.update).toHaveBeenCalledWith('task', true)
    expect(useChatStore.getState().threads[0]).toMatchObject({ harnessId: 'codex', collaboration: { enabled: true } })
    expect(controls.enable).not.toHaveBeenCalled()
  })

  it('allows ordinary delegation when advanced collaboration is disabled', async () => {
    controls.enabled = false
    await mount(null, 'codex')
    await act(async () => result.toggleCollaboration())
    expect(result.collaborationAvailable).toBe(true)
    expect(useChatStore.getState().composerCollaborationEnabled).toBe(true)
    expect(useChatStore.getState().openSettings).not.toHaveBeenCalled()
    expect(useChatStore.getState().composerHarnessId).toBe('')
  })
})
