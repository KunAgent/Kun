// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import i18n from '../../i18n'
import { FloatingComposerAgentModePicker, type ComposerAgentModeControls } from './FloatingComposerAgentModePicker'

function row(id: string, displayName: string, installed: 'yes' | 'no' = 'yes'): AdeHarnessRow {
  return {
    definition: {
      id, displayName, transport: id === 'kun' ? 'native-loop' : 'agent-sdk',
      credentialModes: ['native-login'], permissionModes: [],
      modelSource: 'static', staticModels: [], builtin: true
    },
    status: { harnessId: id, installed, login: 'signed-in', checkedAt: '2026-09-30T00:00:00Z' }
  }
}

let host: HTMLDivElement
let root: Root
let controls: ComposerAgentModeControls

beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  controls = {
    contextKey: 'thread-a', harnessId: 'kun', harnessLabel: 'Kun', loading: false,
    rows: [row('kun', 'Kun'), row('claude-code', 'Claude Code'), row('cursor', 'Cursor', 'no'), row('devin', 'Devin')],
    needsConfirm: () => false, onSelect: vi.fn(), onOpen: vi.fn(), onManage: vi.fn()
  }
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

async function render(surface: 'code' | 'design' = 'code', disabled = false): Promise<HTMLButtonElement> {
  await act(async () => root.render(createElement(FloatingComposerAgentModePicker, { controls, surface, disabled })))
  return host.querySelector<HTMLButtonElement>('[data-agent-mode-trigger]')!
}
async function open(surface: 'code' | 'design' = 'code'): Promise<HTMLButtonElement> {
  const trigger = await render(surface)
  await act(async () => trigger.click())
  return trigger
}
function choice(id: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-agent-mode-option="${id}"]`)!
}

describe('Agent and Kun mode picker', () => {
  it('keeps Kun modes together in the original surface position and lists external Agents once', async () => {
    const trigger = await open('design')
    expect(trigger.textContent).toContain('Kun · Design')
    expect(controls.onOpen).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('[data-agent-mode-group="kun"] [role="menuitemradio"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-agent-mode-group="external"] [role="menuitemradio"]')).toHaveLength(3)
    expect(choice('kun-design').getAttribute('aria-checked')).toBe('true')
    expect(choice('claude-code').querySelector('[data-agent-icon="claude-code"]')).not.toBeNull()
    expect(choice('devin').disabled).toBe(false)
    expect(document.activeElement).toBe(choice('kun-design'))
    expect(host.querySelector('[data-agent-mode-menu]')).toBeNull()
  })

  it('switches an external Agent from Design to Code and returns to the requested Kun mode', async () => {
    const trigger = await open('design')
    await act(async () => choice('claude-code').click())
    expect(controls.onSelect).toHaveBeenCalledExactlyOnceWith('claude-code', 'code')
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    controls = { ...controls, harnessId: 'claude-code', harnessLabel: 'Claude Code', onSelect: vi.fn() }
    await open()
    expect(trigger.textContent).toContain('Claude Code')
    expect(trigger.textContent).not.toContain('Design')
    await act(async () => choice('kun-design').click())
    expect(controls.onSelect).toHaveBeenCalledExactlyOnceWith('kun', 'design')
  })

  it('switches Kun Code and Design without requiring a cross-Agent handoff', async () => {
    controls.needsConfirm = vi.fn(() => true)
    await open()
    await act(async () => choice('kun-design').click())
    expect(controls.needsConfirm).not.toHaveBeenCalled()
    expect(controls.onSelect).toHaveBeenCalledExactlyOnceWith('kun', 'design')
  })

  it('requires a handoff decision and preserves the requested Kun mode in the confirmation', async () => {
    controls = { ...controls, harnessId: 'claude-code', harnessLabel: 'Claude Code', needsConfirm: () => true }
    await open()
    await act(async () => choice('kun-design').click())
    expect(controls.onSelect).not.toHaveBeenCalled()
    expect(document.querySelector('[data-agent-mode-confirm]')?.textContent).toContain('Kun · Design')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-mode-confirm-cancel]')!.click())
    expect(controls.onSelect).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(choice('claude-code'))
    await act(async () => choice('kun-design').click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-mode-confirm-yes]')!.click())
    expect(controls.onSelect).toHaveBeenCalledExactlyOnceWith('kun', 'design')
  })

  it('leaves unavailable Agents visible and opens their repair entry without selecting them', async () => {
    await open()
    expect(choice('cursor').disabled).toBe(true)
    await act(async () => choice('cursor').click())
    expect(controls.onSelect).not.toHaveBeenCalled()
    const repair = document.querySelector<HTMLButtonElement>('[data-agent-mode-repair="cursor"]')!
    expect(repair.disabled).toBe(false)
    await act(async () => repair.click())
    expect(controls.onManage).toHaveBeenCalledWith('cursor', false)
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
  })

  it('supports arrows, Home/End and Tab while skipping disabled Agent rows', async () => {
    const trigger = await render()
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(choice('kun-code'))
    await act(async () => choice('kun-code').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement).toBe(document.querySelector('[data-agent-mode-manage]'))
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(document.activeElement).toBe(choice('kun-code'))
    await act(async () => choice('claude-code').focus())
    await act(async () => choice('claude-code').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(document.querySelector('[data-agent-mode-repair="cursor"]'))
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
  })

  it('closes on Escape and outside pointer input', async () => {
    const trigger = await open()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    await act(async () => window.dispatchEvent(new Event('pointerdown')))
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
  })

  it('moves keyboard focus into an already open menu without refreshing the catalog again', async () => {
    const trigger = await open()
    trigger.focus()
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(choice('kun-code'))
    expect(controls.onOpen).toHaveBeenCalledOnce()
  })

  it('does not confirm a handoff if the target Agent becomes unavailable or is removed', async () => {
    controls.needsConfirm = () => true
    await open()
    await act(async () => choice('claude-code').click())
    controls = { ...controls, rows: [row('kun', 'Kun'), row('claude-code', 'Claude Code', 'no')] }
    await render()
    let confirm = document.querySelector<HTMLButtonElement>('[data-agent-mode-confirm-yes]')!
    expect(confirm.disabled).toBe(true)
    await act(async () => confirm.click())
    expect(controls.onSelect).not.toHaveBeenCalled()
    controls = { ...controls, rows: [row('kun', 'Kun')] }
    await render()
    confirm = document.querySelector<HTMLButtonElement>('[data-agent-mode-confirm-yes]')!
    expect(confirm.disabled).toBe(true)
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-mode-confirm-cancel]')!.click())
    expect(choice('kun-code')).not.toBeNull()
  })

  it('discards stale confirmation after a thread change or disabled composer', async () => {
    controls.needsConfirm = () => true
    await open()
    await act(async () => choice('claude-code').click())
    controls = { ...controls, contextKey: 'thread-b' }
    const trigger = await render()
    expect(document.querySelector('[data-agent-mode-confirm]')).toBeNull()
    await act(async () => trigger.click())
    await act(async () => choice('claude-code').click())
    const staleConfirmation = document.querySelector<HTMLButtonElement>('[data-agent-mode-confirm-yes]')!
    await render('code', true)
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
    await act(async () => staleConfirmation.click())
    expect(controls.onSelect).not.toHaveBeenCalled()
  })

  it('preserves the local-session continuation entry in the Agent menu', async () => {
    controls.onContinueLocalSession = vi.fn()
    await open()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-continue-local-session]')!.click())
    expect(controls.onContinueLocalSession).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-agent-mode-menu]')).toBeNull()
  })
})
