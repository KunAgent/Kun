import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { KUN_AVATAR_CATALOG, type KunAvatarAccessoryCategory, type KunAvatarColor } from '@shared/rooms-api'
import { composedAvatarLayerUrl } from './room-avatar-compositor'

type Box = readonly [number, number, number, number]
const FULL: Box = [0, 0, 1, 1]
// Clothes are thin collars; on the chest of a body they read as something worn.
const MANNEQUIN: Box = [0.06, 0.52, 0.94, 1]
const MEASURE = 128
const bounds = new Map<string, Promise<Box>>()

/** Opaque pixel bounds of one full-canvas layer, normalized to 0..1 and cached per URL. */
async function measureLayer(url: string): Promise<Box> {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = MEASURE; canvas.height = MEASURE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return FULL
  context.drawImage(image, 0, 0, MEASURE, MEASURE)
  const { data } = context.getImageData(0, 0, MEASURE, MEASURE)
  let x0 = MEASURE, y0 = MEASURE, x1 = -1, y1 = -1
  for (let y = 0; y < MEASURE; y++) {
    for (let x = 0; x < MEASURE; x++) {
      if (data[(y * MEASURE + x) * 4 + 3]! <= 16) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? FULL : [x0 / MEASURE, y0 / MEASURE, (x1 + 1) / MEASURE, (y1 + 1) / MEASURE]
}

function layerBounds(url: string): Promise<Box> {
  let pending = bounds.get(url)
  if (!pending) {
    // Without a canvas (tests, a failed decode) the whole layer is shown instead.
    pending = measureLayer(url).catch(() => FULL)
    bounds.set(url, pending)
  }
  return pending
}

/** Back layers draw first so capes and hoods read as one piece; a mannequin body sits between. */
export function avatarItemLayers(category: KunAvatarAccessoryCategory, id: string, mannequin?: KunAvatarColor): string[] {
  const part = KUN_AVATAR_CATALOG[category].find((entry) => entry.id === id)
  return part ? [...(part.hasBack ? [`${category}/${id}.back`] : []), ...(mannequin ? [`base/${mannequin}`] : []),
    `${category}/${id}`] : []
}

/** An accessory the way a wardrobe shows it: cropped to its artwork, or worn on a mannequin. */
export function RoomAvatarItemArt({ category, id, size, height = size, mannequin }: {
  category: KunAvatarAccessoryCategory; id: string; size: number; height?: number; mannequin?: KunAvatarColor
}): ReactElement {
  const layers = avatarItemLayers(category, id, mannequin)
  const key = layers.join('|')
  const [box, setBox] = useState<{ key: string; value: Box }>()
  useEffect(() => {
    let active = true
    if (mannequin) { setBox({ key, value: MANNEQUIN }); return }
    const urls = layers.map((layer) => composedAvatarLayerUrl(layer, 128)).filter((url): url is string => Boolean(url))
    void Promise.all(urls.map(layerBounds)).then((boxes) => {
      if (!active) return
      const value: Box = boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : FULL
      setBox({ key, value })
    })
    return () => { active = false }
    // The layer list and mannequin are fully described by the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const frame = { width: size, height } as CSSProperties
  if (box?.key !== key) return <span className="rooms-avatar-item-art" style={frame} data-loading aria-hidden="true" />
  const [x0, y0, x1, y1] = box.value
  const spanX = Math.max(x1 - x0, 0.01), spanY = Math.max(y1 - y0, 0.01)
  // Loose items get breathing room and small ones (a quill) zoom in, never past the 512px source.
  const rendered = Math.min(size / spanX, height / spanY) * (mannequin ? 1 : 0.84)
  const capped = Math.min(rendered, Math.max(size, height) * 3.2)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const tier = capped * dpr > 256 ? 512 : 256
  const placement = { width: capped, height: capped,
    left: size / 2 - (x0 + spanX / 2) * capped, top: height / 2 - (y0 + spanY / 2) * capped } as CSSProperties
  return <span className="rooms-avatar-item-art" style={frame} data-mannequin={mannequin ? true : undefined} aria-hidden="true">
    {layers.map((layer) => {
      const url = composedAvatarLayerUrl(layer, tier)
      return url ? <img key={layer} src={url} alt="" draggable={false} style={placement} /> : null
    })}
  </span>
}
