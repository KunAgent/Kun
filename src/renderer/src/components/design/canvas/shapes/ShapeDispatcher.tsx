import { memo } from 'react'
import type { CSSProperties } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { hasShadow, shadowFilterId } from './shape-paint'
import { RectShape } from './RectShape'
import { EllipseShape } from './EllipseShape'
import { TextShape } from './TextShape'
import { ImageShape } from './ImageShape'
import { FrameShape } from './FrameShape'
import { GroupShape } from './GroupShape'
import { LinearShape } from './LinearShape'

function ShapeDispatcherInner({
  shapeId,
  objects
}: {
  shapeId: string
  objects: Record<string, CanvasShape>
}) {
  const shape = objects[shapeId]
  if (!shape || !shape.visible) return null

  const transform = `translate(${shape.x}, ${shape.y})${shape.rotation ? ` rotate(${shape.rotation}, ${shape.width / 2}, ${shape.height / 2})` : ''}`

  let content: React.ReactNode
  switch (shape.type) {
    case 'rect':
      content = <RectShape shape={shape} />
      break
    case 'ellipse':
      content = <EllipseShape shape={shape} />
      break
    case 'text':
      content = <TextShape shape={shape} />
      break
    case 'image':
      content = <ImageShape shape={shape} />
      break
    case 'frame':
      content = <FrameShape shape={shape} objects={objects} />
      break
    case 'group':
      content = <GroupShape shape={shape} objects={objects} />
      break
    case 'arrow':
    case 'line':
    case 'draw':
      content = <LinearShape shape={shape} />
      break
    default:
      return null
  }

  // Shadows render through a per-shape SVG filter declared inside the shape
  // content (ShapePaintDefs); blend mode maps straight to CSS mix-blend-mode.
  const style: CSSProperties = { pointerEvents: shape.locked ? 'none' : 'auto' }
  if (shape.blendMode && shape.blendMode !== 'normal') {
    style.mixBlendMode = shape.blendMode
  }
  const filter = hasShadow(shape) ? `url(#${shadowFilterId(shape.id)})` : undefined

  return (
    <g
      id={`shape-${shape.id}`}
      data-canvas-motion-target={shape.id}
      data-canvas-motion-kind="svg"
      opacity={shape.opacity}
    >
      <g transform={transform} filter={filter} style={style}>
        {content}
      </g>
    </g>
  )
}

export const ShapeDispatcher = memo(ShapeDispatcherInner)
