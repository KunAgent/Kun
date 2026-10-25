import { afterEach, describe, expect, it } from 'vitest'
import { projectPptCanvasBundle, resolvePptCanvasProjection } from './ppt-canvas-projection'
import { useCanvasShapeStore } from './canvas-shape-store'
import type { PptReviewBundle } from './ppt-review-board'
import type { OpError } from './shape-ops'

function reviewBundle(slides: Array<{ slideId: string; revision: number }>): PptReviewBundle {
  return {
    workflowId: 'deck:presentations/q3',
    childId: 'thr_main',
    manifestPath: 'presentations/q3/.kun-ppt-review/preview.json',
    deckTitle: 'Q3 review',
    styleFingerprint: 'style',
    phase: 'awaiting_review',
    slides: slides.map((slide, index) => ({
      ...slide,
      index,
      title: `Page ${index + 1}`,
      previewPath: `presentations/q3/.kun-ppt-review/previews/${index}-r${slide.revision}.svg`,
      status: 'ready'
    }))
  }
}

function project(bundle: PptReviewBundle, blockId: string): string {
  const projection = resolvePptCanvasProjection('ppt_preview', { reviewBundle: bundle })
  if (!projection || projection.kind === 'filtered') throw new Error('expected a review projection')
  const errors: OpError[] = []
  return projectPptCanvasBundle({
    blockId,
    projection,
    targetThreadId: 'thr_main',
    affectedThisTurn: new Set(),
    errorsThisTurn: errors,
    onOpenRequested: () => undefined
  })
}

function slideIds(): string[] {
  return [...new Set(Object.values(useCanvasShapeStore.getState().document.objects)
    .flatMap((shape) => shape.pptReviewRef?.role === 'slide-frame' ? [shape.pptReviewRef.slideId] : []))].sort()
}

afterEach(() => {
  useCanvasShapeStore.getState().resetDocument()
})

describe('PPT canvas projection for deck tools', () => {
  it('reads review bundles from ppt_preview and validated ppt_export results only', () => {
    const bundle = reviewBundle([{ slideId: 'pages/01.page', revision: 1 }])
    expect(resolvePptCanvasProjection('ppt_preview', { reviewBundle: bundle })).toMatchObject({
      kind: 'review', pptState: { phase: 'review', revision: 1 }
    })
    expect(resolvePptCanvasProjection('ppt_export', {
      validated: true, output: 'presentations/q3.pptx', reviewBundle: { ...bundle, phase: 'completed', slides: bundle.slides.map((slide) => ({ ...slide, qaIssues: [] })) }
    })).toMatchObject({ kind: 'review', pptState: { phase: 'complete', outputPath: 'presentations/q3.pptx' } })
    expect(resolvePptCanvasProjection('ppt_export', { validated: false, output: 'presentations/q3.pptx', reviewBundle: bundle }))
      .toMatchObject({ kind: 'review', pptState: { phase: 'review' } })
    expect(resolvePptCanvasProjection('write', { reviewBundle: bundle })).toBeNull()
  })

  it('accepts a review that dropped the newest page and rejects one with an older slide', () => {
    expect(project(reviewBundle([
      { slideId: 'pages/01.page', revision: 1 },
      { slideId: 'pages/02.page', revision: 3 }
    ]), 'b1')).toBe('applied')
    expect(slideIds()).toEqual(['pages/01.page', 'pages/02.page'])

    expect(project(reviewBundle([{ slideId: 'pages/01.page', revision: 1 }]), 'b2')).not.toBe('rejected')
    expect(slideIds()).toEqual(['pages/01.page'])

    expect(project(reviewBundle([{ slideId: 'pages/01.page', revision: 2 }]), 'b3')).toBe('applied')
    expect(project(reviewBundle([{ slideId: 'pages/01.page', revision: 1 }]), 'b4')).toBe('rejected')
  })
})
