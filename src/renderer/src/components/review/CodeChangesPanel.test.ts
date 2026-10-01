import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'

const provider = vi.hoisted(() => ({ listTaskWorkspaces: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
vi.mock('../ChangeInspector', () => ({ ChangeInspector: () => createElement('div', { 'data-conversation': true }) }))
vi.mock('./ReviewPanel', () => ({ ReviewPanel: (props: { workspace: TaskWorkspaceRecord; threadId: string }) =>
  createElement('div', { 'data-workspace': props.workspace.workspaceId, 'data-thread': props.threadId }) }))
import { CodeChangesPanel } from './CodeChangesPanel'
import { useChatStore } from '../../store/chat-store'
import { useActivityStore } from '../../store/activity-store'

function workspace(id: string, workerId?: string): TaskWorkspaceRecord {
  return {
    workspaceId: id, ownerThreadId: 'manager', unitId: workerId, isolation: 'worktree', sourceRoot: '/repo',
    path: `/repo/${id}`, state: 'ready', changedFiles: [], createdAt: '2026-09-30', updatedAt: '2026-09-30'
  }
}
let renderer: ReactTestRenderer
beforeEach(() => {
  vi.useFakeTimers()
  provider.listTaskWorkspaces.mockReset()
  useChatStore.setState({ activeThreadId: 'manager' })
  useActivityStore.setState({ rows: {} })
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  vi.useRealTimers()
})
async function mount(): Promise<void> {
  await act(async () => { renderer = create(createElement(CodeChangesPanel, { changes: {} as never })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(150) })
}

describe('Code changes target', () => {
  it('keeps the ordinary diff simple when no managed workspace exists', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [] })
    await mount()
    expect(renderer.root.findAllByType('select')).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-conversation': true })).toHaveLength(1)
  })

  it('previews the chosen worker workspace without changing the main conversation', async () => {
    provider.listTaskWorkspaces.mockImplementation(async (options) => ({
      records: options.ownerThreadId ? [workspace('parent'), workspace('child', 'worker')] : [workspace('parent')]
    }))
    await mount()
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'child' } }))
    expect(renderer.root.findByProps({ 'data-workspace': 'child' }).props['data-thread']).toBe('worker')
    expect(useChatStore.getState().activeThreadId).toBe('manager')
  })

  it('defaults to the exact task binding even when a worker workspace is newer', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [
      { ...workspace('child', 'worker'), updatedAt: '2026-10-02' },
      { ...workspace('legacy-owner'), updatedAt: '2026-10-01' },
      workspace('parent', 'manager')
    ] })
    await mount()
    expect(renderer.root.findByType('select').props.value).toBe('parent')
    expect(renderer.root.findByProps({ 'data-workspace': 'parent' }).props['data-thread']).toBe('manager')
  })

  it('keeps conversation changes selected when the manager only owns worker workspaces', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [workspace('child', 'worker')] })
    await mount()
    expect(renderer.root.findByType('select').props.value).toBe('conversation')
    expect(renderer.root.findAllByProps({ 'data-conversation': true })).toHaveLength(1)
  })

  it('discards late workspace results when the user opens another task', async () => {
    let finish!: (value: { records: TaskWorkspaceRecord[] }) => void
    const old = new Promise<{ records: TaskWorkspaceRecord[] }>((resolve) => { finish = resolve })
    provider.listTaskWorkspaces.mockImplementation((options) =>
      (options.ownerThreadId ?? options.boundThreadId) === 'manager' ? old : Promise.resolve({ records: [] }))
    await mount()
    await act(async () => { useChatStore.setState({ activeThreadId: 'other' }) })
    await act(async () => { finish({ records: [workspace('old')] }); await vi.advanceTimersByTimeAsync(150) })
    expect(renderer.root.findAllByProps({ 'data-workspace': 'old' })).toHaveLength(0)
    expect(renderer.root.findAllByType('select')).toHaveLength(0)
  })
})
