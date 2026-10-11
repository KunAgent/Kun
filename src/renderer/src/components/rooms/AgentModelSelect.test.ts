// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { AgentModelSelect } from './AgentModelSelect'
import type { DirectModelOption } from './room-direct-model-groups'

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: { composerModelGroups: never[] }) => unknown) => selector({ composerModelGroups: [] })
}))

const option = (model: string, providerId: string, extra: Partial<DirectModelOption> = {}): DirectModelOption => ({
  model, providerId, accountId: `account:${providerId}`, label: model, providerLabel: providerId,
  available: true, groupAvailable: true, fastAvailable: true, ...extra
})
const OPTIONS = [
  option('gpt-6-sol', 'codex'), option('gpt-6-luna', 'codex'),
  option('grok-4.6', 'cursor', { available: false, reason: 'agent_scope_unsupported' }),
  option('deepseek-flash', 'deepseek')
]

describe('AgentModelSelect', () => {
  let host: HTMLDivElement
  let root: Root
  const onChange = vi.fn()
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    onChange.mockReset()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })
  const render = (selected: DirectModelOption | null = null) => act(() => root.render(createElement(AgentModelSelect, {
    role: 'main', label: 'Main model', options: OPTIONS, onChange,
    selected: selected ? { providerId: selected.providerId, accountId: selected.accountId, model: selected.model } : null,
    inherited: { providerId: 'deepseek', model: 'deepseek-flash' }
  })))
  const trigger = () => host.querySelector<HTMLButtonElement>('[data-agent-model-trigger="main"]')!
  const search = () => document.querySelector<HTMLInputElement>('[data-agent-model-panel] input[type="search"]')!
  const key = (target: Element, name: string) => act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  })
  const type = (value: string) => act(() => {
    const input = search()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('shows the inherited model with a follow-default badge and portals the list', () => {
    render()
    expect(trigger().textContent).toContain('deepseek-flash')
    expect(trigger().textContent).toContain('Follow default')
    key(trigger(), 'ArrowDown')
    const panel = document.querySelector('[data-agent-model-panel]')!
    expect(host.contains(panel)).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelector('[data-agent-model-option="__inherit__"]')!.getAttribute('aria-selected')).toBe('true')
    expect(panel.textContent).toContain('Unavailable')
    expect(panel.textContent).toContain(i18n.t('directScopeUnsupported', { ns: 'common' }))
  })

  it('moves with arrows, skips unavailable rows and picks with Enter', () => {
    render()
    act(() => trigger().click())
    const input = search()
    key(input, 'ArrowDown')
    key(input, 'ArrowDown')
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)!.textContent).toContain('gpt-6-luna')
    key(input, 'ArrowDown')
    key(input, 'ArrowDown')
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)!.textContent).toContain('deepseek-flash')
    key(input, 'Enter')
    expect(onChange).toHaveBeenCalledWith({ providerId: 'deepseek', accountId: 'account:deepseek', model: 'deepseek-flash' })
    expect(document.querySelector('[data-agent-model-panel]')).toBeNull()
  })

  it('filters while typing, picks the first match, and Escape restores focus', () => {
    render(OPTIONS[0]!)
    act(() => trigger().click())
    type('luna')
    expect(document.querySelector('[data-agent-model-option="__inherit__"]')).toBeNull()
    expect(document.querySelector('[data-agent-model-panel] mark')!.textContent).toBe('luna')
    key(search(), 'Enter')
    expect(onChange).toHaveBeenCalledWith({ providerId: 'codex', accountId: 'account:codex', model: 'gpt-6-luna' })
    act(() => trigger().click())
    type('gemini')
    expect(document.querySelector('[data-agent-model-panel]')!.textContent).toContain('No models match')
    key(search(), 'Escape')
    expect(document.querySelector('[data-agent-model-panel]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('reports null when following the default again', () => {
    render(OPTIONS[0]!)
    act(() => trigger().click())
    act(() => document.querySelector<HTMLButtonElement>('[data-agent-model-option="__inherit__"]')!.click())
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
