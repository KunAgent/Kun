import { describe, expect, it } from 'vitest'
import { loadAvatarManifest } from './room-avatar-manifest'

const index = { schemaVersion: 1, version: 'art-polish', canvas: 1024,
  anchors: { faceBox: [232, 300, 792, 860] }, assetManifests: ['manifests/base.json', 'manifests/icon-outfit.json'] }
const base = { png: 'base/sky.png', webp: { 128: '128/base/sky.webp' } }
const icon = { png: 'icon/outfit/cardigan.png', webp: { 128: '128/icon/outfit/cardigan.webp' } }
const groups = { 'manifests/base.json': { 'base/sky': base }, 'manifests/icon-outfit.json': { 'icon/outfit/cardigan': icon } }

describe('bundled avatar manifest families', () => {
  it('accepts a separate small crop without moving the canonical face protection box', () => {
    const result = loadAvatarManifest({ ...index, anchors: { ...index.anchors, compactFaceBox: [200, 236, 824, 860] } }, groups)
    expect(result.anchors.faceBox).toEqual([232, 300, 792, 860])
    expect(result.anchors.compactFaceBox).toEqual([200, 236, 824, 860])
  })

  it.each([[200, 236, 190, 860], [200, -10, 824, 860], [200, 236, 1200, 860], [200, 236, 824, 800]])('rejects invalid small crops: %s', (...compactFaceBox) => {
    expect(() => loadAvatarManifest({ ...index, anchors: { ...index.anchors, compactFaceBox } }, groups))
      .toThrow('Invalid compact avatar face box')
  })

  it('loads only the families declared by the index, including independent icon entries', () => {
    const result = loadAvatarManifest(index, { ...groups, 'manifests/unused.json': { 'unused/item': base } })
    expect(result.assets).toEqual({ 'base/sky': base, 'icon/outfit/cardigan': icon })
    expect(result.anchors.faceBox).toEqual(index.anchors.faceBox)
    expect(result.version).toBe(index.version)
  })

  it('accepts small container exports without requiring avatar-specific 128px tiers', () => {
    const entry = { png: 'container/bottle-glow.png', webp: { 96: '96/container/bottle-glow.webp' } }
    const result = loadAvatarManifest({ ...index, assetManifests: ['manifests/container.json'] },
      { 'manifests/container.json': { 'container/bottle-glow': entry } })
    expect(result.assets['container/bottle-glow']).toEqual(entry)
  })

  it('fails when a declared family is missing rather than rendering a partial catalog', () => {
    expect(() => loadAvatarManifest(index, { 'manifests/base.json': groups['manifests/base.json'] }))
      .toThrow('Missing avatar manifest family: manifests/icon-outfit.json')
  })

  it('rejects repeated families and collisions instead of silently overwriting assets', () => {
    expect(() => loadAvatarManifest({ ...index, assetManifests: ['manifests/base.json', 'manifests/base.json'] }, groups))
      .toThrow('Duplicate avatar manifest family')
    expect(() => loadAvatarManifest(index, { ...groups, 'manifests/icon-outfit.json': { 'base/sky': icon } }))
      .toThrow('Duplicate avatar asset: base/sky')
  })

  it('rejects invalid family paths, empty families and malformed entries', () => {
    for (const path of ['../base.json', 'manifests/../base.json', '/manifests/base.json']) {
      expect(() => loadAvatarManifest({ ...index, assetManifests: [path] }, groups)).toThrow('Invalid avatar manifest family')
    }
    expect(() => loadAvatarManifest(index, { ...groups, 'manifests/base.json': {} })).toThrow('Invalid avatar manifest family')
    expect(() => loadAvatarManifest(index, { ...groups, 'manifests/base.json': { 'base/sky': { png: 'base/sky.png' } } }))
      .toThrow('Invalid avatar asset: base/sky')
    expect(() => loadAvatarManifest({ ...index, assetManifests: [] }, groups)).toThrow('Invalid avatar manifest index')
  })
})
