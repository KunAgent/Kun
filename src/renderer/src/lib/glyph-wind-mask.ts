/**
 * The resting "wind" over the home glyph field. A small tileable noise tile
 * of soft blobs is stretched along the wind and slid across the field as a
 * repeating canvas pattern; wherever it is opaque, faint glyphs show through.
 * Two layers at different speeds and scales make the gusts change shape as
 * they drift. Painting it is a couple of GPU pattern fills per frame.
 */

const TILE_SIZE = 128
/** Noise lattice cells across one tile; the octave above uses twice as many. */
const LATTICE = 8

type WindLayer = {
  /** Drift in field units per second. */
  speedX: number
  speedY: number
  /** Tile stretch: wide along the wind, thin across it, so gusts read as streaks. */
  scaleX: number
  scaleY: number
  /** Rotation of the streaks, in degrees. */
  angle: number
  phaseX: number
  phaseY: number
  /** Peak mask opacity this layer contributes. */
  strength: number
}

const WIND_LAYERS: readonly WindLayer[] = [
  { speedX: 34, speedY: -7, scaleX: 9, scaleY: 3.2, angle: -10, phaseX: 0, phaseY: 0, strength: 0.45 },
  { speedX: 55, speedY: -4, scaleX: 6.5, scaleY: 2.3, angle: -6, phaseX: 310, phaseY: 170, strength: 0.3 }
]

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const smooth = (t: number): number => t * t * (3 - 2 * t)
const smoothstep = (a: number, b: number, x: number): number =>
  smooth(Math.min(1, Math.max(0, (x - a) / (b - a))))
const wrap = (value: number, period: number): number => ((value % period) + period) % period

/** Value noise whose lattice repeats every `period` cells, so the tile seams vanish. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  const x0 = wrap(xi, period)
  const y0 = wrap(yi, period)
  const x1 = wrap(xi + 1, period)
  const y1 = wrap(yi + 1, period)
  const a = hash(x0, y0, seed)
  const b = hash(x1, y0, seed)
  const c = hash(x0, y1, seed)
  const d = hash(x1, y1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Wind opacity 0..1 at tile coordinates `u`, `v` in [0, 1): sparse soft blobs. */
export function windTileAlpha(u: number, v: number): number {
  const n = 0.65 * periodicNoise(u * LATTICE, v * LATTICE, LATTICE, 3) +
    0.35 * periodicNoise(u * LATTICE * 2, v * LATTICE * 2, LATTICE * 2, 11)
  return smoothstep(0.56, 0.8, n)
}

/** Render the wind tile once; it is reused as a repeating pattern. */
export function createWindTile(): HTMLCanvasElement | null {
  const tile = document.createElement('canvas')
  tile.width = TILE_SIZE
  tile.height = TILE_SIZE
  const context = tile.getContext('2d')
  if (!context) return null
  const image = context.createImageData(TILE_SIZE, TILE_SIZE)
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      image.data[(y * TILE_SIZE + x) * 4 + 3] = Math.round(windTileAlpha(x / TILE_SIZE, y / TILE_SIZE) * 255)
    }
  }
  context.putImageData(image, 0, 0)
  return tile
}

/** Lay the wind's opacity over `width`×`height` field units at `seconds` (source-over). */
export function paintWind(
  context: CanvasRenderingContext2D,
  pattern: CanvasPattern,
  width: number,
  height: number,
  seconds: number
): void {
  for (const layer of WIND_LAYERS) {
    pattern.setTransform(new DOMMatrix()
      .translateSelf(layer.phaseX + seconds * layer.speedX, layer.phaseY + seconds * layer.speedY)
      .rotateSelf(layer.angle)
      .scaleSelf(layer.scaleX, layer.scaleY))
    context.globalAlpha = layer.strength
    context.fillStyle = pattern
    context.fillRect(0, 0, width, height)
  }
  context.globalAlpha = 1
}
