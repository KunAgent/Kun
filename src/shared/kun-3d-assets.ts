/**
 * The 3D asset space: artists drop generated `.glb` models (and optional
 * three-view drawings) into `~/.kun/3d-assets/<category>/`, and the app shows
 * them with their budgets. Layout and budgets follow
 * docs/kun-avatar-3d-asset-plan.zh-CN.md sections 6 and 7.
 */

export const KUN_3D_ASSET_DIRECTORY = ['.kun', '3d-assets'] as const
export const KUN_3D_ASSET_CATEGORIES = ['base', 'headwear', 'glasses', 'outfit', 'prop', 'scene', 'bottle', 'other'] as const
export type Kun3dAssetCategory = (typeof KUN_3D_ASSET_CATEGORIES)[number]
/** Folders created for artists; loose files at the root count as `other`. */
export const KUN_3D_ASSET_FOLDERS = KUN_3D_ASSET_CATEGORIES.filter((category) => category !== 'other')
export const KUN_3D_REFERENCE_VIEWS = ['front', 'left', 'back', 'right', 'worn'] as const
export type Kun3dReferenceView = (typeof KUN_3D_REFERENCE_VIEWS)[number]
export const KUN_3D_MODEL_EXTENSIONS = ['.glb'] as const
export const KUN_3D_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const
/** Generated models with 2K–8K textures can be large; anything bigger is not a game asset. */
export const KUN_3D_ASSET_MAX_BYTES = 200 * 1024 * 1024
export const KUN_3D_ASSET_MAX_ENTRIES = 2000
export const KUN_3D_ASSET_KEY_MAX_LENGTH = 512

export type Kun3dAssetEntry = {
  /** Path relative to the asset folder, with forward slashes, e.g. `headwear/pilot-cap.glb`. */
  key: string
  category: Kun3dAssetCategory
  /** The catalog id when the file follows the naming rule, otherwise the file name without extension. */
  id: string
  bytes: number
  modifiedAt: string
  /** Three-view drawings found in `<category>/<id>/<view>.png`. */
  references: Partial<Record<Kun3dReferenceView, string>>
}

export type Kun3dAssetListResult =
  | { ok: true; root: string; entries: Kun3dAssetEntry[]; truncated: boolean }
  | { ok: false; root: string; message: string }
export type Kun3dAssetReadResult =
  | { ok: true; key: string; bytes: number; data: Uint8Array; mimeType: string }
  | { ok: false; key: string; message: string }
export type Kun3dAssetsBridge = {
  list: () => Promise<Kun3dAssetListResult>
  read: (key: string) => Promise<Kun3dAssetReadResult>
  openFolder: () => Promise<{ ok: boolean; message?: string }>
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}
export const isKun3dModelFile = (name: string) => (KUN_3D_MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(name))
export const isKun3dImageFile = (name: string) => (KUN_3D_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/** A key the main process may read: relative, forward slashes, no `..`, a model or image file. */
export function isSafeKun3dAssetKey(key: string): boolean {
  if (!key || key.length > KUN_3D_ASSET_KEY_MAX_LENGTH || key.includes('\\') || key.includes('\0')) return false
  if (key.startsWith('/') || /^[a-z]:/i.test(key)) return false
  const parts = key.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false
  return isKun3dModelFile(key) || isKun3dImageFile(key)
}

export function kun3dMimeType(key: string): string {
  const extension = extensionOf(key)
  return extension === '.glb' ? 'model/gltf-binary' : extension === '.png' ? 'image/png'
    : extension === '.webp' ? 'image/webp' : 'image/jpeg'
}

export type Kun3dBudget = { triangles: number; bytes: number; materials: number; texture: number }
const KB = 1024
/** LOD0 budgets from the plan (6.1, 6.2); textures are the published sizes. */
export const KUN_3D_BUDGETS: Record<Kun3dAssetCategory, Kun3dBudget> = {
  base: { triangles: 6000, bytes: 1536 * KB, materials: 3, texture: 1024 },
  headwear: { triangles: 1500, bytes: 250 * KB, materials: 2, texture: 512 },
  glasses: { triangles: 600, bytes: 150 * KB, materials: 2, texture: 256 },
  outfit: { triangles: 3000, bytes: 300 * KB, materials: 2, texture: 512 },
  prop: { triangles: 1200, bytes: 200 * KB, materials: 2, texture: 256 },
  scene: { triangles: 2000, bytes: 900 * KB, materials: 4, texture: 1024 },
  bottle: { triangles: 2000, bytes: 300 * KB, materials: 3, texture: 512 },
  other: { triangles: 15000, bytes: 2048 * KB, materials: 6, texture: 1024 }
}
const LARGE_ITEMS: Partial<Record<Kun3dAssetCategory, { ids: readonly string[]; triangles: number }>> = {
  // Legendary headwear and the two capes get a bigger allowance.
  headwear: { ids: ['astronaut-helmet', 'wizard-hat', 'laurel'], triangles: 3000 },
  outfit: { ids: ['storyteller-cape', 'wizard-cape'], triangles: 4000 }
}
export function kun3dBudget(category: Kun3dAssetCategory, id: string): Kun3dBudget {
  const base = KUN_3D_BUDGETS[category]
  const large = LARGE_ITEMS[category]
  return large?.ids.includes(id) ? { ...base, triangles: large.triangles } : base
}
