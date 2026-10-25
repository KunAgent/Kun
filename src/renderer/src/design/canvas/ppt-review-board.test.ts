import { describe, expect, it } from 'vitest'
import { createDefaultShape, type CanvasShape } from './canvas-types'
import { ShapeOpSchema } from './shape-ops'
import {
  isPptReviewBundle,
  pptReviewBoardOps,
  serializeActivePptReviewContexts,
  type PptReviewBundle,
  type PptReviewQaIssue
} from './ppt-review-board'

const bundle: PptReviewBundle = {
  workflowId: 'ppt_workflow',
  childId: 'child_ppt',
  manifestPath: 'deck/.kun-ppt-review/manifest.json',
  deckTitle: 'Review deck',
  styleFingerprint: 'style-1',
  phase: 'awaiting_review',
  slides: [{
    slideId: 'slide-1',
    index: 0,
    title: 'Opening',
    previewPath: '.kun/images/opening.png',
    revision: 1,
    status: 'ready'
  }]
}

function shape(type: CanvasShape['type'], name: string, id: string): CanvasShape {
  return { ...createDefaultShape(type, 0, 0), id, name }
}

function qaIssue(
  severity: PptReviewQaIssue['severity'],
  issueId: string,
  rect = { x: 0.25, y: 0.2, width: 0.1, height: 0.2 }
): PptReviewQaIssue {
  return {
    issueId,
    rule: 'objects.overlap',
    severity,
    slideIndex: 0,
    shapeId: `shape-${severity}`,
    rect,
    message: `${severity} geometry issue`,
    repairHint: `Repair the ${severity} issue`
  }
}

function materializeAdds(ops: unknown[]): CanvasShape[] {
  return ops.flatMap((value, index) => {
    const op = value as { op: string; shape?: Partial<CanvasShape> & Pick<CanvasShape, 'type' | 'name'> }
    if (op.op !== 'add' || !op.shape) return []
    return [{ ...createDefaultShape(op.shape.type, 0, 0), ...op.shape, id: `added-${index}` } as CanvasShape]
  })
}

describe('PPT review board', () => {
  it('adds stable review cards and updates them in place for a new revision', () => {
    const created = pptReviewBoardOps(bundle, [], 'thread-a') as Array<{ op: string; shape?: Partial<CanvasShape> }>
    expect(created).toHaveLength(4)
    const frameSpec = created[0].shape!
    const previewSpec = created[1].shape!
    const frame = { ...shape('frame', frameSpec.name!, 'frame-1'), ...frameSpec } as CanvasShape
    const preview = { ...shape('image', previewSpec.name!, 'preview-1'), ...previewSpec } as CanvasShape
    const title = shape('text', 'ppt-review:ppt_workflow:slide-1:title', 'title-1')
    const status = shape('text', 'ppt-review:ppt_workflow:slide-1:status', 'status-1')

    const revisedBundle = {
      ...bundle,
      slides: [{ ...bundle.slides[0], previewPath: '.kun/images/opening-v2.png', revision: 2 }]
    }
    const revised = pptReviewBoardOps(revisedBundle, [frame, preview, title, status], 'thread-a') as Array<{
      op: string
      id?: string
      patch?: Partial<CanvasShape>
    }>
    expect(revised.every((op) => op.op === 'update')).toBe(true)
    expect(revised.map((op) => op.id)).toEqual(['frame-1', 'preview-1', 'title-1', 'status-1'])
    expect(revised[1].patch).toMatchObject({
      imageUrl: '.kun/images/opening-v2.png',
      pptReviewRef: { workflowId: 'ppt_workflow', childId: 'child_ppt', slideId: 'slide-1', revision: 2 }
    })
  })

  it('repairs only missing card layers instead of duplicating an existing frame', () => {
    const frame = {
      ...shape('frame', 'ppt-review:ppt_workflow:slide-1:frame', 'frame-1'),
      pptReviewRef: { workflowId: 'ppt_workflow', childId: 'child_ppt', slideId: 'slide-1', revision: 1, role: 'slide-frame' as const }
    }
    const ops = pptReviewBoardOps(bundle, [frame], 'thread-a') as Array<{ op: string; id?: string; shape?: Partial<CanvasShape> }>
    expect(ops).toHaveLength(4)
    expect(ops[0]).toMatchObject({ op: 'update', id: 'frame-1' })
    expect(ops.slice(1).every((op) => op.op === 'add')).toBe(true)
    expect(ops.filter((op) => op.op === 'add' && op.shape?.name?.endsWith(':frame'))).toHaveLength(0)
  })

  it('maps actionable QA issues onto numbered red and amber preview markers', () => {
    const qaBundle: PptReviewBundle = {
      ...bundle,
      phase: 'failed_recoverable',
      slides: [{
        ...bundle.slides[0],
        qaIssues: [
          qaIssue('error', 'pptqa_aaaaaaaaaaaaaaaaaaaaaaaa'),
          qaIssue('warning', 'pptqa_bbbbbbbbbbbbbbbbbbbbbbbb', { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }),
          qaIssue('unchecked', 'pptqa_cccccccccccccccccccccccc')
        ]
      }]
    }
    expect(isPptReviewBundle(qaBundle)).toBe(true)
    expect(isPptReviewBundle({ ...qaBundle, phase: 'completed' })).toBe(true)
    expect(isPptReviewBundle({ ...bundle, phase: 'completed' })).toBe(false)
    const ops = pptReviewBoardOps(qaBundle, [], 'thread-a')
    expect(ops.every((op) => ShapeOpSchema.safeParse(op).success)).toBe(true)
    const markers = materializeAdds(ops).filter((item) => item.pptReviewRef?.role === 'annotation')
    const badges = markers.filter((item) => item.type === 'ellipse')
    const numbers = markers.filter((item) => item.type === 'text')
    expect(badges).toHaveLength(2)
    expect(numbers.map((item) => item.textContent)).toEqual(['1', '2'])
    expect(badges.map((item) => item.fills[0])).toEqual([
      { type: 'solid', color: '#DC2626', opacity: 1 },
      { type: 'solid', color: '#D97706', opacity: 1 }
    ])
    expect(badges[0].x).toBeCloseTo(136.2)
    expect(badges[0].y).toBeCloseTo(73.2)
    expect(markers.some((item) => item.name.includes('cccccccc'))).toBe(false)
    expect(badges[0].agentNote?.body).toContain('Fix: Repair the error issue')
    const status = materializeAdds(ops).find((item) => item.name.endsWith(':status'))
    expect(status?.textContent).toBe('Revision 1 · QA 1 error · 1 warning · 1 unchecked')
  })

  it('clears stale QA markers and resets counts when qaIssues becomes empty', () => {
    const withIssues: PptReviewBundle = {
      ...bundle,
      slides: [{
        ...bundle.slides[0],
        qaIssues: [qaIssue('error', 'pptqa_aaaaaaaaaaaaaaaaaaaaaaaa')]
      }]
    }
    const existing = materializeAdds(pptReviewBoardOps(withIssues, [], 'thread-a'))
    const cleared: PptReviewBundle = {
      ...bundle,
      slides: [{ ...bundle.slides[0], qaIssues: [] }]
    }
    const ops = pptReviewBoardOps(cleared, existing, 'thread-a') as Array<{
      op: string; id?: string; patch?: Partial<CanvasShape>
    }>
    const markerIds = new Set(existing.filter((item) => item.name.includes(':qa:')).map((item) => item.id))
    expect(ops.filter((op) => op.op === 'delete').map((op) => op.id)).toEqual([...markerIds])
    expect(ops.find((op) => op.op === 'update' && op.id === 'added-3')?.patch?.textContent)
      .toBe('Revision 1 · QA 0 errors · 0 warnings · 0 unchecked')
  })

  it('labels where slide images came from, including built-in SVG previews', () => {
    const withAssets: PptReviewBundle = {
      ...bundle,
      slides: [{
        ...bundle.slides[0],
        previewPath: 'deck/.kun-ppt-review/previews/p01-r1.svg',
        assets: [
          { path: 'deck/media/line.png', origin: 'user' },
          { path: 'deck/media/scene.png', origin: 'generated' }
        ]
      }]
    }
    expect(isPptReviewBundle(withAssets)).toBe(true)
    const added = materializeAdds(pptReviewBoardOps(withAssets, [], 'thread-a'))
    expect(added.find((item) => item.name.endsWith(':preview'))?.imageUrl).toBe('deck/.kun-ppt-review/previews/p01-r1.svg')
    expect(added.find((item) => item.name.endsWith(':status'))?.textContent)
      .toBe('Revision 1 · images: 1 yours, 1 generated · visual review')
  })

  it('outlines image slots as annotations and removes slots a revision dropped', () => {
    const withSlots: PptReviewBundle = {
      ...bundle,
      slides: [{
        ...bundle.slides[0],
        assets: [
          { path: 'deck/media/line.png', origin: 'user', rect: { x: 0.5, y: 0.1, width: 0.4, height: 0.8 } },
          { path: 'deck/media/far.png', origin: 'generated', rect: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } }
        ]
      }]
    }
    const ops = pptReviewBoardOps(withSlots, [], 'thread-a')
    for (const op of ops) expect(ShapeOpSchema.safeParse(op).success).toBe(true)
    const added = materializeAdds(ops)
    const slots = added.filter((item) => item.name.includes(':slot:'))
    expect(slots.map((item) => item.name.split(':slot:')[1])).toEqual(['0:frame', '0:tag', '0:label'])
    const frame = slots[0]
    expect(frame).toMatchObject({ x: 8 + 0.5 * 464, y: 8 + 0.1 * 254, width: 0.4 * 464, strokes: [{ dash: 'dashed' }] })
    expect(slots.every((item) => item.pptReviewRef?.role === 'annotation')).toBe(true)
    expect(serializeActivePptReviewContexts(added, 'thread-a')[0]?.slides[0]).not.toHaveProperty('annotations')

    const cleared = pptReviewBoardOps({ ...bundle, slides: [{ ...bundle.slides[0], revision: 2 }] }, added, 'thread-a') as Array<{ op: string; id?: string }>
    expect(cleared.filter((op) => op.op === 'delete').map((op) => op.id).sort())
      .toEqual(slots.map((item) => item.id).sort())
  })

  it('removes the cards of pages a later review no longer has', () => {
    const twoSlides: PptReviewBundle = {
      ...bundle,
      slides: [
        bundle.slides[0],
        { ...bundle.slides[0], slideId: 'slide-2', index: 1, title: 'Risks', previewPath: '.kun/images/risks.png' }
      ]
    }
    const added = materializeAdds(pptReviewBoardOps(twoSlides, [], 'thread-a'))
    const removed = added.filter((item) => item.name.startsWith('ppt-review:ppt_workflow:slide-2:'))
    expect(removed.length).toBeGreaterThanOrEqual(4)

    const ops = pptReviewBoardOps(bundle, added, 'thread-a') as Array<{ op: string; id?: string }>
    for (const op of ops) expect(ShapeOpSchema.safeParse(op).success).toBe(true)
    expect(ops.filter((op) => op.op === 'delete').map((op) => op.id).sort())
      .toEqual(removed.map((item) => item.id).sort())
  })

  it('rejects malformed or stale review bundles before they reach the canvas', () => {
    expect(isPptReviewBundle(bundle)).toBe(true)
    expect(isPptReviewBundle({ ...bundle, phase: 'completed' })).toBe(false)
    expect(isPptReviewBundle({
      ...bundle,
      slides: [{ ...bundle.slides[0], previewPath: '/outside/opening.png' }]
    })).toBe(false)
    expect(isPptReviewBundle({
      ...bundle,
      slides: [{ ...bundle.slides[0], previewPath: 'https://example.com/opening.png' }]
    })).toBe(false)
    expect(isPptReviewBundle({
      ...bundle,
      slides: [bundle.slides[0], { ...bundle.slides[0], index: 1 }]
    })).toBe(false)
    expect(isPptReviewBundle({
      ...bundle,
      slides: [{ ...bundle.slides[0], index: 1 }]
    })).toBe(false)
    expect(isPptReviewBundle({
      ...bundle,
      slides: [{ ...bundle.slides[0], qaIssues: [
        qaIssue('error', 'pptqa_aaaaaaaaaaaaaaaaaaaaaaaa', { x: 0.95, y: 0, width: 0.1, height: 0.1 })
      ] }]
    })).toBe(false)
    expect(isPptReviewBundle({
      ...bundle,
      slides: [{ ...bundle.slides[0], qaIssues: [
        { ...qaIssue('error', 'pptqa_aaaaaaaaaaaaaaaaaaaaaaaa'), slideIndex: 1 }
      ] }]
    })).toBe(false)
  })

  it('serializes slide ids, revisions, images, and user text inside each card', () => {
    const frame = {
      ...shape('frame', 'ppt-review:ppt_workflow:slide-1:frame', 'frame-1'),
      x: 0,
      y: 0,
      width: 480,
      height: 318,
      pptReviewRef: { workflowId: 'ppt_workflow', childId: 'child_ppt', slideId: 'slide-1', revision: 2, parentThreadId: 'thread-a', role: 'slide-frame' as const }
    }
    const preview = {
      ...shape('image', 'ppt-review:ppt_workflow:slide-1:preview', 'preview-1'),
      imageUrl: '.kun/images/opening-v2.png',
      pptReviewRef: { workflowId: 'ppt_workflow', childId: 'child_ppt', slideId: 'slide-1', revision: 2, parentThreadId: 'thread-a', role: 'preview-image' as const }
    }
    const annotation = {
      ...shape('text', 'User note', 'note-1'),
      x: 20,
      y: 20,
      width: 180,
      height: 40,
      textContent: 'Make the headline larger'
    }
    const qaMarker = {
      ...shape('text', 'ppt-review:ppt_workflow:slide-1:qa:pptqa_aaaaaaaaaaaaaaaaaaaaaaaa:number', 'qa-1'),
      x: 40,
      y: 40,
      width: 22,
      height: 22,
      textContent: '1',
      pptReviewRef: {
        workflowId: 'ppt_workflow', childId: 'child_ppt', slideId: 'slide-1', revision: 2,
        parentThreadId: 'thread-a', role: 'annotation' as const
      }
    }

    expect(serializeActivePptReviewContexts([frame, preview, annotation, qaMarker], 'thread-b')).toEqual([])
    expect(serializeActivePptReviewContexts([frame, preview, annotation, qaMarker], 'thread-a')).toEqual([{
      workflowId: 'ppt_workflow',
      childId: 'child_ppt',
      slides: [{
        slideId: 'slide-1',
        revision: 2,
        imagePath: '.kun/images/opening-v2.png',
        annotations: ['Make the headline larger']
      }]
    }])
  })
})
