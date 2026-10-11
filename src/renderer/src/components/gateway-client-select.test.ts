// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATEWAY_CLIENTS, type GatewayClientId } from '@shared/gateway-client-setup'
import { GatewayClientSelect } from './gateway-client-select'
import { agentIconAssetUrl } from './agent-icon'

let root: Root
let host: HTMLDivElement
const onChange = vi.fn()
function Fixture() {
  const [value, setValue] = useState<GatewayClientId>('codex')
  return createElement('div', { style: { overflow: 'hidden', width: 150 } },
    createElement(GatewayClientSelect, { label: 'Client', value, onChange: (id) => { onChange(id); setValue(id) } }),
    createElement('button', { 'data-next': true }, 'Next control'))
}
const trigger = (): HTMLButtonElement => document.querySelector('[data-gateway-client-select]')!
const listbox = (): HTMLDivElement | null => document.querySelector('[data-gateway-client-listbox]')
const key = async (key: string): Promise<void> => {
  await act(async () => { trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
}
const click = async (element: HTMLElement): Promise<void> => { await act(async () => { element.click() }) }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  onChange.mockClear()
  await act(async () => { root.render(createElement(Fixture)) })
  await act(async () => { trigger().focus() })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('gateway client select', () => {
  it('labels the selected icon and exposes all four branded choices in an unclipped portal', async () => {
    expect(trigger().getAttribute('role')).toBe('combobox')
    expect(document.getElementById(trigger().getAttribute('aria-labelledby')!)?.textContent).toBe('Client')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().querySelector('[data-agent-icon="codex"]')).not.toBeNull()
    await click(trigger())
    const popup = listbox()!
    expect(popup.parentElement).toBe(document.body)
    expect(popup.getAttribute('role')).toBe('listbox')
    expect(trigger().getAttribute('aria-controls')).toBe(popup.id)
    expect(popup.querySelectorAll('[role="option"]')).toHaveLength(GATEWAY_CLIENTS.length)
    for (const { id, label } of GATEWAY_CLIENTS) {
      const option = popup.querySelector<HTMLElement>(`[data-gateway-client-option="${id}"]`)!
      expect(option.textContent).toBe(label)
      expect(option.getAttribute('aria-selected')).toBe(String(id === 'codex'))
      const icon = option.querySelector<HTMLElement>(`[data-agent-icon="${id}"]`)!
      expect(icon.getAttribute('aria-hidden')).toBe('true')
      if (id === 'opencode') {
        expect(icon.querySelector('img.dark\\:hidden')?.getAttribute('src')).toContain('opencode-logo-light-square.svg')
        expect(icon.querySelector('img.dark\\:block')?.getAttribute('src')).toContain('opencode-logo-dark-square.svg')
      } else expect(icon.style.maskImage).toContain(agentIconAssetUrl(id))
    }
  })

  it.each(GATEWAY_CLIENTS)('selects $label and updates its trigger icon without losing focus', async ({ id, label }) => {
    await click(trigger())
    await click(listbox()!.querySelector<HTMLElement>(`[data-gateway-client-option="${id}"]`)!)
    expect(onChange).toHaveBeenLastCalledWith(id)
    expect(trigger().textContent).toBe(label)
    expect(trigger().querySelector(`[data-agent-icon="${id}"]`)).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(listbox()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('supports arrow, Home/End, Enter/Space, and type-ahead with active-descendant focus', async () => {
    await key('ArrowDown')
    expect(document.activeElement).toBe(trigger())
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-codex')
    await key('ArrowDown')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-claude-code')
    expect(onChange).not.toHaveBeenCalled()
    await key('End')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-pi')
    await key('ArrowDown')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-codex')
    await key('ArrowUp')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-pi')
    await key('Home')
    await key('o')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-opencode')
    await key('Enter')
    expect(onChange).toHaveBeenLastCalledWith('opencode')
    await key(' ')
    await key('Home')
    await key(' ')
    expect(onChange).toHaveBeenLastCalledWith('codex')
    expect(document.activeElement).toBe(trigger())
  })

  it('dismisses with Escape, Tab, outside pointer, and blur without changing selection', async () => {
    await key('End')
    await key('Escape')
    expect(listbox()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    await click(trigger())
    await key('Tab')
    expect(listbox()).toBeNull()
    await click(trigger())
    await act(async () => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(listbox()).toBeNull()
    await click(trigger())
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-next]')!.focus() })
    expect(listbox()).toBeNull()
    expect(document.activeElement).not.toBe(trigger())
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger().textContent).toBe('Codex')
  })

  it('cycles repeated first letters while retaining multi-character type-ahead', async () => {
    await key('c')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-codex')
    await key('C')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-claude-code')
    await key('c')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-codex')
    await key('l')
    expect(trigger().getAttribute('aria-activedescendant')).toContain('-claude-code')
    await key('Enter')
    expect(onChange).toHaveBeenLastCalledWith('claude-code')
  })

  it('consumes Escape only while open so parent overlays stay open until the next Escape', async () => {
    const parentEscape = vi.fn()
    window.addEventListener('keydown', parentEscape)
    try {
      await click(trigger())
      const openEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      await act(async () => { trigger().dispatchEvent(openEscape) })
      expect(openEscape.defaultPrevented).toBe(true)
      expect(parentEscape).not.toHaveBeenCalled()
      expect(listbox()).toBeNull()
      expect(document.activeElement).toBe(trigger())
      const closedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      await act(async () => { trigger().dispatchEvent(closedEscape) })
      expect(closedEscape.defaultPrevented).toBe(false)
      expect(parentEscape).toHaveBeenCalledOnce()
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', parentEscape)
    }
  })
})
