import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { KUN_AVATAR_DEFAULT_PARTS, kunAvatarBodyClip } from '@shared/rooms-api'
import { renderAvatarComposition } from './room-avatar-composition-canvas'

let output: Blob | undefined
const files = new Map<string, Buffer>()
function painted(name: string, color: string, box = [0, 0, 1024, 1024]) {
  const canvas = createCanvas(1024, 1024), ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(box[0], box[1], box[2], box[3])
  files.set(name, canvas.toBuffer('image/png'))
}

beforeEach(() => {
  output = undefined
  painted('body', '#ff0000')
  painted('face', '#00ffff', [780, 850, 100, 100])
  painted('garment', '#00ff00', [32, 920, 160, 104])
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, blob: async () => new Blob([Uint8Array.from(files.get(url)!)]),
  })))
  vi.stubGlobal('createImageBitmap', async (blob: Blob) =>
    Object.assign(await loadImage(Buffer.from(await blob.arrayBuffer())), { close() {} }))
  vi.stubGlobal('OffscreenCanvas', class {
    private surface
    constructor(width: number, height: number) { this.surface = createCanvas(width, height) }
    get width() { return this.surface.width }
    set width(value: number) { this.surface.width = value }
    get height() { return this.surface.height }
    set height(value: number) { this.surface.height = value }
    getContext() { return this.surface.getContext('2d') }
    async convertToBlob() { return new Blob([Uint8Array.from(this.surface.toBuffer('image/png'))]) }
  })
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { output = blob as Blob; return 'blob:result' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); files.clear() })

async function pixels(options: { crop?: readonly number[]; clip?: boolean; bg?: string; pixels?: number } = {}) {
  const clip = kunAvatarBodyClip({ ...KUN_AVATAR_DEFAULT_PARTS, outfit: 'cream-shirt' })!
  const size = options.pixels ?? 256
  await renderAvatarComposition(['body', 'face', 'garment'], {
    pixels: size, canvas: 1024, bg: options.bg ?? '#0000ff', crop: options.crop,
    layerClips: options.clip === false ? undefined : { 0: clip },
  })
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d')
  ctx.drawImage(await loadImage(Buffer.from(await output!.arrayBuffer())), 0, 0)
  return (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data]
}

describe('real avatar raster composition', () => {
  it('removes resting wing pixels only from the body and restores the clip before face/clothes', async () => {
    const pixel = await pixels()
    expect(pixel(25, 220)).toEqual([0, 0, 255, 255]) // revealed background
    expect(pixel(128, 100)).toEqual([255, 0, 0, 255]) // head is intact
    expect(pixel(128, 220)).toEqual([255, 0, 0, 255]) // chest stays under open collars
    expect(pixel(205, 225)).toEqual([0, 255, 255, 255]) // later face layer was not clipped
    expect(pixel(25, 245)).toEqual([0, 255, 0, 255]) // clothing extends outside body clip
    expect((await pixels({ clip: false }))(25, 220)).toEqual([255, 0, 0, 255])
  })

  it('keeps alpha holes transparent and maps the mask through the same retina face crop', async () => {
    expect((await pixels({ bg: 'transparent' }))(25, 220)).toEqual([0, 0, 0, 0])
    const pixel = await pixels({ crop: [128, 256, 896, 1024], pixels: 192 })
    expect(pixel(8, 160)).toEqual([0, 0, 255, 255]) // source (160,896), removed wing
    expect(pixel(96, 96)).toEqual([255, 0, 0, 255]) // source (512,640), face area
    expect(pixel(172, 160)).toEqual([0, 255, 255, 255]) // source (816,896), later layer
  })
})
