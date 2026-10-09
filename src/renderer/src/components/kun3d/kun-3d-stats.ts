import { Box3, Vector3, type AnimationClip, type Material, type Mesh, type Object3D, type SkinnedMesh, type Texture } from 'three'
import { kun3dBudget, type Kun3dAssetCategory } from '@shared/kun-3d-assets'

export type Kun3dModelStats = {
  triangles: number
  vertices: number
  meshes: number
  materials: number
  textures: number
  /** Longest side of the largest texture, 0 when the model has none. */
  maxTexture: number
  bones: number
  animations: string[]
  /** Bounding box size in model units (1 unit = 1 m by the plan). */
  size: { x: number; y: number; z: number }
  /** Distance of the bounding box's bottom center from the origin. */
  originOffset: number
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const

function textureSide(texture: Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  return Math.max(image?.width ?? 0, image?.height ?? 0)
}

/** Counts what a game engine would pay for: triangles, materials, textures, bones and bounds. */
export function measureKun3dScene(root: Object3D, animations: readonly AnimationClip[] = []): Kun3dModelStats {
  let triangles = 0, vertices = 0, meshes = 0
  const materials = new Set<Material>(), textures = new Set<Texture>(), bones = new Set<string>()
  root.updateMatrixWorld(true)
  root.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    meshes += 1
    const position = mesh.geometry.getAttribute('position')
    const count = mesh.geometry.index ? mesh.geometry.index.count : position?.count ?? 0
    triangles += Math.floor(count / 3)
    vertices += position?.count ?? 0
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue
      materials.add(material)
      for (const slot of TEXTURE_SLOTS) {
        const texture = (material as unknown as Record<string, Texture | null | undefined>)[slot]
        if (texture) textures.add(texture)
      }
    }
    const skinned = node as SkinnedMesh
    if (skinned.isSkinnedMesh) for (const bone of skinned.skeleton.bones) bones.add(bone.uuid)
  })
  const box = new Box3().setFromObject(root)
  const size = box.isEmpty() ? new Vector3() : box.getSize(new Vector3())
  const bottom = box.isEmpty() ? new Vector3() : new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
  return {
    triangles, vertices, meshes, materials: materials.size, textures: textures.size,
    maxTexture: [...textures].reduce((max, texture) => Math.max(max, textureSide(texture)), 0),
    bones: bones.size, animations: animations.map((clip) => clip.name || 'clip'),
    size: { x: size.x, y: size.y, z: size.z }, originOffset: bottom.length()
  }
}

export type Kun3dBudgetCheck = { id: 'triangles' | 'bytes' | 'materials' | 'texture' | 'origin' | 'height'; ok: boolean; value: string; limit: string }

const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
export const formatKun3dBytes = formatBytes
export const formatKun3dMeters = (value: number) => value >= 1 ? `${value.toFixed(2)} m` : `${Math.round(value * 100)} cm`

/** Compares a model with the plan's LOD0 budget for its category; over budget is shown, never blocked. */
export function checkKun3dBudget(category: Kun3dAssetCategory, id: string, stats: Kun3dModelStats, bytes: number): Kun3dBudgetCheck[] {
  const budget = kun3dBudget(category, id)
  const height = stats.size.y
  const checks: Kun3dBudgetCheck[] = [
    { id: 'triangles', ok: stats.triangles <= budget.triangles, value: stats.triangles.toLocaleString('en-US'), limit: budget.triangles.toLocaleString('en-US') },
    { id: 'bytes', ok: bytes <= budget.bytes, value: formatBytes(bytes), limit: formatBytes(budget.bytes) },
    { id: 'materials', ok: stats.materials <= budget.materials, value: String(stats.materials), limit: String(budget.materials) },
    { id: 'texture', ok: stats.maxTexture <= budget.texture, value: stats.maxTexture ? `${stats.maxTexture}px` : '—', limit: `${budget.texture}px` },
    // Rigid items carry their pivot at the socket, so only the base and scenery must stand on the origin.
    ...(category === 'base' || category === 'scene' || category === 'bottle'
      ? [{ id: 'origin' as const, ok: height > 0 && stats.originOffset <= Math.max(0.01, height * 0.02), value: formatKun3dMeters(stats.originOffset), limit: formatKun3dMeters(Math.max(0.01, height * 0.02)) }]
      : [])
  ]
  // 0.8 m to the top of the head; the crest may add a little.
  if (category === 'base') checks.push({ id: 'height', ok: height >= 0.72 && height <= 0.95, value: formatKun3dMeters(height), limit: '0.72–0.95 m' })
  return checks
}
