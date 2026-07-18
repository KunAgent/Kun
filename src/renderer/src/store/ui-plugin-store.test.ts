import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_MODE_DEFAULT, UI_MODE_STORAGE_KEY } from '../lib/ui-mode'
import { useUiPluginStore } from './ui-plugin-store'

const dedicatedCharacterChromeRecipes = [
  'botanical',
  'fortune-ledger',
  'dream-gate',
  'washi',
  'scrapbook',
  'aurora',
  'synth',
  'midnight-pass',
  'nautical',
  'dimension-lab',
  'starlight'
] as const

function createDomFixture(storedMode?: string) {
  const attributes = new Map<string, string>()
  const storage = new Map<string, string>()
  if (storedMode) storage.set(UI_MODE_STORAGE_KEY, storedMode)
  const createElement = vi.fn()
  const documentFixture = {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name)
    },
    getElementById: vi.fn(() => null),
    createElement
  }
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  }
  vi.stubGlobal('document', documentFixture)
  return { attributes, createElement, localStorage }
}

function resetStore(): void {
  useUiPluginStore.setState({
    uiMode: UI_MODE_DEFAULT,
    installed: [],
    activeRuntime: null,
    busy: false,
    initialized: false,
    lastError: null
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('UI plugin CDP theme activation', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deactivates the main-held CDP theme while initializing the default mode', async () => {
    const { attributes, createElement, localStorage } = createDomFixture()
    const deactivateUiPluginTheme = vi.fn(async () => ({ ok: true as const }))
    const listUiPlugins = vi.fn(async () => ({ plugins: [] }))
    vi.stubGlobal('window', {
      localStorage,
      kunGui: { deactivateUiPluginTheme, listUiPlugins }
    })

    await useUiPluginStore.getState().initUiPlugins()

    expect(deactivateUiPluginTheme).toHaveBeenCalledOnce()
    expect(useUiPluginStore.getState().uiMode).toBe(UI_MODE_DEFAULT)
    expect(attributes.has('data-ui-plugin')).toBe(false)
    expect(listUiPlugins).toHaveBeenCalledOnce()
    await useUiPluginStore.getState().initUiPlugins()
    expect(listUiPlugins).toHaveBeenCalledOnce()
    expect(createElement).not.toHaveBeenCalled()
  })

  it('serializes activation and lets a newer request win without injecting renderer CSS', async () => {
    const { attributes, createElement, localStorage } = createDomFixture()
    const firstActivationResult = deferred<{
      ok: true
      manifest: { id: string; name: string; version: string; figures: {} }
      figures: {}
    }>()
    const activateUiPluginTheme = vi.fn((id: string) => {
      if (id === 'alpha-theme') return firstActivationResult.promise
      return Promise.resolve({
        ok: true as const,
        manifest: { id, name: id, version: '1.0.0', figures: {} },
        figures: {}
      })
    })
    vi.stubGlobal('window', {
      localStorage,
      kunGui: {
        activateUiPluginTheme,
        deactivateUiPluginTheme: vi.fn(async () => ({ ok: true as const }))
      }
    })

    const firstActivation = useUiPluginStore.getState().activateUiMode('alpha-theme')
    await vi.waitFor(() => expect(activateUiPluginTheme).toHaveBeenCalledWith('alpha-theme'))
    const secondActivation = useUiPluginStore.getState().activateUiMode('beta-theme')
    firstActivationResult.resolve({
      ok: true,
      manifest: { id: 'alpha-theme', name: 'Alpha', version: '1.0.0', figures: {} },
      figures: {}
    })
    await Promise.all([firstActivation, secondActivation])

    expect(activateUiPluginTheme).toHaveBeenCalledTimes(2)
    expect(activateUiPluginTheme.mock.calls.map(([id]) => id)).toEqual([
      'alpha-theme',
      'beta-theme'
    ])
    expect(useUiPluginStore.getState().uiMode).toBe('beta-theme')
    expect(attributes.get('data-ui-plugin')).toBe('beta-theme')
    expect(createElement).not.toHaveBeenCalled()
  })

  it('applies only normalized presentation attributes and clears them on a fast theme switch', async () => {
    const { attributes, localStorage } = createDomFixture()
    const portraitManifest = {
      id: 'portrait-theme',
      name: 'Portrait',
      version: '1.0.0',
      figures: { portrait: 'img/portrait.png' },
      presentation: {
        character: {
          anchor: 'bottom-right',
          size: 'hero',
          offsetX: 3,
          offsetY: -4,
          opacity: 0.92,
          frame: 'polaroid',
          motion: 'float',
          contentReserve: 'wide'
        },
        readability: { scrim: 'opposite-character', strength: 'strong' },
        surfaces: {
          sidebar: 'glass',
          topbar: 'translucent',
          composer: 'strong-glass',
          cards: 'solid'
        }
      }
    } as const
    const activateUiPluginTheme = vi.fn(async (id: string) => ({
      ok: true as const,
      manifest:
        id === portraitManifest.id
          ? portraitManifest
          : { id, name: 'Plain', version: '1.0.0', figures: {} },
      figures: id === portraitManifest.id ? { portrait: 'data:image/png;base64,AAAA' } : {}
    }))
    vi.stubGlobal('window', {
      localStorage,
      kunGui: {
        activateUiPluginTheme,
        deactivateUiPluginTheme: vi.fn(async () => ({ ok: true as const }))
      }
    })

    await useUiPluginStore.getState().activateUiMode('portrait-theme')

    expect(Object.fromEntries(attributes)).toMatchObject({
      'data-ui-plugin': 'portrait-theme',
      'data-ui-plugin-presentation': 'on',
      'data-ui-plugin-character-anchor': 'bottom-right',
      'data-ui-plugin-character-size': 'hero',
      'data-ui-plugin-character-offset-x': '3',
      'data-ui-plugin-character-offset-y': '-4',
      'data-ui-plugin-character-opacity': '0.92',
      'data-ui-plugin-character-frame': 'polaroid',
      'data-ui-plugin-character-motion': 'float',
      'data-ui-plugin-content-reserve': 'wide',
      'data-ui-plugin-readability-scrim': 'opposite-character',
      'data-ui-plugin-readability-strength': 'strong',
      'data-ui-plugin-surface-sidebar': 'glass',
      'data-ui-plugin-surface-topbar': 'translucent',
      'data-ui-plugin-surface-composer': 'strong-glass',
      'data-ui-plugin-surface-cards': 'solid'
    })

    await useUiPluginStore.getState().activateUiMode('plain-theme')

    expect(attributes.get('data-ui-plugin')).toBe('plain-theme')
    expect(
      [...attributes.keys()].filter((key) => key.startsWith('data-ui-plugin-'))
    ).toEqual([])
  })

  it('applies and clears only normalized scene v1.6 root attributes', async () => {
    const { attributes, localStorage } = createDomFixture()
    const sceneManifest = {
      id: 'scene-theme',
      name: 'Scene',
      version: '1.0.0',
      figures: { portrait: 'img/portrait.png' },
      presentation: {
        character: {
          anchor: 'right',
          size: 'large',
          offsetX: 0,
          offsetY: 0,
          opacity: 1,
          frame: 'soft-card',
          motion: 'none',
          contentReserve: 'wide'
        },
        readability: { scrim: 'opposite-character', strength: 'medium' },
        surfaces: {
          sidebar: 'glass',
          topbar: 'glass',
          composer: 'strong-glass',
          cards: 'translucent'
        }
      },
      scene: {
        apiVersion: '1.6',
        layout: 'rail-left',
        character: {
          scale: 'hero',
          fit: 'contain',
          focalPoint: 'bottom',
          mask: 'arch',
          offsetX: 1,
          offsetY: -2,
          opacity: 0.96,
          flipX: true,
          motion: { preset: 'sway', speed: 'slow', phase: 'b' }
        },
        artwork: {
          frame: {
            path: 'scene/frame.png',
            anchor: 'center',
            size: 'large',
            fit: 'contain',
            offsetX: 0,
            offsetY: 0,
            opacity: 1,
            blend: 'normal',
            motion: { preset: 'none', speed: 'normal', phase: 'a' }
          }
        },
        chrome: {
          sidebar: 'paper',
          topbar: 'editorial',
          composer: 'hologram',
          cards: 'ticket'
        }
      }
    } as const
    const activateUiPluginTheme = vi.fn(async (id: string) => {
      const recipe = dedicatedCharacterChromeRecipes.find(
        (candidate) => id === `scene-recipe-${candidate}`
      )
      const activeSceneManifest = recipe
        ? {
            ...sceneManifest,
            id,
            scene: {
              ...sceneManifest.scene,
              chrome: {
                sidebar: recipe,
                topbar: recipe,
                composer: recipe,
                cards: recipe
              }
            }
          }
        : id === sceneManifest.id
          ? sceneManifest
          : null
      return {
        ok: true as const,
        manifest: activeSceneManifest
          ?? { id, name: 'Plain', version: '1.0.0', figures: {} },
        figures: activeSceneManifest ? { portrait: 'data:image/png;base64,AAAA' } : {},
        sceneAssets: activeSceneManifest
          ? { assets: { 'scene/frame.png': 'data:image/png;base64,AAAA' } }
          : {}
      }
    })
    vi.stubGlobal('window', {
      localStorage,
      kunGui: {
        activateUiPluginTheme,
        deactivateUiPluginTheme: vi.fn(async () => ({ ok: true as const }))
      }
    })

    await useUiPluginStore.getState().activateUiMode('scene-theme')

    expect(Object.fromEntries(attributes)).toMatchObject({
      'data-ui-plugin-presentation': 'on',
      'data-ui-plugin-readability-scrim': 'opposite-character',
      'data-ui-plugin-readability-strength': 'medium',
      'data-ui-plugin-scene': 'on',
      'data-ui-plugin-scene-layout': 'rail-left',
      'data-ui-plugin-scene-character-scale': 'hero',
      'data-ui-plugin-scene-character-fit': 'contain',
      'data-ui-plugin-scene-character-focal-point': 'bottom',
      'data-ui-plugin-scene-character-mask': 'arch',
      'data-ui-plugin-scene-character-flip-x': 'on',
      'data-ui-plugin-scene-character-motion': 'sway',
      'data-ui-plugin-scene-character-motion-speed': 'slow',
      'data-ui-plugin-scene-character-motion-phase': 'b',
      'data-ui-plugin-scene-chrome-sidebar': 'paper',
      'data-ui-plugin-scene-chrome-topbar': 'editorial',
      'data-ui-plugin-scene-chrome-composer': 'hologram',
      'data-ui-plugin-scene-chrome-cards': 'ticket'
    })
    for (const legacyAttribute of [
      'data-ui-plugin-character-frame',
      'data-ui-plugin-character-motion',
      'data-ui-plugin-content-reserve',
      'data-ui-plugin-surface-sidebar',
      'data-ui-plugin-surface-topbar',
      'data-ui-plugin-surface-composer',
      'data-ui-plugin-surface-cards'
    ]) {
      expect(attributes.has(legacyAttribute)).toBe(false)
    }
    expect(useUiPluginStore.getState().activeRuntime?.sceneAssets.assets?.['scene/frame.png'])
      .toBe('data:image/png;base64,AAAA')

    await useUiPluginStore.getState().activateUiMode('plain-theme')

    expect([...attributes.keys()].some((key) => key.startsWith('data-ui-plugin-scene')))
      .toBe(false)

    for (const recipe of dedicatedCharacterChromeRecipes) {
      await useUiPluginStore.getState().activateUiMode(`scene-recipe-${recipe}`)
      expect(Object.fromEntries(attributes), recipe).toMatchObject({
        'data-ui-plugin-scene-chrome-sidebar': recipe,
        'data-ui-plugin-scene-chrome-topbar': recipe,
        'data-ui-plugin-scene-chrome-composer': recipe,
        'data-ui-plugin-scene-chrome-cards': recipe
      })
    }
  })

  it('waits for activation before removing that plugin and leaves the default mode active', async () => {
    const { attributes, localStorage } = createDomFixture()
    const activationResult = deferred<{
      ok: true
      manifest: { id: string; name: string; version: string; figures: {} }
      figures: {}
    }>()
    const activateUiPluginTheme = vi.fn(() => activationResult.promise)
    const deactivateUiPluginTheme = vi.fn(async () => ({ ok: true as const }))
    const removeUiPlugin = vi.fn(async () => ({ ok: true }))
    const listUiPlugins = vi.fn(async () => ({ plugins: [] }))
    vi.stubGlobal('window', {
      localStorage,
      kunGui: {
        activateUiPluginTheme,
        deactivateUiPluginTheme,
        removeUiPlugin,
        listUiPlugins
      }
    })

    const activation = useUiPluginStore.getState().activateUiMode('alpha-theme')
    await vi.waitFor(() => expect(activateUiPluginTheme).toHaveBeenCalledOnce())
    const removal = useUiPluginStore.getState().removeUiPluginById('alpha-theme')
    expect(removeUiPlugin).not.toHaveBeenCalled()

    activationResult.resolve({
      ok: true,
      manifest: { id: 'alpha-theme', name: 'Alpha', version: '1.0.0', figures: {} },
      figures: {}
    })
    await Promise.all([activation, removal])

    expect(deactivateUiPluginTheme).toHaveBeenCalledOnce()
    expect(removeUiPlugin).toHaveBeenCalledWith('alpha-theme')
    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: false,
      lastError: null
    })
    expect(attributes.has('data-ui-plugin')).toBe(false)
  })

  it('surfaces a failed plugin removal instead of silently refreshing the list', async () => {
    const { localStorage } = createDomFixture()
    const removeUiPlugin = vi.fn(async () => ({ ok: false }))
    const listUiPlugins = vi.fn(async () => ({ plugins: [] }))
    vi.stubGlobal('window', { localStorage, kunGui: { removeUiPlugin, listUiPlugins } })

    await useUiPluginStore.getState().removeUiPluginById('alpha-theme')

    expect(removeUiPlugin).toHaveBeenCalledWith('alpha-theme')
    expect(listUiPlugins).toHaveBeenCalledOnce()
    expect(useUiPluginStore.getState().lastError).toMatch(/删除 UI 插件失败/)
    expect(useUiPluginStore.getState().busy).toBe(false)
  })
})
