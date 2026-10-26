import { useRef } from 'react'
import type { HtmlElementMeasureLine } from './html-element-map'

type Rect = { left: number; top: number; width: number; height: number }

type Props = {
  zoom: number
  screenWidth: number
  screenHeight: number
  hoverRect: Rect | null
  hoverParentRect: Rect | null
  hoverLabel: string
  hoverSize: string
  hoverIsSelection: boolean
  selectedRect: Rect | null
  selectedPadding: [number, number, number, number] | null
  measureLines: HtmlElementMeasureLine[]
}

const MEASURE_COLOR = '#d4462f'
const TAG_CLASS = 'absolute whitespace-nowrap rounded-[3px] px-1 text-[10px] font-medium leading-[14px] text-white'
const OUTLINE_MOTION = 'left 70ms ease-out, top 70ms ease-out, width 70ms ease-out, height 70ms ease-out, opacity 120ms ease-out'

/** Tag placement that never leaves the frame: above the box, else inside its top edge. */
export function htmlFramePickTagTop(top: number, tagHeight = 14): number {
  return top >= tagHeight + 2 ? -(tagHeight + 2) : 2
}

function scaled(rect: Rect, zoom: number): { left: number; top: number; width: number; height: number } {
  return {
    left: rect.left * zoom,
    top: rect.top * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom
  }
}

/**
 * Hover, selection and distance guides drawn over a frame's page. The hover
 * outline is one persistent element that glides between targets and fades out
 * on leave, so moving across a page reads as one continuous motion.
 */
export function HtmlFramePickOutline({
  zoom,
  screenWidth,
  screenHeight,
  hoverRect,
  hoverParentRect,
  hoverLabel,
  hoverSize,
  hoverIsSelection,
  selectedRect,
  selectedPadding,
  measureLines
}: Props): React.JSX.Element {
  // Keep the last target so the outline can fade out where it was instead of snapping away.
  const lastHover = useRef<{ rect: Rect; label: string; size: string } | null>(null)
  const lastParent = useRef<Rect | null>(null)
  if (hoverRect) lastHover.current = { rect: hoverRect, label: hoverLabel, size: hoverSize }
  lastParent.current = hoverRect ? hoverParentRect : lastParent.current
  const shown = hoverRect !== null && !hoverIsSelection
  const hover = lastHover.current && scaled(lastHover.current.rect, zoom)
  const parent = lastParent.current && scaled(lastParent.current, zoom)
  const selected = selectedRect && scaled(selectedRect, zoom)
  const hoverWide = hover ? hover.width >= 24 : false
  const sizeBelowFits = hover ? hover.top + hover.height + 18 <= screenHeight : true
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true" data-canvas-pick-outline="true">
      {parent && !hoverIsSelection ? (
        <div
          className="absolute border border-accent/35"
          style={{ ...parent, opacity: shown ? 1 : 0, transition: OUTLINE_MOTION }}
        />
      ) : null}
      {hover && lastHover.current ? (
        <div
          className="absolute border-[1.5px] border-accent bg-accent/[0.05]"
          style={{ ...hover, opacity: shown ? 1 : 0, transition: OUTLINE_MOTION }}
        >
          {hoverWide && lastHover.current.label ? (
            <span
              className={`${TAG_CLASS} left-0 max-w-[220px] truncate bg-accent`}
              style={{ top: htmlFramePickTagTop(hover.top) }}
            >
              {lastHover.current.label}
            </span>
          ) : null}
          {hoverWide && hover.height >= 24 && lastHover.current.size ? (
            <span
              className={`${TAG_CLASS} left-1/2 -translate-x-1/2 bg-accent`}
              style={sizeBelowFits ? { top: hover.height + 3 } : { bottom: 3 }}
            >
              {lastHover.current.size}
            </span>
          ) : null}
        </div>
      ) : null}
      {selected ? (
        <div
          className="absolute border-[1.5px] border-accent shadow-[0_0_0_1px_rgba(255,255,255,0.75)]"
          style={{ ...selected, transition: OUTLINE_MOTION }}
        >
          {selectedPadding ? (
            <>
              <span className="absolute left-0 right-0 top-0 bg-accent/10" style={{ height: selectedPadding[0] * zoom }} />
              <span className="absolute bottom-0 left-0 right-0 bg-accent/10" style={{ height: selectedPadding[2] * zoom }} />
              <span
                className="absolute bg-accent/10"
                style={{
                  left: 0,
                  width: selectedPadding[3] * zoom,
                  top: selectedPadding[0] * zoom,
                  bottom: selectedPadding[2] * zoom
                }}
              />
              <span
                className="absolute bg-accent/10"
                style={{
                  right: 0,
                  width: selectedPadding[1] * zoom,
                  top: selectedPadding[0] * zoom,
                  bottom: selectedPadding[2] * zoom
                }}
              />
            </>
          ) : null}
          {([['-left-[4px]', '-top-[4px]'], ['-right-[4px]', '-top-[4px]'],
            ['-left-[4px]', '-bottom-[4px]'], ['-right-[4px]', '-bottom-[4px]']] as const).map(([x, y]) => (
            <span key={`${x}${y}`} className={`absolute h-[7px] w-[7px] border-[1.5px] border-accent bg-white ${x} ${y}`} />
          ))}
        </div>
      ) : null}
      {measureLines.map((line, index) => {
        const horizontal = line.y1 === line.y2
        const left = Math.min(line.x1, line.x2) * zoom
        const top = Math.min(line.y1, line.y2) * zoom
        const width = Math.abs(line.x2 - line.x1) * zoom
        const height = Math.abs(line.y2 - line.y1) * zoom
        return (
          <div key={index}>
            <span
              className="absolute"
              style={{
                left, top,
                width: horizontal ? width : 1,
                height: horizontal ? 1 : height,
                background: MEASURE_COLOR
              }}
            />
            <span
              className={`${TAG_CLASS} -translate-x-1/2 -translate-y-1/2`}
              style={{
                left: horizontal ? left + width / 2 : left,
                top: horizontal ? top : top + height / 2,
                background: MEASURE_COLOR
              }}
            >
              {line.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
