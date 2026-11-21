/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ColabConnectionView,
  ColabSessionView,
  ColabStateSnapshot
} from '@shared/colab/colab-types'
import { ColabConnectionsSection } from './ColabConnectionsSection'
import { useColabStore } from './colab-store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const WS = '/ws/image-cls'

function conn(id: string, name: string, extra: Partial<ColabConnectionView> = {}): ColabConnectionView {
  return {
    id,
    name,
    email: `${id}@example.com`,
    avatarColor: '#5b78ff',
    planLabel: 'Pro',
    balanceCu: 50,
    burnRateCuPerHour: null,
    status: 'connected',
    createdAt: '',
    updatedAt: '',
    activeSessions: [],
    ...extra
  }
}

function snapshot(partial: Partial<ColabStateSnapshot>): ColabStateSnapshot {
  return {
    cli: { state: 'ready', version: '0.8.0', pythonVersion: '3.12', venvPath: '' },
    connections: [],
    workspaceConnections: {},
    oauthPending: null,
    lastLoginOutcome: null,
    sessions: [],
    untrackedSessions: [],
    lastRunsByWorkspace: {},
    ...partial
  }
}

function setReactActEnvironment(value: boolean): void {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = value
}

let container: HTMLDivElement
let root: Root
const api = {
  colabSelectWorkspaceConnection: vi.fn(async () => ({ ok: true })),
  colabClearLastLoginOutcome: vi.fn(async () => undefined),
  colabStartOAuthLogin: vi.fn(async () => ({ ok: true }))
}

function render(): void {
  act(() => {
    root.render(createElement(ColabConnectionsSection, { workspaceRoot: WS }))
  })
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="radio"]')]
}

beforeEach(() => {
  setReactActEnvironment(true)
  vi.useFakeTimers()
  Object.values(api).forEach((fn) => fn.mockClear())
  ;(window as unknown as { kunGui: typeof api }).kunGui = api
  // jsdom has no layout engine.
  Element.prototype.scrollIntoView = vi.fn()
  useColabStore.setState(useColabStore.getInitialState(), true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  setReactActEnvironment(false)
})

describe('ColabConnectionsSection', () => {
  it('moves focus with arrow keys and only switches on Enter', () => {
    useColabStore.setState({
      connectionsExpanded: true,
      snapshot: snapshot({
        connections: [conn('a', 'Personal'), conn('b', 'Lab')],
        workspaceConnections: { [WS]: 'a' }
      })
    })
    render()
    const [first, second] = rows()
    act(() => first!.focus())
    act(() => {
      first!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(second)
    expect(api.colabSelectWorkspaceConnection).not.toHaveBeenCalled()

    act(() => {
      second!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(api.colabSelectWorkspaceConnection).toHaveBeenCalledWith({
      workspaceRoot: WS,
      connectionId: 'b'
    })
  })

  it('asks for confirmation before switching while this workspace has a running session', () => {
    useColabStore.setState({
      connectionsExpanded: true,
      snapshot: snapshot({
        connections: [conn('a', 'Personal'), conn('b', 'Lab')],
        workspaceConnections: { [WS]: 'a' },
        sessions: [
          { id: 's1', sessionName: 'image-cls-0116', workspaceRoot: WS, connectionId: 'a', phase: 'running' } as ColabSessionView
        ]
      })
    })
    render()
    act(() => rows()[1]!.click())
    expect(api.colabSelectWorkspaceConnection).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('colab.switchConfirmTitle')
  })

  it('shows a retryable banner after a timed-out login', () => {
    useColabStore.setState({
      addAccountOpen: true,
      snapshot: snapshot({
        connections: [conn('a', 'Personal')],
        workspaceConnections: { [WS]: 'a' },
        lastLoginOutcome: { ok: false, kind: 'timeout', message: 'timeout' }
      })
    })
    render()
    const banner = container.querySelector('[role="alert"]')
    expect(banner?.textContent).toContain('colab.loginTimedOut')
    expect(banner?.textContent).toContain('colab.retryBtn')
  })

  it('clears the new-account badge after the highlight window', () => {
    const created = conn('b', 'Lab')
    act(() => {
      useColabStore.getState().applySnapshot(
        snapshot({
          connections: [conn('a', 'Personal'), created],
          workspaceConnections: { [WS]: 'b' },
          lastLoginOutcome: { ok: true, kind: 'created', connection: created }
        })
      )
      useColabStore.setState({ connectionsExpanded: true })
    })
    render()
    expect(container.textContent).toContain('colab.newBadge')
    act(() => {
      vi.advanceTimersByTime(2_100)
    })
    expect(container.textContent).not.toContain('colab.newBadge')
  })
})
