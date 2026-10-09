/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kun3dAssetEntry } from '@shared/kun-3d-assets'

const viewer = vi.hoisted(() => ({ load: vi.fn(), setOrthographic: vi.fn(), setView: vi.fn(), setShading: vi.fn(), setLighting: vi.fn(),
  setAutoRotate: vi.fn(), setGrid: vi.fn(), playAnimation: vi.fn(), dispose: vi.fn() }))
vi.mock('./kun-3d-viewer', () => ({
  KUN_3D_VIEWS: ['front', 'threeQuarter', 'left', 'back', 'right', 'top'], KUN_3D_SHADINGS: ['original', 'toon', 'clay', 'wireframe'],
  KUN_3D_LIGHTINGS: ['studio', 'day', 'dusk', 'night'], Kun3dViewer: vi.fn(function Fake() { return viewer })
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(',')}` : key })
}))
const { default: Kun3dShowcase } = await import('./Kun3dShowcase')

const entry: Kun3dAssetEntry = { key: 'headwear/pilot-cap.glb', category: 'headwear', id: 'pilot-cap', bytes: 2048, modifiedAt: '2026-10-09T00:00:00.000Z',
  references: { front: 'headwear/pilot-cap/front.png' } }
const stats = { triangles: 2400, vertices: 1300, meshes: 1, materials: 1, textures: 1, maxTexture: 2048, bones: 0, animations: ['kun_idle'],
  size: { x: 0.3, y: 0.2, z: 0.3 }, originOffset: 0.4 }
let container: HTMLDivElement, root: Root
const bridge = { list: vi.fn(), read: vi.fn(), openFolder: vi.fn() }
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:front'), revokeObjectURL: vi.fn() }))
  Object.values(viewer).forEach((fn) => fn.mockReset())
  viewer.load.mockResolvedValue(stats)
  bridge.list.mockResolvedValue({ ok: true, root: '/home/me/.kun/3d-assets', entries: [entry], truncated: false })
  bridge.read.mockImplementation(async (key: string) => ({ ok: true, key, bytes: key.endsWith('.glb') ? 2048 : 10, data: new Uint8Array([1, 2, 3]),
    mimeType: key.endsWith('.glb') ? 'model/gltf-binary' : 'image/png' }))
  ;(window as unknown as { kunGui: unknown }).kunGui = { kun3dAssets: bridge }
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('3D showcase', () => {
  it('lists catalog items, loads a model, checks its budget and overlays the front drawing', async () => {
    await act(async () => root.render(createElement(Kun3dShowcase, { onClose: vi.fn() })))
    await flush()
    const item = button('[data-kun3d-entry="headwear/pilot-cap.glb"]')
    expect(item.textContent).toContain('Pilot cap')
    expect(button('[data-kun3d-open-folder]').title).toBe('/home/me/.kun/3d-assets')
    // Nothing open yet: no toolbar and no model panel, only the list and a hint.
    expect(document.querySelector('.kun3d')!.getAttribute('data-kun3d-layout')).toBe('library')
    expect(document.querySelector('.kun3d-toolbar, .kun3d-info')).toBeNull()
    await act(async () => item.click())
    await flush()
    expect(bridge.read).toHaveBeenCalledWith('headwear/pilot-cap.glb')
    expect(viewer.load.mock.calls[0]![0]).toBeInstanceOf(ArrayBuffer)
    expect(document.querySelector('.kun3d')!.getAttribute('data-kun3d-state')).toBe('ready')
    expect(document.querySelector('.kun3d')!.getAttribute('data-kun3d-layout')).toBe('model')
    expect(document.querySelector('.kun3d-info-head')!.textContent).toBe('Pilot capheadwear/pilot-cap.glb')
    const triangles = document.querySelector('[data-kun3d-check="triangles"]')!
    expect(triangles.hasAttribute('data-ok')).toBe(false)
    expect(triangles.textContent).toContain('2,400')
    expect(document.querySelector('[data-kun3d-check="origin"]')).toBeNull()
    await act(async () => button('[data-kun3d-ref="front"]').click())
    expect(viewer.setOrthographic).toHaveBeenLastCalledWith('front')
    expect(document.querySelector<HTMLImageElement>('.kun3d-overlay')!.src).toBe('blob:front')
    await act(async () => button('[data-kun3d-view="back"]').click())
    expect(viewer.setOrthographic).toHaveBeenLastCalledWith(null)
    expect(viewer.setView).toHaveBeenLastCalledWith('back')
    expect(document.querySelector('.kun3d-overlay')).toBeNull()
  })

  it('says there is nothing yet when the folder is empty', async () => {
    bridge.list.mockResolvedValue({ ok: true, root: '/home/me/.kun/3d-assets', entries: [], truncated: false })
    await act(async () => root.render(createElement(Kun3dShowcase, { onClose: vi.fn() })))
    await flush()
    expect(document.querySelector('.kun3d')!.getAttribute('data-kun3d-layout')).toBe('empty')
    expect(document.querySelector('[data-kun3d-empty]')!.textContent).toBe('kun3dEmpty')
    expect(document.querySelector('.kun3d-library, .kun3d-toolbar, .kun3d-info')).toBeNull()
    await act(async () => button('[data-kun3d-open-folder]').click())
    expect(bridge.openFolder).toHaveBeenCalled()
  })

  it('explains a model that does not load', async () => {
    viewer.load.mockRejectedValue(new Error('THREE.GLTFLoader: No DRACOLoader instance provided.'))
    await act(async () => root.render(createElement(Kun3dShowcase, { onClose: vi.fn() })))
    await flush()
    await act(async () => button('[data-kun3d-entry="headwear/pilot-cap.glb"]').click())
    await flush()
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('kun3dErrorDraco')
  })
})
