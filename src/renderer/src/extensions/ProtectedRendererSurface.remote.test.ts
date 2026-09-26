// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtectedRendererSurface } from './ProtectedRendererSurface'
import { createInitialChatStoreState } from '../store/chat-store-initial-state'

const RESTORE_KEY = 'kun:protected-surface-restore'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

describe('protected surface on Remote web', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  let session: MemoryStorage

  beforeEach(() => {
    session = new MemoryStorage()
    Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true })
    Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('renders its children immediately without the host-only content-script sync', () => {
    const extensionSyncHostContentScripts = vi.fn(() => new Promise(() => undefined))
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      isRemoteWeb: true,
      extensionSyncHostContentScripts
    }
    root = createRoot(container)
    act(() => root!.render(createElement(ProtectedRendererSurface, {
      kind: 'account-credentials',
      restoreTarget: 'settings',
      fallback: createElement('span', null, 'loading'),
      children: createElement('span', null, 'settings-body')
    })))
    expect(container.textContent).toBe('settings-body')
    expect(extensionSyncHostContentScripts).not.toHaveBeenCalled()
    expect(session.getItem(RESTORE_KEY)).toBeNull()
  })

  it('ignores and clears a stale settings restore key on Remote web', () => {
    session.setItem(RESTORE_KEY, 'settings')
    ;(window as unknown as { kunGui: unknown }).kunGui = { isRemoteWeb: true }
    const state = createInitialChatStoreState('workspace')
    expect(state.route).toBe('chat')
    expect(session.getItem(RESTORE_KEY)).toBeNull()
  })

  it('still restores the settings route in the desktop renderer', () => {
    session.setItem(RESTORE_KEY, 'settings')
    ;(window as unknown as { kunGui: unknown }).kunGui = { isRemoteWeb: false }
    const state = createInitialChatStoreState('workspace')
    expect(state.route).toBe('settings')
  })
})
