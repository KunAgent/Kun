import { create } from 'zustand'
import {
  resolveUiPluginFigure,
  type UiPluginFigureSlot,
  type UiPluginLabelKey,
  type UiPluginListItem,
  type UiPluginManifestV1,
  type UiPluginRuntimeFigures,
  type UiPluginRuntimeSceneAssets
} from '@shared/ui-plugin'
import {
  UI_MODE_DEFAULT,
  UI_MODE_IKUN,
  UI_MODE_RETROMA,
  readUiModePreference,
  writeUiModePreference
} from '../lib/ui-mode'

/**
 * 形象工坊运行时:单一 uiMode('default' | 'ikun' | 插件 id),
 * 负责 DOM 属性(data-ikun-mode / data-ui-plugin)与插件图集加载。
 * 主题 CSS 由主进程根据已校验 manifest 生成并通过短生命周期 CDP 会话注入。
 */

export type UiPluginRuntime = {
  manifest: UiPluginManifestV1
  figures: UiPluginRuntimeFigures
  sceneAssets: UiPluginRuntimeSceneAssets
}

type UiPluginState = {
  uiMode: string
  installed: UiPluginListItem[]
  activeRuntime: UiPluginRuntime | null
  busy: boolean
  initialized: boolean
  lastError: string | null
  initUiPlugins: () => Promise<void>
  refreshUiPlugins: () => Promise<void>
  activateUiMode: (mode: string) => Promise<void>
  installUiPluginFromDialog: () => Promise<{ ok: boolean; errors?: string[]; canceled?: boolean }>
  removeUiPluginById: (id: string) => Promise<void>
}

const LEGACY_RENDERER_THEME_STYLE_ID = 'ds-ui-plugin-tokens'
const UI_PLUGIN_PRESENTATION_ATTRIBUTES = [
  'data-ui-plugin-presentation',
  'data-ui-plugin-character-anchor',
  'data-ui-plugin-character-size',
  'data-ui-plugin-character-offset-x',
  'data-ui-plugin-character-offset-y',
  'data-ui-plugin-character-opacity',
  'data-ui-plugin-character-frame',
  'data-ui-plugin-character-motion',
  'data-ui-plugin-content-reserve',
  'data-ui-plugin-readability-scrim',
  'data-ui-plugin-readability-strength',
  'data-ui-plugin-surface-sidebar',
  'data-ui-plugin-surface-topbar',
  'data-ui-plugin-surface-composer',
  'data-ui-plugin-surface-cards'
] as const
const UI_PLUGIN_SCENE_ATTRIBUTES = [
  'data-ui-plugin-scene',
  'data-ui-plugin-scene-layout',
  'data-ui-plugin-scene-character-scale',
  'data-ui-plugin-scene-character-fit',
  'data-ui-plugin-scene-character-focal-point',
  'data-ui-plugin-scene-character-mask',
  'data-ui-plugin-scene-character-flip-x',
  'data-ui-plugin-scene-character-motion',
  'data-ui-plugin-scene-character-motion-speed',
  'data-ui-plugin-scene-character-motion-phase',
  'data-ui-plugin-scene-chrome-sidebar',
  'data-ui-plugin-scene-chrome-topbar',
  'data-ui-plugin-scene-chrome-composer',
  'data-ui-plugin-scene-chrome-cards'
] as const
let activationRequestId = 0
let activationQueue: Promise<void> = Promise.resolve()

function uiPluginApi(): Window['kunGui'] | null {
  if (typeof window === 'undefined') return null
  return window.kunGui ?? null
}

function applyUiModeDom(mode: string, runtime: UiPluginRuntime | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-ikun-mode', mode === UI_MODE_IKUN ? 'on' : 'off')
  // Retroma 是纯配色模式:仅点亮 data-retroma-mode(浅色守卫在 CSS 侧),
  // 不走插件运行时,不注入插件 token。
  root.setAttribute('data-retroma-mode', mode === UI_MODE_RETROMA ? 'on' : 'off')
  for (const attribute of UI_PLUGIN_PRESENTATION_ATTRIBUTES) {
    root.removeAttribute(attribute)
  }
  for (const attribute of UI_PLUGIN_SCENE_ATTRIBUTES) {
    root.removeAttribute(attribute)
  }
  if (runtime && mode === runtime.manifest.id) {
    root.setAttribute('data-ui-plugin', runtime.manifest.id)
    const presentation = runtime.manifest.presentation
    const scene = runtime.manifest.scene
    if (presentation) {
      const { character, readability, surfaces } = presentation
      root.setAttribute('data-ui-plugin-presentation', 'on')
      root.setAttribute('data-ui-plugin-readability-scrim', readability.scrim)
      root.setAttribute('data-ui-plugin-readability-strength', readability.strength)
      // v1.6 scene owns character geometry and chrome. Keep only the v1.5
      // readability fallback active so old frame/surface recipes cannot bleed
      // into a scene recipe such as `inherit` or `paper`.
      if (!scene) {
        root.setAttribute('data-ui-plugin-character-anchor', character.anchor)
        root.setAttribute('data-ui-plugin-character-size', character.size)
        root.setAttribute('data-ui-plugin-character-offset-x', String(character.offsetX))
        root.setAttribute('data-ui-plugin-character-offset-y', String(character.offsetY))
        root.setAttribute('data-ui-plugin-character-opacity', String(character.opacity))
        root.setAttribute('data-ui-plugin-character-frame', character.frame)
        root.setAttribute('data-ui-plugin-character-motion', character.motion)
        root.setAttribute('data-ui-plugin-content-reserve', character.contentReserve)
        root.setAttribute('data-ui-plugin-surface-sidebar', surfaces.sidebar)
        root.setAttribute('data-ui-plugin-surface-topbar', surfaces.topbar)
        root.setAttribute('data-ui-plugin-surface-composer', surfaces.composer)
        root.setAttribute('data-ui-plugin-surface-cards', surfaces.cards)
      }
    }
    if (scene) {
      root.setAttribute('data-ui-plugin-scene', 'on')
      root.setAttribute('data-ui-plugin-scene-layout', scene.layout)
      root.setAttribute('data-ui-plugin-scene-character-scale', scene.character.scale)
      root.setAttribute('data-ui-plugin-scene-character-fit', scene.character.fit)
      root.setAttribute('data-ui-plugin-scene-character-focal-point', scene.character.focalPoint)
      root.setAttribute('data-ui-plugin-scene-character-mask', scene.character.mask)
      root.setAttribute('data-ui-plugin-scene-character-flip-x', scene.character.flipX ? 'on' : 'off')
      root.setAttribute('data-ui-plugin-scene-character-motion', scene.character.motion.preset)
      root.setAttribute('data-ui-plugin-scene-character-motion-speed', scene.character.motion.speed)
      root.setAttribute('data-ui-plugin-scene-character-motion-phase', scene.character.motion.phase)
      root.setAttribute('data-ui-plugin-scene-chrome-sidebar', scene.chrome.sidebar)
      root.setAttribute('data-ui-plugin-scene-chrome-topbar', scene.chrome.topbar)
      root.setAttribute('data-ui-plugin-scene-chrome-composer', scene.chrome.composer)
      root.setAttribute('data-ui-plugin-scene-chrome-cards', scene.chrome.cards)
    }
  } else {
    root.removeAttribute('data-ui-plugin')
  }
  // Remove a style node left behind by an older hot-reloaded renderer. New
  // versions never construct or update plugin theme CSS in the renderer.
  document.getElementById(LEGACY_RENDERER_THEME_STYLE_ID)?.remove()
}

async function deactivateHostTheme(api: Window['kunGui'] | null): Promise<string | null> {
  if (typeof api?.deactivateUiPluginTheme !== 'function') return null
  try {
    const result = await api.deactivateUiPluginTheme()
    return result.ok ? null : result.error
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export const useUiPluginStore = create<UiPluginState>((set, get) => ({
  uiMode: UI_MODE_DEFAULT,
  installed: [],
  activeRuntime: null,
  busy: false,
  initialized: false,
  lastError: null,

  initUiPlugins: async () => {
    if (get().initialized) return
    set({ initialized: true })
    const mode = readUiModePreference()
    if (mode === UI_MODE_DEFAULT || mode === UI_MODE_RETROMA) {
      // Main may still remember/reapply a CDP theme across renderer reloads.
      // Route even inactive modes through the host deactivation handshake.
      await get().activateUiMode(mode)
      void get().refreshUiPlugins()
      return
    }
    // 插件模式(含预装的 ikun):先把 ikun 属性立即点亮避免闪烁,再异步加载图集;失败则回退默认
    applyUiModeDom(mode === UI_MODE_IKUN ? UI_MODE_IKUN : UI_MODE_DEFAULT, null)
    await get().activateUiMode(mode)
    void get().refreshUiPlugins()
  },

  refreshUiPlugins: async () => {
    const api = uiPluginApi()
    if (typeof api?.listUiPlugins !== 'function') return
    try {
      const result = await api.listUiPlugins()
      set({ installed: result.plugins })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  activateUiMode: (mode: string) => {
    const normalized = mode.trim().toLowerCase()
    const requestId = ++activationRequestId
    const operation = activationQueue.then(async () => {
      if (requestId !== activationRequestId) return
      const api = uiPluginApi()

      if (normalized === UI_MODE_DEFAULT || normalized === UI_MODE_RETROMA) {
        writeUiModePreference(normalized)
        set({ busy: false, uiMode: normalized, activeRuntime: null, lastError: null })
        applyUiModeDom(normalized, null)
        const deactivateError = await deactivateHostTheme(api)
        if (requestId === activationRequestId && deactivateError) {
          set({ lastError: deactivateError })
        }
        return
      }

      // 'ikun' 不再特殊:它是预装插件,与第三方插件走同一条加载链路;
      // applyUiModeDom 会在 id 为 ikun 时同时点亮 data-ikun-mode 手工机制。
      if (typeof api?.activateUiPluginTheme !== 'function') {
        // 桌面接口不可用(如纯渲染测试):ikun 仍可退化为仅属性模式。
        if (normalized === UI_MODE_IKUN) {
          writeUiModePreference(normalized)
          set({ busy: false, uiMode: normalized, activeRuntime: null, lastError: null })
          applyUiModeDom(normalized, null)
        } else {
          const message = '桌面 CDP 主题注入接口不可用'
          writeUiModePreference(UI_MODE_DEFAULT)
          set({
            busy: false,
            uiMode: UI_MODE_DEFAULT,
            activeRuntime: null,
            lastError: message
          })
          applyUiModeDom(UI_MODE_DEFAULT, null)
        }
        return
      }

      set({ busy: true })
      try {
        // The ID is the only renderer-provided activation input. Main reloads
        // and validates the installed manifest/assets before generating CSS,
        // then returns figures from that same canonical load (no TOCTOU split).
        const themeResult = await api.activateUiPluginTheme(normalized)
        if (requestId !== activationRequestId) return
        if (!themeResult.ok) {
          writeUiModePreference(UI_MODE_DEFAULT)
          set({
            busy: false,
            uiMode: UI_MODE_DEFAULT,
            activeRuntime: null,
            lastError: themeResult.error
          })
          applyUiModeDom(UI_MODE_DEFAULT, null)
          await deactivateHostTheme(api)
          return
        }

        const runtime: UiPluginRuntime = {
          manifest: themeResult.manifest,
          figures: themeResult.figures,
          sceneAssets: themeResult.sceneAssets ?? {}
        }
        writeUiModePreference(normalized)
        set({ busy: false, uiMode: normalized, activeRuntime: runtime, lastError: null })
        applyUiModeDom(normalized, runtime)
      } catch (error) {
        if (requestId !== activationRequestId) return
        const message = error instanceof Error ? error.message : String(error)
        writeUiModePreference(UI_MODE_DEFAULT)
        set({
          busy: false,
          uiMode: UI_MODE_DEFAULT,
          activeRuntime: null,
          lastError: message
        })
        applyUiModeDom(UI_MODE_DEFAULT, null)
        await deactivateHostTheme(api)
      }
    })
    activationQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  },

  installUiPluginFromDialog: async () => {
    const api = uiPluginApi()
    if (typeof api?.installUiPlugin !== 'function') {
      return { ok: false, errors: ['桌面接口不可用'] }
    }
    set({ busy: true })
    try {
      const result = await api.installUiPlugin()
      set({ busy: false })
      if (result.canceled) return { ok: false, canceled: true }
      if (!result.ok) return { ok: false, errors: result.errors }
      await get().refreshUiPlugins()
      return { ok: true }
    } catch (error) {
      set({ busy: false })
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }
    }
  },

  removeUiPluginById: (id: string) => {
    const normalized = id.trim().toLowerCase()
    // Removal shares the activation queue so an in-flight load/injection must
    // settle before we inspect the active mode or delete its on-disk assets.
    const operation = activationQueue.then(async () => {
      const api = uiPluginApi()
      if (typeof api?.removeUiPlugin !== 'function') {
        set({ busy: false, lastError: '桌面接口不可用' })
        return
      }

      set({ busy: true, lastError: null })
      try {
        if (get().uiMode === normalized) {
          writeUiModePreference(UI_MODE_DEFAULT)
          set({ uiMode: UI_MODE_DEFAULT, activeRuntime: null })
          applyUiModeDom(UI_MODE_DEFAULT, null)
          await deactivateHostTheme(api)
        }

        const result = await api.removeUiPlugin(normalized)
        if (!result.ok) {
          set({ lastError: '删除 UI 插件失败，插件可能正在使用或文件不可写' })
        }
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      } finally {
        await get().refreshUiPlugins()
        set({ busy: false })
      }
    })
    activationQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }
}))

/** 按槽位回退链取激活插件的形象;无插件或槽位缺失时返回 fallback */
export function useUiPluginFigure(
  slots: readonly UiPluginFigureSlot[],
  fallback: string
): string {
  const figure = useUiPluginStore((state) =>
    resolveUiPluginFigure(state.activeRuntime?.figures ?? null, slots)
  )
  return figure ?? fallback
}

/** 激活插件提供的进行中文案(按当前语言);未提供时返回 null */
export function useUiPluginWorkLabel(labelKey: UiPluginLabelKey, language: string): string | null {
  return useUiPluginStore((state) => {
    const labels = state.activeRuntime?.manifest.labels
    if (!labels) return null
    const locale = language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    return labels[locale]?.[labelKey] ?? null
  })
}

/** 是否应启用主会话出没彩蛋(ikun 内置 或 插件声明 features.cameos) */
export function useUiModeCameosEnabled(): boolean {
  return useUiPluginStore(
    (state) =>
      state.uiMode === UI_MODE_IKUN ||
      Boolean(state.activeRuntime && state.activeRuntime.manifest.features?.cameos)
  )
}
