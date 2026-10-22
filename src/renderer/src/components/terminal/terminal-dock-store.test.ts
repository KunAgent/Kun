// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTerminalTab,
  removeTerminalPane,
  renameTerminalPane,
  resetTerminalDockStoreForTest,
  seedWorkspace,
  setActiveTerminalTab,
  splitTerminalTab,
  takeClosedTerminal,
  workspaceTerminals
} from './terminal-dock-store'
import { freshPane, TERMINAL_MAX_TABS } from './terminal-dock-model'

const KEY = 'w'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  get length(): number { return this.values.size }
}

describe('terminal dock store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', new MemoryStorage())
    resetTerminalDockStoreForTest()
    seedWorkspace(KEY, { id: 'main', target: { kind: 'local' } })
  })

  it('adds tabs, optionally in the background, up to the limit', () => {
    const first = workspaceTerminals(KEY).activeTabId
    addTerminalTab(KEY, freshPane({ kind: 'local' }), { activate: false })
    expect(workspaceTerminals(KEY).activeTabId).toBe(first)
    for (let index = workspaceTerminals(KEY).tabs.length; index < TERMINAL_MAX_TABS; index += 1) {
      expect(addTerminalTab(KEY, freshPane({ kind: 'local' }))).toBe(true)
    }
    expect(addTerminalTab(KEY, freshPane({ kind: 'local' }))).toBe(false)
  })

  it('splits once, removes panes and remembers closed ones', () => {
    const tab = workspaceTerminals(KEY).tabs[0]!
    const right = freshPane({ kind: 'local' })
    expect(splitTerminalTab(KEY, tab.id, right)).toBe(true)
    expect(splitTerminalTab(KEY, tab.id, freshPane({ kind: 'local' }))).toBe(false)
    expect(workspaceTerminals(KEY).tabs[0]!.focusedPaneId).toBe(right.id)
    removeTerminalPane(KEY, tab.id, right.id, { pane: right, ptySessionId: 'pty-right', title: 'right', closedAt: 1 })
    expect(workspaceTerminals(KEY).tabs[0]!.panes).toHaveLength(1)
    expect(takeClosedTerminal(KEY, right.id)?.ptySessionId).toBe('pty-right')
    expect(workspaceTerminals(KEY).closed).toHaveLength(0)
  })

  it('moves focus to a neighbour when the active tab closes', () => {
    addTerminalTab(KEY, freshPane({ kind: 'local' }))
    const [first, second] = workspaceTerminals(KEY).tabs
    setActiveTerminalTab(KEY, first!.id)
    removeTerminalPane(KEY, first!.id, first!.panes[0]!.id)
    expect(workspaceTerminals(KEY).activeTabId).toBe(second!.id)
  })

  it('persists tabs without one-shot commands or Kun processes', async () => {
    const tab = workspaceTerminals(KEY).tabs[0]!
    renameTerminalPane(KEY, tab.id, 'main', 'renamed')
    addTerminalTab(KEY, freshPane({ kind: 'local' }, { initialCommand: 'npm test', prefill: 'x' }))
    addTerminalTab(KEY, freshPane({ kind: 'kun-process', processId: 'p', command: 'dev', threadId: 't' }))
    vi.advanceTimersByTime(400)
    const saved = JSON.parse(localStorage.getItem('kun.terminal.dock.v1') ?? '{}')
    const panes = saved.workspaces[KEY].tabs.flatMap((entry: { panes: unknown[] }) => entry.panes)
    expect(panes).toHaveLength(2)
    expect(panes[0].userTitle).toBe('renamed')
    expect(panes[1]).not.toHaveProperty('initialCommand')
    expect(panes[1]).not.toHaveProperty('prefill')
    expect(panes[1]).not.toHaveProperty('fresh')
  })
})
