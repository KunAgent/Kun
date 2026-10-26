// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import i18n from '../../i18n'
import { DispatchPreferenceEditor } from './DispatchPreferenceEditor'
import type { AdeDispatchPreferenceRule } from '@shared/ade-collaboration-settings'
vi.mock('../../store/harness-store', () => ({ useHarnessStore: (select: (state: unknown) => unknown) => select({ rows: [] }) }))
vi.mock('../chat/AgentDispatchRoutePicker', () => ({ AgentDispatchRoutePicker: ({ onChange }: { onChange: (route: unknown) => void }) =>
  createElement('button', { onClick: () => onChange({ agentId: 'codex', model: 'test-model', credentialMode: 'native-login' }) }, 'Pick Codex') }))
let host: HTMLDivElement, root: Root
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('zh'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); await i18n.changeLanguage('en') })
const rule: AdeDispatchPreferenceRule = { id: 'one', scenario: 'Review', agentId: 'kun', enabled: true }
function Harness({ initial = [] }: { initial?: AdeDispatchPreferenceRule[] }) {
  const [rules, setRules] = useState(initial), [notes, setNotes] = useState('')
  return createElement(DispatchPreferenceEditor, { preferences: rules, notes, onPreferencesChange: setRules, onNotesChange: setNotes })
}
function click(selector: string): void { act(() => host.querySelector<HTMLButtonElement>(selector)!.click()) }
describe('DispatchPreferenceEditor', () => {
  it('adds and removes a scenario without creating work', () => {
    act(() => root.render(createElement(Harness)))
    click('[data-preference-add]')
    expect(host.querySelectorAll('[data-preference-rule]')).toHaveLength(1)
    expect(host.querySelector('input[aria-invalid="true"]')).not.toBeNull()
    click('button[aria-label="删除此偏好"]')
    expect(host.querySelectorAll('[data-preference-rule]')).toHaveLength(0)
  })
  it('updates Agent identity and model, supports default models and omits disabled rules from preview', () => {
    act(() => root.render(createElement(Harness, { initial: [rule] })))
    const pick = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Pick Codex')!
    act(() => pick.click())
    expect(host.querySelector('[data-preference-summary] [data-agent-icon="codex"]')).not.toBeNull()
    expect(host.querySelector('pre')?.textContent).toContain('test-model')
    const reset = [...host.querySelectorAll('button')].find((button) => button.textContent === '跟随 Agent 默认模型')!
    act(() => reset.click())
    expect(host.querySelector('pre')?.textContent).toContain('Agent default')
    click('input[type="checkbox"]')
    expect(host.querySelector('pre')?.textContent).not.toContain('Review')
    expect(host.querySelector('[data-preference-summary]')?.textContent).toBe('')
  })
  it('enforces the eight-rule cap and displays the untruncated text budget error', () => {
    const initial = Array.from({ length: 8 }, (_, i) => ({ ...rule, id: String(i), scenario: 'x'.repeat(200), note: 'y'.repeat(300) }))
    act(() => root.render(createElement(Harness, { initial })))
    expect(host.querySelector<HTMLButtonElement>('[data-preference-add]')!.disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('2000')
    expect(host.querySelector('pre')!.textContent!.length).toBeGreaterThan(2000)
  })
})
