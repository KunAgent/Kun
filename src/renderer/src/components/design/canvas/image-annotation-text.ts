import {
  createAnnotationId,
  type AnnotationFontFamily,
  type AnnotationFontWeight,
  type AnnotationOp
} from './image-annotation-model'

export type ImageAnnotationTextDraft = {
  cssX: number
  cssY: number
  x: number
  y: number
  cssFontSize: number
  cssLineHeight: number
  maxCssWidth: number
}

const TEXT_EDITOR_MIN_WIDTH = 120
const TEXT_EDITOR_MARGIN = 8
export const TEXT_LINE_HEIGHT = 1.2

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function createImageAnnotationTextOp(
  draft: ImageAnnotationTextDraft | null,
  rawValue: string,
  color: string,
  fontSize: number,
  options: {
    id?: string
    opacity?: number
    fontFamily?: AnnotationFontFamily
    fontWeight?: AnnotationFontWeight
  } = {}
): Extract<AnnotationOp, { kind: 'text' }> | null {
  const text = rawValue.trim()
  if (!draft || !text) return null
  return {
    id: options.id ?? createAnnotationId(),
    kind: 'text',
    color,
    opacity: options.opacity ?? 1,
    x: draft.x,
    y: draft.y,
    text,
    fontFamily: options.fontFamily ?? 'sans',
    fontSize,
    fontWeight: options.fontWeight ?? 500
  }
}

export function shouldCommitImageAnnotationTextKey(
  key: string,
  nativeIsComposing: boolean,
  activeComposition: boolean,
  ctrlOrMetaKey = false
): boolean {
  if (nativeIsComposing || activeComposition) return false
  return key === 'Escape' || (key === 'Enter' && ctrlOrMetaKey)
}

export function createImageAnnotationTextDraftAtRenderedPoint(input: {
  canvasWidth: number
  canvasHeight: number
  layoutWidth: number
  layoutHeight: number
  renderedWidth: number
  renderedHeight: number
  renderedX: number
  renderedY: number
  canvasFontSize: number
}): ImageAnnotationTextDraft | null {
  if (
    input.canvasWidth <= 0 || input.canvasHeight <= 0 || input.layoutWidth <= 0 ||
    input.layoutHeight <= 0 || input.renderedWidth <= 0 || input.renderedHeight <= 0
  ) return null

  const renderedX = clamp(input.renderedX, 0, input.renderedWidth)
  const renderedY = clamp(input.renderedY, 0, input.renderedHeight)
  const cssX = renderedX * (input.layoutWidth / input.renderedWidth)
  const cssY = renderedY * (input.layoutHeight / input.renderedHeight)
  const sx = input.canvasWidth / input.layoutWidth
  const sy = input.canvasHeight / input.layoutHeight
  const cssFontSize = Math.max(16, input.canvasFontSize / Math.max(sx, sy))
  return {
    cssX,
    cssY,
    x: renderedX * (input.canvasWidth / input.renderedWidth),
    y: renderedY * (input.canvasHeight / input.renderedHeight),
    cssFontSize,
    cssLineHeight: cssFontSize * TEXT_LINE_HEIGHT,
    maxCssWidth: Math.max(TEXT_EDITOR_MIN_WIDTH, input.layoutWidth - cssX - TEXT_EDITOR_MARGIN)
  }
}

export function createImageAnnotationTextDraftAtCanvasPoint(input: {
  canvasWidth: number
  canvasHeight: number
  layoutWidth: number
  layoutHeight: number
  renderedWidth: number
  renderedHeight: number
  canvasX: number
  canvasY: number
  canvasFontSize: number
}): ImageAnnotationTextDraft | null {
  return createImageAnnotationTextDraftAtRenderedPoint({
    ...input,
    renderedX: input.canvasX * (input.renderedWidth / input.canvasWidth),
    renderedY: input.canvasY * (input.renderedHeight / input.canvasHeight)
  })
}

export function resizeImageAnnotationTextEditor(
  textarea: HTMLTextAreaElement,
  draft: ImageAnnotationTextDraft
): void {
  textarea.style.width = `${TEXT_EDITOR_MIN_WIDTH}px`
  textarea.style.height = `${draft.cssLineHeight}px`
  const nextWidth = clamp(
    Math.ceil(textarea.scrollWidth) + 2,
    Math.min(TEXT_EDITOR_MIN_WIDTH, draft.maxCssWidth),
    draft.maxCssWidth
  )
  textarea.style.width = `${nextWidth}px`
  textarea.style.height = `${Math.max(draft.cssLineHeight, textarea.scrollHeight)}px`
}
