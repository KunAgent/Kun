// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { receiveHarnessSessionState, useHarnessStore } from '../../store/harness-store'
import { harnessSettingsRequestField, useHarnessSessionSettingsStore } from '../../lib/harness-session-settings'
import { normalizeKunRuntimeEvent } from '../../agent/kun-event-normalizer'
import { FloatingComposerAgentSettings } from './FloatingComposerAgentSettings'

const row = {
  definition: { id: 'fixture-acp', displayName: 'Fixture', transport: 'acp', credentialModes: ['native-login'],
    permissionModes: [{ id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' }], modelSource: 'probe',
    staticModels: [], builtin: false },
  status: { harnessId: 'fixture-acp', installed: 'yes', login: 'unknown', checkedAt: '2026-01-01T00:00:00Z' }
} as AdeHarnessRow
const verbosity = { kind: 'select' as const, id: 'verbosity', label: 'Verbosity', value: 'normal',
  options: [{ value: 'terse', label: 'Terse' }, { value: 'normal', label: 'Normal' }] }

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useHarnessSessionSettingsStore.setState({ values: {} })
  useHarnessStore.setState({ rows: [row], models: {}, sessions: {} })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

it('stays hidden until the Agent publishes settings', () => {
  act(() => root.render(createElement(FloatingComposerAgentSettings, { harnessId: 'fixture-acp', threadId: 't1' })))
  expect(document.querySelector('[data-agent-settings-picker]')).toBeNull()
})

it('renders catalog settings, prefers the live session and sends picks with the next turn', () => {
  useHarnessStore.setState({ models: { 'fixture-acp': { models: [], loading: false, settings: [verbosity] } } })
  act(() => root.render(createElement(FloatingComposerAgentSettings, { harnessId: 'fixture-acp', threadId: 't1' })))
  act(() => receiveHarnessSessionState({ threadId: 't1', harnessId: 'fixture-acp',
    settings: [verbosity, { kind: 'toggle', id: 'web', label: 'Web search', value: false }] }))
  act(() => document.querySelector<HTMLButtonElement>('[data-agent-settings-picker] button')!.click())
  expect(document.querySelector('[data-agent-setting="web"]')).not.toBeNull()
  act(() => document.querySelector<HTMLButtonElement>('[data-agent-setting-option="terse"]')!.click())
  act(() => document.querySelector<HTMLButtonElement>('[data-agent-setting="web"]')!.click())
  expect(harnessSettingsRequestField('fixture-acp')).toEqual({ harnessSettings: { verbosity: 'terse', web: true } })
  act(() => document.querySelector<HTMLButtonElement>('[data-agent-settings-reset]')!.click())
  expect(harnessSettingsRequestField('fixture-acp')).toEqual({})
})

it('projects settings from harness_session_state events and drops malformed ones', () => {
  const actions = normalizeKunRuntimeEvent({ kind: 'harness_session_state', threadId: 't1', turnId: 'u1', harnessId: 'fixture-acp',
    settings: [verbosity] } as never, {} as never)
  expect(actions[0]).toMatchObject({ type: 'harness_session_state_received', payload: { settings: [verbosity] } })
  const malformed = normalizeKunRuntimeEvent({ kind: 'harness_session_state', threadId: 't1', harnessId: 'fixture-acp',
    settings: [{ kind: 'slider', id: 'x' }] } as never, {} as never)
  expect(malformed[0]?.type === 'harness_session_state_received' && 'settings' in malformed[0].payload).toBe(false)
})
