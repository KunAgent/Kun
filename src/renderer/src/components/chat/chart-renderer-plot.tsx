import { useState, type PointerEvent, type ReactElement, type RefObject } from 'react'
import type { RendererChartSpec } from '../../agent/chart-spec-adapter'
import { chartPointLabel } from './chart-renderer-format'
import {
  buildCartesianLayout,
  pieSliceItems,
  type ChartCategoryBand,
  type ChartTooltipItem
} from './chart-renderer-layout'
import { ChartTooltip, type ChartHover } from './chart-renderer-tooltip'

function hoverFromPointer(
  event: PointerEvent<SVGElement>,
  category: string,
  items: ChartTooltipItem[],
  wrapper: HTMLElement | null
): ChartHover {
  const rect = wrapper?.getBoundingClientRect()
  return {
    category,
    items,
    x: rect ? event.clientX - rect.left : event.clientX,
    y: rect ? event.clientY - rect.top : event.clientY
  }
}

function CartesianMarks({
  spec,
  layout,
  hoverCategory,
  wrapper,
  onHover
}: {
  spec: RendererChartSpec
  layout: ReturnType<typeof buildCartesianLayout>
  hoverCategory: string | null
  wrapper: HTMLElement | null
  onHover: (hover: ChartHover | null) => void
}): ReactElement {
  const dim = (category: string): number => hoverCategory && hoverCategory !== category ? 0.42 : 1
  return (
    <>
      {layout.ticks.map((tick) => layout.horizontal ? (
        <g key={`tick-${tick.value}`}>
          <line x1={tick.x} x2={tick.x} y1={layout.pad.top} y2={layout.height - layout.pad.bottom} stroke="var(--ds-border-muted)" />
          <text x={tick.x} y={layout.height - layout.pad.bottom + 16} textAnchor="middle" fill="var(--ds-text-muted)" fontSize="11">{tick.label}</text>
        </g>
      ) : (
        <g key={`tick-${tick.value}`}>
          <line x1={layout.pad.left} x2={layout.width - layout.pad.right} y1={tick.y} y2={tick.y} stroke="var(--ds-border-muted)" />
          <text x={layout.pad.left - 8} y={tick.y + 4} textAnchor="end" fill="var(--ds-text-muted)" fontSize="11">{tick.label}</text>
        </g>
      ))}
      {layout.bars.map((bar) => (
        <rect
          key={`${bar.rowIndex}-${bar.seriesIndex}`}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx="2"
          fill={bar.color}
          opacity={dim(bar.category)}
          pointerEvents="none"
          aria-label={chartPointLabel(bar.category, bar.seriesLabel, bar.formatted)}
        />
      ))}
      {spec.type !== 'bar' ? layout.lines.map((line) => (
        <g key={line.field} opacity={hoverCategory ? 0.95 : 1} pointerEvents="none">
          {spec.type === 'area' && line.area ? <path d={line.area} fill={line.color} opacity="0.16" /> : null}
          <path d={line.path} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {line.points.map((point) => (
            <circle
              key={point.rowIndex}
              cx={point.x}
              cy={point.y}
              r="3.5"
              fill="var(--ds-surface-card)"
              stroke={line.color}
              strokeWidth="2"
              aria-label={chartPointLabel(point.category, line.seriesLabel, point.formatted, true)}
            />
          ))}
        </g>
      )) : null}
      {layout.categoryLabels.map((label) => (
        <text
          key={`label-${label.full}-${label.x}`}
          x={label.x}
          y={label.y}
          textAnchor={label.rotate || layout.horizontal ? (layout.horizontal ? 'end' : 'end') : 'middle'}
          transform={label.rotate ? `rotate(-40 ${label.x} ${label.y})` : undefined}
          fill="var(--ds-text-muted)"
          fontSize="11"
        >
          <title>{label.full}</title>
          {label.text}
        </text>
      ))}
      {layout.bands.map((band) => (
        <CategoryBand
          key={`band-${band.rowIndex}`}
          band={band}
          wrapper={wrapper}
          onHover={onHover}
        />
      ))}
    </>
  )
}

function CategoryBand({
  band,
  wrapper,
  onHover
}: {
  band: ChartCategoryBand
  wrapper: HTMLElement | null
  onHover: (hover: ChartHover | null) => void
}): ReactElement {
  return (
    <rect
      data-chart-category={band.category}
      x={band.x}
      y={band.y}
      width={band.width}
      height={band.height}
      fill="transparent"
      onPointerEnter={(event) => onHover(hoverFromPointer(event, band.category, band.items, wrapper))}
      onPointerMove={(event) => onHover(hoverFromPointer(event, band.category, band.items, wrapper))}
      onPointerLeave={() => onHover(null)}
    />
  )
}

function RadialMarks({
  spec,
  width,
  height,
  wrapper,
  hoverCategory,
  onHover
}: {
  spec: RendererChartSpec
  width: number
  height: number
  wrapper: HTMLElement | null
  hoverCategory: string | null
  onHover: (hover: ChartHover | null) => void
}): ReactElement {
  const slices = pieSliceItems(spec)
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.28
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <g transform={`rotate(-90 ${cx} ${cy})`}>
      {slices.map((slice) => {
        const length = slice.fraction * circumference
        const node = (
          <circle
            key={slice.category}
            data-chart-category={slice.category}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={spec.type === 'donut' ? 42 : 92}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            opacity={hoverCategory && hoverCategory !== slice.category ? 0.42 : 1}
            pointerEvents="stroke"
            aria-label={chartPointLabel(slice.category, spec.series[0]?.label ?? spec.series[0]?.field ?? 'value', slice.formatted)}
            onPointerEnter={(event) => onHover(hoverFromPointer(event, slice.category, [{
              label: slice.category,
              value: slice.formatted,
              color: slice.color
            }], wrapper))}
            onPointerMove={(event) => onHover(hoverFromPointer(event, slice.category, [{
              label: slice.category,
              value: slice.formatted,
              color: slice.color
            }], wrapper))}
            onPointerLeave={() => onHover(null)}
          />
        )
        offset += length
        return node
      })}
    </g>
  )
}

export function ChartSvg({
  spec,
  width,
  svgRef
}: {
  spec: RendererChartSpec
  width: number
  svgRef?: RefObject<SVGSVGElement | null>
}): ReactElement {
  const [hover, setHover] = useState<ChartHover | null>(null)
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  const layout = buildCartesianLayout(spec, width)
  const height = spec.type === 'pie' || spec.type === 'donut' ? CHART_VIEW_HEIGHT : layout.height
  const radial = spec.type === 'pie' || spec.type === 'donut'
  return (
    <div ref={setWrapper} className="relative min-w-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={spec.title}
        data-chart-orientation={layout.horizontal ? 'horizontal' : 'vertical'}
        data-chart-stacked={layout.stacked ? 'true' : 'false'}
      >
        <title>{spec.title}</title>
        <desc>{spec.description ?? `${spec.type} chart with ${spec.data.length} data rows.`}</desc>
        {radial
          ? (
            <RadialMarks
              spec={spec}
              width={width}
              height={height}
              wrapper={wrapper}
              hoverCategory={hover?.category ?? null}
              onHover={setHover}
            />
          )
          : (
            <CartesianMarks
              spec={spec}
              layout={layout}
              hoverCategory={hover?.category ?? null}
              wrapper={wrapper}
              onHover={setHover}
            />
          )}
      </svg>
      <ChartTooltip hover={hover} />
    </div>
  )
}

const CHART_VIEW_HEIGHT = 320
