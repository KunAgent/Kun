// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyTerminalOpenRequest,
  consumePendingTerminalRequest,
  hasPendingTerminalRequest,
  openTerminal,
  openTerminalAt,
  openTerminalWithSetup,
  paneForTerminalRequest,
  useTerminalOpenRequests
} from './terminal-open'
import { resetTerminalDockStoreForTest, seedWorkspace, workspaceTerminals } from './terminal-dock-store'

const KEY = 'workspace-a'

function HookHarness(): null {
  useTerminalOpenRequests(KEY)
  return null
}

describe('terminal-open request channel', () => {
  beforeEach(() => {
    resetTerminalDockStoreForTest()
    seedWorkspace(KEY, { id: 'main', target: { kind: 'local' } })
  })
  afterEach(() => {
    consumePendingTerminalRequest()
  })

  it('stores a pending request until the dock drains it', () => {
    openTerminalWithSetup({ prefill: 'npm i -g @x/cli', probeHarnessId: 'codex' })
    expect(hasPendingTerminalRequest()).toBe(true)
    expect(consumePendingTerminalRequest()).toEqual({ prefill: 'npm i -g @x/cli', probeHarnessId: 'codex' })
    expect(hasPendingTerminalRequest()).toBe(false)
  })

  it('openTerminalAt stays a cwd-only shorthand', () => {
    openTerminalAt('/tmp/work')
    expect(consumePendingTerminalRequest()).toEqual({ cwd: '/tmp/work' })
  })

  it('builds panes for setup, agent and Kun process requests', () => {
    const setup = paneForTerminalRequest({ prefill: 'claude /login', probeHarnessId: 'claude-code', title: 'Claude Code' })
    expect(setup).toMatchObject({ target: { kind: 'local' }, prefill: 'claude /login', probeHarnessId: 'claude-code', title: 'Claude Code', fresh: true })
    const agent = paneForTerminalRequest({ agent: { harnessId: 'codex', title: 'Codex', task: 'fix it' }, cwd: '/w' })
    expect(agent.target).toEqual({ kind: 'agent', harnessId: 'codex', title: 'Codex', task: 'fix it', cwd: '/w' })
    const process = paneForTerminalRequest({ kunProcess: { id: 'p1', command: 'npm run dev', threadId: 't1' } })
    expect(process.target).toEqual({ kind: 'kun-process', processId: 'p1', command: 'npm run dev', threadId: 't1' })
  })

  it('reuses a local tab with the same directory and a Kun process tab', () => {
    applyTerminalOpenRequest(KEY, { cwd: '/tmp/work' })
    applyTerminalOpenRequest(KEY, { cwd: '/tmp/work' })
    applyTerminalOpenRequest(KEY, { kunProcess: { id: 'p1', command: 'npm run dev', threadId: 't1' } })
    applyTerminalOpenRequest(KEY, { kunProcess: { id: 'p1', command: 'npm run dev', threadId: 't1' } })
    const { tabs, activeTabId } = workspaceTerminals(KEY)
    expect(tabs).toHaveLength(3)
    expect(tabs.find((tab) => tab.id === activeTabId)?.panes[0]?.target.kind).toBe('kun-process')
  })

  it('a mounted dock drains the pending request and handles new events', () => {
    openTerminal({ cwd: '/tmp/a' })
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(createElement(HookHarness)) })
    expect(workspaceTerminals(KEY).tabs).toHaveLength(2)
    act(() => { openTerminalWithSetup({ prefill: 'codex login', title: 'Codex' }) })
    const tabs = workspaceTerminals(KEY).tabs
    expect(tabs).toHaveLength(3)
    expect(tabs[2]?.panes[0]).toMatchObject({ prefill: 'codex login', title: 'Codex' })
    expect(hasPendingTerminalRequest()).toBe(false)
    act(() => renderer.unmount())
  })
})
