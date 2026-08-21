export type AnnotationTool = 'select' | 'pen' | 'arrow' | 'rect' | 'text'
export type DrawingAnnotationTool = Exclude<AnnotationTool, 'select'>
export type AnnotationDash = 'solid' | 'dashed' | 'dotted'
export type AnnotationArrowhead = 'arrow' | 'triangle' | 'none'
export type AnnotationFontFamily = 'sans' | 'serif' | 'mono'
export type AnnotationFontWeight = 400 | 500 | 700

export type AnnotationPoint = { x: number; y: number }

type AnnotationBase = {
  id: string
  color: string
  opacity: number
}

export type LineAnnotationStyle = {
  color: string
  opacity: number
  width: number
  dash: AnnotationDash
}

export type TextAnnotationStyle = {
  color: string
  opacity: number
  fontFamily: AnnotationFontFamily
  fontSize: number
  fontWeight: AnnotationFontWeight
}

export type ArrowAnnotationStyle = LineAnnotationStyle & {
  arrowhead: AnnotationArrowhead
}

export type AnnotationOp =
  | (AnnotationBase & { kind: 'pen'; width: number; dash: AnnotationDash; points: AnnotationPoint[] })
  | (AnnotationBase & {
      kind: 'arrow'
      width: number
      dash: AnnotationDash
      arrowhead: AnnotationArrowhead
      from: AnnotationPoint
      to: AnnotationPoint
    })
  | (AnnotationBase & {
      kind: 'rect'
      width: number
      dash: AnnotationDash
      from: AnnotationPoint
      to: AnnotationPoint
    })
  | (AnnotationBase & {
      kind: 'text'
      x: number
      y: number
      text: string
      fontFamily: AnnotationFontFamily
      fontSize: number
      fontWeight: AnnotationFontWeight
    })

export type ToolStyleMap = {
  pen: LineAnnotationStyle
  arrow: ArrowAnnotationStyle
  rect: LineAnnotationStyle
  text: TextAnnotationStyle
}

export type AnnotationStylePatch = {
  color?: string
  opacity?: number
  width?: number
  dash?: AnnotationDash
  arrowhead?: AnnotationArrowhead
  fontFamily?: AnnotationFontFamily
  fontSize?: number
  fontWeight?: AnnotationFontWeight
}

export const ANNOTATION_FONT_STACKS: Record<AnnotationFontFamily, string> = {
  sans: 'Inter, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", ui-monospace, monospace'
}

export const ANNOTATION_SWATCHES = [
  { name: '红', value: '#ef4444' },
  { name: '橙', value: '#f59e0b' },
  { name: '绿', value: '#22c55e' },
  { name: '蓝', value: '#3b82f6' },
  { name: '黑', value: '#111827' },
  { name: '白', value: '#ffffff' }
] as const

export function clampAnnotationValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function createDefaultToolStyles(canvasLongest: number): ToolStyleMap {
  const edge = Math.max(1, canvasLongest || 800)
  const width = clampAnnotationValue(Math.round(edge / 320), 2, 6)
  const fontSize = clampAnnotationValue(Math.round(edge / 24), 18, 64)
  const line = { color: '#ef4444', opacity: 1, width, dash: 'solid' as const }
  return {
    pen: { ...line },
    arrow: { ...line, arrowhead: 'arrow' },
    rect: { ...line },
    text: {
      color: '#ef4444',
      opacity: 1,
      fontFamily: 'sans',
      fontSize,
      fontWeight: 500
    }
  }
}

let annotationSequence = 0

export function createAnnotationId(): string {
  annotationSequence += 1
  return `annotation-${Date.now().toString(36)}-${annotationSequence.toString(36)}`
}

export function styleForAnnotation(op: AnnotationOp): AnnotationStylePatch {
  if (op.kind === 'text') {
    return {
      color: op.color,
      opacity: op.opacity,
      fontFamily: op.fontFamily,
      fontSize: op.fontSize,
      fontWeight: op.fontWeight
    }
  }
  return {
    color: op.color,
    opacity: op.opacity,
    width: op.width,
    dash: op.dash,
    ...(op.kind === 'arrow' ? { arrowhead: op.arrowhead } : {})
  }
}

export function patchAnnotationStyle(op: AnnotationOp, patch: AnnotationStylePatch): AnnotationOp {
  if (op.kind === 'text') {
    return {
      ...op,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.opacity !== undefined ? { opacity: clampAnnotationValue(patch.opacity, 0.1, 1) } : {}),
      ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
      ...(patch.fontSize !== undefined
        ? { fontSize: clampAnnotationValue(Math.round(patch.fontSize), 16, 128) }
        : {}),
      ...(patch.fontWeight !== undefined ? { fontWeight: patch.fontWeight } : {})
    }
  }
  return {
    ...op,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.opacity !== undefined ? { opacity: clampAnnotationValue(patch.opacity, 0.1, 1) } : {}),
    ...(patch.width !== undefined
      ? { width: clampAnnotationValue(Math.round(patch.width * 10) / 10, 1, 24) }
      : {}),
    ...(patch.dash !== undefined ? { dash: patch.dash } : {}),
    ...(op.kind === 'arrow' && patch.arrowhead !== undefined ? { arrowhead: patch.arrowhead } : {})
  }
}

export function patchToolStyle<T extends DrawingAnnotationTool>(
  styles: ToolStyleMap,
  tool: T,
  patch: AnnotationStylePatch
): ToolStyleMap {
  const current = styles[tool]
  if (tool === 'text') {
    const text = current as TextAnnotationStyle
    return {
      ...styles,
      text: {
        ...text,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.opacity !== undefined ? { opacity: clampAnnotationValue(patch.opacity, 0.1, 1) } : {}),
        ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
        ...(patch.fontSize !== undefined
          ? { fontSize: clampAnnotationValue(Math.round(patch.fontSize), 16, 128) }
          : {}),
        ...(patch.fontWeight !== undefined ? { fontWeight: patch.fontWeight } : {})
      }
    }
  }
  const line = current as LineAnnotationStyle | ArrowAnnotationStyle
  const next = {
    ...line,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.opacity !== undefined ? { opacity: clampAnnotationValue(patch.opacity, 0.1, 1) } : {}),
    ...(patch.width !== undefined
      ? { width: clampAnnotationValue(Math.round(patch.width * 10) / 10, 1, 24) }
      : {}),
    ...(patch.dash !== undefined ? { dash: patch.dash } : {})
  }
  if (tool === 'arrow') {
    return {
      ...styles,
      arrow: {
        ...(next as ArrowAnnotationStyle),
        ...(patch.arrowhead !== undefined ? { arrowhead: patch.arrowhead } : {})
      }
    }
  }
  return { ...styles, [tool]: next } as ToolStyleMap
}

export function imageAnnotationTextNotes(ops: readonly AnnotationOp[]): string[] {
  return ops.filter((op): op is Extract<AnnotationOp, { kind: 'text' }> => op.kind === 'text').map((op) => op.text)
}
