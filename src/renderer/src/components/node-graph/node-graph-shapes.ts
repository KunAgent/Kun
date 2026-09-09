import type { NodeGraphShape } from './node-graph-theme'

/**
 * Canvas silhouettes for each node kind.
 *
 * Every shape is drawn inscribed in a circle of the given radius so a node's
 * visual weight still reads as its degree regardless of which shape it wears,
 * and so hit testing can stay a single radius comparison.
 */

const TAU = Math.PI * 2

export function traceNodeGraphShape(
  context: CanvasRenderingContext2D,
  shape: NodeGraphShape,
  x: number,
  y: number,
  radius: number
): void {
  context.beginPath()
  switch (shape) {
    case 'circle':
      context.arc(x, y, radius, 0, TAU)
      return
    case 'hexagon':
      tracePolygon(context, x, y, radius, 6, -Math.PI / 2)
      return
    case 'diamond':
      tracePolygon(context, x, y, radius, 4, -Math.PI / 2)
      return
    case 'roundedSquare':
      traceRoundedSquare(context, x, y, radius)
      return
    case 'cylinder':
      traceCylinder(context, x, y, radius)
      return
    case 'document':
      traceDocument(context, x, y, radius)
      return
    case 'star':
      traceStar(context, x, y, radius)
      return
  }
}

function tracePolygon(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number
): void {
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index / sides) * TAU
    const pointX = x + Math.cos(angle) * radius
    const pointY = y + Math.sin(angle) * radius
    if (index === 0) context.moveTo(pointX, pointY)
    else context.lineTo(pointX, pointY)
  }
  context.closePath()
}

function traceRoundedSquare(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  // Inscribed square, so a square and a circle of the same radius read as the
  // same size rather than the square looking bigger.
  const half = radius * Math.SQRT1_2
  const corner = Math.max(1, half * 0.42)
  const left = x - half
  const top = y - half
  const size = half * 2
  if (typeof context.roundRect === 'function') {
    context.roundRect(left, top, size, size, corner)
    return
  }
  context.moveTo(left + corner, top)
  context.arcTo(left + size, top, left + size, top + size, corner)
  context.arcTo(left + size, top + size, left, top + size, corner)
  context.arcTo(left, top + size, left, top, corner)
  context.arcTo(left, top, left + size, top, corner)
  context.closePath()
}

/**
 * A database drum: two ellipse caps joined by straight sides.
 *
 * Proportions are chosen so the corner-to-centre distance is exactly `radius` —
 * hit testing is a single radius comparison, so a shape drawn wider than that
 * would be visible in places it cannot be clicked.
 */
function traceCylinder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  const width = radius * 1.333
  const height = radius * 1.49
  const capHeight = Math.max(1.2, height * 0.24)
  const halfWidth = width / 2
  const top = y - height / 2
  const bottom = y + height / 2
  context.ellipse(x, top + capHeight / 2, halfWidth, capHeight / 2, 0, Math.PI, 0)
  context.lineTo(x + halfWidth, bottom - capHeight / 2)
  context.ellipse(x, bottom - capHeight / 2, halfWidth, capHeight / 2, 0, 0, Math.PI)
  context.lineTo(x - halfWidth, top + capHeight / 2)
  context.closePath()
}

/** A page with the corner turned down, inscribed in `radius` (see above). */
function traceDocument(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  const width = radius * 1.22
  const height = radius * 1.586
  const fold = Math.max(1.5, width * 0.36)
  const left = x - width / 2
  const right = x + width / 2
  const top = y - height / 2
  const bottom = y + height / 2
  context.moveTo(left, top)
  context.lineTo(right - fold, top)
  context.lineTo(right, top + fold)
  context.lineTo(right, bottom)
  context.lineTo(left, bottom)
  context.closePath()
}

function traceStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  const inner = radius * 0.46
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index / 10) * TAU
    const length = index % 2 === 0 ? radius : inner
    const pointX = x + Math.cos(angle) * length
    const pointY = y + Math.sin(angle) * length
    if (index === 0) context.moveTo(pointX, pointY)
    else context.lineTo(pointX, pointY)
  }
  context.closePath()
}

/**
 * SVG path for the same silhouette, in a 0..size box.
 *
 * The legend and the inspector need the identical outline the canvas paints;
 * duplicating the geometry in markup would let the two drift apart.
 */
export function nodeGraphShapePath(shape: NodeGraphShape, size = 16): string {
  const center = size / 2
  const radius = center * 0.92
  const points = (sides: number, rotation: number): string =>
    Array.from({ length: sides }, (_, index) => {
      const angle = rotation + (index / sides) * TAU
      return `${(center + Math.cos(angle) * radius).toFixed(2)},${(center + Math.sin(angle) * radius).toFixed(2)}`
    }).join(' ')
  switch (shape) {
    case 'hexagon':
      return `M${points(6, -Math.PI / 2).replace(/ /g, 'L')}Z`
    case 'diamond':
      return `M${points(4, -Math.PI / 2).replace(/ /g, 'L')}Z`
    case 'star':
      return `M${Array.from({ length: 10 }, (_, index) => {
        const angle = -Math.PI / 2 + (index / 10) * TAU
        const length = index % 2 === 0 ? radius : radius * 0.46
        return `${(center + Math.cos(angle) * length).toFixed(2)},${(center + Math.sin(angle) * length).toFixed(2)}`
      }).join('L')}Z`
    case 'roundedSquare': {
      const half = radius * Math.SQRT1_2
      const left = center - half
      const span = half * 2
      const corner = (half * 0.42).toFixed(2)
      return `M${(left + half * 0.42).toFixed(2)},${left.toFixed(2)}` +
        `h${(span - half * 0.84).toFixed(2)}a${corner},${corner} 0 0 1 ${corner},${corner}` +
        `v${(span - half * 0.84).toFixed(2)}a${corner},${corner} 0 0 1 -${corner},${corner}` +
        `h-${(span - half * 0.84).toFixed(2)}a${corner},${corner} 0 0 1 -${corner},-${corner}` +
        `v-${(span - half * 0.84).toFixed(2)}a${corner},${corner} 0 0 1 ${corner},-${corner}Z`
    }
    case 'cylinder': {
      const halfWidth = radius * 0.667
      const height = radius * 1.49
      const cap = height * 0.24
      const top = center - height / 2
      const bottom = center + height / 2
      return `M${(center - halfWidth).toFixed(2)},${(top + cap / 2).toFixed(2)}` +
        `a${halfWidth.toFixed(2)},${(cap / 2).toFixed(2)} 0 0 1 ${(halfWidth * 2).toFixed(2)},0` +
        `v${(bottom - cap - top).toFixed(2)}` +
        `a${halfWidth.toFixed(2)},${(cap / 2).toFixed(2)} 0 0 1 -${(halfWidth * 2).toFixed(2)},0Z`
    }
    case 'document': {
      const width = radius * 1.22
      const height = radius * 1.586
      const fold = width * 0.36
      const left = center - width / 2
      const right = center + width / 2
      const top = center - height / 2
      const bottom = center + height / 2
      return `M${left.toFixed(2)},${top.toFixed(2)}` +
        `L${(right - fold).toFixed(2)},${top.toFixed(2)}` +
        `L${right.toFixed(2)},${(top + fold).toFixed(2)}` +
        `L${right.toFixed(2)},${bottom.toFixed(2)}` +
        `L${left.toFixed(2)},${bottom.toFixed(2)}Z`
    }
    case 'circle':
      return `M${center},${(center - radius).toFixed(2)}a${radius.toFixed(2)},${radius.toFixed(2)} 0 1 0 0.01,0Z`
  }
}
