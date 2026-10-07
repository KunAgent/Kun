import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsSidebar } from './SettingsSidebar'
import { EasterEggSettingsSection } from './settings-section-easter-egg'
import { useUiPluginStore } from '../store/ui-plugin-store'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function restoreLocalStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

const labels: Record<string, string> = {
  back: 'Back',
  general: 'General',
  providers: 'Providers',
  write: 'Work',
  imageGen: 'Image generation',
  speechToText: 'Speech to text',
  agents: 'AI assistant',
  keyboardShortcuts: 'Keyboard shortcuts',
  easterEgg: 'Mode workshop',
  claw: 'Connect phone',
  settingsFooter: 'Settings',
  easterEggSection: 'Mode workshop',
  uiModeWorkshopTitle: 'Mascot modes',
  uiModeWorkshopDesc: 'Pick the workspace mascot pack. iKun is a pre-installed plugin example.',
  uiModeDefaultTitle: 'Default Kun',
  uiModeDefaultSubtitle: 'The little blue bird',
  uiPaletteRetromaOn: 'Retroma palette on — click to use default palette',
  uiPaletteRetromaOff: 'Switch to Retroma parchment palette',
  uiPluginInstall: 'Install plugin folder…',
  uiPluginActivate: 'Use',
  uiPluginActive: 'Active',
  uiPluginRemove: 'Remove plugin',
  uiPluginEmpty: 'No UI plugins installed yet.',
  uiPluginDocsHint: 'Developer guide: docs/UI_PLUGINS.md',
  uiPluginCharacterScale: 'Character size',
  uiPluginCharacterScaleDesc: 'Adjust the active character relative to its pack default.',
  uiPluginCharacterScaleSmaller: 'Make character smaller',
  uiPluginCharacterScaleLarger: 'Make character larger'
}

const presentation = {
  character: {
    anchor: 'right' as const,
    size: 'hero' as const,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    frame: 'soft-card' as const,
    motion: 'none' as const,
    contentReserve: 'wide' as const
  },
  readability: { scrim: 'opposite-character' as const, strength: 'medium' as const },
  surfaces: {
    sidebar: 'glass' as const,
    topbar: 'glass' as const,
    composer: 'strong-glass' as const,
    cards: 'translucent' as const
  }
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('EasterEggSettingsSection (mode workshop)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage()
    })
    useUiPluginStore.setState({
      uiMode: 'default',
      installed: [],
      activeRuntime: null,
      characterScale: 1,
      busy: false,
      initialized: false,
      lastError: null
    })
  })

  afterEach(() => {
    restoreLocalStorage()
  })

  it('renders the default mode card and install entry (plugins come from the installed list)', () => {
    const html = renderToStaticMarkup(createElement(EasterEggSettingsSection, {
      ctx: {
        t,
        tCommon: t
      }
    }))

    expect(html).toContain('Mode workshop')
    expect(html).toContain('Mascot modes')
    expect(html).toContain('Default Kun')
    expect(html).toContain('Install plugin folder…')
    expect(html).toContain('docs/UI_PLUGINS.md')
    // 默认模式应处于使用中状态;iKun 不再硬编码,而是预装插件,SSR 下列表为空
    expect(html).toContain('Active')
    expect(html).not.toContain('iKun mode')
    // 默认 Kun 卡片右上角带 Retroma 配色切换按钮(SSR 下 uiMode=default,按钮为关闭态)
    expect(html).toContain('Switch to Retroma parchment palette')
    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain('Character size')
  })

  it('shows the active plugin scale and updates it through every control style', async () => {
    useUiPluginStore.setState({
      uiMode: 'alpha-theme',
      activeRuntime: {
        manifest: {
          id: 'alpha-theme',
          name: 'Alpha theme',
          version: '1.0.0',
          figures: { portrait: 'portrait.png' },
          presentation
        },
        figures: { portrait: 'data:image/png;base64,AAAA' },
        sceneAssets: {}
      },
      characterScale: 1.25,
      initialized: true
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(EasterEggSettingsSection, {
        ctx: { t, tCommon: t }
      }))
    })
    expect(JSON.stringify(renderer.toJSON())).toContain('Character size')

    const range = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'range')
    expect(range?.props.value).toBe(1.25)
    const initialNumber = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'number')
    expect(initialNumber?.props.value).toBe(125)
    await act(async () => range?.props.onChange({ target: { value: '1.5' } }))
    expect(useUiPluginStore.getState().characterScale).toBe(1.5)

    const number = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'number')
    await act(async () => number?.props.onChange({ target: { value: '180' } }))
    expect(useUiPluginStore.getState().characterScale).toBe(1.8)

    const smaller = renderer.root.findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Make character smaller')
    await act(async () => smaller?.props.onClick())
    expect(useUiPluginStore.getState().characterScale).toBe(1.75)

    const larger = renderer.root.findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Make character larger')
    await act(async () => larger?.props.onClick())
    expect(useUiPluginStore.getState().characterScale).toBe(1.8)
    await act(async () => renderer.unmount())
  })

  it('adds the workshop tab to the settings sidebar', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'easterEgg',
      goBack: () => undefined,
      setCategory: () => undefined,
      t
    }))

    expect(html).toContain('Mode workshop')
    expect(html).toMatch(/aria-current="page"[^>]*data-settings-category="easterEgg"/)
    expect(html).toContain('data-active="true"')
  })

  it('disables plugin removal while another workshop operation is busy', async () => {
    useUiPluginStore.setState({
      busy: true,
      initialized: true,
      installed: [{
        manifest: {
          id: 'alpha-theme',
          name: 'Alpha theme',
          version: '1.0.0',
          figures: {}
        },
        previewDataUrl: null
      }]
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(EasterEggSettingsSection, {
        ctx: { t, tCommon: t }
      }))
    })
    const removeButton = renderer.root.findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Remove plugin')

    expect(removeButton?.props.disabled).toBe(true)
    await act(async () => renderer.unmount())
  })
})
