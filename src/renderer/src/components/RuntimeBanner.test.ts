import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeBanner } from './RuntimeBanner'

describe('RuntimeBanner', () => {
  it('renders technical details and logs as compact toast affordances', () => {
    const html = renderToStaticMarkup(createElement(RuntimeBanner, {
      message: 'Runtime request failed.',
      detail: 'Code: provider_unavailable\n\nMessage:\nprovider failed',
      logPath: '/tmp/deepseek-gui/logs',
      runtimeReady: true,
      stageInsetClass: 'px-4',
      t: (key: string) => key,
      onOpenLogDir: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetryConnection: vi.fn()
    }))

    expect(html).toContain('Runtime request failed.')
    expect(html).toContain('role="alert"')
    expect(html).toContain('ds-runtime-error-toast')
    expect(html).toContain('runtimeErrorDetails')
    expect(html).toContain('runtimeErrorViewLogs')
    expect(html).not.toContain('/tmp/deepseek-gui/logs')
    expect(html).not.toContain('retryConnection')
  })

  it('adds the connection title and recovery actions when the runtime is offline', () => {
    const html = renderToStaticMarkup(createElement(RuntimeBanner, {
      message: 'Automatic recovery did not find a matching plan.',
      runtimeReady: false,
      stageInsetClass: 'px-4',
      t: (key: string) => key,
      onOpenSettings: vi.fn(),
      onRetryConnection: vi.fn()
    }))

    expect(html).toContain('runtimeErrorHeroTitle')
    expect(html).toContain('Automatic recovery did not find a matching plan.')
    expect(html).toContain('retryConnection')
    expect(html).toContain('openSettings')
    expect(html).toContain('aria-label="close"')
  })
})
