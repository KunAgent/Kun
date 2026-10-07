// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { useHarnessStore } from '../../store/harness-store'
import {
  harnessAgentRequestField,
  nativeAgentOptions,
  selectHarnessNativeAgent,
  selectedNativeAgentPreview,
  useHarnessNativeAgentStore
} from '../../lib/harness-native-agent'
import { FloatingComposerNativeAgentPicker } from './FloatingComposerNativeAgentPicker'

function row(id: string, nativeAgents: boolean): AdeHarnessRow {
  return {
    definition: {
      id,
      displayName: id === 'opencode' ? 'OpenCode' : 'Devin',
      transport: 'acp',
      credentialModes: ['native-login'],
      permissionModes: [
        { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' },
        { id: 'build', label: 'Build', kunPermissionMode: 'full-access' }
      ],
      modelSource: 'probe',
      ...(nativeAgents ? { nativeAgents: 'session-modes' as const } : {}),
      staticModels: [],
      builtin: true
    },
    status: { harnessId: id, installed: 'yes', login: 'signed-in', checkedAt: '2026-01-01T00:00:00Z' }
  } as AdeHarnessRow
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useHarnessNativeAgentStore.setState({ selected: {} })
  useHarnessStore.setState({
    rows: [row('opencode', true), row('devin', false)],
    // A loaded (non-empty) catalog keeps the picker from starting a live lookup.
    models: { opencode: { models: ['m'], loading: false, agents: [{ id: 'build' }, { id: 'plan' }] } },
    sessions: {}
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function render(harnessId: string, threadId?: string): void {
  act(() => root.render(createElement(FloatingComposerNativeAgentPicker, { harnessId, threadId })))
}

describe('FloatingComposerNativeAgentPicker', () => {
  it('stays hidden for Agents without switchable native Agents', () => {
    render('devin')
    expect(host.querySelector('[data-native-agent-picker]')).toBeNull()
  })

  it('lists the live session Agents and forwards the picked one with the next turn', () => {
    useHarnessStore.setState({ sessions: { thread_1: { harnessId: 'opencode', updatedAt: '', agents: [
      { id: 'build', name: 'build' }, { id: 'plan', name: 'plan' }, { id: 'docs', name: 'docs', description: 'Writes docs' }
    ] } } })
    render('opencode', 'thread_1')
    const trigger = host.querySelector<HTMLButtonElement>('[data-native-agent-picker] button')!
    expect(trigger.textContent).toContain('Auto')
    act(() => trigger.click())
    const items = [...document.querySelectorAll<HTMLButtonElement>('[data-native-agent-menu] [role="menuitemradio"]')]
    expect(items.map((item) => item.dataset.nativeAgent)).toEqual(['', 'build', 'plan', 'docs'])
    expect(items[0]!.getAttribute('aria-checked')).toBe('true')
    act(() => items[3]!.click())
    expect(trigger.textContent).toContain('Docs')
    expect(harnessAgentRequestField('opencode')).toEqual({ harnessAgentId: 'docs' })
    expect(harnessAgentRequestField('devin')).toEqual({})
  })

  it('returns to Auto, which sends no Agent and keeps permission mapping', () => {
    selectHarnessNativeAgent('opencode', 'plan')
    render('opencode')
    const trigger = host.querySelector<HTMLButtonElement>('[data-native-agent-picker] button')!
    expect(trigger.textContent).toContain('Plan')
    act(() => trigger.click())
    act(() => document.querySelector<HTMLButtonElement>('[data-native-agent=""]')!.click())
    expect(harnessAgentRequestField('opencode')).toEqual({})
  })
})

describe('nativeAgentOptions', () => {
  it('prefers the live session, then the catalog, then the declared built-in modes', () => {
    const opencode = row('opencode', true)
    expect(nativeAgentOptions({ row: opencode, sessionAgents: [{ id: 'docs' }], catalogAgents: [{ id: 'build' }] })).toEqual([{ id: 'docs' }])
    expect(nativeAgentOptions({ row: opencode, catalogAgents: [{ id: 'build' }] })).toEqual([{ id: 'build' }])
    expect(nativeAgentOptions({ row: opencode }).map((agent) => agent.id)).toEqual(['plan', 'build'])
    expect(nativeAgentOptions({ row: row('devin', false), catalogAgents: [{ id: 'build' }] })).toEqual([])
  })
})

describe('selectedNativeAgentPreview', () => {
  it('shows the picked Agent instead of the permission-mapped mode', () => {
    expect(selectedNativeAgentPreview(row('opencode', true))).toBeNull()
    selectHarnessNativeAgent('opencode', 'docs')
    expect(selectedNativeAgentPreview(row('opencode', true))).toEqual({ id: 'docs', label: 'Docs', readOnly: false })
    selectHarnessNativeAgent('opencode', 'plan')
    expect(selectedNativeAgentPreview(row('opencode', true))?.readOnly).toBe(true)
    expect(selectedNativeAgentPreview(row('devin', false))).toBeNull()
  })
})
