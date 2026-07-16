import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ikunFigureRef from '../asset/img/ikun.png?url'
import ikunBobaFigureRef from '../asset/img/ikun_boba.png?url'
import ikunRunFigureRef from '../asset/img/ikun_run.png?url'
import ikunSleepFigureRef from '../asset/img/ikun_sleep.png?url'
import ikunStandFigureRef from '../asset/img/ikun_stand.png?url'
import ikunWaveFigureRef from '../asset/img/ikun_wave.png?url'
import shuimoYijingKunFigureRef from '../asset/img/shuimo-yijing-kun.png?url'
import {
  UI_PLUGIN_BUNDLED_IKUN_ID,
  UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
  type UiPluginFigureSlot,
  type UiPluginManifestV1,
  type UiPluginRuntimeFigures
} from '../shared/ui-plugin'
import {
  createBundledUiPluginSeedGuard,
  seedBundledUiPluginOnce
} from './services/bundled-ui-plugin-seeder'
import { seedUiPlugin, type UiPluginLoadResult } from './services/ui-plugin-service'

/**
 * iKun 的 manifest。注意:激活 id 为 'ikun' 的插件时,渲染层会额外点亮
 * data-ikun-mode 的手工 CSS 机制(运球/快攻/喝奶茶变体、橙色氛围),
 * 所以这里的 figures 主要服务于工坊预览与通用槽位兜底。
 */
const BUNDLED_IKUN_MANIFEST = {
  id: UI_PLUGIN_BUNDLED_IKUN_ID,
  name: 'iKun 模式',
  version: '1.0.0',
  author: 'Kun Team',
  description: '预装示例插件:坤鸡全家福,附手工运球/快攻/喝奶茶动画与出没彩蛋。',
  figures: {
    swim: 'img/dribble.png',
    run: 'img/run.png',
    greet: 'img/wave.png',
    sleep: 'img/sleep.png',
    sit: 'img/boba.png',
    toggleIcon: 'img/stand.png'
  },
  features: {
    cameos: true
  }
}

const SHUIMO_LIGHT_TOKENS = {
  '--ds-bg-main': '#f2f0e7',
  '--ds-bg-sidebar': '#e8e9e2',
  '--ds-bg-canvas': '#f7f5ee',
  '--ds-surface-card': 'rgba(248, 247, 240, 0.92)',
  '--ds-surface-elevated': 'rgba(252, 250, 244, 0.97)',
  '--ds-surface-subtle': '#e7e8e0',
  '--ds-surface-hover': 'rgba(67, 83, 75, 0.08)',
  '--ds-border': 'rgba(54, 68, 62, 0.16)',
  '--ds-border-muted': 'rgba(54, 68, 62, 0.1)',
  '--ds-border-strong': 'rgba(54, 68, 62, 0.24)',
  '--ds-text': '#27302c',
  '--ds-text-muted': '#59645e',
  '--ds-text-faint': '#7e8983',
  '--ds-accent': '#8f4036',
  '--ds-accent-soft': 'rgba(143, 64, 54, 0.14)',
  '--ds-success': '#2f7d54',
  '--ds-danger': '#a4473d',
  '--ds-diff-added': '#2f7d54',
  '--ds-diff-added-soft': 'rgba(47, 125, 84, 0.11)',
  '--ds-diff-removed': '#a4473d',
  '--ds-diff-removed-soft': 'rgba(164, 71, 61, 0.11)',
  '--ds-skill': '#6b5c8f',
  '--ds-skill-soft': 'rgba(107, 92, 143, 0.12)',
  '--ds-success-soft': 'rgba(47, 125, 84, 0.12)',
  '--ds-warning-soft': 'rgba(165, 118, 45, 0.14)',
  '--ds-danger-soft': 'rgba(164, 71, 61, 0.12)',
  '--ds-selection': 'rgba(78, 99, 88, 0.18)',
  '--ds-bubble-user': 'rgba(76, 96, 85, 0.11)',
  '--ds-bubble-user-fg': '#27302c',
  '--ds-code-block-bg': '#e5e7df'
}

const SHUIMO_DARK_TOKENS = {
  '--ds-bg-main': '#171c1a',
  '--ds-bg-sidebar': '#121614',
  '--ds-bg-canvas': '#1c221f',
  '--ds-surface-card': 'rgba(31, 38, 34, 0.94)',
  '--ds-surface-elevated': 'rgba(37, 44, 40, 0.98)',
  '--ds-surface-subtle': '#242b27',
  '--ds-surface-hover': 'rgba(218, 223, 214, 0.08)',
  '--ds-border': 'rgba(218, 223, 214, 0.14)',
  '--ds-border-muted': 'rgba(218, 223, 214, 0.09)',
  '--ds-border-strong': 'rgba(218, 223, 214, 0.22)',
  '--ds-text': '#e4e2d9',
  '--ds-text-muted': '#adb5ae',
  '--ds-text-faint': '#818c85',
  '--ds-accent': '#c46b5e',
  '--ds-accent-soft': 'rgba(196, 107, 94, 0.16)',
  '--ds-success': '#72b18c',
  '--ds-danger': '#d47c70',
  '--ds-diff-added': '#72b18c',
  '--ds-diff-added-soft': 'rgba(114, 177, 140, 0.14)',
  '--ds-diff-removed': '#d47c70',
  '--ds-diff-removed-soft': 'rgba(212, 124, 112, 0.14)',
  '--ds-skill': '#a89bc1',
  '--ds-skill-soft': 'rgba(168, 155, 193, 0.14)',
  '--ds-success-soft': 'rgba(114, 177, 140, 0.14)',
  '--ds-warning-soft': 'rgba(202, 157, 86, 0.15)',
  '--ds-danger-soft': 'rgba(212, 124, 112, 0.14)',
  '--ds-selection': 'rgba(190, 201, 192, 0.16)',
  '--ds-bubble-user': 'rgba(190, 201, 192, 0.1)',
  '--ds-bubble-user-fg': '#e4e2d9',
  '--ds-code-block-bg': '#111614'
}

export const BUNDLED_SHUIMO_YIJING_MANIFEST = {
  id: UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
  name: '水墨易经',
  version: '1.0.0',
  author: 'Kun Team',
  description: '清雅水墨明暗主题，以启动时所起之卦铺陈《周易本义》书法背景。',
  figures: {
    swim: 'img/shuimo-yijing-kun.png',
    greet: 'img/shuimo-yijing-kun.png',
    toggleIcon: 'img/shuimo-yijing-kun.png'
  },
  labels: {
    zh: {
      working: '研墨中…',
      workingSprint: '挥毫中…',
      workingDive: '寻章摘句中…',
      workingSurf: '观象玩辞中…'
    },
    en: {
      working: 'Grinding ink...',
      workingSprint: 'Writing swiftly...',
      workingDive: 'Reading the lines...',
      workingSurf: 'Studying the changes...'
    }
  },
  tokens: {
    light: SHUIMO_LIGHT_TOKENS,
    dark: SHUIMO_DARK_TOKENS
  },
  features: {
    cameos: false
  }
} satisfies UiPluginManifestV1

const BUNDLED_IKUN_FIGURE_REFS: Record<string, string> = {
  swim: ikunFigureRef,
  run: ikunRunFigureRef,
  greet: ikunWaveFigureRef,
  sleep: ikunSleepFigureRef,
  sit: ikunBobaFigureRef,
  toggleIcon: ikunStandFigureRef
}

const BUNDLED_SHUIMO_YIJING_FIGURE_REFS: Record<string, string> = {
  swim: shuimoYijingKunFigureRef,
  greet: shuimoYijingKunFigureRef,
  toggleIcon: shuimoYijingKunFigureRef
}

/** bundle 所在目录,用于把 ?url 的 /chunks/xxx.png 还原为真实文件路径 */
const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 资源引用在打包/开发下可能是:
 *   - data URL ("data:image/png;base64,...")  → 直接 base64 解码
 *   - Vite 开发态源码路径 ("/src/asset/...") → 相对工作区根目录
 *   - Vite ?url 在主进程中的 web 路径 ("/chunks/xxx.png") → 相对 bundle 目录拼绝对路径
 */
async function bytesFromAssetRef(ref: string): Promise<Buffer> {
  if (ref.startsWith('data:')) {
    const base64 = ref.slice(ref.indexOf(',') + 1)
    return Buffer.from(base64, 'base64')
  }
  if (ref.startsWith('/src/')) {
    return readFile(join(process.cwd(), ref.slice(1)))
  }
  return readFile(join(BUNDLE_DIR, ref))
}

export async function loadBundledShuimoYijingRuntime(): Promise<UiPluginLoadResult> {
  const figures: UiPluginRuntimeFigures = {}
  const dataUrls = new Map<string, string>()
  for (const [slot, ref] of Object.entries(BUNDLED_SHUIMO_YIJING_FIGURE_REFS)) {
    let dataUrl = dataUrls.get(ref)
    if (!dataUrl) {
      const bytes = await bytesFromAssetRef(ref)
      dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
      dataUrls.set(ref, dataUrl)
    }
    figures[slot as UiPluginFigureSlot] = dataUrl
  }
  return { ok: true, manifest: BUNDLED_SHUIMO_YIJING_MANIFEST, figures }
}

const ensureIkunSeeded = createBundledUiPluginSeedGuard({
  seed: (kunHomeDir) =>
    seedBundledUiPluginOnce({
      kunHomeDir,
      pluginId: UI_PLUGIN_BUNDLED_IKUN_ID,
      markerVersion: 1,
      legacyMarkers: ['.bundled-seed-v1'],
      seed: async () => {
        const figureBytes: Record<string, Buffer> = {}
        for (const [slot, ref] of Object.entries(BUNDLED_IKUN_FIGURE_REFS)) {
          figureBytes[slot] = await bytesFromAssetRef(ref)
        }
        return seedUiPlugin(kunHomeDir, BUNDLED_IKUN_MANIFEST, figureBytes)
      }
    }).then(() => undefined),
  onError: (error) => console.error('[ui-plugin] bundled ikun seed error:', error)
})

const ensureShuimoYijingSeeded = createBundledUiPluginSeedGuard({
  seed: (kunHomeDir) =>
    seedBundledUiPluginOnce({
      kunHomeDir,
      pluginId: UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
      markerVersion: 1,
      seed: async () => {
        const figureBytes: Record<string, Buffer> = {}
        for (const [slot, ref] of Object.entries(BUNDLED_SHUIMO_YIJING_FIGURE_REFS)) {
          figureBytes[slot] = await bytesFromAssetRef(ref)
        }
        return seedUiPlugin(kunHomeDir, BUNDLED_SHUIMO_YIJING_MANIFEST, figureBytes)
      }
    }).then(() => undefined),
  onError: (error) =>
    console.error('[ui-plugin] bundled shuimo yijing seed error:', error)
})

/**
 * 预装插件各自维护成功标记与进程内 promise。某个插件失败时只清空自己的
 * promise，其他插件仍能完成播种；后续入口调用会单独重试失败的插件。
 */
export function ensureBundledUiPlugins(kunHomeDir: string): Promise<void> {
  return Promise.all([
    ensureIkunSeeded(kunHomeDir),
    ensureShuimoYijingSeeded(kunHomeDir)
  ]).then(() => undefined)
}
