import { createElement } from 'react'
import type { ErrorInfo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      createElement(AppErrorBoundary, null, createElement('div', { 'data-testid': 'child' }, 'hello'))
    )
    expect(html).toContain('hello')
    expect(html).not.toContain('appErrorTitle')
  })

  it('renders without throwing when given no children', () => {
    const result = renderToStaticMarkup(createElement(AppErrorBoundary, null, null))
    expect(typeof result).toBe('string')
  })

  it('writes render errors to the app log API when available', () => {
    const logError = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: { logError } })
    const boundary = new AppErrorBoundary({ children: null })
    const error = new Error('boom')

    boundary.componentDidCatch(error, { componentStack: '\n    at Child' } as ErrorInfo)

    expect(logError).toHaveBeenCalledWith('renderer', 'Uncaught render error', {
      errorId: expect.any(String),
      name: 'Error',
      message: 'boom',
      stack: expect.any(String),
      componentStack: expect.any(String)
    })
  })

  it('does not render or log raw secret-like error text', () => {
    const logError = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: { logError } })
    const boundary = new AppErrorBoundary({ children: null })
    const error = new Error('request failed apiKey=super-secret')

    boundary.componentDidCatch(error, { componentStack: '\n    at Child token=component-secret' } as ErrorInfo)
    const detail = logError.mock.calls[0]?.[2] as Record<string, string>

    expect(detail.message).toContain('<redacted>')
    expect(detail.message).not.toContain('super-secret')
    expect(detail.componentStack).not.toContain('component-secret')
  })

  it('uses the desktop recovery APIs and exposes recovery actions', async () => {
    const runDesktopCommand = vi.fn().mockResolvedValue(undefined)
    const openLogDir = vi.fn().mockResolvedValue({ ok: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: { runDesktopCommand, openLogDir } })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const boundary = new AppErrorBoundary({ children: null })
    boundary.state = { error: new Error('boom'), errorId: 'renderer-test-id' }

    const handlers = boundary as unknown as {
      handleReload: () => void
      handleCopyErrorId: () => void
      handleOpenLogs: () => void
    }
    handlers.handleReload()
    handlers.handleCopyErrorId()
    handlers.handleOpenLogs()
    await Promise.resolve()
    expect(runDesktopCommand).toHaveBeenCalledWith('reload')
    expect(writeText).toHaveBeenCalledWith('renderer-test-id')
    expect(openLogDir).toHaveBeenCalledTimes(1)

    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(html).toContain('renderer-test-id')
    expect(html).toContain('Reload workbench')
    expect(html).toContain('Copy error ID')
    expect(html).toContain('Open logs')
  })
})
