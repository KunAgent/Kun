import { describe, expect, it } from 'vitest'
import { isSafeKun3dAssetKey, kun3dBudget, kun3dMimeType } from './kun-3d-assets'

describe('3D asset contract', () => {
  it('accepts only relative model and drawing paths inside the folder', () => {
    expect(isSafeKun3dAssetKey('headwear/pilot-cap.glb')).toBe(true)
    expect(isSafeKun3dAssetKey('headwear/pilot-cap/front.png')).toBe(true)
    expect(isSafeKun3dAssetKey('kun.glb')).toBe(true)
    for (const key of ['', '../secret.glb', 'headwear/../../x.glb', '/etc/passwd.glb', 'C:/x.glb', 'a\\b.glb', 'headwear/.hidden.glb',
      'headwear/pilot-cap.fbx', 'headwear//x.glb', 'README.txt']) expect(isSafeKun3dAssetKey(key)).toBe(false)
  })

  it('gives legendary headwear and capes a larger triangle budget', () => {
    expect(kun3dBudget('headwear', 'pilot-cap').triangles).toBe(1500)
    expect(kun3dBudget('headwear', 'wizard-hat').triangles).toBe(3000)
    expect(kun3dBudget('outfit', 'wizard-cape').triangles).toBe(4000)
    expect(kun3dBudget('base', 'kun').triangles).toBe(6000)
    expect(kun3dMimeType('a/b.glb')).toBe('model/gltf-binary')
    expect(kun3dMimeType('a/b/front.webp')).toBe('image/webp')
  })
})
