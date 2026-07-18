import { describe, expect, it, beforeEach } from 'vitest'
import {
  extractDesignCanvasToolBlocks,
  extractShapeOpsBlocks,
  extractCanvasOpBlocks,
  applyCanvasOpBlocks,
  applyCanvasOpsSince,
  applyShapeOpsFromText,
  extractCanvasOpBlocksFromValue,
  extractSvgArtifactCreateSpecsFromValue,
  isDesignCanvasToolName,
  setLastCanvasOpErrors,
  takeLastCanvasOpErrors
} from './apply-shape-ops'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { createEmptyDocument } from './canvas-types'
import { setScreenArtifactFactory, setScreenCreationFactory, takeScreenBrief } from './screen-artifact-bridge'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  setScreenArtifactFactory(() => null)
  setScreenCreationFactory(null)
  takeLastCanvasOpErrors() // clear any cross-test leakage
})

describe('last-canvas-op-errors stash (agent self-correction bridge)', () => {
  it('is a one-shot: take returns the stashed errors then clears', () => {
    setLastCanvasOpErrors([{ code: 'SHAPE_NOT_FOUND', message: 'No shape "x"' }])
    expect(takeLastCanvasOpErrors()).toEqual([{ code: 'SHAPE_NOT_FOUND', message: 'No shape "x"' }])
    expect(takeLastCanvasOpErrors()).toEqual([])
  })

  it('isolates errors per design key so two documents do not cross-contaminate', () => {
    setLastCanvasOpErrors([{ code: 'SHAPE_NOT_FOUND', message: 'doc A' }], 'docA')
    setLastCanvasOpErrors([{ code: 'PARENT_NOT_FOUND', message: 'doc B' }], 'docB')
    expect(takeLastCanvasOpErrors('docA')).toEqual([{ code: 'SHAPE_NOT_FOUND', message: 'doc A' }])
    // Taking docA must not have drained docB.
    expect(takeLastCanvasOpErrors('docB')).toEqual([{ code: 'PARENT_NOT_FOUND', message: 'doc B' }])
    expect(takeLastCanvasOpErrors('docA')).toEqual([])
  })
})

describe('extractShapeOpsBlocks', () => {
  it('returns [] when there is no shapeops fence', () => {
    expect(extractShapeOpsBlocks('just some prose, no canvas here')).toEqual([])
  })

  it('extracts a single fenced array', () => {
    const text = 'plan\n```shapeops\n[{ "op": "delete", "id": "x" }]\n```'
    const blocks = extractShapeOpsBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveLength(1)
  })

  it('extracts multiple fenced blocks', () => {
    const text =
      '```shapeops\n[{ "op": "delete", "id": "a" }]\n```\nmid\n```shapeops\n[{ "op": "delete", "id": "b" }]\n```'
    expect(extractShapeOpsBlocks(text)).toHaveLength(2)
  })

  it('wraps a non-array JSON object into a single-op batch', () => {
    const blocks = extractShapeOpsBlocks('```shapeops\n{ "op": "delete", "id": "x" }\n```')
    expect(blocks[0]).toHaveLength(1)
  })

  it('skips malformed JSON without throwing', () => {
    expect(extractShapeOpsBlocks('```shapeops\nnot json\n```')).toEqual([])
  })
})

describe('SVG artifact creation protocol', () => {
  it('extracts a validated first-class SVG artifact request from a tool result', () => {
    expect(extractSvgArtifactCreateSpecsFromValue({
      ok: true,
      ops: [{
        op: 'add-svg-artifact',
        artifactId: 'svg-4d2a6b8c0e12',
        name: 'Orbit loader',
        brief: 'Looping vector loader',
        x: 120,
        y: 80,
        width: 240,
        height: 160
      }]
    })).toEqual([{
      artifactId: 'svg-4d2a6b8c0e12',
      name: 'Orbit loader',
      brief: 'Looping vector loader',
      x: 120,
      y: 80,
      width: 240,
      height: 160
    }])
  })

  it('ignores malformed or unrelated SVG creation results', () => {
    expect(extractSvgArtifactCreateSpecsFromValue({ ops: [{ op: 'add-svg-artifact', name: '', brief: 'x' }] })).toEqual([])
    expect(extractSvgArtifactCreateSpecsFromValue({
      ops: [{ op: 'add-svg-artifact', artifactId: '../escape', name: 'Bad', brief: 'x' }]
    })).toEqual([{ name: 'Bad', brief: 'x' }])
    expect(extractSvgArtifactCreateSpecsFromValue({ ops: [{ op: 'add-screen', name: 'Home' }] })).toEqual([])
  })
})

describe('extractDesignCanvasToolBlocks', () => {
  it('maps update_shapes tool calls to shape ops', () => {
    const blocks = extractDesignCanvasToolBlocks(
      '```design_canvas\n{ "action": "update_shapes", "ops": [{ "op": "delete", "id": "x" }] }\n```'
    )
    expect(blocks).toEqual([[{ op: 'delete', id: 'x' }]])
  })

  it('maps add_screen tool calls to the legacy add-screen op', () => {
    const blocks = extractDesignCanvasToolBlocks(
      '```design_canvas\n{ "action": "add_screen", "name": "Login", "width": 390, "height": 844, "devicePreset": "mobile" }\n```'
    )
    expect(blocks).toEqual([[
      {
        op: 'add-screen',
        name: 'Login',
        width: 390,
        height: 844,
        devicePreset: 'mobile'
      }
    ]])
  })

  it('carries the agent brief through add_screen', () => {
    const blocks = extractDesignCanvasToolBlocks(
      '```design_canvas\n{ "action": "add_screen", "name": "Login", "brief": "Clean login with email + SSO" }\n```'
    )
    expect(blocks[0][0]).toMatchObject({ op: 'add-screen', name: 'Login', brief: 'Clean login with email + SSO' })
  })
})

describe('applyShapeOpsFromText', () => {
  it('is a no-op (batchCount 0) for plain text', () => {
    const result = applyShapeOpsFromText('I will not touch the canvas.')
    expect(result.batchCount).toBe(0)
    expect(result.affectedIds).toEqual([])
  })

  it('applies an add op and reports the affected id', () => {
    const text = '```shapeops\n[{ "op": "add", "shape": { "type": "rect", "x": 0, "y": 0, "width": 20, "height": 20 } }]\n```'
    const result = applyShapeOpsFromText(text)
    expect(result.batchCount).toBe(1)
    expect(result.affectedIds).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.objects[result.affectedIds[0]]?.type).toBe('rect')
  })

  it('counts each fenced block as its own batch', () => {
    const text =
      '```shapeops\n[{ "op": "add", "shape": { "type": "rect", "width": 10, "height": 10 } }]\n```\n```shapeops\n[{ "op": "add", "shape": { "type": "ellipse", "width": 10, "height": 10 } }]\n```'
    expect(applyShapeOpsFromText(text).batchCount).toBe(2)
  })

  it('applies design_canvas update_shapes calls', () => {
    const text =
      '```design_canvas\n{ "action": "update_shapes", "ops": [{ "op": "add", "shape": { "type": "text", "textContent": "Hello", "x": 10, "y": 20 } }] }\n```'
    const result = applyShapeOpsFromText(text)
    expect(result.batchCount).toBe(1)
    expect(result.affectedIds).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.objects[result.affectedIds[0]]?.type).toBe('text')
  })

  it('applies design_canvas add_screen calls through the screen factory', () => {
    setScreenArtifactFactory((name) => `artifact-${name.toLowerCase()}`)
    const text =
      '```design_canvas\n{ "action": "add_screen", "name": "Login", "width": 390, "height": 844, "devicePreset": "mobile" }\n```'
    const result = applyShapeOpsFromText(text)
    expect(result.batchCount).toBe(1)
    expect(result.affectedIds).toHaveLength(1)
    const shape = useCanvasShapeStore.getState().document.objects[result.affectedIds[0]]
    expect(shape?.type).toBe('frame')
    expect(shape?.htmlArtifactId).toBe('artifact-login')
    expect(shape?.width).toBe(390)
    expect(shape?.height).toBe(844)
  })

  it('stashes an add_screen brief under the created frame id (one-shot)', () => {
    setScreenArtifactFactory((name) => `artifact-${name.toLowerCase()}`)
    const result = applyShapeOpsFromText(
      '```design_canvas\n{ "action": "add_screen", "name": "Login", "brief": "Clean login with email + SSO" }\n```'
    )
    const shapeId = result.affectedIds[0]
    expect(takeScreenBrief(shapeId)).toBe('Clean login with email + SSO')
    // one-shot: a second take returns null so a stale brief can't leak into a later screen
    expect(takeScreenBrief(shapeId)).toBeNull()
  })
})

describe('extractCanvasOpBlocks (source-ordered)', () => {
  it('returns design_canvas and shapeops blocks in source order', () => {
    const text = [
      '```design_canvas',
      '{ "action": "update_shapes", "ops": [{ "op": "delete", "id": "a" }] }',
      '```',
      'mid',
      '```shapeops',
      '[{ "op": "delete", "id": "b" }]',
      '```',
      '```design_canvas',
      '{ "action": "update_shapes", "ops": [{ "op": "delete", "id": "c" }] }',
      '```'
    ].join('\n')
    expect(extractCanvasOpBlocks(text)).toEqual([
      [{ op: 'delete', id: 'a' }],
      [{ op: 'delete', id: 'b' }],
      [{ op: 'delete', id: 'c' }]
    ])
  })

  it('accepts recognized design_canvas tool calls emitted under a json fence', () => {
    const text = [
      '```json',
      '{ "action": "add_screen", "name": "Home", "devicePreset": "mobile" }',
      '```'
    ].join('\n')
    expect(extractCanvasOpBlocks(text)).toEqual([
      [{ op: 'add-screen', name: 'Home', devicePreset: 'mobile' }]
    ])
  })

  it('ignores unrelated json fenced blocks', () => {
    const text = [
      '```json',
      '{ "name": "Home", "items": [{ "title": "Feed" }] }',
      '```'
    ].join('\n')
    expect(extractCanvasOpBlocks(text)).toEqual([])
  })

  it('accepts direct shape ops emitted under a json fence', () => {
    const text = [
      '```json',
      '{ "op": "delete", "id": "stale" }',
      '```'
    ].join('\n')
    expect(extractCanvasOpBlocks(text)).toEqual([[{ op: 'delete', id: 'stale' }]])
  })

  it('omits an incomplete (unclosed) block until its fence closes', () => {
    const partial =
      '```design_canvas\n{ "action": "update_shapes", "ops": [{ "op": "add", "shape": { "type": "rect" } }] }'
    expect(extractCanvasOpBlocks(partial)).toEqual([])
  })
})

describe('extractCanvasOpBlocksFromValue (tool result payloads)', () => {
  it('extracts ops from a design_canvas tool result', () => {
    expect(
      extractCanvasOpBlocksFromValue({
        ok: true,
        action: 'add_screen',
        ops: [{ op: 'add-screen', name: 'Home' }]
      })
    ).toEqual([[{ op: 'add-screen', name: 'Home' }]])
  })

  it('falls back to direct design_canvas tool-call normalization', () => {
    expect(
      extractCanvasOpBlocksFromValue({
        action: 'add_screen',
        name: 'Home'
      })
    ).toEqual([[{ op: 'add-screen', name: 'Home' }]])
  })

  it('recognizes dedicated design tools and extracts their ops payloads', () => {
    expect(isDesignCanvasToolName('design_system_template')).toBe(true)
    expect(isDesignCanvasToolName('design_update_shapes')).toBe(true)
    expect(isDesignCanvasToolName('design_motion_set_timeline')).toBe(true)
    expect(isDesignCanvasToolName('design_motion_upsert_keyframes')).toBe(true)
    expect(isDesignCanvasToolName('bash')).toBe(false)
    expect(
      extractCanvasOpBlocksFromValue({
        ok: true,
        tool: 'design_system_template',
        ops: [{ op: 'design-system-template', operation: 'create', name: 'Kit' }]
      })
    ).toEqual([[{ op: 'design-system-template', operation: 'create', name: 'Kit' }]])
  })

  it('applies design_update_shapes imageUrl updates to empty slots as visible image shapes', () => {
    const added = applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "rect", "width": 180, "height": 120 } }]\n```'
    )
    const id = added.affectedIds[0]
    const blocks = extractCanvasOpBlocksFromValue({
      ok: true,
      tool: 'design_update_shapes',
      ops: [{ op: 'update', id, patch: { imageUrl: '.deepseekgui-images/tool-img.png' } }]
    })

    const result = applyCanvasOpBlocks(blocks, 'tool:test')

    const shape = useCanvasShapeStore.getState().document.objects[id]
    expect(result.errors).toEqual([])
    expect(shape?.type).toBe('image')
    expect(shape?.imageUrl).toBe('.deepseekgui-images/tool-img.png')
  })
})

describe('applyCanvasOpsSince (streaming application)', () => {
  // The canvas document always carries a `__root__` container; count real shapes.
  const nonRootShapeIds = (): string[] =>
    Object.keys(useCanvasShapeStore.getState().document.objects).filter((id) => id !== '__root__')
  const addBlock = (type: string): string =>
    `\`\`\`design_canvas\n{ "action": "update_shapes", "ops": [{ "op": "add", "shape": { "type": "${type}", "width": 10, "height": 10 } }] }\n\`\`\``

  it('applies only blocks at/after the cursor and never re-runs earlier ones', () => {
    const first = addBlock('rect')
    const r1 = applyCanvasOpsSince(first, 0)
    expect(r1.totalBlocks).toBe(1)
    expect(r1.affectedIds).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.objects[r1.affectedIds[0]]?.type).toBe('rect')

    // The stream grows by one more completed block; advance the cursor.
    const grown = `${first}\n${addBlock('ellipse')}`
    const r2 = applyCanvasOpsSince(grown, r1.totalBlocks)
    expect(r2.totalBlocks).toBe(2)
    expect(r2.affectedIds).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.objects[r2.affectedIds[0]]?.type).toBe('ellipse')

    // Exactly two shapes — the first block was applied once, not twice.
    expect(nonRootShapeIds()).toHaveLength(2)
  })

  it('is a no-op when no new block has completed since the cursor', () => {
    const text = addBlock('rect')
    const r1 = applyCanvasOpsSince(text, 0)
    const r2 = applyCanvasOpsSince(text, r1.totalBlocks)
    expect(r2.totalBlocks).toBe(1)
    expect(r2.affectedIds).toEqual([])
    expect(nonRootShapeIds()).toHaveLength(1)
  })
})

describe('new ShapeOps (duplicate / reorder / parent validation / text fields)', () => {
  const nonRootIds = (): string[] => {
    const doc = useCanvasShapeStore.getState().document
    return Object.keys(doc.objects).filter((id) => id !== doc.rootId)
  }
  const addRect = (): string =>
    applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "rect", "x": 0, "y": 0, "width": 10, "height": 10 } }]\n```'
    ).affectedIds[0]

  it('rejects add with a non-existent parentId instead of reporting phantom success', () => {
    const result = applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "rect", "width": 10, "height": 10 }, "parentId": "nope" }]\n```'
    )
    expect(result.affectedIds).toEqual([])
    expect(result.errors.some((e) => e.code === 'PARENT_NOT_FOUND')).toBe(true)
    expect(nonRootIds()).toHaveLength(0)
  })

  it('accepts textAlign and lineHeight on a text shape (strict schema no longer drops them)', () => {
    const result = applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "text", "textContent": "Hi", "textAlign": "center", "lineHeight": 1.4 } }]\n```'
    )
    expect(result.errors).toEqual([])
    const shape = useCanvasShapeStore.getState().document.objects[result.affectedIds[0]]
    expect(shape?.textAlign).toBe('center')
    expect(shape?.lineHeight).toBe(1.4)
  })

  it('duplicate creates N staggered copies of a shape', () => {
    const id = addRect()
    const dup = applyShapeOpsFromText(
      `\`\`\`shapeops\n[{ "op": "duplicate", "id": "${id}", "count": 2, "offset": { "dx": 20, "dy": 0 } }]\n\`\`\``
    )
    expect(dup.errors).toEqual([])
    expect(dup.affectedIds).toHaveLength(2)
    const doc = useCanvasShapeStore.getState().document
    const xs = dup.affectedIds.map((d) => doc.objects[d]?.x).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(xs).toEqual([20, 40]) // each copy offset by (i+1)*dx from the original at x=0
    expect(nonRootIds()).toHaveLength(3) // original + 2 copies
  })

  it('reorder sends a shape to the front of its sibling order', () => {
    const a = addRect()
    const b = addRect()
    const root0 = useCanvasShapeStore.getState().document
    const rootChildren0 = root0.objects[root0.rootId].children
    expect(rootChildren0.indexOf(a)).toBeLessThan(rootChildren0.indexOf(b))

    const result = applyShapeOpsFromText(
      `\`\`\`shapeops\n[{ "op": "reorder", "id": "${a}", "action": "front" }]\n\`\`\``
    )
    expect(result.errors).toEqual([])
    const root1 = useCanvasShapeStore.getState().document
    const rootChildren1 = root1.objects[root1.rootId].children
    expect(rootChildren1.indexOf(a)).toBeGreaterThan(rootChildren1.indexOf(b))
  })
})

describe('imageUrl ShapeOp support', () => {
  it('add op accepts imageUrl and stores it on the image shape', () => {
    const text =
      '```shapeops\n[{ "op": "add", "shape": { "type": "image", "width": 100, "height": 100, "imageUrl": ".deepseekgui-images/img-1.png" } }]\n```'
    const result = applyShapeOpsFromText(text)
    expect(result.affectedIds).toHaveLength(1)
    const shape = useCanvasShapeStore.getState().document.objects[result.affectedIds[0]]
    expect(shape?.type).toBe('image')
    expect(shape?.imageUrl).toBe('.deepseekgui-images/img-1.png')
  })

  it('update op patches imageUrl on an existing shape', () => {
    const added = applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "image", "width": 50, "height": 50 } }]\n```'
    )
    const id = added.affectedIds[0]
    const result = applyShapeOpsFromText(
      `\`\`\`shapeops\n[{ "op": "update", "id": "${id}", "patch": { "imageUrl": ".deepseekgui-images/img-2.png" } }]\n\`\`\``
    )
    expect(result.affectedIds).toContain(id)
    expect(useCanvasShapeStore.getState().document.objects[id]?.imageUrl).toBe(
      '.deepseekgui-images/img-2.png'
    )
  })

  it('update op converts an empty rect slot with imageUrl into a renderable image shape', () => {
    const added = applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "rect", "width": 120, "height": 80, "fills": [{ "type": "solid", "color": "#d9d9d9", "opacity": 1 }] } }]\n```'
    )
    const id = added.affectedIds[0]

    const result = applyShapeOpsFromText(
      `\`\`\`shapeops\n[{ "op": "update", "id": "${id}", "patch": { "imageUrl": ".deepseekgui-images/img-slot.png" } }]\n\`\`\``
    )

    const shape = useCanvasShapeStore.getState().document.objects[id]
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toContain(id)
    expect(shape?.type).toBe('image')
    expect(shape?.imageUrl).toBe('.deepseekgui-images/img-slot.png')
    expect(shape?.width).toBe(120)
    expect(shape?.height).toBe(80)
  })

  it('update op converts an empty frame slot with imageUrl into a renderable image shape', () => {
    const added = applyShapeOpsFromText(
      '```shapeops\n[{ "op": "add", "shape": { "type": "frame", "width": 160, "height": 100, "aiImageHolder": true } }]\n```'
    )
    const id = added.affectedIds[0]

    const result = applyShapeOpsFromText(
      `\`\`\`shapeops\n[{ "op": "update", "id": "${id}", "patch": { "imageUrl": ".deepseekgui-images/img-frame.png" } }]\n\`\`\``
    )

    const shape = useCanvasShapeStore.getState().document.objects[id]
    expect(result.errors).toEqual([])
    expect(shape?.type).toBe('image')
    expect(shape?.imageUrl).toBe('.deepseekgui-images/img-frame.png')
    expect(shape?.children).toEqual([])
  })
})
