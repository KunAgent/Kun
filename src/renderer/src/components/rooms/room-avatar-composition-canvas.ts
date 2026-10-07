import type { AvatarCompositionResource } from './room-avatar-composition-cache'

interface DecodedLayer {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

async function decodeLayer(url: string): Promise<DecodedLayer> {
  if (typeof createImageBitmap === 'function') {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Avatar layer could not load (${response.status})`)
    const bitmap = await createImageBitmap(await response.blob())
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }
  const image = new Image()
  image.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => { image.removeAttribute('src'); reject(new Error('Avatar layer could not decode')) }
    image.src = url
  })
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => { image.onload = null; image.onerror = null; image.removeAttribute('src') }
  }
}

function createCanvas(pixels: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(pixels, pixels)
      const context = canvas.getContext('2d')
      if (context && typeof canvas.convertToBlob === 'function') {
        return { canvas, context, encode: () => canvas.convertToBlob({ type: 'image/png' }) }
      }
    } catch {
      // Some mobile browsers expose OffscreenCanvas without a usable 2D context.
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = pixels
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Avatar canvas is unavailable')
  return {
    canvas,
    context,
    encode: () => new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Avatar canvas could not encode')), 'image/png'
    ))
  }
}

export async function renderAvatarComposition(urls: string[], options: {
  pixels: number
  canvas: number
  crop?: readonly number[]
  bg: string
}): Promise<AvatarCompositionResource> {
  const { pixels, canvas, bg } = options
  // allSettled ensures every successful decode gets released if any layer fails.
  const decoded = await Promise.allSettled(urls.map(decodeLayer))
  const layers = decoded.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  let surface: ReturnType<typeof createCanvas> | undefined
  try {
    const failure = decoded.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    surface = createCanvas(pixels)
    const { context } = surface
    if (bg !== 'transparent') {
      context.fillStyle = bg
      context.fillRect(0, 0, pixels, pixels)
    }
    const [left, top, right, bottom] = options.crop ?? [0, 0, canvas, canvas]
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    for (const layer of layers) {
      const scaleX = layer.width / canvas
      const scaleY = layer.height / canvas
      context.drawImage(layer.source, left * scaleX, top * scaleY,
        (right - left) * scaleX, (bottom - top) * scaleY, 0, 0, pixels, pixels)
    }
    const blob = await surface.encode()
    const url = URL.createObjectURL(blob)
    // Account conservatively for the decoded output a browser may retain for
    // this object URL, even though this cache itself only owns the PNG blob.
    return { url, bytes: Math.max(blob.size, pixels * pixels * 4), dispose: () => URL.revokeObjectURL(url) }
  } finally {
    for (const layer of layers) layer.close()
    if (surface) surface.canvas.width = surface.canvas.height = 1
  }
}
