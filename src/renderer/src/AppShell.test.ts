import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'
import { readStylesheetBundle } from './testing/stylesheet-bundle'

describe('AppShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the macOS app shell on the same full-height flex chain as desktop titlebar platforms', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'darwin' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('flex h-full min-h-0 flex-col bg-transparent')
    expect(html).toContain('flex min-h-0 flex-1 flex-col')
    expect(html).not.toContain('ds-windows-titlebar')
  })

  it('renders a visible route fallback instead of a blank shell while lazy views load', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'win32' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('role="status"')
    expect(html).toContain('Loading')
    expect(html).toContain('kun-loader')
  })

  it('omits the renderer title bar when Linux uses the system window frame', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'linux', desktopTitleBarMode: 'system' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('flex h-full min-h-0 flex-col bg-transparent')
    expect(html).not.toContain('ds-windows-titlebar')
  })

  it('keeps the renderer title bar in the default Linux mode', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'linux', desktopTitleBarMode: 'custom' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('ds-windows-app-frame')
    expect(html).toContain('ds-windows-titlebar')
  })

  it('reserves overlay height only when the renderer owns the title bar', async () => {
    const css = await readStylesheetBundle(new URL('./styles/base-shell.css', import.meta.url))

    expect(css).toContain(":root[data-desktop-title-bar='custom']")
    expect(css).not.toMatch(/data-platform='linux'[^}]*--ds-windows-titlebar-height/s)
  })

  it('does not render a DV overlay in the development workbench', () => {
    vi.stubGlobal('window', {
      kunGui: {
        platform: 'darwin',
        appEnvironment: { flavor: 'development', appName: 'kun-dv' }
      }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).not.toContain('data-testid="kun-dv-badge"')
    expect(html).not.toContain('kun-dv · DV')
  })
})
