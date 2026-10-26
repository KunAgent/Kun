// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import i18n from '../../i18n'
import type { AdeCollaborationSettingsSnapshot } from '@shared/ade-collaboration-settings'
import { DispatchPreferenceCard } from './DispatchPreferenceCard'

function snapshot(preferencePrompt: string, revision = 'rev-1'): AdeCollaborationSettingsSnapshot {
  return {
    revision,
    value: {
      enabled: true, managerMayApprove: false, allowUnattendedFullAccess: false,
      limits: { softWorkers: 4, hardWorkers: 8 }, hibernation: { enabled: true, idleMinutes: 30 },
      stall: { structuredMinutes: 10, terminalMinutes: 20 },
      dispatch: { autoStartSeconds: 60, autoStartWhenConfirmationRequired: true, preferencePrompt },
      tasks: { autoStartSeconds: 0, worktree: true, inheritContext: false },
      harnessRouter: true, deterministicHandoff: true
    }
  }
}

let host: HTMLDivElement
let root: Root
const getSettings = vi.fn()
const saveSettings = vi.fn()

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  getSettings.mockReset().mockResolvedValue(snapshot('UI: claude-code'))
  saveSettings.mockReset()
  ;(window as unknown as { kunGui: unknown }).kunGui = {
    getAdeCollaborationSettings: getSettings, saveAdeCollaborationSettings: saveSettings
  }
})

afterEach(async () => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

function setText(value: string): void {
  const input = host.querySelector<HTMLTextAreaElement>('[data-dispatch-preference-input]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('DispatchPreferenceCard', () => {
  it('shows the saved preference and saves an edit against its revision', async () => {
    await act(async () => { root.render(createElement(DispatchPreferenceCard)) })
    expect(host.textContent).toContain('派发偏好')
    expect(host.textContent).toContain('UI: claude-code')
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-dispatch-preference-card] button')!.click() })
    setText('  Reviews: codex  ')
    saveSettings.mockResolvedValue({ ok: true, generation: 2, ...snapshot('Reviews: codex', 'rev-2') })
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-dispatch-preference-save]')!.click() })
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 'rev-1',
      value: expect.objectContaining({ dispatch: expect.objectContaining({ preferencePrompt: 'Reviews: codex' }) }) }))
    expect(host.textContent).toContain('已保存')
  })

  it('reports a conflict and loads the newer preference instead of overwriting it', async () => {
    await act(async () => { root.render(createElement(DispatchPreferenceCard)) })
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-dispatch-preference-card] button')!.click() })
    setText('mine')
    saveSettings.mockResolvedValue({ ok: false, kind: 'conflict', ...snapshot('theirs', 'rev-3') })
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-dispatch-preference-save]')!.click() })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('别处')
    expect(host.textContent).toContain('theirs')
  })
})
