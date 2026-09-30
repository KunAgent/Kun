// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  consumePendingTerminalRequest,
  hasPendingTerminalRequest,
  openTerminalAt,
  openTerminalWithSetup,
  TERMINAL_OPEN_AT_EVENT,
  useTerminalOpenAt
} from './terminal-open'
import type { TerminalTab } from './terminal-panel-support'

function HookHarness({
  tabsRef,
  setTabs,
  setActiveTabId
}: {
  tabsRef: { current: TerminalTab[] }
  setTabs: (updater: (current: TerminalTab[]) => TerminalTab[]) => void
  setActiveTabId: (id: string) => void
}): null {
  useTerminalOpenAt(tabsRef, setTabs, setActiveTabId)
  return null
}

function mountHarness(initial: TerminalTab[] = []) {
  const state = { tabs: initial, activeTabId: initial[0]?.id ?? '' }
  const tabsRef = { current: state.tabs }
  const setTabs = (updater: (current: TerminalTab[]) => TerminalTab[]): void => {
    state.tabs = updater(state.tabs)
    tabsRef.current = state.tabs
  }
  const setActiveTabId = (id: string): void => {
    state.activeTabId = id
  }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(HookHarness, { tabsRef, setTabs, setActiveTabId }))
  })
  return { state, renderer }
}

describe('terminal-open request channel', () => {
  afterEach(() => {
    consumePendingTerminalRequest()
    vi.restoreAllMocks()
  })

  it('stores a pending request until the panel drains it', () => {
    openTerminalWithSetup({ prefill: 'npm i -g @x/cli', probeHarnessId: 'codex' })
    expect(hasPendingTerminalRequest()).toBe(true)
    expect(consumePendingTerminalRequest()).toEqual({
      prefill: 'npm i -g @x/cli',
      probeHarnessId: 'codex'
    })
    expect(hasPendingTerminalRequest()).toBe(false)
    expect(consumePendingTerminalRequest()).toBeNull()
  })

  it('openTerminalAt stays a cwd-only shorthand', () => {
    openTerminalAt('/tmp/work')
    expect(consumePendingTerminalRequest()).toEqual({ cwd: '/tmp/work' })
  })

  it('a mounted panel opens a prefill tab straight from the event', () => {
    const { state, renderer } = mountHarness([
      { id: 'main', index: 1, target: { kind: 'local' } }
    ])
    act(() => {
      openTerminalWithSetup({
        prefill: 'claude /login',
        probeHarnessId: 'claude-code',
        title: 'Claude Code'
      })
    })
    expect(state.tabs).toHaveLength(2)
    const tab = state.tabs[1]
    expect(tab.prefill).toBe('claude /login')
    expect(tab.probeHarnessId).toBe('claude-code')
    expect(tab.title).toBe('Claude Code')
    expect(state.activeTabId).toBe(tab.id)
    // The live event cleared the pending slot, so a later mount sees nothing.
    expect(hasPendingTerminalRequest()).toBe(false)
    act(() => renderer.unmount())
  })

  it('reuses an existing local tab for plain cwd requests', () => {
    const { state, renderer } = mountHarness([
      { id: 'main', index: 1, target: { kind: 'local', cwd: '/repo' } }
    ])
    act(() => openTerminalAt('/repo'))
    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).toBe('main')
    act(() => renderer.unmount())
  })

  it('never reuses a tab when the request carries a prefill', () => {
    const { state, renderer } = mountHarness([
      { id: 'main', index: 1, target: { kind: 'local', cwd: '/repo' } }
    ])
    act(() => {
      openTerminalWithSetup({ cwd: '/repo', prefill: 'gemini auth', probeHarnessId: 'gemini-cli' })
    })
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[1].prefill).toBe('gemini auth')
    act(() => renderer.unmount())
  })

  it('a request dispatched before mount is drained on mount', () => {
    openTerminalWithSetup({ prefill: 'opencode auth login', probeHarnessId: 'opencode' })
    const { state, renderer } = mountHarness()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].prefill).toBe('opencode auth login')
    expect(state.tabs[0].probeHarnessId).toBe('opencode')
    act(() => renderer.unmount())
  })
})
