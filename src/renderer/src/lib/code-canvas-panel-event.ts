export const CODE_CANVAS_OPEN_REQUEST_EVENT = 'kun:code-canvas-open-request'
export const CODE_CANVAS_FOCUS_REQUEST_EVENT = 'kun:code-canvas-focus-request'

export type PptCanvasOpenReason = 'ppt-direction' | 'ppt-review'

export type CodeCanvasOpenRequestDetail = {
  target: 'code'
  reason?: 'manual' | PptCanvasOpenReason
  blockId?: string
  threadId?: string
  workflowId?: string
  childId?: string
}

export type WorkCanvasOpenRequestDetail = {
  target: 'write'
  reason: PptCanvasOpenReason
  blockId: string
  workspaceRoot: string
  threadId: string
  workflowId: string
  childId: string
  /** Canonical title for the whiteboard this workflow creates (payload.title > deckTitle > legacy fallback). */
  title: string
  sourcePath?: string
  /** Direction/review bundles commit this state from the canvas after persistence. */
  pptProjectionRequired?: boolean
  pptState?: {
    phase: 'directions' | 'review' | 'complete'
    revision: number
    outputPath?: string
  }
}

export type CanvasOpenRequestDetail = CodeCanvasOpenRequestDetail | WorkCanvasOpenRequestDetail

export function requestCanvasOpen(detail: CanvasOpenRequestDetail): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent<CanvasOpenRequestDetail>(CODE_CANVAS_OPEN_REQUEST_EVENT, { detail }))
}

export function requestCodeCanvasPanelOpen(
  detail: Omit<CodeCanvasOpenRequestDetail, 'target'> = {}
): void {
  requestCanvasOpen({ target: 'code', ...detail })
}

/**
 * Request the right whiteboard to expand to a focused, full-width presentation.
 * Presentation-only: the host widens the panel and never touches the bound
 * document, canvas state, or task/profile selection.
 */
export function requestCodeCanvasPanelFocus(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(CODE_CANVAS_FOCUS_REQUEST_EVENT))
}

export function requestWorkCanvasOpen(
  detail: Omit<WorkCanvasOpenRequestDetail, 'target'>
): void {
  requestCanvasOpen({ target: 'write', ...detail })
}

export function canvasOpenRequestDetail(event: Event): CanvasOpenRequestDetail | null {
  const detail = (event as CustomEvent<unknown>).detail
  if (!detail || typeof detail !== 'object') return null
  const candidate = detail as Partial<CanvasOpenRequestDetail>
  return candidate.target === 'code' || candidate.target === 'write'
    ? candidate as CanvasOpenRequestDetail
    : null
}
