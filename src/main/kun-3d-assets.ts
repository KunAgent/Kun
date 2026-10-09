import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import {
  KUN_3D_ASSET_DIRECTORY, KUN_3D_ASSET_FOLDERS, KUN_3D_ASSET_MAX_BYTES, KUN_3D_ASSET_MAX_ENTRIES, KUN_3D_REFERENCE_VIEWS,
  isKun3dImageFile, isKun3dModelFile, isSafeKun3dAssetKey, kun3dMimeType,
  type Kun3dAssetCategory, type Kun3dAssetEntry, type Kun3dAssetListResult, type Kun3dAssetReadResult, type Kun3dReferenceView
} from '../shared/kun-3d-assets'

const README = `Kun 3D 资产文件夹

把 tripo-cli 生成并清理好的模型放在这里，应用里的 3D 展台会直接显示：

  base/kun.glb                     素体
  headwear/<id>.glb                头饰，<id> 与衣橱目录一致，例如 pilot-cap
  glasses/ outfit/ prop/ scene/ bottle/   同上
  headwear/<id>/front.png          三视图（可选：front、left、back、right、worn），用于在展台里叠图对照

规范见仓库 docs/kun-avatar-3d-asset-plan.zh-CN.md。
`

export function kun3dAssetRoot(home = homedir()): string {
  return join(home, ...KUN_3D_ASSET_DIRECTORY)
}

/** Creates the folder, one sub-folder per category and a short readme for artists. */
export async function ensureKun3dAssetRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await Promise.all(KUN_3D_ASSET_FOLDERS.map((folder) => mkdir(join(root, folder), { recursive: true })))
  await writeFile(join(root, 'README.txt'), README, { flag: 'wx' }).catch(() => undefined)
}

const stripExtension = (name: string) => name.slice(0, name.lastIndexOf('.'))

async function references(root: string, folder: string, id: string): Promise<Partial<Record<Kun3dReferenceView, string>>> {
  const directory = join(root, folder, id)
  const found: Partial<Record<Kun3dReferenceView, string>> = {}
  try {
    const info = await lstat(directory)
    if (!info.isDirectory()) return found
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !isKun3dImageFile(file.name)) continue
      const view = stripExtension(file.name).toLowerCase() as Kun3dReferenceView
      if ((KUN_3D_REFERENCE_VIEWS as readonly string[]).includes(view) && !found[view]) found[view] = `${folder}/${id}/${file.name}`
    }
  } catch { /* No drawings for this model. */ }
  return found
}

async function modelsIn(root: string, folder: string | null, category: Kun3dAssetCategory): Promise<Kun3dAssetEntry[]> {
  const directory = folder ? join(root, folder) : root
  let files
  try { files = await readdir(directory, { withFileTypes: true }) } catch { return [] }
  const entries: Kun3dAssetEntry[] = []
  for (const file of files) {
    // Symbolic links are skipped so a listing never points outside the folder.
    if (!file.isFile() || !isKun3dModelFile(file.name)) continue
    const key = folder ? `${folder}/${file.name}` : file.name
    try {
      const info = await stat(join(directory, file.name))
      const id = stripExtension(file.name)
      entries.push({ key, category, id, bytes: info.size, modifiedAt: info.mtime.toISOString(),
        references: folder ? await references(root, folder, id) : {} })
    } catch { /* The file went away while listing. */ }
  }
  return entries
}

export async function listKun3dAssets(root: string): Promise<Kun3dAssetListResult> {
  try {
    await ensureKun3dAssetRoot(root)
    const groups = await Promise.all([
      ...KUN_3D_ASSET_FOLDERS.map((folder) => modelsIn(root, folder, folder)),
      modelsIn(root, null, 'other')
    ])
    const all = groups.flat().sort((a, b) => a.key.localeCompare(b.key))
    return { ok: true, root, entries: all.slice(0, KUN_3D_ASSET_MAX_ENTRIES), truncated: all.length > KUN_3D_ASSET_MAX_ENTRIES }
  } catch (error) {
    return { ok: false, root, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Reads one model or drawing, refusing anything that resolves outside the asset folder. */
export async function readKun3dAsset(root: string, key: string): Promise<Kun3dAssetReadResult> {
  if (!isSafeKun3dAssetKey(key)) return { ok: false, key, message: 'Not a 3D asset path.' }
  try {
    const realRoot = await realpath(root)
    const target = await realpath(resolve(root, key))
    if (!target.startsWith(realRoot + sep)) return { ok: false, key, message: 'Not a 3D asset path.' }
    const info = await stat(target)
    if (!info.isFile()) return { ok: false, key, message: 'Not a file.' }
    if (info.size > KUN_3D_ASSET_MAX_BYTES) return { ok: false, key, message: `File is larger than ${KUN_3D_ASSET_MAX_BYTES / 1024 / 1024} MB.` }
    const data = await readFile(target)
    return { ok: true, key, bytes: info.size, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mimeType: kun3dMimeType(key) }
  } catch (error) {
    return { ok: false, key, message: error instanceof Error ? error.message : String(error) }
  }
}
