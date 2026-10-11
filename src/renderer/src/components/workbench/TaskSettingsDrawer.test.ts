// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeTaskSettingsResponse } from '@shared/ade-task-settings'
import type { NormalizedThread } from '../../agent/types'
import i18n from '../../i18n'

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('../../agent/kun-task-settings-client', () => ({ getTaskSettings: api.get, saveTaskSettings: api.save }))
vi.mock('./task-settings-fields', () => ({
  TASK_SETTINGS_FIELDS: ['route', 'collaborationEnabled', 'managerModel', 'limits', 'budget'],
  TaskSettingsFields: ({ onChange }: { onChange: (field: string, value: unknown) => void }) =>
    createElement('button', { onClick: () => onChange('limits', { softWorkers: 2, hardWorkers: 3 }) }, 'Edit worker limits')
}))
import { TaskSettingsDrawer } from './TaskSettingsDrawer'
import { useChatStore } from '../../store/chat-store'

const config = {
  version: 1 as const, revision: 'value-revision', route: { harnessId: 'kun', providerId: 'provider', model: 'model' },
  collaborationEnabled: true, limits: { softWorkers: 1, hardWorkers: 4 }, isolation: 'worktree' as const,
  origins: { route: 'global', collaborationEnabled: 'task', managerModel: 'global', limits: 'project', budget: 'global', isolation: 'task' } as const,
  resolvedAt: '2026-09-30T00:00:00Z'
}
const response: AdeTaskSettingsResponse = {
  revision: 'task-revision', current: config, inherited: config,
  editable: { route: { allowed: true }, collaborationEnabled: { allowed: true }, managerModel: { allowed: true },
    limits: { allowed: true }, budget: { allowed: true }, isolation: { allowed: false, reason: 'workspace_bound' } }
}
let root: Root, host: HTMLDivElement, onClose: ReturnType<typeof vi.fn<() => void>>, task: NormalizedThread
let nextId = 0
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  api.get.mockResolvedValue(response)
  api.save.mockResolvedValue({ ...response, revision: 'saved-revision', pending: { ...config, limits: { softWorkers: 2, hardWorkers: 3 } } })
  task = { id: `task-${++nextId}`, title: 'Main task', model: 'model', workspace: '/repo', mode: 'agent' } as NormalizedThread
  useChatStore.setState({ activeThreadId: task.id, refreshThreads: vi.fn(async () => undefined) })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  onClose = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const button = (text: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
async function mount(): Promise<void> {
  await act(async () => root.render(createElement(TaskSettingsDrawer, { thread: task, onClose })))
}

describe('current task settings drawer', () => {
  it('saves to the explicit task with CAS while leaving the selected conversation alone', async () => {
    await mount()
    await act(async () => button('Edit worker limits').click())
    useChatStore.setState({ activeThreadId: 'preview-worker' })
    await act(async () => button('Save changes').click())
    expect(api.save).toHaveBeenCalledWith(task.id, { expectedRevision: 'task-revision', set: { limits: { softWorkers: 2, hardWorkers: 3 } } })
    expect(useChatStore.getState().activeThreadId).toBe('preview-worker')
    expect(document.body.textContent).toContain('Saved for the next turn or dispatch')
  })

  it('keeps edits visible when another window changed the task', async () => {
    api.save.mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }))
    await mount()
    await act(async () => button('Edit worker limits').click())
    await act(async () => button('Save changes').click())
    expect(document.body.textContent).toContain('Your draft is preserved')
    expect(button('Save changes').disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers save, discard and keep editing on close and retains a failed save', async () => {
    api.save.mockRejectedValue(new Error('runtime offline'))
    await mount()
    await act(async () => button('Edit worker limits').click())
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
    expect(button('Keep editing')).toBeTruthy()
    expect(button('Discard and close')).toBeTruthy()
    await act(async () => button('Save and close').click())
    expect(document.body.textContent).toContain('runtime offline')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses a read-only fallback when the connected runtime lacks the new endpoint', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    await mount()
    expect(document.body.textContent).toContain('does not support task settings')
    expect(button('Save changes').disabled).toBe(true)
    expect(api.save).not.toHaveBeenCalled()
  })
})
