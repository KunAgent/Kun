import type { CanvasShape } from './canvas-types'

export type PptReviewSlideBundle = {
  slideId: string
  index: number
  title: string
  previewPath?: string
  revision: number
  status: 'ready' | 'failed'
  error?: string
  qaIssues?: PptReviewQaIssue[]
}

export type PptReviewQaIssue = {
  issueId: string
  rule: 'bounds.out_of_slide' | 'text.overflow' | 'objects.overlap' | 'footer.safe_zone' |
    'image.aspect_ratio' | 'text.minimum_font_size'
  severity: 'error' | 'warning' | 'unchecked'
  slideIndex: number
  shapeId: string
  relatedShapeId?: string
  rect: { x: number; y: number; width: number; height: number }
  message: string
  repairHint: string
}

export type PptReviewBundle = {
  workflowId: string
  childId: string
  manifestPath: string
  deckTitle: string
  styleFingerprint: string
  phase: 'awaiting_review' | 'failed_recoverable' | 'completed'
  slides: PptReviewSlideBundle[]
}

const CARD_WIDTH = 480
const CARD_HEIGHT = 270
const CARD_GAP_X = 56
const CARD_GAP_Y = 88
const COLUMNS = 3
const QA_MARKER_SIZE = 22
const QA_RULES = new Set([
  'bounds.out_of_slide', 'text.overflow', 'objects.overlap', 'footer.safe_zone',
  'image.aspect_ratio', 'text.minimum_font_size'
])

export function isPptReviewBundle(value: unknown): value is PptReviewBundle {
  if (!isRecord(value) || !Array.isArray(value.slides)) return false
  if (
    !nonEmptyString(value.workflowId) ||
    !nonEmptyString(value.childId) ||
    !workspaceRelativePath(value.manifestPath) ||
    !nonEmptyString(value.deckTitle) ||
    !nonEmptyString(value.styleFingerprint) ||
    (value.phase !== 'awaiting_review' && value.phase !== 'failed_recoverable' && value.phase !== 'completed') ||
    value.slides.length === 0
  ) return false
  const slideIds = new Set<string>()
  const indexes = new Set<number>()
  const issueIds = new Set<string>()
  for (const slide of value.slides) {
    if (
      !isRecord(slide) ||
      !nonEmptyString(slide.slideId) ||
      !Number.isInteger(slide.index) ||
      Number(slide.index) < 0 ||
      !nonEmptyString(slide.title) ||
      !Number.isInteger(slide.revision) ||
      Number(slide.revision) < 0 ||
      (slide.status !== 'ready' && slide.status !== 'failed') ||
      (slide.status === 'ready' && !workspaceRelativePath(slide.previewPath)) ||
      slideIds.has(slide.slideId) ||
      indexes.has(Number(slide.index))
    ) return false
    if (slide.qaIssues !== undefined) {
      if (!Array.isArray(slide.qaIssues)) return false
      for (const issue of slide.qaIssues) {
        if (!isPptReviewQaIssue(issue, Number(slide.index)) || issueIds.has(issue.issueId)) return false
        issueIds.add(issue.issueId)
      }
    }
    slideIds.add(slide.slideId)
    indexes.add(Number(slide.index))
  }
  for (let index = 0; index < value.slides.length; index += 1) {
    if (!indexes.has(index)) return false
  }
  if (value.phase === 'completed' && value.slides.some((slide) => !isRecord(slide) || !Array.isArray(slide.qaIssues))) {
    return false
  }
  return true
}

export function pptReviewBoardOps(
  bundle: PptReviewBundle,
  shapes: readonly CanvasShape[] = [],
  parentThreadId?: string
): unknown[] {
  const byName = new Map(shapes.map((shape) => [shape.name, shape]))
  const expectedQaMarkers = new Set(bundle.slides.flatMap((slide) =>
    (slide.qaIssues ?? []).filter((issue) => issue.severity !== 'unchecked').flatMap((issue) => [
      `${reviewKey(bundle.workflowId, slide.slideId)}:qa:${issue.issueId}:badge`,
      `${reviewKey(bundle.workflowId, slide.slideId)}:qa:${issue.issueId}:number`
    ])))
  const qaCleanup = shapes
    .filter((shape) => shape.pptReviewRef?.workflowId === bundle.workflowId &&
      shape.pptReviewRef.childId === bundle.childId && shape.pptReviewRef.role === 'annotation' &&
      shape.name.includes(':qa:') && !expectedQaMarkers.has(shape.name))
    .map((shape) => ({ op: 'delete', id: shape.id }))
  const slideOps = bundle.slides.flatMap((slide): unknown[] => {
    const col = slide.index % COLUMNS
    const row = Math.floor(slide.index / COLUMNS)
    const x = col * (CARD_WIDTH + CARD_GAP_X)
    const y = row * (CARD_HEIGHT + CARD_GAP_Y)
    const key = reviewKey(bundle.workflowId, slide.slideId)
    const label = `P${slide.index + 1} · ${slide.title}`
    const status = reviewStatus(slide)
    const frame = byName.get(`${key}:frame`)
    const preview = byName.get(`${key}:preview`)
    const title = byName.get(`${key}:title`)
    const statusLabel = byName.get(`${key}:status`)
    const frameShape = {
      type: 'frame',
      name: `${key}:frame`,
      x,
      y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT + 48,
      fills: [{ type: 'solid', color: '#111827', opacity: 1 }],
      cornerRadius: 12,
      clipContent: true,
      pptReviewRef: reviewRef(bundle, slide, 'slide-frame', parentThreadId)
    }
    const previewShape = {
      type: 'image',
      name: `${key}:preview`,
      x: x + 8,
      y: y + 8,
      width: CARD_WIDTH - 16,
      height: CARD_HEIGHT - 16,
      imageUrl: slide.previewPath ?? '',
      opacity: slide.status === 'failed' ? 0.2 : 1,
      pptReviewRef: reviewRef(bundle, slide, 'preview-image', parentThreadId)
    }
    const titleShape = {
      type: 'text',
      name: `${key}:title`,
      x: x + 12,
      y: y + CARD_HEIGHT + 2,
      width: CARD_WIDTH - 24,
      height: 20,
      textContent: label,
      fontSize: 15,
      fontWeight: 700,
      fontColor: '#F9FAFB'
    }
    const statusShape = {
      type: 'text',
      name: `${key}:status`,
      x: x + 12,
      y: y + CARD_HEIGHT + 23,
      width: CARD_WIDTH - 24,
      height: 18,
      textContent: status,
      fontSize: 12,
      fontColor: reviewStatusColor(slide)
    }
    const framePatch = shapePatch(frameShape)
    const previewPatch = shapePatch(previewShape)
    const titlePatch = shapePatch(titleShape)
    const statusPatch = shapePatch(statusShape)
    return [
      frame
        ? { op: 'update', id: frame.id, patch: framePatch }
        : {
        op: 'add',
        shape: frameShape
      },
      preview
        ? { op: 'update', id: preview.id, patch: previewPatch }
        : {
        op: 'add',
        shape: previewShape
      },
      title
        ? { op: 'update', id: title.id, patch: titlePatch }
        : {
        op: 'add',
        shape: titleShape
      },
      statusLabel
        ? { op: 'update', id: statusLabel.id, patch: statusPatch }
        : {
        op: 'add',
        shape: statusShape
      },
      ...qaMarkerOps(bundle, slide, x + 8, y + 8, byName, parentThreadId)
    ]
  })
  return [...qaCleanup, ...slideOps]
}

export type SerializedPptReviewContext = {
  workflowId: string
  childId: string
  slides: Array<{ slideId: string; revision: number; imagePath?: string; annotations?: string[] }>
}

export function serializeActivePptReviewContexts(
  shapes: readonly CanvasShape[],
  parentThreadId?: string
): SerializedPptReviewContext[] {
  const workflows = new Map<string, {
    childId: string
    invalidChild: boolean
    slides: Map<string, { frame?: CanvasShape; preview?: CanvasShape }>
  }>()
  for (const shape of shapes) {
    const ref = shape.pptReviewRef
    if (!ref || ref.role === 'annotation' || (parentThreadId && ref.parentThreadId !== parentThreadId)) continue
    const workflow = workflows.get(ref.workflowId) ?? {
      childId: ref.childId,
      invalidChild: false,
      slides: new Map()
    }
    if (workflow.childId !== ref.childId) workflow.invalidChild = true
    const slide = workflow.slides.get(ref.slideId) ?? {}
    if (ref.role === 'slide-frame') slide.frame = shape
    if (ref.role === 'preview-image') slide.preview = shape
    workflow.slides.set(ref.slideId, slide)
    workflows.set(ref.workflowId, workflow)
  }
  return [...workflows.entries()].flatMap(([workflowId, workflow]) => {
    if (workflow.invalidChild) return []
    const slides = [...workflow.slides.entries()].flatMap(([slideId, slide]) => {
      if (!slide.frame?.pptReviewRef || !slide.preview?.pptReviewRef ||
        slide.frame.pptReviewRef.childId !== slide.preview.pptReviewRef.childId ||
        slide.frame.pptReviewRef.revision !== slide.preview.pptReviewRef.revision ||
        slide.preview.type !== 'image' || !slide.preview.imageUrl?.trim()) return []
      const revision = slide.preview?.pptReviewRef?.revision ?? slide.frame?.pptReviewRef?.revision ?? 0
      const annotations = slide.frame
        ? shapes
            .filter((shape) => shape.type === 'text' &&
              shape.pptReviewRef?.role !== 'annotation' &&
              !shape.name.endsWith(':title') &&
              !shape.name.endsWith(':status') &&
              shape.x >= slide.frame!.x &&
              shape.y >= slide.frame!.y &&
              shape.x + shape.width <= slide.frame!.x + slide.frame!.width &&
              shape.y + shape.height <= slide.frame!.y + slide.frame!.height)
            .map((shape) => shape.textContent?.trim() ?? '')
            .filter(Boolean)
        : []
      return [{
        slideId,
        revision,
        ...(slide.preview?.type === 'image' && slide.preview.imageUrl ? { imagePath: slide.preview.imageUrl } : {}),
        ...(annotations.length ? { annotations } : {})
      }]
    })
    return slides.length === workflow.slides.size && slides.length > 0
      ? [{ workflowId, childId: workflow.childId, slides }]
      : []
  })
}

export function serializePptReviewContext(
  bundle: PptReviewBundle,
  shapes: readonly CanvasShape[],
  userFeedback = ''
): { workflowId: string; slides: Array<{ slideId: string; revision: number; feedback?: string; annotations?: string[]; imagePath?: string }> } {
  const byName = new Map(shapes.map((shape) => [shape.name, shape]))
  return {
    workflowId: bundle.workflowId,
    slides: bundle.slides.map((slide) => {
      const prefix = `${reviewKey(bundle.workflowId, slide.slideId)}:`
      const annotations = shapes
        .filter((shape) => shape.name.startsWith(prefix) && shape.type === 'text' &&
          shape.pptReviewRef?.role !== 'annotation' && !shape.name.endsWith(':title') && !shape.name.endsWith(':status'))
        .map((shape) => shape.textContent?.trim() ?? '')
        .filter(Boolean)
      const image = byName.get(`${prefix}preview`)
      return {
        slideId: slide.slideId,
        revision: slide.revision,
        ...(userFeedback.trim() ? { feedback: userFeedback.trim() } : {}),
        ...(annotations.length ? { annotations } : {}),
        ...(image?.type === 'image' && image.imageUrl ? { imagePath: image.imageUrl } : {})
      }
    })
  }
}

function reviewRef(
  bundle: PptReviewBundle,
  slide: PptReviewSlideBundle,
  role: 'slide-frame' | 'preview-image' | 'annotation',
  parentThreadId?: string
): NonNullable<CanvasShape['pptReviewRef']> {
  return {
    workflowId: bundle.workflowId,
    childId: bundle.childId,
    slideId: slide.slideId,
    revision: slide.revision,
    ...(parentThreadId ? { parentThreadId } : {}),
    role
  }
}

function qaMarkerOps(
  bundle: PptReviewBundle,
  slide: PptReviewSlideBundle,
  previewX: number,
  previewY: number,
  byName: ReadonlyMap<string, CanvasShape>,
  parentThreadId?: string
): unknown[] {
  return (slide.qaIssues ?? []).filter((issue) => issue.severity !== 'unchecked')
    .flatMap((issue, index) => {
      const key = `${reviewKey(bundle.workflowId, slide.slideId)}:qa:${issue.issueId}`
      const color = issue.severity === 'error' ? '#DC2626' : '#D97706'
      const centerX = previewX + (issue.rect.x + issue.rect.width / 2) * (CARD_WIDTH - 16)
      const centerY = previewY + (issue.rect.y + issue.rect.height / 2) * (CARD_HEIGHT - 16)
      const x = clamp(centerX - QA_MARKER_SIZE / 2, previewX, previewX + CARD_WIDTH - 16 - QA_MARKER_SIZE)
      const y = clamp(centerY - QA_MARKER_SIZE / 2, previewY, previewY + CARD_HEIGHT - 16 - QA_MARKER_SIZE)
      const ref = reviewRef(bundle, slide, 'annotation', parentThreadId)
      const note = {
        kind: 'critique' as const,
        body: `${issue.message}\nFix: ${issue.repairHint}`,
        source: 'critic' as const,
        severity: issue.severity
      }
      const badge = {
        type: 'ellipse', name: `${key}:badge`, x, y, width: QA_MARKER_SIZE, height: QA_MARKER_SIZE,
        fills: [{ type: 'solid', color, opacity: 1 }],
        strokes: [{ color: '#FFFFFF', width: 2, opacity: 1, position: 'inside' }],
        pptReviewRef: ref, agentNote: note
      }
      const number = {
        type: 'text', name: `${key}:number`, x, y: y + 2, width: QA_MARKER_SIZE, height: QA_MARKER_SIZE - 2,
        textContent: String(index + 1), fontSize: 11, fontWeight: 700, textAlign: 'center' as const,
        lineHeight: 1, fontColor: '#FFFFFF', pptReviewRef: ref, agentNote: note
      }
      const badgeShape = byName.get(badge.name)
      const numberShape = byName.get(number.name)
      return [
        badgeShape ? { op: 'update', id: badgeShape.id, patch: shapePatch(badge) } : { op: 'add', shape: badge },
        numberShape ? { op: 'update', id: numberShape.id, patch: shapePatch(number) } : { op: 'add', shape: number }
      ]
    })
}

function reviewStatus(slide: PptReviewSlideBundle): string {
  const base = slide.status === 'failed'
    ? `Preview failed${slide.error ? `: ${slide.error}` : ''}`
    : `Revision ${slide.revision}`
  if (slide.qaIssues === undefined) return `${base} · visual review`
  const errors = slide.qaIssues.filter((issue) => issue.severity === 'error').length
  const warnings = slide.qaIssues.filter((issue) => issue.severity === 'warning').length
  const unchecked = slide.qaIssues.filter((issue) => issue.severity === 'unchecked').length
  return `${base} · QA ${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${unchecked} unchecked`
}

function reviewStatusColor(slide: PptReviewSlideBundle): string {
  if (slide.status === 'failed' || slide.qaIssues?.some((issue) => issue.severity === 'error')) return '#FCA5A5'
  if (slide.qaIssues?.some((issue) => issue.severity === 'warning')) return '#FBBF24'
  return '#9CA3AF'
}

function isPptReviewQaIssue(value: unknown, slideIndex: number): value is PptReviewQaIssue {
  if (!isRecord(value) || typeof value.issueId !== 'string' || !/^pptqa_[a-f0-9]{24}$/.test(value.issueId) ||
    typeof value.rule !== 'string' || !QA_RULES.has(value.rule) ||
    (value.severity !== 'error' && value.severity !== 'warning' && value.severity !== 'unchecked') ||
    value.slideIndex !== slideIndex || !nonEmptyString(value.shapeId) ||
    (value.relatedShapeId !== undefined && !nonEmptyString(value.relatedShapeId)) ||
    !nonEmptyString(value.message) || !nonEmptyString(value.repairHint) || !isRecord(value.rect)) return false
  const { x, y, width, height } = value.rect
  return [x, y, width, height].every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1) &&
    Number(x) + Number(width) <= 1.000_001 && Number(y) + Number(height) <= 1.000_001
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function reviewKey(workflowId: string, slideId: string): string {
  return `ppt-review:${workflowId}:${slideId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function workspaceRelativePath(value: unknown): value is string {
  if (!nonEmptyString(value)) return false
  const path = value.replaceAll('\\', '/')
  return !path.startsWith('/') &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) &&
    !path.split('/').includes('..')
}

function shapePatch<T extends { type: string }>(shape: T): Omit<T, 'type'> {
  const { type, ...patch } = shape
  void type
  return patch
}
