import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import sharp from 'sharp'
import {
  UI_PLUGIN_BACKGROUND_SLOTS,
  UI_PLUGIN_BACKGROUND_THEMES,
  UI_PLUGIN_LIMITS,
  UI_PLUGIN_MANIFEST_FILENAME,
  UI_PLUGIN_SCENE_ARTWORK_SLOTS,
  isSafeUiPluginBackgroundPath,
  isSafeUiPluginFigurePath,
  normalizeUiPluginManifest,
  type UiPluginBackgroundSlot,
  type UiPluginBackgroundTheme,
  type UiPluginFigureSlot,
  type UiPluginListItem,
  type UiPluginManifestV1,
  type UiPluginRuntimeBackgrounds,
  type UiPluginRuntimeFigures,
  type UiPluginRuntimeSceneAssets,
  type UiPluginSceneArtworkSlot
} from '../../shared/ui-plugin'

/**
 * UI 插件落盘服务。插件目录: ~/.kun/ui-plugins/<id>/
 * 安装走“白名单复制”:只复制 manifest.json 与 figures/backgrounds 引用的图片,
 * 源目录里的其它任何文件(脚本、可执行文件等)一概不进入 Kun 数据目录。
 */

export type UiPluginInstallResult =
  | { ok: true; plugin: UiPluginListItem }
  | { ok: false; errors: string[] }

export type UiPluginLoadResult =
  | {
      ok: true
      manifest: UiPluginManifestV1
      figures: UiPluginRuntimeFigures
      backgrounds: UiPluginRuntimeBackgrounds
      sceneAssets: UiPluginRuntimeSceneAssets
    }
  | { ok: false; error: string }

type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif'

type ValidatedAsset = {
  bytes: Buffer
  format: ImageFormat
  mime: string
  width: number
  height: number
  animated: boolean
}

type AssetReadResult =
  | { ok: true; asset: ValidatedAsset }
  | { ok: false; error: string }

type AssetReadOptions = {
  maxBytes?: number
  maxPixels?: number
  requireStaticFigure?: boolean
}

type AssetKind = 'figure' | 'background' | 'scene'

type SeedBackgroundBytes = Partial<
  Record<
    UiPluginBackgroundTheme,
    Partial<Record<UiPluginBackgroundSlot, Buffer>>
  >
>

type SeedSceneAssetBytes = Partial<Record<string, Buffer>>

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

// 列表会一次读取所有插件预览；背景原图只在足够小的情况下才可作为卡片预览。
const UI_PLUGIN_BACKGROUND_PREVIEW_MAX_BYTES = 512 * 1024
const UI_PLUGIN_BACKGROUND_PREVIEW_MAX_PIXELS = 2_100_000

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf
])

export function uiPluginsRootDir(kunHomeDir: string): string {
  return join(kunHomeDir, 'ui-plugins')
}

function confinedPluginPath(rootDir: string, pluginId: string, relativePath?: string): string {
  const base = resolve(rootDir)
  const target = resolve(base, pluginId, ...(relativePath ? relativePath.split('/') : []))
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`UI plugin path escapes plugins root: ${pluginId}/${relativePath ?? ''}`)
  }
  return target
}

function pathIsInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep)
}

function assetDataUrl(asset: ValidatedAsset): string {
  return `data:${asset.mime};base64,${asset.bytes.toString('base64')}`
}

function expectedImageFormat(relativePath: string): ImageFormat | null {
  const extension = relativePath.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg'
  if (extension === 'png' || extension === 'webp' || extension === 'gif') return extension
  return null
}

type ImageInspection = {
  width: number
  height: number
  animated: boolean
}

function inspectPng(bytes: Buffer): ImageInspection | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return null

  let offset = 8
  let width = 0
  let height = 0
  let sawIdat = false
  let sawIend = false
  let animated = false
  let chunkIndex = 0
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null
    const dataLength = bytes.readUInt32BE(offset)
    const chunkType = bytes.toString('ascii', offset + 4, offset + 8)
    const chunkEnd = offset + 12 + dataLength
    if (chunkEnd > bytes.length) return null

    if (chunkIndex === 0) {
      if (chunkType !== 'IHDR' || dataLength !== 13) return null
      width = bytes.readUInt32BE(offset + 8)
      height = bytes.readUInt32BE(offset + 12)
      if (width === 0 || height === 0) return null
    } else if (chunkType === 'IHDR') {
      return null
    }

    if (chunkType === 'IDAT') sawIdat = true
    if (chunkType === 'acTL') animated = true
    if (chunkType === 'IEND') {
      if (dataLength !== 0 || chunkEnd !== bytes.length) return null
      sawIend = true
      break
    }
    offset = chunkEnd
    chunkIndex += 1
  }

  return width > 0 && height > 0 && sawIdat && sawIend ? { width, height, animated } : null
}

function inspectGif(bytes: Buffer): ImageInspection | null {
  if (bytes.length < 14) return null
  const header = bytes.toString('ascii', 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  const width = bytes.readUInt16LE(6)
  const height = bytes.readUInt16LE(8)
  if (width === 0 || height === 0 || bytes[bytes.length - 1] !== 0x3b) return null
  return { width, height, animated: false }
}

function inspectJpeg(bytes: Buffer): ImageInspection | null {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null
  }

  let offset = 2
  let width = 0
  let height = 0
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9) break
    if (marker === 0x00 || marker === 0xd8) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      height = bytes.readUInt16BE(offset + 3)
      width = bytes.readUInt16BE(offset + 5)
      if (width === 0 || height === 0) return null
    }

    if (marker === 0xda) {
      // 熵编码数据由解码器处理；这里仍要求此前已有合法 SOF 且文件完整收尾。
      return width > 0 && height > 0 ? { width, height, animated: false } : null
    }
    offset += segmentLength
  }
  return null
}

function readUint24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function inspectWebp(bytes: Buffer): ImageInspection | null {
  if (
    bytes.length < 20 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null
  }

  const declaredEnd = bytes.readUInt32LE(4) + 8
  if (declaredEnd !== bytes.length) return null

  let offset = 12
  let canvasDimensions: { width: number; height: number } | null = null
  let imageDimensions: { width: number; height: number } | null = null
  let animated = false
  while (offset < declaredEnd) {
    if (offset + 8 > declaredEnd) return null
    const chunkType = bytes.toString('ascii', offset, offset + 4)
    const chunkLength = bytes.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    const dataEnd = dataOffset + chunkLength
    const paddedEnd = dataEnd + (chunkLength % 2)
    if (dataEnd > declaredEnd || paddedEnd > declaredEnd) return null

    if (chunkType === 'VP8X') {
      if (chunkLength < 10) return null
      animated ||= (bytes[dataOffset] & 0x02) !== 0
      const width = readUint24LE(bytes, dataOffset + 4) + 1
      const height = readUint24LE(bytes, dataOffset + 7) + 1
      if (width === 0 || height === 0) return null
      canvasDimensions = { width, height }
    } else if (chunkType === 'VP8 ') {
      if (
        chunkLength < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return null
      }
      const width = bytes.readUInt16LE(dataOffset + 6) & 0x3fff
      const height = bytes.readUInt16LE(dataOffset + 8) & 0x3fff
      if (width === 0 || height === 0) return null
      imageDimensions = { width, height }
    } else if (chunkType === 'VP8L') {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) return null
      const b1 = bytes[dataOffset + 1]
      const b2 = bytes[dataOffset + 2]
      const b3 = bytes[dataOffset + 3]
      const b4 = bytes[dataOffset + 4]
      const width = 1 + (((b2 & 0x3f) << 8) | b1)
      const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6))
      imageDimensions = { width, height }
    } else if (chunkType === 'ANIM') {
      animated = true
      if (chunkLength < 6) return null
    } else if (chunkType === 'ANMF') {
      animated = true
      // Animated WebP 的图像位于 ANMF 内；尺寸读取仅用于给出稳定的拒绝原因。
      if (chunkLength < 16) return null
      const width = readUint24LE(bytes, dataOffset + 6) + 1
      const height = readUint24LE(bytes, dataOffset + 9) + 1
      if (width === 0 || height === 0) return null
      imageDimensions = { width, height }
    }

    offset = paddedEnd
  }
  if (offset !== declaredEnd || !imageDimensions) return null
  return { ...(canvasDimensions ?? imageDimensions), animated }
}

function inspectImage(bytes: Buffer): Omit<ValidatedAsset, 'bytes'> | null {
  const png = inspectPng(bytes)
  if (png) return { format: 'png', mime: MIME_BY_FORMAT.png, ...png }
  const jpeg = inspectJpeg(bytes)
  if (jpeg) return { format: 'jpeg', mime: MIME_BY_FORMAT.jpeg, ...jpeg }
  const webp = inspectWebp(bytes)
  if (webp) return { format: 'webp', mime: MIME_BY_FORMAT.webp, ...webp }
  const gif = inspectGif(bytes)
  if (gif) return { format: 'gif', mime: MIME_BY_FORMAT.gif, ...gif }
  return null
}

async function validateAssetBytes(
  relativePath: string,
  bytes: Buffer,
  kind: AssetKind,
  options: AssetReadOptions = {}
): Promise<AssetReadResult> {
  const inspected = inspectImage(bytes)
  if (!inspected) return { ok: false, error: '图片文件结构不完整或格式不受支持' }
  const asset: ValidatedAsset = { bytes, ...inspected }
  const usageError = validateAssetUsage(relativePath, asset, kind)
  if (usageError) return { ok: false, error: usageError }
  if (options.requireStaticFigure) {
    const staticError = validateStaticFigureUsage(asset)
    if (staticError) return { ok: false, error: staticError }
  }
  if (options.maxBytes !== undefined && asset.bytes.byteLength > options.maxBytes) {
    return { ok: false, error: '图片超过列表预览体积上限' }
  }
  if (options.maxPixels !== undefined && asset.width * asset.height > options.maxPixels) {
    return { ok: false, error: '图片超过列表预览像素上限' }
  }

  try {
    // libvips 会完整展开首帧像素流并以 Promise 失败报告损坏输入。
    // 不使用 @napi-rs/canvas.loadImage：部分截断 VP8 会令该原生路径直接崩溃主进程。
    const decodedDimensions = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: kind === 'figure'
        ? UI_PLUGIN_LIMITS.figureMaxPixels
        : kind === 'scene'
          ? UI_PLUGIN_LIMITS.sceneAssetMaxPixels
          : UI_PLUGIN_LIMITS.backgroundMaxPixels
    })
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ info }) => ({ width: info.width, height: info.height }))
    if (decodedDimensions.width !== asset.width || decodedDimensions.height !== asset.height) {
      return { ok: false, error: '图片声明尺寸与实际解码尺寸不一致' }
    }
  } catch {
    return { ok: false, error: '图片像素数据无法完整解码' }
  }

  return { ok: true, asset }
}

function validateAssetUsage(
  relativePath: string,
  asset: ValidatedAsset,
  kind: AssetKind
): string | null {
  const safePath = kind === 'figure'
    ? isSafeUiPluginFigurePath(relativePath)
    : isSafeUiPluginBackgroundPath(relativePath)
  if (!safePath) return '图片路径不合法'

  const byteLimit = kind === 'figure'
    ? UI_PLUGIN_LIMITS.figureBytes
    : kind === 'scene'
      ? UI_PLUGIN_LIMITS.sceneAssetBytes
      : UI_PLUGIN_LIMITS.backgroundBytes
  if (asset.bytes.byteLength > byteLimit) {
    return `图片超过 ${Math.round(byteLimit / 1024 / 1024)}MB 上限`
  }

  const expectedFormat = expectedImageFormat(relativePath)
  if (expectedFormat !== asset.format) {
    return '图片扩展名与实际格式不一致'
  }
  if (kind !== 'figure' && asset.format === 'gif') {
    return kind === 'scene' ? 'scene 图片仅支持 png/jpeg/webp' : '背景仅支持 png/jpeg/webp'
  }
  if (kind !== 'figure' && asset.animated) {
    return kind === 'scene'
      ? 'scene 图片仅支持静态图片，不支持 APNG 或 animated WebP'
      : '背景仅支持静态图片，不支持 APNG 或 animated WebP'
  }

  if (kind === 'figure') {
    if (
      asset.width > UI_PLUGIN_LIMITS.figureMaxDimension ||
      asset.height > UI_PLUGIN_LIMITS.figureMaxDimension
    ) {
      return `形象宽高不得超过 ${UI_PLUGIN_LIMITS.figureMaxDimension}px`
    }
    if (asset.width * asset.height > UI_PLUGIN_LIMITS.figureMaxPixels) {
      return `形象像素不得超过 ${UI_PLUGIN_LIMITS.figureMaxPixels}`
    }
  } else if (kind === 'background') {
    if (
      asset.width > UI_PLUGIN_LIMITS.backgroundMaxDimension ||
      asset.height > UI_PLUGIN_LIMITS.backgroundMaxDimension
    ) {
      return `背景宽高不得超过 ${UI_PLUGIN_LIMITS.backgroundMaxDimension}px`
    }
    if (asset.width * asset.height > UI_PLUGIN_LIMITS.backgroundMaxPixels) {
      return `背景像素不得超过 ${UI_PLUGIN_LIMITS.backgroundMaxPixels}`
    }
  } else {
    if (
      asset.width > UI_PLUGIN_LIMITS.sceneAssetMaxDimension ||
      asset.height > UI_PLUGIN_LIMITS.sceneAssetMaxDimension
    ) {
      return `scene 图片宽高不得超过 ${UI_PLUGIN_LIMITS.sceneAssetMaxDimension}px`
    }
    if (asset.width * asset.height > UI_PLUGIN_LIMITS.sceneAssetMaxPixels) {
      return `scene 图片像素不得超过 ${UI_PLUGIN_LIMITS.sceneAssetMaxPixels}`
    }
  }

  return null
}

function validateStaticFigureUsage(asset: ValidatedAsset): string | null {
  if (asset.format === 'gif' || asset.animated) {
    return 'portrait 仅支持静态 png/jpeg/webp，不支持 GIF、APNG 或 animated WebP'
  }
  return null
}

async function readAssetFromDirectory(
  rootDir: string,
  relativePath: string,
  kind: AssetKind,
  options: AssetReadOptions = {}
): Promise<AssetReadResult> {
  const safePath = kind === 'figure'
    ? isSafeUiPluginFigurePath(relativePath)
    : isSafeUiPluginBackgroundPath(relativePath)
  if (!safePath) return { ok: false, error: '图片路径不合法' }

  let current = rootDir
  let size = 0
  try {
    const segments = relativePath.split('/')
    for (let index = 0; index < segments.length; index += 1) {
      current = join(current, segments[index])
      const info = await lstat(current)
      if (info.isSymbolicLink()) return { ok: false, error: '不允许使用符号链接' }
      const isLast = index === segments.length - 1
      if (isLast) {
        if (!info.isFile()) return { ok: false, error: '不是文件' }
        size = info.size
      } else if (!info.isDirectory()) {
        return { ok: false, error: '图片路径中的父级不是目录' }
      }
    }

    const [rootRealPath, assetRealPath] = await Promise.all([realpath(rootDir), realpath(current)])
    if (!pathIsInside(rootRealPath, assetRealPath)) {
      return { ok: false, error: '图片真实路径越界' }
    }
  } catch {
    return { ok: false, error: '文件不存在' }
  }

  const byteLimit = kind === 'figure'
    ? UI_PLUGIN_LIMITS.figureBytes
    : kind === 'scene'
      ? UI_PLUGIN_LIMITS.sceneAssetBytes
      : UI_PLUGIN_LIMITS.backgroundBytes
  const effectiveByteLimit = Math.min(byteLimit, options.maxBytes ?? byteLimit)
  if (size > effectiveByteLimit) {
    return {
      ok: false,
      error: options.maxBytes !== undefined && effectiveByteLimit === options.maxBytes
        ? '图片超过列表预览体积上限'
        : `图片超过 ${Math.round(byteLimit / 1024 / 1024)}MB 上限`
    }
  }

  try {
    const bytes = await readFile(current)
    return await validateAssetBytes(relativePath, bytes, kind, options)
  } catch {
    return { ok: false, error: '图片读取失败' }
  }
}

async function readManifestAt(dir: string): Promise<
  | { ok: true; manifest: UiPluginManifestV1 }
  | { ok: false; errors: string[] }
> {
  const manifestPath = join(dir, UI_PLUGIN_MANIFEST_FILENAME)
  let text: string
  try {
    const info = await lstat(manifestPath)
    if (info.isSymbolicLink() || !info.isFile()) {
      return { ok: false, errors: ['manifest.json 必须是普通文件,不能是符号链接'] }
    }
    if (info.size > UI_PLUGIN_LIMITS.manifestBytes) {
      return { ok: false, errors: ['manifest.json 超过 64KB 上限'] }
    }
    text = await readFile(manifestPath, 'utf8')
  } catch {
    return { ok: false, errors: ['目录里找不到 manifest.json'] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      errors: [`manifest.json 不是合法 JSON:${error instanceof Error ? error.message : String(error)}`]
    }
  }
  return normalizeUiPluginManifest(raw)
}

async function isSafeInstalledPluginDirectory(rootDir: string, pluginDir: string): Promise<boolean> {
  try {
    const info = await lstat(pluginDir)
    if (info.isSymbolicLink() || !info.isDirectory()) return false
    const [rootRealPath, pluginRealPath] = await Promise.all([realpath(rootDir), realpath(pluginDir)])
    return pathIsInside(rootRealPath, pluginRealPath) && pluginRealPath !== rootRealPath
  } catch {
    return false
  }
}

function backgroundEntries(
  manifest: UiPluginManifestV1
): Array<{
  theme: UiPluginBackgroundTheme
  slot: UiPluginBackgroundSlot
  relativePath: string
}> {
  const entries: Array<{
    theme: UiPluginBackgroundTheme
    slot: UiPluginBackgroundSlot
    relativePath: string
  }> = []
  for (const theme of UI_PLUGIN_BACKGROUND_THEMES) {
    for (const slot of UI_PLUGIN_BACKGROUND_SLOTS) {
      const layer = manifest.backgrounds?.[theme]?.[slot]
      if (layer) entries.push({ theme, slot, relativePath: layer.path })
    }
  }
  return entries
}

function sceneAssetEntries(
  manifest: UiPluginManifestV1
): Array<{
  slot: UiPluginSceneArtworkSlot
  variant: 'default' | 'dark'
  relativePath: string
}> {
  const entries: Array<{
    slot: UiPluginSceneArtworkSlot
    variant: 'default' | 'dark'
    relativePath: string
  }> = []
  for (const slot of UI_PLUGIN_SCENE_ARTWORK_SLOTS) {
    const layer = manifest.scene?.artwork[slot]
    if (!layer) continue
    entries.push({ slot, variant: 'default', relativePath: layer.path })
    if (layer.darkPath && layer.darkPath !== layer.path) {
      entries.push({ slot, variant: 'dark', relativePath: layer.darkPath })
    }
  }
  return entries
}

async function buildPortraitPreviewDataUrl(asset: ValidatedAsset): Promise<string | null> {
  if (validateStaticFigureUsage(asset)) return null
  try {
    for (const quality of [72, 50, 32, 20]) {
      const thumbnailBytes = await sharp(asset.bytes, {
        failOn: 'error',
        limitInputPixels: UI_PLUGIN_LIMITS.figureMaxPixels
      })
        .rotate()
        .resize({
          width: UI_PLUGIN_LIMITS.portraitPreviewMaxDimension,
          height: UI_PLUGIN_LIMITS.portraitPreviewMaxDimension,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality, effort: 4 })
        .toBuffer()
      if (thumbnailBytes.byteLength > UI_PLUGIN_LIMITS.portraitPreviewBytes) continue
      const inspected = inspectImage(thumbnailBytes)
      if (
        inspected?.format !== 'webp' ||
        inspected.animated ||
        inspected.width > UI_PLUGIN_LIMITS.portraitPreviewMaxDimension ||
        inspected.height > UI_PLUGIN_LIMITS.portraitPreviewMaxDimension
      ) {
        continue
      }
      return `data:${MIME_BY_FORMAT.webp};base64,${thumbnailBytes.toString('base64')}`
    }
  } catch {
    // A preview is optional. Installation/loading already performs the
    // authoritative full-image validation and should not fail for a thumbnail.
  }
  return null
}

async function readPluginPreview(
  pluginDir: string,
  manifest: UiPluginManifestV1
): Promise<string | null> {
  const previewSlots: UiPluginFigureSlot[] = [
    'toggleIcon',
    'swim',
    'greet',
    'sit',
    'sleep',
    'run',
    'surf'
  ]
  for (const slot of previewSlots) {
    const relativePath = manifest.figures[slot]
    if (!relativePath) continue
    const result = await readAssetFromDirectory(pluginDir, relativePath, 'figure')
    if (result.ok) return assetDataUrl(result.asset)
  }

  const portraitPath = manifest.figures.portrait
  if (portraitPath) {
    const portrait = await readAssetFromDirectory(pluginDir, portraitPath, 'figure', {
      requireStaticFigure: true
    })
    if (portrait.ok) return buildPortraitPreviewDataUrl(portrait.asset)
  }

  const backgroundPreviewOrder: Array<
    readonly [UiPluginBackgroundTheme, UiPluginBackgroundSlot]
  > = [
    ['light', 'stage'],
    ['dark', 'stage'],
    ['light', 'app'],
    ['dark', 'app'],
    ['light', 'sidebar'],
    ['dark', 'sidebar']
  ]
  for (const [theme, slot] of backgroundPreviewOrder) {
    const relativePath = manifest.backgrounds?.[theme]?.[slot]?.path
    if (!relativePath) continue
    const result = await readAssetFromDirectory(pluginDir, relativePath, 'background', {
      maxBytes: UI_PLUGIN_BACKGROUND_PREVIEW_MAX_BYTES,
      maxPixels: UI_PLUGIN_BACKGROUND_PREVIEW_MAX_PIXELS
    })
    if (result.ok) return assetDataUrl(result.asset)
  }
  return null
}

export async function listUiPlugins(userDataDir: string): Promise<UiPluginListItem[]> {
  const rootDir = uiPluginsRootDir(userDataDir)
  let entries: string[]
  try {
    entries = (await readdir(rootDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const plugins: UiPluginListItem[] = []
  for (const entry of entries.sort()) {
    let pluginDir: string
    try {
      pluginDir = confinedPluginPath(rootDir, entry)
    } catch {
      continue
    }
    if (!(await isSafeInstalledPluginDirectory(rootDir, pluginDir))) continue
    const manifestResult = await readManifestAt(pluginDir)
    if (!manifestResult.ok) continue
    // 目录名必须与 manifest id 一致,避免同一插件多份伪装。
    if (manifestResult.manifest.id !== entry) continue
    plugins.push({
      manifest: manifestResult.manifest,
      previewDataUrl: await readPluginPreview(pluginDir, manifestResult.manifest)
    })
  }
  return plugins
}

export async function loadUiPluginFigures(
  userDataDir: string,
  pluginId: string
): Promise<UiPluginLoadResult> {
  const rootDir = uiPluginsRootDir(userDataDir)
  let pluginDir: string
  try {
    pluginDir = confinedPluginPath(rootDir, pluginId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!(await isSafeInstalledPluginDirectory(rootDir, pluginDir))) {
    return { ok: false, error: '插件目录不存在、越界或是符号链接' }
  }

  const manifestResult = await readManifestAt(pluginDir)
  if (!manifestResult.ok) {
    return { ok: false, error: manifestResult.errors.join('; ') }
  }
  const manifest = manifestResult.manifest
  if (manifest.id !== pluginId) {
    return { ok: false, error: '插件目录与 manifest id 不一致' }
  }

  const cache = new Map<string, ValidatedAsset>()
  const uniqueAssetPaths = new Set<string>()
  const uniqueBackgroundPaths = new Set<string>()
  let totalFigureBytes = 0
  let totalFigurePixels = 0
  let totalBackgroundBytes = 0
  let totalAssetBytes = 0
  let totalBackgroundPixels = 0
  let totalSceneAssetBytes = 0
  let totalSceneAssetPixels = 0
  const uniqueSceneAssetPaths = new Set<string>()

  const readCachedAsset = async (
    relativePath: string,
    kind: AssetKind,
    options: AssetReadOptions = {}
  ): Promise<AssetReadResult> => {
    const cached = cache.get(relativePath)
    if (cached) {
      const usageError = validateAssetUsage(relativePath, cached, kind)
      if (usageError) return { ok: false, error: usageError }
      if (options.requireStaticFigure) {
        const staticError = validateStaticFigureUsage(cached)
        if (staticError) return { ok: false, error: staticError }
      }
      return { ok: true, asset: cached }
    }
    const result = await readAssetFromDirectory(pluginDir, relativePath, kind, options)
    if (result.ok) cache.set(relativePath, result.asset)
    return result
  }

  const chargeTotalAsset = (relativePath: string, asset: ValidatedAsset): string | null => {
    if (uniqueAssetPaths.has(relativePath)) return null
    uniqueAssetPaths.add(relativePath)
    totalAssetBytes += asset.bytes.byteLength
    return totalAssetBytes > UI_PLUGIN_LIMITS.totalAssetBytes ? '插件全部资源总体积超过上限' : null
  }

  const figures: UiPluginRuntimeFigures = {}
  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath || !isSafeUiPluginFigurePath(relativePath)) {
      return { ok: false, error: `槽位 ${slot} 的图片路径不合法` }
    }
    const result = await readCachedAsset(relativePath, 'figure', {
      requireStaticFigure: slot === 'portrait'
    })
    if (!result.ok) return { ok: false, error: `槽位 ${slot} 加载失败:${result.error}` }

    totalFigureBytes += result.asset.bytes.byteLength
    totalFigurePixels += result.asset.width * result.asset.height
    if (totalFigureBytes > UI_PLUGIN_LIMITS.totalFigureBytes) {
      return { ok: false, error: '插件形象图片总体积超过上限' }
    }
    if (totalFigurePixels > UI_PLUGIN_LIMITS.totalFigurePixels) {
      return { ok: false, error: '插件形象图片总像素超过上限' }
    }
    const totalError = chargeTotalAsset(relativePath, result.asset)
    if (totalError) return { ok: false, error: totalError }
    figures[slot as UiPluginFigureSlot] = assetDataUrl(result.asset)
  }

  const backgrounds: UiPluginRuntimeBackgrounds = {}
  for (const { theme, slot, relativePath } of backgroundEntries(manifest)) {
    if (!isSafeUiPluginBackgroundPath(relativePath)) {
      return { ok: false, error: `背景 ${theme}.${slot} 的图片路径不合法` }
    }
    const result = await readCachedAsset(relativePath, 'background')
    if (!result.ok) {
      return { ok: false, error: `背景 ${theme}.${slot} 加载失败:${result.error}` }
    }
    if (result.asset.format === 'gif') {
      return { ok: false, error: `背景 ${theme}.${slot} 加载失败:背景仅支持 png/jpeg/webp` }
    }

    if (!uniqueBackgroundPaths.has(relativePath)) {
      uniqueBackgroundPaths.add(relativePath)
      totalBackgroundBytes += result.asset.bytes.byteLength
      totalBackgroundPixels += result.asset.width * result.asset.height
      if (totalBackgroundBytes > UI_PLUGIN_LIMITS.totalBackgroundBytes) {
        return { ok: false, error: '插件背景图片总体积超过上限' }
      }
      if (totalBackgroundPixels > UI_PLUGIN_LIMITS.totalBackgroundPixels) {
        return { ok: false, error: '插件背景图片总像素超过上限' }
      }
    }
    const totalError = chargeTotalAsset(relativePath, result.asset)
    if (totalError) return { ok: false, error: totalError }
    const runtimeAssets = (backgrounds.assets ??= {})
    if (!Object.prototype.hasOwnProperty.call(runtimeAssets, relativePath)) {
      runtimeAssets[relativePath] = assetDataUrl(result.asset)
    }
  }

  const sceneAssets: UiPluginRuntimeSceneAssets = {}
  for (const { slot, variant, relativePath } of sceneAssetEntries(manifest)) {
    if (!isSafeUiPluginBackgroundPath(relativePath)) {
      return { ok: false, error: `scene ${slot}.${variant} 的图片路径不合法` }
    }
    const result = await readCachedAsset(relativePath, 'scene')
    if (!result.ok) {
      return { ok: false, error: `scene ${slot}.${variant} 加载失败:${result.error}` }
    }
    if (!uniqueSceneAssetPaths.has(relativePath)) {
      uniqueSceneAssetPaths.add(relativePath)
      totalSceneAssetBytes += result.asset.bytes.byteLength
      totalSceneAssetPixels += result.asset.width * result.asset.height
      if (totalSceneAssetBytes > UI_PLUGIN_LIMITS.totalSceneAssetBytes) {
        return { ok: false, error: '插件 scene 图片总体积超过上限' }
      }
      if (totalSceneAssetPixels > UI_PLUGIN_LIMITS.totalSceneAssetPixels) {
        return { ok: false, error: '插件 scene 图片总像素超过上限' }
      }
    }
    const totalError = chargeTotalAsset(relativePath, result.asset)
    if (totalError) return { ok: false, error: totalError }
    const runtimeAssets = (sceneAssets.assets ??= {})
    if (!Object.prototype.hasOwnProperty.call(runtimeAssets, relativePath)) {
      runtimeAssets[relativePath] = assetDataUrl(result.asset)
    }
  }

  return { ok: true, manifest, figures, backgrounds, sceneAssets }
}

export async function installUiPluginFromDirectory(
  userDataDir: string,
  sourceDir: string
): Promise<UiPluginInstallResult> {
  const manifestResult = await readManifestAt(sourceDir)
  if (!manifestResult.ok) return { ok: false, errors: manifestResult.errors }
  const manifest = manifestResult.manifest

  // 先在源目录核验所有被引用资源，再对白名单文件按相对路径去重落盘。
  const errors: string[] = []
  const assetFiles = new Map<string, ValidatedAsset>()
  const uniqueAssetPaths = new Set<string>()
  const uniqueBackgroundPaths = new Set<string>()
  const uniqueSceneAssetPaths = new Set<string>()
  let totalFigureBytes = 0
  let totalFigurePixels = 0
  let totalBackgroundBytes = 0
  let totalAssetBytes = 0
  let totalBackgroundPixels = 0
  let totalSceneAssetBytes = 0
  let totalSceneAssetPixels = 0

  const readCachedAsset = async (
    relativePath: string,
    kind: AssetKind,
    options: AssetReadOptions = {}
  ): Promise<AssetReadResult> => {
    const cached = assetFiles.get(relativePath)
    if (cached) {
      const usageError = validateAssetUsage(relativePath, cached, kind)
      if (usageError) return { ok: false, error: usageError }
      if (options.requireStaticFigure) {
        const staticError = validateStaticFigureUsage(cached)
        if (staticError) return { ok: false, error: staticError }
      }
      return { ok: true, asset: cached }
    }
    const result = await readAssetFromDirectory(sourceDir, relativePath, kind, options)
    if (result.ok) assetFiles.set(relativePath, result.asset)
    return result
  }

  const chargeTotalAsset = (relativePath: string, asset: ValidatedAsset): void => {
    if (uniqueAssetPaths.has(relativePath)) return
    uniqueAssetPaths.add(relativePath)
    totalAssetBytes += asset.bytes.byteLength
  }

  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath) continue
    const result = await readCachedAsset(relativePath, 'figure', {
      requireStaticFigure: slot === 'portrait'
    })
    if (!result.ok) {
      errors.push(`槽位 ${slot}(${relativePath}):${result.error}`)
      continue
    }
    totalFigureBytes += result.asset.bytes.byteLength
    totalFigurePixels += result.asset.width * result.asset.height
    chargeTotalAsset(relativePath, result.asset)
  }

  for (const { theme, slot, relativePath } of backgroundEntries(manifest)) {
    const result = await readCachedAsset(relativePath, 'background')
    if (!result.ok) {
      errors.push(`背景 ${theme}.${slot}(${relativePath}):${result.error}`)
      continue
    }
    if (result.asset.format === 'gif') {
      errors.push(`背景 ${theme}.${slot}(${relativePath}):背景仅支持 png/jpeg/webp`)
      continue
    }
    if (!uniqueBackgroundPaths.has(relativePath)) {
      uniqueBackgroundPaths.add(relativePath)
      totalBackgroundBytes += result.asset.bytes.byteLength
      totalBackgroundPixels += result.asset.width * result.asset.height
    }
    chargeTotalAsset(relativePath, result.asset)
  }

  for (const { slot, variant, relativePath } of sceneAssetEntries(manifest)) {
    const result = await readCachedAsset(relativePath, 'scene')
    if (!result.ok) {
      errors.push(`scene ${slot}.${variant}(${relativePath}):${result.error}`)
      continue
    }
    if (!uniqueSceneAssetPaths.has(relativePath)) {
      uniqueSceneAssetPaths.add(relativePath)
      totalSceneAssetBytes += result.asset.bytes.byteLength
      totalSceneAssetPixels += result.asset.width * result.asset.height
    }
    chargeTotalAsset(relativePath, result.asset)
  }

  if (totalFigureBytes > UI_PLUGIN_LIMITS.totalFigureBytes) {
    errors.push('插件形象图片总体积超过上限')
  }
  if (totalFigurePixels > UI_PLUGIN_LIMITS.totalFigurePixels) {
    errors.push('插件形象图片总像素超过上限')
  }
  if (totalBackgroundBytes > UI_PLUGIN_LIMITS.totalBackgroundBytes) {
    errors.push('插件背景图片总体积超过上限')
  }
  if (totalBackgroundPixels > UI_PLUGIN_LIMITS.totalBackgroundPixels) {
    errors.push('插件背景图片总像素超过上限')
  }
  if (totalSceneAssetBytes > UI_PLUGIN_LIMITS.totalSceneAssetBytes) {
    errors.push('插件 scene 图片总体积超过上限')
  }
  if (totalSceneAssetPixels > UI_PLUGIN_LIMITS.totalSceneAssetPixels) {
    errors.push('插件 scene 图片总像素超过上限')
  }
  if (totalAssetBytes > UI_PLUGIN_LIMITS.totalAssetBytes) {
    errors.push('插件全部资源总体积超过上限')
  }
  if (errors.length > 0) return { ok: false, errors }

  const rootDir = uiPluginsRootDir(userDataDir)
  const targetDir = confinedPluginPath(rootDir, manifest.id)
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  await writeFile(
    join(targetDir, UI_PLUGIN_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  for (const [relativePath, asset] of assetFiles) {
    const targetPath = confinedPluginPath(rootDir, manifest.id, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, asset.bytes)
  }

  return {
    ok: true,
    plugin: {
      manifest,
      previewDataUrl: await readPluginPreview(targetDir, manifest)
    }
  }
}

/**
 * 用内存字节落盘一个插件(预装插件用)。figureBytes 的键是槽位名；
 * backgroundBytes 按 theme → slot 提供，sceneAssetBytes 按 manifest 相对路径提供。
 * 旧的三/四参数调用保持兼容。
 */
export async function seedUiPlugin(
  userDataDir: string,
  manifestRaw: unknown,
  figureBytes: Record<string, Buffer>,
  backgroundBytes: SeedBackgroundBytes = {},
  sceneAssetBytes: SeedSceneAssetBytes = {}
): Promise<UiPluginInstallResult> {
  const manifestResult = normalizeUiPluginManifest(manifestRaw)
  if (!manifestResult.ok) return { ok: false, errors: manifestResult.errors }
  const manifest = manifestResult.manifest

  const errors: string[] = []
  const assetFiles = new Map<string, ValidatedAsset>()
  const uniqueAssetPaths = new Set<string>()
  const uniqueBackgroundPaths = new Set<string>()
  const uniqueSceneAssetPaths = new Set<string>()
  let totalFigureBytes = 0
  let totalFigurePixels = 0
  let totalBackgroundBytes = 0
  let totalAssetBytes = 0
  let totalBackgroundPixels = 0
  let totalSceneAssetBytes = 0
  let totalSceneAssetPixels = 0

  const registerAsset = async (
    relativePath: string,
    bytes: Buffer,
    kind: AssetKind,
    context: string,
    options: AssetReadOptions = {}
  ): Promise<ValidatedAsset | null> => {
    const existing = assetFiles.get(relativePath)
    if (existing) {
      if (!existing.bytes.equals(bytes)) {
        errors.push(`${context}:同一路径提供了不同的图片数据`)
        return null
      }
      const usageError = validateAssetUsage(relativePath, existing, kind)
      if (usageError) {
        errors.push(`${context}:${usageError}`)
        return null
      }
      if (options.requireStaticFigure) {
        const staticError = validateStaticFigureUsage(existing)
        if (staticError) {
          errors.push(`${context}:${staticError}`)
          return null
        }
      }
      return existing
    }
    const result = await validateAssetBytes(relativePath, bytes, kind, options)
    if (!result.ok) {
      errors.push(`${context}:${result.error}`)
      return null
    }
    assetFiles.set(relativePath, result.asset)
    return result.asset
  }

  const chargeTotalAsset = (relativePath: string, asset: ValidatedAsset): void => {
    if (uniqueAssetPaths.has(relativePath)) return
    uniqueAssetPaths.add(relativePath)
    totalAssetBytes += asset.bytes.byteLength
  }

  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath) continue
    const bytes = figureBytes[slot]
    if (!bytes) {
      errors.push(`槽位 ${slot} 缺少预装图片数据`)
      continue
    }
    const asset = await registerAsset(relativePath, bytes, 'figure', `槽位 ${slot}`, {
      requireStaticFigure: slot === 'portrait'
    })
    if (!asset) continue
    totalFigureBytes += bytes.byteLength
    totalFigurePixels += asset.width * asset.height
    chargeTotalAsset(relativePath, asset)
  }

  for (const { theme, slot, relativePath } of backgroundEntries(manifest)) {
    const bytes = backgroundBytes[theme]?.[slot]
    if (!bytes) {
      errors.push(`背景 ${theme}.${slot} 缺少预装图片数据`)
      continue
    }
    const asset = await registerAsset(relativePath, bytes, 'background', `背景 ${theme}.${slot}`)
    if (!asset) continue
    if (!uniqueBackgroundPaths.has(relativePath)) {
      uniqueBackgroundPaths.add(relativePath)
      totalBackgroundBytes += asset.bytes.byteLength
      totalBackgroundPixels += asset.width * asset.height
    }
    chargeTotalAsset(relativePath, asset)
  }

  for (const { slot, variant, relativePath } of sceneAssetEntries(manifest)) {
    const bytes = sceneAssetBytes[relativePath]
    if (!bytes) {
      errors.push(`scene ${slot}.${variant} 缺少预装图片数据`)
      continue
    }
    const asset = await registerAsset(
      relativePath,
      bytes,
      'scene',
      `scene ${slot}.${variant}`
    )
    if (!asset) continue
    if (!uniqueSceneAssetPaths.has(relativePath)) {
      uniqueSceneAssetPaths.add(relativePath)
      totalSceneAssetBytes += asset.bytes.byteLength
      totalSceneAssetPixels += asset.width * asset.height
    }
    chargeTotalAsset(relativePath, asset)
  }

  if (totalFigureBytes > UI_PLUGIN_LIMITS.totalFigureBytes) {
    errors.push('预装插件形象图片总体积超过上限')
  }
  if (totalFigurePixels > UI_PLUGIN_LIMITS.totalFigurePixels) {
    errors.push('预装插件形象图片总像素超过上限')
  }
  if (totalBackgroundBytes > UI_PLUGIN_LIMITS.totalBackgroundBytes) {
    errors.push('预装插件背景图片总体积超过上限')
  }
  if (totalBackgroundPixels > UI_PLUGIN_LIMITS.totalBackgroundPixels) {
    errors.push('预装插件背景图片总像素超过上限')
  }
  if (totalSceneAssetBytes > UI_PLUGIN_LIMITS.totalSceneAssetBytes) {
    errors.push('预装插件 scene 图片总体积超过上限')
  }
  if (totalSceneAssetPixels > UI_PLUGIN_LIMITS.totalSceneAssetPixels) {
    errors.push('预装插件 scene 图片总像素超过上限')
  }
  if (totalAssetBytes > UI_PLUGIN_LIMITS.totalAssetBytes) {
    errors.push('预装插件全部资源总体积超过上限')
  }
  if (errors.length > 0) return { ok: false, errors }

  const rootDir = uiPluginsRootDir(userDataDir)
  const targetDir = confinedPluginPath(rootDir, manifest.id)
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  await writeFile(
    join(targetDir, UI_PLUGIN_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  for (const [relativePath, asset] of assetFiles) {
    const targetPath = confinedPluginPath(rootDir, manifest.id, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, asset.bytes)
  }

  return {
    ok: true,
    plugin: {
      manifest,
      previewDataUrl: await readPluginPreview(targetDir, manifest)
    }
  }
}

export async function removeUiPlugin(userDataDir: string, pluginId: string): Promise<boolean> {
  const rootDir = uiPluginsRootDir(userDataDir)
  let pluginDir: string
  try {
    pluginDir = confinedPluginPath(rootDir, pluginId)
  } catch {
    return false
  }
  if (pluginDir === resolve(rootDir)) return false
  try {
    await rm(pluginDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
