/**
 * UI 插件(形象工坊)规范 v1。
 *
 * 一个 UI 插件 = 一个文件夹:manifest.json + 若干图片。
 * 纯声明式 —— 不允许任何 JS / HTML / 自定义 CSS 执行;
 * 图片由主进程读入并以 data URL 注入渲染层,
 * 主题 token 仅允许 --ds-* 白名单,样式文本由应用侧生成。
 */

export const UI_PLUGIN_MANIFEST_FILENAME = 'manifest.json'

/** 形象槽位:缺失的槽位回退默认 Kun 美术(允许"半皮肤") */
export const UI_PLUGIN_FIGURE_SLOTS = [
  'swim',
  'surf',
  'greet',
  'sleep',
  'sit',
  'run',
  'toggleIcon'
] as const

export type UiPluginFigureSlot = (typeof UI_PLUGIN_FIGURE_SLOTS)[number]

export const UI_PLUGIN_LABEL_KEYS = [
  'working',
  'workingSprint',
  'workingDive',
  'workingSurf'
] as const

export type UiPluginLabelKey = (typeof UI_PLUGIN_LABEL_KEYS)[number]

export type UiPluginLabelLocale = 'zh' | 'en'

export type UiPluginHostEffect = {
  readonly kind: 'shuimo-yijing'
  readonly hexagram: {
    readonly ordinal: number
    readonly glyph: string
    readonly name: string
    readonly statement: string
    readonly statementCommentary: string
    readonly movingLine: number
    readonly movingLineLabel: string
    readonly movingLineText: string
    readonly movingLineCommentary: string
  }
}

export type UiPluginManifestV1 = {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  /** 槽位 → 插件目录内的相对图片路径 */
  figures: Partial<Record<UiPluginFigureSlot, string>>
  /** 可选:进行中状态文案(按语言、按泳姿键) */
  labels?: Partial<Record<UiPluginLabelLocale, Partial<Record<UiPluginLabelKey, string>>>>
  /** 可选:主题 token 覆盖(仅 --ds-*) */
  tokens?: {
    light?: Record<string, string>
    dark?: Record<string, string>
  }
  features?: {
    /** 是否启用主会话两侧的出没彩蛋 */
    cameos?: boolean
  }
}

export type UiPluginListItem = {
  manifest: UiPluginManifestV1
  /** 预览图(toggleIcon → swim → 第一个槽位)的 data URL,列表页用 */
  previewDataUrl: string | null
}

export type UiPluginRuntimeFigures = Partial<Record<UiPluginFigureSlot, string>>

export type UiPluginValidationResult =
  | { ok: true; manifest: UiPluginManifestV1 }
  | { ok: false; errors: string[] }

export const UI_PLUGIN_LIMITS = {
  manifestBytes: 64 * 1024,
  figureBytes: 2 * 1024 * 1024,
  totalFigureBytes: 24 * 1024 * 1024,
  tokenEntries: 60,
  labelChars: 24
} as const

const UI_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/
/**
 * 与内置模式、DOM 属性值保留字互斥。
 * 注意:'ikun' 不在保留字里 —— 内置的 iKun 模式本身就是一个预装 UI 插件
 * (见 src/main/ui-plugin-bundled.ts),id 为 'ikun' 时额外点亮
 * data-ikun-mode 的手工 CSS 机制。
 */
const UI_PLUGIN_RESERVED_IDS = new Set(['default', 'kun', 'on', 'off', 'none'])

/** 预装示例插件(iKun)的 id:激活时会同时启用 data-ikun-mode 手工动画机制 */
export const UI_PLUGIN_BUNDLED_IKUN_ID = 'ikun'
export const UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID = 'shuimo-yijing'
const UI_PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][\w.-]{0,40})?$/
const UI_PLUGIN_FIGURE_PATH_PATTERN = /^[\w][\w./-]{0,200}$/
const UI_PLUGIN_FIGURE_EXTENSIONS = new Set(['png', 'webp', 'jpg', 'jpeg', 'gif'])
const UI_PLUGIN_TOKEN_NAME_PATTERN = /^--ds-[a-z][a-z0-9-]{0,60}$/
/** 颜色/渐变等安全值:禁分号、花括号、url()、反斜杠 */
const UI_PLUGIN_TOKEN_VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s/-]{1,120}$/

export function isSafeUiPluginFigurePath(value: string): boolean {
  if (!UI_PLUGIN_FIGURE_PATH_PATTERN.test(value)) return false
  if (value.includes('\\')) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false
  }
  const extension = segments[segments.length - 1]?.split('.').pop()?.toLowerCase() ?? ''
  return UI_PLUGIN_FIGURE_EXTENSIONS.has(extension)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

export function normalizeUiPluginManifest(raw: unknown): UiPluginValidationResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['manifest.json 必须是 JSON 对象'] }
  }

  const id = readTrimmedString(raw.id, 40)
  if (!id || !UI_PLUGIN_ID_PATTERN.test(id)) {
    errors.push('id 需为 2-40 位小写字母/数字/连字符,且以字母或数字开头')
  } else if (UI_PLUGIN_RESERVED_IDS.has(id)) {
    errors.push(`id "${id}" 是保留字`)
  }

  const name = readTrimmedString(raw.name, 60)
  if (!name) errors.push('name 必填(≤60 字符)')

  const version = readTrimmedString(raw.version, 60)
  if (!version || !UI_PLUGIN_VERSION_PATTERN.test(version)) {
    errors.push('version 需为语义化版本号,如 1.0.0')
  }

  const author = readTrimmedString(raw.author, 80) ?? undefined
  if (raw.author !== undefined && author === undefined) errors.push('author 过长(≤80 字符)')
  const description = readTrimmedString(raw.description, 240) ?? undefined
  if (raw.description !== undefined && description === undefined) {
    errors.push('description 过长(≤240 字符)')
  }

  const figures: Partial<Record<UiPluginFigureSlot, string>> = {}
  if (!isPlainObject(raw.figures)) {
    errors.push('figures 必填:至少声明一个形象槽位')
  } else {
    for (const [slot, value] of Object.entries(raw.figures)) {
      if (!(UI_PLUGIN_FIGURE_SLOTS as readonly string[]).includes(slot)) {
        errors.push(`未知形象槽位 "${slot}"`)
        continue
      }
      if (typeof value !== 'string' || !isSafeUiPluginFigurePath(value.trim())) {
        errors.push(`槽位 "${slot}" 的图片路径不合法(需为插件内相对路径,png/webp/jpg/gif)`)
        continue
      }
      figures[slot as UiPluginFigureSlot] = value.trim()
    }
    if (Object.keys(figures).length === 0 && errors.length === 0) {
      errors.push('figures 至少需要一个合法槽位')
    }
  }

  let labels: UiPluginManifestV1['labels']
  if (raw.labels !== undefined) {
    if (!isPlainObject(raw.labels)) {
      errors.push('labels 需为对象,如 { "zh": { "working": "巡航中…" } }')
    } else {
      labels = {}
      for (const [locale, entries] of Object.entries(raw.labels)) {
        if (locale !== 'zh' && locale !== 'en') {
          errors.push(`labels 不支持语言 "${locale}"`)
          continue
        }
        if (!isPlainObject(entries)) {
          errors.push(`labels.${locale} 需为对象`)
          continue
        }
        const normalized: Partial<Record<UiPluginLabelKey, string>> = {}
        for (const [key, text] of Object.entries(entries)) {
          if (!(UI_PLUGIN_LABEL_KEYS as readonly string[]).includes(key)) {
            errors.push(`labels.${locale} 不支持键 "${key}"`)
            continue
          }
          const label = readTrimmedString(text, UI_PLUGIN_LIMITS.labelChars)
          if (!label) {
            errors.push(`labels.${locale}.${key} 需为 1-${UI_PLUGIN_LIMITS.labelChars} 字符文本`)
            continue
          }
          normalized[key as UiPluginLabelKey] = label
        }
        labels[locale] = normalized
      }
    }
  }

  let tokens: UiPluginManifestV1['tokens']
  if (raw.tokens !== undefined) {
    if (!isPlainObject(raw.tokens)) {
      errors.push('tokens 需为对象,如 { "light": { "--ds-accent": "#8a63e8" } }')
    } else {
      tokens = {}
      let tokenCount = 0
      for (const [theme, entries] of Object.entries(raw.tokens)) {
        if (theme !== 'light' && theme !== 'dark') {
          errors.push(`tokens 不支持主题 "${theme}"`)
          continue
        }
        if (!isPlainObject(entries)) {
          errors.push(`tokens.${theme} 需为对象`)
          continue
        }
        const normalized: Record<string, string> = {}
        for (const [tokenName, tokenValue] of Object.entries(entries)) {
          tokenCount += 1
          if (tokenCount > UI_PLUGIN_LIMITS.tokenEntries) {
            errors.push(`tokens 数量超过上限 ${UI_PLUGIN_LIMITS.tokenEntries}`)
            break
          }
          if (!UI_PLUGIN_TOKEN_NAME_PATTERN.test(tokenName)) {
            errors.push(`token "${tokenName}" 不在 --ds-* 白名单内`)
            continue
          }
          if (
            typeof tokenValue !== 'string' ||
            !UI_PLUGIN_TOKEN_VALUE_PATTERN.test(tokenValue.trim())
          ) {
            errors.push(`token "${tokenName}" 的值包含不允许的字符`)
            continue
          }
          normalized[tokenName] = tokenValue.trim()
        }
        tokens[theme] = normalized
      }
    }
  }

  let features: UiPluginManifestV1['features']
  if (raw.features !== undefined) {
    if (!isPlainObject(raw.features)) {
      errors.push('features 需为对象')
    } else {
      features = { cameos: raw.features.cameos === true }
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    manifest: {
      id: id as string,
      name: name as string,
      version: version as string,
      ...(author ? { author } : {}),
      ...(description ? { description } : {}),
      figures,
      ...(labels && Object.keys(labels).length > 0 ? { labels } : {}),
      ...(tokens && Object.keys(tokens).length > 0 ? { tokens } : {}),
      ...(features ? { features } : {})
    }
  }
}

/**
 * 这些容器会在 dark 下的嵌套作用域里整体重声明 palette token
 * (base-shell.css 的 `[data-theme='dark'] .ds-workbench-shell`),从而遮蔽
 * 注入在 <html> 上的插件 token —— 这正是对话区(Workbench)在 dark 下不吃
 * 插件配色的根因。对应 iKun 既有的
 * `[data-theme='dark'][data-ikun-mode='on'] .ds-workbench-shell` 处理。
 * '' = <html> 根自身;日后若有新容器整体重声明 token,在此追加后缀即可。
 */
const TOKEN_SCOPE_ROOTS = ['', ' .ds-workbench-shell'] as const

/** 把单一锚点扩成「根 + 各重声明子作用域」的逗号选择器列表 */
function scopedSelector(base: string): string {
  return TOKEN_SCOPE_ROOTS.map((suffix) => `${base}${suffix}`).join(',\n')
}

/**
 * 生成插件 token 的样式文本。选择器锚定 html[data-ui-plugin='<id>'],
 * light 块用 :not([data-theme='dark']) 守卫,避免在暗色下错误覆盖。
 * 选择器同时覆盖 .ds-workbench-shell 子作用域,确保对话区(dark 下会就地
 * 重声明 palette token)也能采纳插件 token。
 */
export function buildUiPluginTokenCss(manifest: UiPluginManifestV1): string {
  const blocks: string[] = []
  const lightEntries = Object.entries(manifest.tokens?.light ?? {})
  const darkEntries = Object.entries(manifest.tokens?.dark ?? {})
  if (lightEntries.length > 0) {
    const body = lightEntries.map(([key, value]) => `  ${key}: ${value};`).join('\n')
    const selector = scopedSelector(`html[data-ui-plugin='${manifest.id}']:not([data-theme='dark'])`)
    blocks.push(`${selector} {\n${body}\n}`)
  }
  if (darkEntries.length > 0) {
    const body = darkEntries.map(([key, value]) => `  ${key}: ${value};`).join('\n')
    const selector = scopedSelector(`html[data-ui-plugin='${manifest.id}'][data-theme='dark']`)
    blocks.push(`${selector} {\n${body}\n}`)
  }
  return blocks.join('\n\n')
}

/** 按槽位回退链取形象:返回第一个有值的槽位 data URL */
export function resolveUiPluginFigure(
  figures: UiPluginRuntimeFigures | null | undefined,
  slots: readonly UiPluginFigureSlot[]
): string | null {
  if (!figures) return null
  for (const slot of slots) {
    const value = figures[slot]
    if (value) return value
  }
  return null
}
