import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { checkKun3dBudget, measureKun3dScene } from './kun-3d-stats'

function texture(size: number) {
  const value = new Texture()
  value.image = { width: size, height: size / 2 }
  return value
}

describe('3D model stats', () => {
  it('counts triangles, materials, textures, bounds and the origin offset', () => {
    const root = new Group()
    const shared = new MeshStandardMaterial({ map: texture(2048) })
    const body = new Mesh(new BoxGeometry(0.5, 0.8, 0.4), shared)
    body.position.y = 0.4
    const hat = new Mesh(new BoxGeometry(0.3, 0.1, 0.3), new MeshStandardMaterial({ map: texture(512), normalMap: texture(512) }))
    hat.position.y = 0.85
    root.add(body, hat)
    const stats = measureKun3dScene(root, [new AnimationClip('kun_idle', 1, [])])
    expect(stats).toMatchObject({ triangles: 24, vertices: 48, meshes: 2, materials: 2, textures: 3, maxTexture: 2048, bones: 0, animations: ['kun_idle'] })
    expect(stats.size.y).toBeCloseTo(0.9)
    expect(stats.originOffset).toBeCloseTo(0)
    const checks = checkKun3dBudget('base', 'kun', stats, 3 * 1024 * 1024)
    expect(checks.map((check) => [check.id, check.ok])).toEqual([
      ['triangles', true], ['bytes', false], ['materials', true], ['texture', false], ['origin', true], ['height', true]])
  })

  it('does not ask rigid items to stand on the origin', () => {
    const root = new Group()
    const cap = new Mesh(new BoxGeometry(0.3, 0.12, 0.3), new MeshStandardMaterial())
    cap.position.y = 0.7
    root.add(cap)
    const checks = checkKun3dBudget('headwear', 'pilot-cap', measureKun3dScene(root), 40 * 1024)
    expect(checks.map((check) => check.id)).toEqual(['triangles', 'bytes', 'materials', 'texture'])
    expect(checks.every((check) => check.ok)).toBe(true)
  })
})
