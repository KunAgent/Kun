// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AppSettingsV1, defaultKunRuntimeSettings, mergeKunRuntimeSettings } from '@shared/app-settings'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'
import { nodeGraphEnabledFromApp, useNodeGraphEnabled } from './use-node-graph-enabled'

const mocks = vi.hoisted(() => ({ getSettings: vi.fn() }))
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: mocks }))

let enabled = false
let renderer: ReactTestRenderer | undefined
function Probe(): null {
  enabled = useNodeGraphEnabled()
  return null
}
function settings(value: boolean) {
  return { agents: { kun: mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
    lab: { nodeGraph: { enabled: value } }
  }) } } as AppSettingsV1
}
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks() })

describe('Node Graph Laboratory gate', () => {
  it('defaults off and backfills legacy settings without opting in', () => {
    expect(nodeGraphEnabledFromApp({} as AppSettingsV1)).toBe(false)
    const current = defaultKunRuntimeSettings()
    delete (current.lab as Partial<typeof current.lab>).nodeGraph
    expect(mergeKunRuntimeSettings(current, {}).lab.nodeGraph.enabled).toBe(false)
    const on = mergeKunRuntimeSettings(current, { lab: { nodeGraph: { enabled: true } } })
    expect(on.lab.nodeGraph.enabled).toBe(true)
    expect(mergeKunRuntimeSettings(on, { lab: { pptAgent: { enabled: false } } }).lab.nodeGraph.enabled).toBe(true)
    expect(mergeKunRuntimeSettings(on, { lab: { nodeGraph: { enabled: false } } }).lab.nodeGraph.enabled).toBe(false)
  })

  it('starts closed and follows live enable/disable events', async () => {
    mocks.getSettings.mockResolvedValue(settings(true))
    act(() => { renderer = create(createElement(Probe)) })
    expect(enabled).toBe(false)
    await act(async () => { await Promise.resolve() })
    expect(enabled).toBe(true)
    act(() => { window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: settings(false) })) })
    expect(enabled).toBe(false)
  })

  it('does not let a stale initial read overwrite a newer save', async () => {
    let resolve!: (value: ReturnType<typeof settings>) => void
    mocks.getSettings.mockReturnValue(new Promise((done) => { resolve = done }))
    act(() => { renderer = create(createElement(Probe)) })
    act(() => { window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: settings(false) })) })
    await act(async () => { resolve(settings(true)) })
    expect(enabled).toBe(false)
  })
})
