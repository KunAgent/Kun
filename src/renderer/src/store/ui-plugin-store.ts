import { create } from 'zustand'
import {
  buildUiPluginTokenCss,
  resolveUiPluginFigure,
  type UiPluginFigureSlot,
  type UiPluginLabelKey,
  type UiPluginListItem,
  type UiPluginManifestV1,
  type UiPluginRuntimeFigures
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
 * 负责 DOM 属性(data-ikun-mode / data-ui-plugin)、token 样式注入与插件图集加载。
 */

export type UiPluginRuntime = {
  manifest: UiPluginManifestV1
  figures: UiPluginRuntimeFigures
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

const TOKEN_STYLE_ELEMENT_ID = 'ds-ui-plugin-tokens'

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
  if (runtime && mode === runtime.manifest.id) {
    root.setAttribute('data-ui-plugin', runtime.manifest.id)
  } else {
    root.removeAttribute('data-ui-plugin')
  }

  const css = runtime && mode === runtime.manifest.id ? buildUiPluginTokenCss(runtime.manifest) : ''
  let styleElement = document.getElementById(TOKEN_STYLE_ELEMENT_ID)
  if (!css) {
    styleElement?.remove()
    return
  }
  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.id = TOKEN_STYLE_ELEMENT_ID
    document.head.appendChild(styleElement)
  }
  styleElement.textContent = css
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
      set({ uiMode: mode })
      applyUiModeDom(mode, null)
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

  activateUiMode: async (mode: string) => {
    const normalized = mode.trim().toLowerCase()
    if (normalized === UI_MODE_DEFAULT) {
      writeUiModePreference(normalized)
      set({ uiMode: normalized, activeRuntime: null, lastError: null })
      applyUiModeDom(normalized, null)
      return
    }

    // 'retroma' 是纯配色内置模式,无吉祥物图集,不走插件加载链路
    if (normalized === UI_MODE_RETROMA) {
      writeUiModePreference(normalized)
      set({ uiMode: normalized, activeRuntime: null, lastError: null })
      applyUiModeDom(normalized, null)
      return
    }

    // 'ikun' 不再特殊:它是预装插件,与第三方插件走同一条加载链路;
    // applyUiModeDom 会在 id 为 ikun 时同时点亮 data-ikun-mode 手工机制
    const api = uiPluginApi()
    if (typeof api?.loadUiPlugin !== 'function') {
      // 桌面接口不可用(如纯渲染测试):ikun 仍可退化为仅属性模式
      if (normalized === UI_MODE_IKUN) {
        writeUiModePreference(normalized)
        set({ uiMode: normalized, activeRuntime: null, lastError: null })
        applyUiModeDom(normalized, null)
      }
      return
    }
    set({ busy: true })
    try {
      const result = await api.loadUiPlugin(normalized)
      if (!result.ok) {
        set({
          busy: false,
          uiMode: UI_MODE_DEFAULT,
          activeRuntime: null,
          lastError: result.error
        })
        writeUiModePreference(UI_MODE_DEFAULT)
        applyUiModeDom(UI_MODE_DEFAULT, null)
        return
      }
      const runtime: UiPluginRuntime = { manifest: result.manifest, figures: result.figures }
      writeUiModePreference(normalized)
      set({ busy: false, uiMode: normalized, activeRuntime: runtime, lastError: null })
      applyUiModeDom(normalized, runtime)
    } catch (error) {
      set({
        busy: false,
        uiMode: UI_MODE_DEFAULT,
        activeRuntime: null,
        lastError: error instanceof Error ? error.message : String(error)
      })
      writeUiModePreference(UI_MODE_DEFAULT)
      applyUiModeDom(UI_MODE_DEFAULT, null)
    }
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

  removeUiPluginById: async (id: string) => {
    const api = uiPluginApi()
    if (typeof api?.removeUiPlugin !== 'function') return
    if (get().uiMode === id) {
      await get().activateUiMode(UI_MODE_DEFAULT)
    }
    try {
      await api.removeUiPlugin(id)
    } finally {
      await get().refreshUiPlugins()
    }
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
