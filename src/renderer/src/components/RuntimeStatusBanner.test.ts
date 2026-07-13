import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import { RuntimeStatusBanner } from './RuntimeStatusBanner'

const storeState = vi.hoisted(() => ({
  runtimeStatus: null as KunRuntimeStatusPayload | null,
  probeRuntime: vi.fn(async () => undefined)
}))

vi.mock('../store/chat-store', () => ({
  useChatStore: (selector: (state: {
    runtimeStatus: KunRuntimeStatusPayload | null
    probeRuntime: typeof storeState.probeRuntime
  }) => unknown) =>
    selector(storeState)
}))

describe('RuntimeStatusBanner', () => {
  afterEach(() => {
    storeState.runtimeStatus = null
    storeState.probeRuntime.mockClear()
  })

  it('renders automatic restarts as an informational status banner', () => {
    storeState.runtimeStatus = {
      state: 'restarting',
      source: 'health-check',
      attempt: 1,
      maxAttempts: 3,
      at: '2026-06-18T15:00:00.000Z'
    }

    const html = renderToStaticMarkup(createElement(RuntimeStatusBanner))

    expect(html).toContain('data-variant="info"')
    expect(html).toContain('role="status"')
    expect(html).toContain('border-sky-200')
    expect(html).not.toContain('role="alert"')
  })

  it('keeps settings rollback visually distinct as a warning banner', () => {
    storeState.runtimeStatus = {
      state: 'running',
      source: 'settings-apply',
      rolledBack: true,
      at: '2026-06-18T15:01:00.000Z'
    }

    const html = renderToStaticMarkup(createElement(RuntimeStatusBanner))

    expect(html).toContain('data-variant="warning"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('border-amber-200')
  })

  it('keeps the workbench mounted while the runtime is degraded', () => {
    storeState.runtimeStatus = {
      state: 'degraded',
      source: 'watchdog',
      at: '2026-06-18T15:02:00.000Z'
    }

    const html = renderToStaticMarkup(createElement(RuntimeStatusBanner))

    expect(html).toContain('data-variant="warning"')
    expect(html).toContain('runtimeStatusDegraded')
    expect(html).not.toContain('retryConnection')
  })

  it('offers an explicit reconnect action for an offline runtime', async () => {
    storeState.runtimeStatus = {
      state: 'offline',
      source: 'health-check',
      at: '2026-06-18T15:03:00.000Z'
    }

    const html = renderToStaticMarkup(createElement(RuntimeStatusBanner))

    expect(html).toContain('runtimeStatusOffline')
    expect(html).toContain('aria-label="retryConnection"')
    expect(html).toContain('role="alert"')
  })
})
