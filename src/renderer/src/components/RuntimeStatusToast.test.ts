import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import i18n from '../i18n'
import { RuntimeStatusToast } from './RuntimeStatusToast'
import { resetToasts, useToastStore } from '../toast/toast-store'

const chat = vi.hoisted(() => ({ status: undefined as KunRuntimeStatusPayload | undefined }))

vi.mock('../store/chat-store', () => ({
  useChatStore: (selector: (state: { runtimeStatus?: KunRuntimeStatusPayload }) => unknown) =>
    selector({ runtimeStatus: chat.status })
}))

const status = (payload: Partial<KunRuntimeStatusPayload> & Pick<KunRuntimeStatusPayload, 'state'>): KunRuntimeStatusPayload => ({ source: 'supervisor', at: '2026-01-01T00:00:00.000Z', ...payload })
const card = () => useToastStore.getState().items[0]

function mount(): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = createRenderer(createElement(RuntimeStatusToast))
  })
  return renderer as ReactTestRenderer
}

function show(renderer: ReactTestRenderer, next: KunRuntimeStatusPayload): void {
  chat.status = next
  act(() => {
    renderer.update(createElement(RuntimeStatusToast))
  })
}

beforeEach(() => {
  resetToasts()
  chat.status = undefined
})

afterEach(() => {
  resetToasts()
  chat.status = undefined
  i18n.changeLanguage('en')
})

describe('RuntimeStatusToast', () => {
  it('shows an automatic restart as a sticky card with its attempt count', () => {
    chat.status = status({ state: 'restarting', attempt: 2, maxAttempts: 3, message: 'Restarting the local runtime' })
    mount()
    expect(card()).toMatchObject({
      id: 'runtime-status',
      tone: 'running',
      badge: '2/3',
      durationMs: null,
      description: 'Restarting the local runtime'
    })
  })

  it('confirms a restart that succeeded and then clears itself', () => {
    chat.status = status({ state: 'restarting', attempt: 1, maxAttempts: 3 })
    const renderer = mount()
    show(renderer, status({ state: 'running' }))
    expect(card()).toMatchObject({ id: 'runtime-status', tone: 'success' })
    expect(card()?.durationMs).toBe(4_000)
  })

  it('warns about a crash and a settings rollback until the user closes it', () => {
    chat.status = status({ state: 'crashed', message: 'The runtime exited' })
    const renderer = mount()
    expect(card()).toMatchObject({ tone: 'warning', durationMs: null, description: 'The runtime exited' })
    show(renderer, status({ state: 'running', rolledBack: true }))
    expect(card()).toMatchObject({ tone: 'warning', durationMs: null })
  })

  it('leaves terminal failures to the main error banner', () => {
    chat.status = status({ state: 'failed', message: 'Port in use' })
    mount()
    expect(useToastStore.getState().items).toEqual([])
  })
})
