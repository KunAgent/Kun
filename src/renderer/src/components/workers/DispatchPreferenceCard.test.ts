// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import i18n from '../../i18n'
import type { AdeCollaborationSettingsSnapshot } from '@shared/ade-collaboration-settings'
import { DispatchPreferenceCard } from './DispatchPreferenceCard'

vi.mock('../../store/harness-store', () => ({ useHarnessStore: (select: (state: unknown) => unknown) => select({ rows: [] }) }))
vi.mock('../chat/AgentDispatchRoutePicker', () => ({ AgentDispatchRoutePicker: () => null }))
const rules = [{ id: 'review', scenario: 'Review code', agentId: 'codex', model: 'm', enabled: true }]
function snapshot(preferencePrompt: string, revision = 'rev-1'): AdeCollaborationSettingsSnapshot {
  return { revision, value: {
    enabled: true, managerMayApprove: false, allowUnattendedFullAccess: false,
    limits: { softWorkers: 4, hardWorkers: 8 }, hibernation: { enabled: true, idleMinutes: 30 },
    stall: { structuredMinutes: 10, terminalMinutes: 20 },
    dispatch: { autoStartSeconds: 60, autoStartWhenConfirmationRequired: true, preferencePrompt, preferences: rules },
    tasks: { autoStartSeconds: 0, worktree: true, inheritContext: false }, harnessRouter: true, deterministicHandoff: true
  } }
}
let host: HTMLDivElement, root: Root
const getSettings = vi.fn(), saveSettings = vi.fn()
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  getSettings.mockReset().mockResolvedValue(snapshot('UI: claude-code')); saveSettings.mockReset()
  ;(window as unknown as { kunGui: unknown }).kunGui = { getAdeCollaborationSettings: getSettings, saveAdeCollaborationSettings: saveSettings }
})
afterEach(async () => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); await i18n.changeLanguage('en') })
function setText(value: string): void {
  const input = document.querySelector<HTMLTextAreaElement>('[data-dispatch-preference-input]')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function open(): Promise<void> {
  await act(async () => { root.render(createElement(DispatchPreferenceCard)) })
  await act(async () => { const trigger = host.querySelector<HTMLButtonElement>('button')!; trigger.focus(); trigger.click() })
}
async function save(): Promise<void> {
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-dispatch-preference-save]')!.click() })
}
describe('DispatchPreferenceCard', () => {
  it('renders actual Agent identity and saves both rules and notes against the revision', async () => {
    await open()
    expect(host.textContent).toContain('协作偏好')
    expect(host.textContent).toContain('Review code')
    expect(host.querySelector('[data-agent-icon="codex"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    setText('  Reviews: codex  ')
    saveSettings.mockResolvedValue({ ok: true, generation: 2, ...snapshot('Reviews: codex', 'rev-2') })
    await save()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 'rev-1',
      value: expect.objectContaining({ dispatch: expect.objectContaining({ preferencePrompt: 'Reviews: codex', preferences: rules }) }) }))
    expect(document.querySelector('[role="status"]')?.textContent).toContain('已保存')
  })
  it('loads a conflicting revision without overwriting it', async () => {
    await open(); setText('mine')
    saveSettings.mockResolvedValue({ ok: false, kind: 'conflict', ...snapshot('theirs', 'rev-3') })
    await save()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('别处')
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('theirs')
    expect(document.querySelector<HTMLButtonElement>('[data-dispatch-preference-save]')!.disabled).toBe(true)
  })
  it('blocks oversize input and leaves the draft intact on a save failure', async () => {
    await open(); setText('x'.repeat(2000))
    expect(document.querySelector<HTMLButtonElement>('[data-dispatch-preference-save]')!.disabled).toBe(true)
    await save(); expect(saveSettings).not.toHaveBeenCalled()
    setText('keep my draft'); saveSettings.mockRejectedValueOnce(new Error('offline'))
    await save()
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('keep my draft')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('offline')
  })
  it('closes with Escape without saving and restores trigger focus', async () => {
    await open(); setText('unsaved')
    act(() => { document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('button'))
    expect(saveSettings).not.toHaveBeenCalled()
  })
})
