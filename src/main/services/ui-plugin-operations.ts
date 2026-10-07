import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
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

import {
  AssetKind,
  AssetReadOptions,
  AssetReadResult,
  SeedBackgroundBytes,
  SeedSceneAssetBytes,
  UiPluginInstallResult,
  UiPluginLoadResult,
  ValidatedAsset,
  assetDataUrl,
  backgroundEntries,
  confinedPluginPath,
  isSafeInstalledPluginDirectory,
  readAssetFromDirectory,
  readManifestAt,
  readPluginPreview,
  sceneAssetEntries,
  uiPluginsRootDir,
  validateAssetBytes,
  validateAssetUsage,
  validateStaticFigureUsage
} from './ui-plugin-assets'

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
