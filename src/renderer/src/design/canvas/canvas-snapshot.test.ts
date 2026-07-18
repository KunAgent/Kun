import { describe, expect, it } from 'vitest'
import { snapshotCanvas } from './canvas-snapshot'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape, createSvgFrameShape } from './canvas-types'
import { createRunningAppFrameShape } from './running-app-frame'
import type { DesignArtifact } from '../design-types'
import { CANVAS_MOTION_VERSION } from '../motion/canvas-motion-types'

const createdAt = '2026-07-02T00:00:00.000Z'

function htmlArtifact(id: string): DesignArtifact {
  return {
    id,
    kind: 'html',
    title: 'Checkout',
    relativePath: `.kun-design/doc/${id}/v1.html`,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath: `.kun-design/doc/${id}/v1.html`, createdAt, summary: '' }],
    direction: { id: 'dir_1', name: 'Checkout refresh', status: 'active' }
  }
}

describe('snapshotCanvas', () => {
  it('returns empty for a fresh document', () => {
    const snap = snapshotCanvas(createEmptyDocument())
    expect(snap.shapeCount).toBe(0)
    expect(snap.shapes).toEqual([])
  })

  it('includes a bounded Motion summary with stable track and keyframe ids', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = { ...createDefaultShape('rect', 10, 20), id: 'hero', parentId: doc.rootId }
    doc.objects[rect.id] = rect
    doc.objects[doc.rootId] = { ...root, children: [rect.id] }
    doc.motion = {
      version: CANVAS_MOTION_VERSION,
      timelines: {
        [doc.rootId]: {
          id: 'timeline_root',
          frameId: doc.rootId,
          durationMs: 800,
          playback: 'once',
          tracks: [{
            id: 'track_hero_opacity',
            targetShapeId: rect.id,
            property: 'opacity',
            operation: 'set',
            baseValue: 1,
            keyframes: [
              { id: 'kf_start', timeMs: 0, value: 0, easing: { type: 'linear' } },
              { id: 'kf_end', timeMs: 800, value: 1, easing: { type: 'ease-out' } }
            ]
          }]
        }
      }
    }

    expect(snapshotCanvas(doc).motion).toMatchObject({
      timelineCount: 1,
      trackCount: 1,
      keyframeCount: 2,
      timelines: [{
        id: 'timeline_root',
        frameId: doc.rootId,
        tracks: [{
          id: 'track_hero_opacity',
          targetShapeId: 'hero',
          targetName: rect.name,
          keyframes: [{ id: 'kf_start' }, { id: 'kf_end' }]
        }]
      }],
      reducedMotion: { automaticPlayback: 'disabled-when-preferred' }
    })
  })

  it('lists shapes with name + bbox + parentName', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 10, 20)
    rect.name = 'My Rect'
    rect.width = 30
    rect.height = 40
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapeCount).toBe(1)
    expect(snap.shapes[0]).toMatchObject({
      id: rect.id,
      name: 'My Rect',
      type: 'rect',
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      parentName: null
    })
  })

  it('rotation is included only when non-zero', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const flat = createDefaultShape('rect', 0, 0)
    const rotated = createDefaultShape('rect', 0, 0)
    rotated.rotation = 45
    doc.objects[flat.id] = { ...flat, parentId: doc.rootId }
    doc.objects[rotated.id] = { ...rotated, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [flat.id, rotated.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).not.toHaveProperty('rotation')
    expect(snap.shapes[1].rotation).toBe(45)
  })

  it('text shapes include textContent (truncated)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const text = createDefaultShape('text', 0, 0)
    text.textContent = 'hello world'
    doc.objects[text.id] = { ...text, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [text.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0].textContent).toBe('hello world')
  })

  it('caps linear shape points in the snapshot while preserving endpoints', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const draw = createDefaultShape('draw', 10, 20)
    draw.width = 119
    draw.height = 0
    draw.points = Array.from({ length: 120 }, (_, index) => ({ x: index, y: 0 }))
    doc.objects[draw.id] = { ...draw, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [draw.id] }

    const shape = snapshotCanvas(doc).shapes[0]

    expect(shape.points).toHaveLength(48)
    expect(shape.points?.[0]).toEqual({ x: 10, y: 20 })
    expect(shape.points?.[shape.points.length - 1]).toEqual({ x: 129, y: 20 })
    expect(shape.pointsOmitted).toBe(72)
  })

  it('flags selected shapes so "this panel" resolves to an id', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const a = createDefaultShape('frame', 0, 0)
    const b = createDefaultShape('frame', 0, 0)
    doc.objects[a.id] = { ...a, parentId: doc.rootId }
    doc.objects[b.id] = { ...b, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }

    const snap = snapshotCanvas(doc, new Set([b.id]))
    expect(snap.shapes[0]).not.toHaveProperty('selected')
    expect(snap.shapes[1].selected).toBe(true)
  })

  it('marks viewport-visible and near-selection shapes as local canvas context', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const inView = createDefaultShape('rect', 20, 20)
    const selected = createDefaultShape('rect', 1000, 1000)
    const nearby = createDefaultShape('rect', 1120, 1000)
    doc.objects[inView.id] = { ...inView, parentId: doc.rootId, name: 'Visible' }
    doc.objects[selected.id] = { ...selected, parentId: doc.rootId, name: 'Selected' }
    doc.objects[nearby.id] = { ...nearby, parentId: doc.rootId, name: 'Neighbor' }
    doc.objects[doc.rootId] = { ...root, children: [inView.id, selected.id, nearby.id] }

    const snap = snapshotCanvas(doc, new Set([selected.id]), {
      viewBox: { x: 0, y: 0, width: 300, height: 300 },
      selectedNeighborPadding: 160
    })

    expect(snap.shapes.find((shape) => shape.id === inView.id)?.inView).toBe(true)
    expect(snap.shapes.find((shape) => shape.id === selected.id)?.selected).toBe(true)
    expect(snap.shapes.find((shape) => shape.id === nearby.id)?.nearSelection).toBe(true)
  })

  it('adds a placement guide with current viewport and recommended screen slots', () => {
    const doc = createEmptyDocument()
    const snap = snapshotCanvas(doc, new Set(), {
      viewBox: { x: 1000, y: 500, width: 1600, height: 1000 }
    })

    expect(snap.placement).toMatchObject({
      empty: true,
      viewBox: { x: 1000, y: 500, w: 1600, h: 1000 },
      defaultScreen: { w: 1280, h: 800 },
      occupiedFrames: []
    })
    expect(snap.placement?.recommendedSlots[0]).toMatchObject({
      label: 'next',
      x: 1160,
      y: 600,
      w: 1280,
      h: 800
    })
    expect(snap.placement?.recommendedSlots).toHaveLength(3)
  })

  it('includes graph direction and recent operation summaries', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const frame = createHtmlFrameShape('Checkout draft', 120, 80, 'checkout', 'desktop')
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [frame.id] }
    doc.graph = {
      version: 1,
      projectId: 'board_1',
      updatedAt: createdAt,
      lastJournalEntryId: 'journal_1'
    }
    doc.operationJournal = [
      {
        id: 'journal_1',
        label: 'create checkout',
        createdAt,
        status: 'applied',
        affectedIds: [frame.id],
        errors: [],
        operations: [
          {
            id: 'op_1',
            type: 'generate_screen',
            label: 'create checkout',
            source: 'agent',
            createdAt,
            targetIds: [frame.id],
            payload: { op: 'add-screen' }
          }
        ]
      }
    ]

    const snap = snapshotCanvas(doc, new Set(), {
      projectId: 'board_1',
      artifacts: [htmlArtifact('checkout')]
    })

    expect(snap.graph).toMatchObject({
      projectId: 'board_1',
      objectCount: 1,
      rootObjectCount: 1,
      directionCount: 1,
      lastJournalEntryId: 'journal_1',
      directions: [{ id: 'dir_1', name: 'Checkout refresh', status: 'active', objectCount: 1 }],
      recentOperations: [
        {
          label: 'create checkout',
          status: 'applied',
          operationTypes: ['generate_screen'],
          affectedCount: 1,
          errorCount: 0
        }
      ]
    })
  })

  it('includes running app portal metadata for live code frames', () => {
    const doc = createEmptyDocument()
    const frame = createRunningAppFrameShape({
      x: 80,
      y: 100,
      url: 'localhost:5173/dashboard',
      title: 'Dashboard app',
      routePath: '/dashboard',
      sourceFile: 'src/app/dashboard/page.tsx',
      componentName: 'DashboardPage'
    })!
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [frame.id] }

    const snap = snapshotCanvas(doc)

    expect(snap.shapes[0]).toMatchObject({
      id: frame.id,
      name: 'Dashboard app',
      type: 'frame',
      runningApp: {
        url: 'http://localhost:5173/dashboard',
        title: 'Dashboard app',
        routePath: '/dashboard',
        sourceFile: 'src/app/dashboard/page.tsx',
        componentName: 'DashboardPage',
        status: 'unknown'
      }
    })
  })

  it('includes code binding summaries with selected bindings first', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const selected = createDefaultShape('rect', 10, 20)
    const stale = createDefaultShape('rect', 200, 20)
    doc.objects[selected.id] = { ...selected, parentId: doc.rootId }
    doc.objects[stale.id] = { ...stale, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [selected.id, stale.id] }
    doc.codeBindings = [
      {
        id: 'binding_stale',
        designObjectId: stale.id,
        kind: 'component',
        status: 'stale',
        createdAt,
        target: { sourceFile: 'src/app/card.tsx', componentName: 'Card' }
      },
      {
        id: 'binding_selected',
        designObjectId: selected.id,
        kind: 'dom-node',
        status: 'active',
        createdAt,
        target: { sourceFile: 'src/app/page.tsx', onlookId: 'oid_1', domId: 'hero' }
      }
    ]

    const snap = snapshotCanvas(doc, new Set([selected.id]))

    expect(snap.codeBindings).toMatchObject({
      count: 2,
      boundObjectCount: 2,
      staleCount: 1,
      missingCount: 0,
      entries: [
        {
          id: 'binding_selected',
          designObjectId: selected.id,
          kind: 'dom-node',
          status: 'active',
          sourceFile: 'src/app/page.tsx',
          onlookId: 'oid_1',
          domId: 'hero',
          selected: true
        },
        {
          id: 'binding_stale',
          designObjectId: stale.id,
          kind: 'component',
          status: 'stale',
          sourceFile: 'src/app/card.tsx',
          componentName: 'Card'
        }
      ]
    })
  })

  it('uses the requested default screen size for placement recommendations', () => {
    const doc = createEmptyDocument()
    const snap = snapshotCanvas(doc, new Set(), {
      viewBox: { x: 1000, y: 500, width: 1600, height: 1000 },
      defaultScreenSize: { width: 390, height: 844 }
    })

    expect(snap.placement).toMatchObject({
      defaultScreen: { w: 390, h: 844 }
    })
    expect(snap.placement?.recommendedSlots[0]).toMatchObject({
      label: 'next',
      x: 1605,
      y: 578,
      w: 390,
      h: 844
    })
  })

  it('reports occupied HTML frames and avoids them in recommended placement', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const home = createHtmlFrameShape('Home', 1160, 600, 'home-artifact', 'desktop')
    doc.objects[home.id] = { ...home, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [home.id] }

    const snap = snapshotCanvas(doc, new Set([home.id]), {
      viewBox: { x: 1000, y: 500, width: 1600, height: 1000 }
    })

    expect(snap.placement?.occupiedFrames).toEqual([
      expect.objectContaining({
        id: home.id,
        name: 'Home',
        htmlArtifactId: 'home-artifact',
        x: 1160,
        y: 600,
        w: 1280,
        h: 800
      })
    ])
    expect(snap.placement?.selectedBounds).toMatchObject({ x: 1160, y: 600, w: 1280, h: 800 })
    expect(snap.placement?.recommendedSlots[0]).toMatchObject({
      label: 'next',
      x: 2520,
      y: 600,
      w: 1280,
      h: 800
    })
  })

  it('reports SVG artifact frames as occupied vector resources', () => {
    const doc = createEmptyDocument()
    const motion = createSvgFrameShape('Orbit loader', 80, 120, 'motion', 320, 240)
    doc.objects[motion.id] = { ...motion, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [motion.id] }

    const snap = snapshotCanvas(doc, new Set([motion.id]), {
      viewBox: { x: 0, y: 0, width: 1200, height: 800 }
    })

    expect(snap.shapes[0]).toMatchObject({
      embeddedArtifact: { id: 'motion', kind: 'svg' }
    })
    expect(snap.placement?.occupiedFrames).toEqual([
      expect.objectContaining({
        id: motion.id,
        artifactId: 'motion',
        artifactKind: 'svg',
        x: 80,
        y: 120,
        w: 320,
        h: 240
      })
    ])
  })

  it('keeps selected, nearby, and viewport-visible shapes when maxShapes truncates', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const farFirst = createDefaultShape('rect', -1000, -1000)
    const inView = createDefaultShape('rect', 20, 20)
    const nearby = createDefaultShape('rect', 1160, 1000)
    const selected = createDefaultShape('rect', 1000, 1000)
    const farLast = createDefaultShape('rect', 2000, 2000)
    for (const shape of [farFirst, inView, nearby, selected, farLast]) {
      doc.objects[shape.id] = { ...shape, parentId: doc.rootId }
    }
    doc.objects[doc.rootId] = {
      ...root,
      children: [farFirst.id, inView.id, nearby.id, selected.id, farLast.id]
    }

    const snap = snapshotCanvas(doc, new Set([selected.id]), {
      maxShapes: 3,
      viewBox: { x: 0, y: 0, width: 300, height: 300 },
      selectedNeighborPadding: 240
    })

    expect(snap.shapeCount).toBe(5)
    expect(snap.omitted).toBe(2)
    expect(snap.shapes.map((shape) => shape.id)).toEqual([selected.id, nearby.id, inView.id])
  })

  it('flags AI image holders (only when set)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const plain = createDefaultShape('image', 0, 0)
    const holder = createDefaultShape('image', 0, 0)
    holder.aiImageHolder = true
    doc.objects[plain.id] = { ...plain, parentId: doc.rootId }
    doc.objects[holder.id] = { ...holder, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [plain.id, holder.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).not.toHaveProperty('aiImageHolder')
    expect(snap.shapes[1].aiImageHolder).toBe(true)
  })

  it('includes imageUrl for filled image shapes and omits it for empty holders', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const filled = createDefaultShape('image', 0, 0)
    filled.imageUrl = '.deepseekgui-images/pic.png'
    const empty = createDefaultShape('image', 0, 0)
    doc.objects[filled.id] = { ...filled, parentId: doc.rootId }
    doc.objects[empty.id] = { ...empty, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [filled.id, empty.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0].imageUrl).toBe('.deepseekgui-images/pic.png')
    expect(snap.shapes[1]).not.toHaveProperty('imageUrl')
    // Empty shape must not be flagged as aiImageHolder when not selected.
    expect(snap.shapes[1]).not.toHaveProperty('aiImageHolder')
  })

  it('skips imageUrl on shapes whose imageUrl is a data: URL (safety-net against leaked base64)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const dataUrlShape = createDefaultShape('image', 0, 0)
    dataUrlShape.imageUrl = 'data:image/png;base64,AAAA'
    const filledShape = createDefaultShape('image', 0, 0)
    filledShape.imageUrl = '.deepseekgui-images/img-x.png'
    doc.objects[dataUrlShape.id] = { ...dataUrlShape, parentId: doc.rootId }
    doc.objects[filledShape.id] = { ...filledShape, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [dataUrlShape.id, filledShape.id] }

    const snap = snapshotCanvas(doc)
    const dataShape = snap.shapes.find((s) => s.id === dataUrlShape.id)
    const filled = snap.shapes.find((s) => s.id === filledShape.id)
    expect(dataShape).not.toHaveProperty('imageUrl')
    expect(filled?.imageUrl).toBe('.deepseekgui-images/img-x.png')
    expect(JSON.stringify(snap)).not.toContain('data:image/png;base64')
  })

  it('flags a selected data: URL image as a holder so neither rule strands the LLM', () => {
    // When persistence fails, an image shape can carry a data: URL imageUrl.
    // The snapshot drops the imageUrl (safety-net) — without this flag the
    // LLM would see an image shape with NEITHER imageUrl NOR aiImageHolder
    // and have no rule to follow. Selected data: URL images become holders so
    // the fill rule fires (generate fresh from text).
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const dataUrlImg = createDefaultShape('image', 0, 0)
    dataUrlImg.imageUrl = 'data:image/png;base64,AAAA'
    doc.objects[dataUrlImg.id] = { ...dataUrlImg, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [dataUrlImg.id] }

    const selected = snapshotCanvas(doc, new Set([dataUrlImg.id]))
    expect(selected.shapes[0].aiImageHolder).toBe(true)
    expect(selected.shapes[0]).not.toHaveProperty('imageUrl')

    // Not selected: the data: URL image stays a passive background shape; no
    // imageUrl in the snapshot but also no holder flag — neither rule fires,
    // which is correct (the user wasn't pointing at it).
    const unselected = snapshotCanvas(doc)
    expect(unselected.shapes[0]).not.toHaveProperty('aiImageHolder')
    expect(unselected.shapes[0]).not.toHaveProperty('imageUrl')
  })

  it('includes a compact style digest (fill/stroke/fontColor/cornerRadius) when set', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 0, 0)
    rect.fills = [{ type: 'solid', color: '#3b82d8', opacity: 1 }]
    rect.strokes = [{ color: '#111827', width: 2, opacity: 1, position: 'inside' }]
    rect.cornerRadius = 8
    const text = createDefaultShape('text', 0, 0)
    text.fontColor = '#0a0a0a'
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[text.id] = { ...text, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id, text.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).toMatchObject({ fill: '#3b82d8', stroke: '#111827/2', cornerRadius: 8 })
    expect(snap.shapes[1].fontColor).toBe('#0a0a0a')
  })

  it('summarizes gradient, shadow and auto-layout in the digest', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const card = createDefaultShape('frame', 0, 0)
    card.fills = [
      {
        type: 'linear',
        angle: 90,
        opacity: 1,
        stops: [
          { offset: 0, color: '#6366f1' },
          { offset: 1, color: '#8b5cf6' }
        ]
      }
    ]
    card.shadows = [{ x: 0, y: 4, blur: 12, color: '#0f172a', opacity: 0.2 }]
    card.layout = {
      direction: 'horizontal',
      gap: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16
    }
    doc.objects[card.id] = { ...card, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [card.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0].gradient).toBe('linear 90deg #6366f1→#8b5cf6')
    expect(snap.shapes[0].shadow).toBe('0/4 b12')
    expect(snap.shapes[0].layout).toBe('row gap12 pad16')
    // The gradient's first stop still surfaces as the primary fill color.
    expect(snap.shapes[0].fill).toBe('#6366f1')
  })

  it('omits stroke when it is invisible (width 0 or opacity 0)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 0, 0)
    rect.strokes = [{ color: '#000000', width: 0, opacity: 1, position: 'inside' }]
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id] }

    expect(snapshotCanvas(doc).shapes[0]).not.toHaveProperty('stroke')
  })

  it('auto-flags a selected empty box as a holder, but not when unselected or filled', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const emptyImg = createDefaultShape('image', 0, 0)
    const filledImg = createDefaultShape('image', 0, 0)
    filledImg.imageUrl = '.deepseekgui-images/pic.png'
    doc.objects[emptyImg.id] = { ...emptyImg, parentId: doc.rootId }
    doc.objects[filledImg.id] = { ...filledImg, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [emptyImg.id, filledImg.id] }

    // Both selected: the empty box becomes an implicit slot; the filled one does not.
    const selected = snapshotCanvas(doc, new Set([emptyImg.id, filledImg.id]))
    expect(selected.shapes[0].aiImageHolder).toBe(true)
    expect(selected.shapes[1]).not.toHaveProperty('aiImageHolder')

    // Nothing selected: an empty box is NOT auto-flagged, so asking for an image
    // elsewhere won't fill stray empty boxes.
    const none = snapshotCanvas(doc)
    expect(none.shapes[0]).not.toHaveProperty('aiImageHolder')
  })
})
