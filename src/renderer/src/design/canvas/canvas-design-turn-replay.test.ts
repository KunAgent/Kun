import { afterEach, describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import {
  activeCanvasTurnMatchesDesignTarget,
  designCanvasReplayKey,
  durableDesignCanvasTurns,
  ensureGeneratedImageOnCanvas,
  materializeHistoricalGeneratedImages,
  replayDurableDesignCanvasTurns,
  toolBlockMatchesDesignTarget
} from './canvas-design-turn-replay'
import { createDefaultShape, createEmptyDocument } from './canvas-types'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { parseProjectDesignMd } from '../design-md/design-md-adapter'
import { useProjectDesignSystemStore } from './project-design-system-store'
import { resetDesignSystemBoardLayoutForTests, setDesignSystemBoardRect } from './design-system-board-layout'
import {
  coalesceGeneratedImageAddsForTurn,
  generatedImageResultsForTurn
} from './canvas-generated-image-replay'

const target = { documentId: 'doc_design', boardArtifactId: 'board_design' }

function userBlock(id: string, submittedTarget?: typeof target): ChatBlock {
  return {
    kind: 'user',
    id,
    text: 'Create a visual',
    ...(submittedTarget ? { meta: { designDocumentTarget: submittedTarget } } : {})
  }
}

describe('Design canvas turn target matching', () => {
  it('matches only the active user turn bound to the visible Design document', () => {
    const blocks = [
      userBlock('user_previous', target),
      userBlock('user_current', { documentId: 'doc_other', boardArtifactId: 'board_other' })
    ]

    expect(activeCanvasTurnMatchesDesignTarget({
      currentTurnUserId: 'user_previous',
      blocks
    }, target)).toBe(true)
    expect(activeCanvasTurnMatchesDesignTarget({
      currentTurnUserId: 'user_current',
      blocks
    }, target)).toBe(false)
    expect(activeCanvasTurnMatchesDesignTarget({
      currentTurnUserId: 'missing',
      blocks
    }, target)).toBe(false)
  })

  it('associates each tool result with the nearest preceding user target', () => {
    const blocks: ChatBlock[] = [
      userBlock('user_design', target),
      { kind: 'tool', id: 'tool_design', summary: 'generate', status: 'success' },
      userBlock('user_other', { documentId: 'doc_other', boardArtifactId: 'board_other' }),
      { kind: 'tool', id: 'tool_other', summary: 'generate', status: 'success' }
    ]

    expect(toolBlockMatchesDesignTarget(blocks, 1, target)).toBe(true)
    expect(toolBlockMatchesDesignTarget(blocks, 3, target)).toBe(false)
  })

  it('enumerates only turns for the bound document and keys replay by thread, turn, and board', () => {
    const blocks: ChatBlock[] = [
      { ...userBlock('user_design', target), turnId: 'turn_design' },
      { kind: 'assistant', id: 'assistant_design', turnId: 'turn_design', text: 'done' },
      userBlock('user_other', { documentId: 'doc_other', boardArtifactId: 'board_other' }),
      { kind: 'assistant', id: 'assistant_other', text: 'other' }
    ]

    expect(durableDesignCanvasTurns(blocks, target)).toEqual([{
      userBlockId: 'user_design',
      turnId: 'turn_design',
      blocks: blocks.slice(0, 2)
    }])
    expect(designCanvasReplayKey({
      threadId: 'thread_design', turnId: 'turn_design', target, source: 'tool:shape'
    })).toBe('thread_design\0turn_design\0doc_design\0board_design\0tool:shape')
  })

  it('leaves durable watermark commit to the async follow-up coordinator', () => {
    useCanvasShapeStore.getState().resetDocument()
    const blocks: ChatBlock[] = [
      { ...userBlock('user_design', target), turnId: 'turn_design' },
      { kind: 'assistant', id: 'assistant_design', turnId: 'turn_design', text: 'done' }
    ]

    replayDurableDesignCanvasTurns({
      threadId: 'thread_design',
      blocks,
      target,
      onTurnStart: () => undefined,
      onAssistantText: () => undefined,
      onToolBlock: () => undefined,
      onTurnComplete: () => undefined
    })

    expect(useCanvasShapeStore.getState().document.rendererReplayWatermarkTurnId).toBeUndefined()
  })
})

describe('generated Design image canvas placement', () => {
  afterEach(() => {
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasViewportStore.getState().resetView()
    resetDesignSystemBoardLayoutForTests()
    useProjectDesignSystemStore.getState().setMissing()
  })

  it('normalizes producing tool identity and valid image dimensions', () => {
    const blocks: ChatBlock[] = [{
      kind: 'tool', id: 'tool-normalized', summary: 'Generated image', status: 'success',
      meta: {
        toolName: 'mcp__kun__generate_image',
        generatedFiles: [{
          absolutePath: '/workspace/.kun/images/normalized.png',
          completionIdentity: 'normalized', width: 1200, height: 600
        }]
      }
    }]

    expect(generatedImageResultsForTurn(blocks)).toEqual([{
      imageUrl: '/workspace/.kun/images/normalized.png',
      completionIdentity: 'normalized',
      toolBlockId: 'tool-normalized',
      width: 1200,
      height: 600
    }])
  })

  it('materializes every historical generated image without overlap or duplication', () => {
    useCanvasViewportStore.getState().setVbox({ x: 0, y: 0, width: 1600, height: 900 })
    const blocks: ChatBlock[] = [
      { ...userBlock('user-first', target), turnId: 'turn-first' },
      {
        kind: 'tool', id: 'image-first', turnId: 'turn-first', summary: 'Generated image',
        status: 'success', meta: {
          toolName: 'generate_image', generatedFiles: [{
            absolutePath: '/workspace/.kun/images/first.png', completionIdentity: 'first',
            width: 1200, height: 600
          }]
        }
      },
      { ...userBlock('user-second', target), turnId: 'turn-second' },
      {
        kind: 'tool', id: 'image-second', turnId: 'turn-second', summary: 'Generated image',
        status: 'success', meta: {
          toolName: 'generate_image', generatedFiles: [{
            absolutePath: '/workspace/.kun/images/second.png', completionIdentity: 'second',
            width: 600, height: 1200
          }]
        }
      }
    ]

    const firstPass = materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })
    const images = Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')
    const [first, second] = images

    expect(firstPass).toHaveLength(2)
    expect(images).toHaveLength(2)
    expect(first && second).toBeTruthy()
    expect({ width: first!.width, height: first!.height }).toEqual({ width: 640, height: 320 })
    expect({ width: second!.width, height: second!.height }).toEqual({ width: 320, height: 640 })
    expect(first!.x + first!.width <= second!.x || second!.x + second!.width <= first!.x ||
      first!.y + first!.height <= second!.y || second!.y + second!.height <= first!.y).toBe(true)
    expect(materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })).toEqual([])
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(2)
  })

  it('hydrates images before the ShapeOps replay watermark without resurrecting deleted images', () => {
    const blocks: ChatBlock[] = [
      { ...userBlock('user-old', target), turnId: 'turn-old' },
      {
        kind: 'tool', id: 'image-old', turnId: 'turn-old', summary: 'Generated image',
        status: 'success', meta: {
          toolName: 'generate_image', generatedFiles: [{
            absolutePath: '/workspace/.kun/images/old.png', completionIdentity: 'old'
          }]
        }
      }
    ]
    useCanvasShapeStore.getState().recordRendererReplayWatermark('turn-old')

    const [placedId] = materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })
    expect(placedId).toBeTruthy()
    useCanvasShapeStore.getState().deleteShape(placedId!)

    expect(materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })).toEqual([])
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(0)
  })

  it('adopts an existing legacy ShapeOps image instead of duplicating it during hydration', () => {
    const existing = createDefaultShape('image', 40, 60)
    existing.imageUrl = '/workspace/.kun/images/adopted.png'
    useCanvasShapeStore.getState().addShape(existing)
    const blocks: ChatBlock[] = [
      { ...userBlock('user-adopted', target), turnId: 'turn-adopted' },
      {
        kind: 'tool', id: 'image-adopted', turnId: 'turn-adopted',
        summary: 'Generated image', status: 'success', meta: {
          toolName: 'generate_image', generatedFiles: [{
            absolutePath: existing.imageUrl, completionIdentity: 'adopted'
          }]
        }
      }
    ]

    expect(materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target }))
      .toEqual([existing.id])
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(1)
    expect(materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })).toEqual([])
  })

  it('uses a stable receipt for legacy Markdown image results', () => {
    const blocks: ChatBlock[] = [
      { ...userBlock('user-legacy', target), turnId: 'turn-legacy' },
      {
        kind: 'assistant', id: 'assistant-legacy', turnId: 'turn-legacy',
        text: '![Legacy](.kun/images/legacy.png)'
      }
    ]

    const [placedId] = materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })
    expect(placedId).toBeTruthy()
    useCanvasShapeStore.getState().deleteShape(placedId!)

    expect(materializeHistoricalGeneratedImages({ threadId: 'thread', blocks, target })).toEqual([])
  })
  it('centers a deterministic square in the viewport and is idempotent by image URL', () => {
    useCanvasShapeStore.getState().resetDocument()
    useCanvasViewportStore.getState().setVbox({ x: 100, y: 200, width: 1000, height: 600 })

    const firstId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/hero.png')
    const secondId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/hero.png')
    const images = Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')

    expect(secondId).toBe(firstId)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({
      id: firstId,
      name: 'AI image',
      imageUrl: '/workspace/.kun/images/hero.png',
      x: 384,
      y: 284,
      width: 432,
      height: 432
    })
  })

  it('fills one selected empty image placeholder without creating a duplicate', () => {
    useCanvasShapeStore.getState().resetDocument()
    const placeholder = createDefaultShape('image', 20, 30)
    useCanvasShapeStore.getState().addShape(placeholder)
    useCanvasSelectionStore.getState().select([placeholder.id])

    const placedId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/product.png')
    const images = Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')

    expect(placedId).toBe(placeholder.id)
    expect(images).toHaveLength(1)
    expect(images[0]?.imageUrl).toBe('/workspace/.kun/images/product.png')
  })

  it('places a new generated image outside the design-system board', () => {
    const documentKey = '/workspace\0.kun-design/document/board/canvas.json'
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), documentKey)
    useCanvasViewportStore.getState().setVbox({ x: 0, y: 0, width: 1600, height: 1000 })
    useProjectDesignSystemStore.getState().activateWorkspace('/workspace')
    useProjectDesignSystemStore.getState().setReady(parseProjectDesignMd(`---
name: Placement test
colors:
  primary: '#3366ff'
---
# Design
`).document!)
    const board = { x: 160, y: 100, width: 1240, height: 700 }
    setDesignSystemBoardRect(documentKey, board, { persist: false })

    const placedId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/clear.png')
    const image = useCanvasShapeStore.getState().document.objects[placedId ?? '']!
    const overlaps = !(
      image.x + image.width <= board.x ||
      board.x + board.width <= image.x ||
      image.y + image.height <= board.y ||
      board.y + board.height <= image.y
    )

    expect(overlaps).toBe(false)
  })

  it('fills a selected empty holder without changing its bounds', () => {
    useCanvasShapeStore.getState().resetDocument()
    const holder = createDefaultShape('rect', 24, 36)
    holder.width = 360
    holder.height = 220
    holder.aiImageHolder = true
    useCanvasShapeStore.getState().addShape(holder)
    useCanvasSelectionStore.getState().select([holder.id])

    const placedId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/holder.png')
    expect(useCanvasShapeStore.getState().document.objects[placedId ?? '']).toMatchObject({
      id: holder.id,
      type: 'image',
      imageUrl: '/workspace/.kun/images/holder.png',
      x: 24,
      y: 36,
      width: 360,
      height: 220
    })
  })

  it('preserves a filled Design source and places a same-size revision beside it', () => {
    const source = createDefaultShape('image', 100, 200)
    source.name = 'Source'
    source.width = 320
    source.height = 180
    source.imageUrl = '/workspace/.kun/images/source.png'
    useCanvasShapeStore.getState().addShape(source)

    const revisionId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/revision.png', {
      replayKey: 'thread\0turn\0doc\0board\0image:revision',
      target: { id: source.id, expectedImageUrl: source.imageUrl },
      preserveTargetAsRevision: true
    })
    const document = useCanvasShapeStore.getState().document

    expect(document.objects[source.id]?.imageUrl).toBe('/workspace/.kun/images/source.png')
    expect(document.objects[revisionId ?? '']).toMatchObject({
      type: 'image', imageUrl: '/workspace/.kun/images/revision.png',
      x: 500, y: 200, width: 320, height: 180
    })
  })

  it('expands source-relative revision placement when the preferred side is occupied', () => {
    const source = createDefaultShape('image', 100, 200)
    source.width = 320
    source.height = 180
    source.imageUrl = '/workspace/.kun/images/source.png'
    const blocker = createDefaultShape('rect', 500, 200)
    blocker.width = 320
    blocker.height = 180
    useCanvasShapeStore.getState().addShape(source)
    useCanvasShapeStore.getState().addShape(blocker)

    const revisionId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/revision.png', {
      replayKey: 'thread\0turn\0doc\0board\0image:revision-left',
      target: { id: source.id, expectedImageUrl: source.imageUrl },
      preserveTargetAsRevision: true
    })

    expect(useCanvasShapeStore.getState().document.objects[revisionId ?? '']).toMatchObject({
      x: -300, y: 200, width: 320, height: 180
    })
  })

  it('keeps the complete chain when editing a generated revision again', () => {
    const source = createDefaultShape('image', 0, 0)
    source.width = 240
    source.height = 160
    source.imageUrl = '/workspace/.kun/images/source.png'
    useCanvasShapeStore.getState().addShape(source)
    const firstId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/revision-1.png', {
      replayKey: 'thread\0turn-1\0doc\0board\0image:revision-1',
      target: { id: source.id, expectedImageUrl: source.imageUrl },
      preserveTargetAsRevision: true
    })!
    const secondId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/revision-2.png', {
      replayKey: 'thread\0turn-2\0doc\0board\0image:revision-2',
      target: { id: firstId, expectedImageUrl: '/workspace/.kun/images/revision-1.png' },
      preserveTargetAsRevision: true
    })!

    const images = Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')
    expect(images.map((shape) => shape.imageUrl)).toEqual(expect.arrayContaining([
      source.imageUrl,
      '/workspace/.kun/images/revision-1.png',
      '/workspace/.kun/images/revision-2.png'
    ]))
    expect(new Set([source.id, firstId, secondId]).size).toBe(3)
  })

  it('keeps Code-style filled-image edits as in-place replacements', () => {
    const source = createDefaultShape('image', 100, 200)
    source.imageUrl = '/workspace/.kun/images/source.png'
    useCanvasShapeStore.getState().addShape(source)

    const placedId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/replacement.png', {
      target: { id: source.id, expectedImageUrl: source.imageUrl }
    })

    expect(placedId).toBe(source.id)
    expect(useCanvasShapeStore.getState().document.objects[source.id]?.imageUrl)
      .toBe('/workspace/.kun/images/replacement.png')
  })

  it('filters a legacy same-turn update that would overwrite a filled Design source', () => {
    const source = createDefaultShape('image', 100, 200)
    source.imageUrl = '/workspace/.kun/images/source.png'
    useCanvasShapeStore.getState().addShape(source)
    const generatedUrl = '/workspace/.kun/images/revision.png'
    const blocks: ChatBlock[] = [
      {
        kind: 'user', id: 'user-revision', text: 'Edit this image', meta: {
          designDocumentTarget: target,
          designImagePlacementTarget: {
            shapeId: source.id, expectedImageUrl: source.imageUrl
          }
        }
      },
      {
        kind: 'tool', id: 'tool-revision', summary: 'Generated image', status: 'success',
        meta: {
          toolName: 'generate_image',
          generatedFiles: [{ absolutePath: generatedUrl, completionIdentity: 'revision' }]
        }
      }
    ]
    const value = {
      ops: [
        { op: 'update', id: source.id, patch: { imageUrl: generatedUrl } },
        { op: 'update', id: source.id, patch: { opacity: 0.8 } }
      ]
    }

    expect(coalesceGeneratedImageAddsForTurn(
      value, blocks, useCanvasShapeStore.getState().document
    )).toEqual({
      ops: [{ op: 'update', id: source.id, patch: { opacity: 0.8 } }]
    })
  })

  it('reuses an image added by ShapeOps before recording the generated-image receipt', () => {
    const imageUrl = '/workspace/.kun/images/tool-placed.png'
    const toolPlaced = createDefaultShape('image', 12, 24)
    toolPlaced.imageUrl = imageUrl
    useCanvasShapeStore.getState().addShape(toolPlaced)

    const placedId = ensureGeneratedImageOnCanvas(imageUrl, {
      replayKey: 'thread\0turn\0doc\0board\0image:completion-tool',
      preferredShapeIds: [toolPlaced.id]
    })

    expect(placedId).toBe(toolPlaced.id)
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(1)
  })

  it('uses a durable completion receipt and does not resurrect a deleted placement', () => {
    useCanvasShapeStore.getState().resetDocument()
    const replayKey = 'thread\0turn\0doc\0board\0image:completion-1'
    const placedId = ensureGeneratedImageOnCanvas('/workspace/.kun/images/receipt.png', {
      replayKey
    })
    expect(placedId).toBeTruthy()
    useCanvasShapeStore.getState().deleteShape(placedId!)

    expect(ensureGeneratedImageOnCanvas('/workspace/.kun/images/receipt.png', {
      replayKey
    })).toBeNull()
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(0)
  })

  it('places distinct completion identities even when they reuse one image URL', () => {
    const imageUrl = '/workspace/.kun/images/stable-output.png'
    const firstKey = 'thread\0turn\0doc\0board\0image:completion-a'
    const secondKey = 'thread\0turn\0doc\0board\0image:completion-b'

    const firstId = ensureGeneratedImageOnCanvas(imageUrl, { replayKey: firstKey })
    const secondId = ensureGeneratedImageOnCanvas(imageUrl, { replayKey: secondKey })

    expect(secondId).not.toBe(firstId)
    expect(ensureGeneratedImageOnCanvas(imageUrl, { replayKey: firstKey })).toBeNull()
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(2)
  })
})
