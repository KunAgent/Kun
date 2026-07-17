import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UiPluginHostEffect } from '@shared/ui-plugin'
import AppShell, { UiPluginStartupLifecycle } from './AppShell'
import { useUiPluginStore } from './store/ui-plugin-store'

const initialInitUiPlugins = useUiPluginStore.getState().initUiPlugins

const effect: UiPluginHostEffect = {
  kind: 'shuimo-yijing',
  hexagram: {
    ordinal: 1,
    glyph: '䷀',
    name: '乾',
    statement: '元亨利貞',
    statementCommentary: '六畫者伏羲所畫之卦也',
    movingLine: 1,
    movingLineLabel: '初九',
    movingLineText: '潛龍勿用',
    movingLineCommentary: '初陽在下未可施用'
  }
}

describe('AppShell', () => {
  afterEach(() => {
    useUiPluginStore.setState({
      uiMode: 'default',
      activeRuntime: null,
      initUiPlugins: initialInitUiPlugins
    })
    Object.assign(useUiPluginStore.getInitialState(), {
      uiMode: 'default',
      activeRuntime: null
    })
    vi.unstubAllGlobals()
  })

  it('initializes persisted UI plugins from the app lifecycle before settings opens', async () => {
    const initUiPlugins = vi.fn(async () => undefined)
    useUiPluginStore.setState({ initUiPlugins })
    let renderer: ReactTestRenderer
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

    try {
      await act(async () => {
        renderer = create(createElement(UiPluginStartupLifecycle))
      })

      expect(initUiPlugins).toHaveBeenCalledTimes(1)
      act(() => renderer!.unmount())
    } finally {
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
    }
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
    expect(html).toContain('bg-ds-card')
  })

  it('mounts the active yijing backdrop below an isolated foreground', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'darwin' }
    })
    useUiPluginStore.setState({
      uiMode: 'shuimo-yijing',
      activeRuntime: {
        manifest: {
          id: 'shuimo-yijing',
          name: '水墨易经',
          version: '1.0.0',
          figures: { swim: 'img/ink.png' }
        },
        figures: {},
        hostEffect: effect
      }
    })
    Object.assign(useUiPluginStore.getInitialState(), useUiPluginStore.getState())

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('ds-app-shell')
    expect(html).toContain('relative isolate')
    expect(html).toContain('shuimo-yijing-backdrop')
    expect(html).toContain('relative z-10')
  })
})
