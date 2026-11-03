import type { PptdRect } from './pptd-deck.js'

/**
 * SVG geometry for PPTD preset shapes. Previews only need a faithful
 * silhouette, so common OOXML presets are drawn from their default or
 * provided adjustment and anything unknown degrades to a rectangle.
 */

export type PptdShapeGeometry =
  | { kind: 'rect'; radius: number }
  | { kind: 'ellipse' }
  | { kind: 'path'; d: string; evenOdd?: boolean }
  /** Author path in its own viewBox; the renderer scales it into the bounds. */
  | { kind: 'custom'; d: string; viewBox: [number, number] }

type Point = [number, number]

function adjustment(adjustments: readonly number[] | undefined, index: number, fallback: number): number {
  const value = adjustments?.[index]
  return typeof value === 'number' && Number.isFinite(value) ? value / 100_000 : fallback / 100_000
}

function polygon(rect: PptdRect, points: readonly Point[]): PptdShapeGeometry {
  const d = points
    .map(([u, v], index) => `${index === 0 ? 'M' : 'L'}${round(rect.x + u * rect.width)} ${round(rect.y + v * rect.height)}`)
    .join(' ')
  return { kind: 'path', d: `${d} Z` }
}

function regularPolygon(rect: PptdRect, sides: number, rotation = -Math.PI / 2): PptdShapeGeometry {
  const points: Point[] = []
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index * 2 * Math.PI) / sides
    points.push([0.5 + Math.cos(angle) / 2, 0.5 + Math.sin(angle) / 2])
  }
  return polygon(rect, points)
}

function star(rect: PptdRect, spikes: number, inner: number): PptdShapeGeometry {
  const points: Point[] = []
  for (let index = 0; index < spikes * 2; index += 1) {
    const radius = index % 2 === 0 ? 0.5 : inner / 2
    const angle = -Math.PI / 2 + (index * Math.PI) / spikes
    points.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius])
  }
  return polygon(rect, points)
}

function ring(rect: PptdRect, thickness: number): PptdShapeGeometry {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const rx = rect.width / 2
  const ry = rect.height / 2
  const inset = Math.min(rect.width, rect.height) * thickness
  const irx = Math.max(rx - inset, 0)
  const iry = Math.max(ry - inset, 0)
  const ellipsePath = (x: number, y: number) =>
    `M${round(cx - x)} ${round(cy)} A${round(x)} ${round(y)} 0 1 0 ${round(cx + x)} ${round(cy)} A${round(x)} ${round(y)} 0 1 0 ${round(cx - x)} ${round(cy)} Z`
  return { kind: 'path', d: `${ellipsePath(rx, ry)} ${ellipsePath(irx, iry)}`, evenOdd: true }
}

function frame(rect: PptdRect, thickness: number): PptdShapeGeometry {
  const inset = Math.min(rect.width, rect.height) * thickness
  const outer = `M${round(rect.x)} ${round(rect.y)} H${round(rect.x + rect.width)} V${round(rect.y + rect.height)} H${round(rect.x)} Z`
  const inner = `M${round(rect.x + inset)} ${round(rect.y + inset)} H${round(rect.x + rect.width - inset)} V${round(rect.y + rect.height - inset)} H${round(rect.x + inset)} Z`
  return { kind: 'path', d: `${outer} ${inner}`, evenOdd: true }
}

function arrow(rect: PptdRect, direction: 'right' | 'left' | 'up' | 'down', shaft: number, head: number): PptdShapeGeometry {
  // Draw a right-pointing arrow in unit space, then rotate the points.
  const half = shaft / 2
  const tipStart = 1 - Math.min(head * (rect.height / Math.max(rect.width, 1)), 0.9)
  const base: Point[] = [
    [0, 0.5 - half], [tipStart, 0.5 - half], [tipStart, 0], [1, 0.5],
    [tipStart, 1], [tipStart, 0.5 + half], [0, 0.5 + half]
  ]
  const turned = base.map(([u, v]): Point => {
    if (direction === 'left') return [1 - u, v]
    if (direction === 'down') return [v, u]
    if (direction === 'up') return [v, 1 - u]
    return [u, v]
  })
  return polygon(rect, turned)
}

function customPath(rect: PptdRect, viewBox: unknown, path: unknown): PptdShapeGeometry | undefined {
  if (typeof path !== 'string' || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/.test(path)) return undefined
  if (!Array.isArray(viewBox) || viewBox.length < 2) return undefined
  const [vw, vh] = viewBox
  if (typeof vw !== 'number' || typeof vh !== 'number' || vw <= 0 || vh <= 0) return undefined
  return { kind: 'custom', d: path, viewBox: [vw, vh] }
}

export function pptdShapeGeometry(
  shapeName: string | undefined,
  rect: PptdRect,
  adjustments?: readonly number[],
  custom?: { viewBox?: unknown; path?: unknown }
): PptdShapeGeometry {
  const min = Math.min(rect.width, rect.height)
  switch (shapeName ?? 'rect') {
    case 'rect':
      return { kind: 'rect', radius: 0 }
    case 'roundRect':
    case 'plaque':
      return { kind: 'rect', radius: min * adjustment(adjustments, 0, 16_667) }
    case 'ellipse':
    case 'oval':
      return { kind: 'ellipse' }
    case 'triangle': {
      const apex = adjustment(adjustments, 0, 50_000)
      return polygon(rect, [[apex, 0], [1, 1], [0, 1]])
    }
    case 'rtTriangle':
      return polygon(rect, [[0, 0], [1, 1], [0, 1]])
    case 'parallelogram': {
      const slant = Math.min(adjustment(adjustments, 0, 25_000) * min / Math.max(rect.width, 1), 0.9)
      return polygon(rect, [[slant, 0], [1, 0], [1 - slant, 1], [0, 1]])
    }
    case 'trapezoid': {
      const inset = Math.min(adjustment(adjustments, 0, 25_000) * min / Math.max(rect.width, 1), 0.49)
      return polygon(rect, [[inset, 0], [1 - inset, 0], [1, 1], [0, 1]])
    }
    case 'diamond':
      return polygon(rect, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])
    case 'pentagon':
      return regularPolygon(rect, 5)
    case 'hexagon':
      return regularPolygon(rect, 6, 0)
    case 'heptagon':
      return regularPolygon(rect, 7)
    case 'octagon':
      return regularPolygon(rect, 8, Math.PI / 8)
    case 'decagon':
      return regularPolygon(rect, 10)
    case 'dodecagon':
      return regularPolygon(rect, 12)
    case 'plus': {
      const arm = Math.min(adjustment(adjustments, 0, 25_000), 0.49)
      return polygon(rect, [
        [arm, 0], [1 - arm, 0], [1 - arm, arm], [1, arm], [1, 1 - arm], [1 - arm, 1 - arm],
        [1 - arm, 1], [arm, 1], [arm, 1 - arm], [0, 1 - arm], [0, arm], [arm, arm]
      ])
    }
    case 'homePlate': {
      const tip = 1 - Math.min(adjustment(adjustments, 0, 50_000) * min / Math.max(rect.width, 1), 0.9)
      return polygon(rect, [[0, 0], [tip, 0], [1, 0.5], [tip, 1], [0, 1]])
    }
    case 'chevron': {
      const notch = Math.min(adjustment(adjustments, 0, 50_000) * min / Math.max(rect.width, 1), 0.9)
      return polygon(rect, [[0, 0], [1 - notch, 0], [1, 0.5], [1 - notch, 1], [0, 1], [notch, 0.5]])
    }
    case 'rightArrow':
      return arrow(rect, 'right', adjustment(adjustments, 0, 50_000), adjustment(adjustments, 1, 50_000))
    case 'leftArrow':
      return arrow(rect, 'left', adjustment(adjustments, 0, 50_000), adjustment(adjustments, 1, 50_000))
    case 'upArrow':
      return arrow(rect, 'up', adjustment(adjustments, 0, 50_000), adjustment(adjustments, 1, 50_000))
    case 'downArrow':
      return arrow(rect, 'down', adjustment(adjustments, 0, 50_000), adjustment(adjustments, 1, 50_000))
    case 'star4':
      return star(rect, 4, adjustment(adjustments, 0, 12_500) * 2)
    case 'star5':
      return star(rect, 5, adjustment(adjustments, 0, 19_098) * 2)
    case 'star6':
      return star(rect, 6, adjustment(adjustments, 0, 28_868) * 2)
    case 'star8':
      return star(rect, 8, adjustment(adjustments, 0, 37_500) * 2)
    case 'donut':
      return ring(rect, adjustment(adjustments, 0, 25_000))
    case 'frame':
      return frame(rect, adjustment(adjustments, 0, 12_500))
    case 'snip1Rect': {
      const cut = Math.min(adjustment(adjustments, 0, 16_667) * min, min / 2)
      const u = cut / Math.max(rect.width, 1)
      const v = cut / Math.max(rect.height, 1)
      return polygon(rect, [[0, 0], [1 - u, 0], [1, v], [1, 1], [0, 1]])
    }
    case 'round1Rect':
    case 'round2SameRect':
    case 'round2DiagRect':
    case 'snipRoundRect':
      return { kind: 'rect', radius: min * adjustment(adjustments, 0, 16_667) }
    case 'custom':
      return customPath(rect, custom?.viewBox, custom?.path) ?? { kind: 'rect', radius: 0 }
    default:
      return { kind: 'rect', radius: 0 }
  }
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}
