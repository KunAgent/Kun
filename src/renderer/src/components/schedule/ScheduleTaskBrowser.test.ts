// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ScheduleTaskBrowser } from './ScheduleTaskBrowser'
import { newScheduledTask, filterScheduledTasks } from './schedule-task-support'
import type { ScheduleTasksBulkInput } from '@shared/schedule-task-bulk'
import type { ScheduledTaskV1 } from '@shared/app-settings'

let root: Root, host: HTMLDivElement
let tasks: ScheduledTaskV1[]
let bulk: ReturnType<typeof vi.fn<(input: ScheduleTasksBulkInput) => Promise<void>>>
let onRun: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>
let onOpenThread: ReturnType<typeof vi.fn<(id: string) => void>>
let width = 1200
const button = (text: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
const input = (label: string): HTMLInputElement => document.querySelector(`input[aria-label="${label}"]`)!
const click = async (node: HTMLElement): Promise<void> => { await act(async () => node.click()) }
const task = (id: string, patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 => ({
  ...newScheduledTask(`/repo/${id}`), id, title: id, prompt: `instruction ${id}`, ...patch
})
async function mount(): Promise<void> {
  await act(async () => root.render(createElement(ScheduleTaskBrowser, {
    tasks, status: null, pending: false, clawChannels: [], modelProviders: [],
    onBulk: bulk, onRun, onEdit: vi.fn(), onOpenThread
  })))
}
function search(value: string): void {
  const field = document.querySelector<HTMLInputElement>('input[type="search"]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('en')
  width = 1200
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 800, x: 0, y: 0, top: 0, left: 0, bottom: 800, right: width, toJSON: () => ({}) }))
  tasks = [task('alpha', { lastStatus: 'success', lastMessage: 'Full result\n'.repeat(60) + 'END', lastThreadId: 'thread-alpha' }), task('beta', { lastStatus: 'error' }), task('gamma')]
  bulk = vi.fn(async () => undefined)
  onRun = vi.fn(async () => undefined)
  onOpenThread = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('scheduled task browser', () => {
  it('shows a real half-selected checkbox and selects only the current filtered results', async () => {
    await mount()
    await click(input('Select alpha'))
    expect(input('Select all filtered tasks').indeterminate).toBe(true)
    await click(button('Failed'))
    expect(input('Select all filtered tasks').indeterminate).toBe(false)
    expect(document.body.textContent).not.toContain('alpha')
    await click(input('Select all filtered tasks'))
    await click(button('Disable'))
    expect(bulk).toHaveBeenCalledExactlyOnceWith({ action: 'disable', taskIds: ['beta'] })
    expect(input('Select all filtered tasks').checked).toBe(false)
  })

  it('searches instruction and workspace and clears selection when the query changes', async () => {
    await mount()
    await click(input('Select all filtered tasks'))
    await act(async () => search(' INSTRUCTION BETA '))
    expect(input('Select all filtered tasks').checked).toBe(false)
    expect(input('Select beta')).toBeTruthy()
    expect(document.body.textContent).not.toContain('alpha')
    await act(async () => search('/REPO/gamma'))
    expect(input('Select gamma')).toBeTruthy()
  })

  it('requires a counted confirmation, makes cancellation harmless and sends only one id-based delete', async () => {
    await mount()
    await click(input('Select alpha')); await click(input('Select beta'))
    await click(button('Delete selected'))
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('Delete 2 selected tasks?')
    expect(document.body.textContent).toContain('Associated conversations are kept')
    await click(button('Cancel'))
    expect(bulk).not.toHaveBeenCalled()
    expect(input('Select alpha').checked).toBe(true)
    await click(button('Delete selected')); await click(button('Delete 2 tasks'))
    expect(bulk).toHaveBeenCalledExactlyOnceWith({ action: 'delete', taskIds: ['alpha', 'beta'] })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('keeps selection and the confirmation available after save failure', async () => {
    bulk.mockRejectedValue(new Error('disk offline'))
    await mount(); await click(input('Select alpha')); await click(button('Delete selected')); await click(button('Delete 1 tasks'))
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('disk offline')
    await click(button('Cancel'))
    expect(input('Select alpha').checked).toBe(true)
  })

  it('guards repeated mutations while saving', async () => {
    let done!: () => void
    bulk.mockImplementation(() => new Promise<void>((resolve) => { done = resolve }))
    await mount(); await click(input('Select all filtered tasks')); await click(button('Disable'))
    expect(button('Disable').disabled).toBe(true)
    await click(button('Enable'))
    expect(bulk).toHaveBeenCalledTimes(1)
    await act(async () => done())
  })

  it('opens complete results and configuration without changing selection, then restores focus', async () => {
    await mount(); await click(input('Select beta'))
    const trigger = button('alpha'); trigger.focus(); await click(trigger)
    const panel = document.querySelector<HTMLElement>('[role="region"]')!
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(panel.textContent).toContain('END')
    await click(button('Configuration'))
    expect(panel.textContent).toContain('/repo/alpha')
    expect(panel.textContent).toContain('instruction alpha')
    await click(button('Open last run')); expect(onOpenThread).toHaveBeenCalledWith('thread-alpha')
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="region"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(input('Select beta').checked).toBe(true)
  })

  it('uses a modal detail layer with keyboard trapping in narrow windows', async () => {
    width = 820
    await mount(); const trigger = button('alpha'); trigger.focus(); await click(trigger)
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(input('Select gamma')).toBeTruthy()
    const buttons = panel.querySelectorAll<HTMLButtonElement>('button')
    buttons[0].focus()
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.activeElement).toBe(trigger)
  })

  it('does not enable expired one-time tasks accidentally', async () => {
    tasks = [task('expired', { enabled: false, schedule: { kind: 'at', atTime: '2020-01-01T00:00:00Z', everyMinutes: 60, timeOfDay: '09:00' } })]
    await mount(); await click(input('Select all filtered tasks')); await click(button('Enable'))
    expect(bulk).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Edit expired')
  })
})

describe('task search and live status filtering', () => {
  it('combines search and failure filters while keeping the existing done filter', () => {
    const sample = [task('alpha', { lastStatus: 'success' }), task('beta', { lastStatus: 'error', prompt: 'ops' }), task('gamma', { lastStatus: 'error' })]
    expect(filterScheduledTasks(sample, 'failed', ' OPS ').map((item) => item.id)).toEqual(['beta'])
    expect(filterScheduledTasks(sample, 'done')).toHaveLength(3)
    expect(filterScheduledTasks(sample, 'all', '/repo/GAMMA').map((item) => item.id)).toEqual(['gamma'])
    expect(filterScheduledTasks(sample, 'running', '', { runningTaskIds: ['alpha'], queuedTaskIds: [] }).map((item) => item.id)).toEqual(['alpha'])
  })
})
