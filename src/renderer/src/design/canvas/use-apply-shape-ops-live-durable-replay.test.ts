import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { canvasDocumentKey } from './canvas-persistence'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { createDefaultShape, createEmptyDocument } from './canvas-types'
import {
  reconcileImageGenerationProgress,
  useImageGenerationProgressStore
} from './canvas-image-generation-progress'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { useApplyShapeOpsLive } from './use-apply-shape-ops-live'

const durableTarget = { documentId: 'doc-design', boardArtifactId: 'board-design' }
const durableDocumentKey = canvasDocumentKey(
  '/workspace', durableTarget.boardArtifactId, `.kun-design/${durableTarget.documentId}`
)

function DurableDesignReplayHarness(): null {
  useApplyShapeOpsLive(
    true, undefined, undefined, undefined, 'thread-design', undefined, undefined,
    durableTarget, durableDocumentKey
  )
  return null
}

describe('useApplyShapeOpsLive durable Design replay', () => {
  it('replays a filled-image edit as a preserved source plus an adjacent revision', async () => {
    const previous = useChatStore.getState()
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    const source = createDefaultShape('image', 40, 60)
    source.width = 300
    source.height = 180
    source.imageUrl = '/workspace/.kun/images/source.png'
    useCanvasShapeStore.getState().addShape(source)
    const generatedUrl = '/workspace/.kun/images/revision.png'
    const blocks: ChatBlock[] = [
      {
        kind: 'user', id: 'user-revision', turnId: 'turn-revision', text: 'Edit this image',
        meta: {
          designDocumentTarget: durableTarget,
          designImagePlacementTarget: {
            shapeId: source.id, expectedImageUrl: source.imageUrl
          }
        }
      },
      {
        kind: 'tool', id: 'tool-generate-revision', turnId: 'turn-revision',
        summary: 'Generated image', status: 'success', detail: '{}',
        meta: {
          toolName: 'generate_image', sourceItemKind: 'tool_result',
          generatedFiles: [{ absolutePath: generatedUrl, completionIdentity: 'revision' }]
        }
      },
      {
        kind: 'tool', id: 'tool-update-source', turnId: 'turn-revision',
        summary: 'Update source', status: 'success',
        meta: { toolName: 'design_update_shapes', sourceItemKind: 'tool_result' },
        detail: JSON.stringify({
          ops: [{ op: 'update', id: source.id, patch: { imageUrl: generatedUrl } }]
        })
      }
    ]
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: null, currentTurnUserId: null,
      busy: false, blocks, liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    const images = Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')

    expect(useCanvasShapeStore.getState().document.objects[source.id]?.imageUrl)
      .toBe('/workspace/.kun/images/source.png')
    expect(images).toHaveLength(2)
    expect(images.find((shape) => shape.id !== source.id)).toMatchObject({
      imageUrl: generatedUrl, width: 300, height: 180, x: 420, y: 60
    })
    expect([...useCanvasSelectionStore.getState().selectedIds]).toEqual([
      images.find((shape) => shape.id !== source.id)!.id
    ])

    await act(async () => renderer?.unmount())
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })

  it('materializes a successful HTML-profile image before turn completion and coalesces a legacy add', async () => {
    const previous = useChatStore.getState()
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    useCanvasViewportStore.setState({
      containerWidth: 800,
      containerHeight: 600,
      vbox: { x: -400, y: -300, width: 800, height: 600 }
    })
    const running: ChatBlock = {
      kind: 'tool', id: 'tool-live-image', turnId: 'turn-live-image',
      summary: 'Generating image', status: 'running', detail: '{"prompt":"hero"}',
      meta: { toolName: 'generate_image', sourceItemKind: 'tool_call' }
    }
    const progress = reconcileImageGenerationProgress([running])
    useImageGenerationProgressStore.getState().replaceEntries(progress.entries)
    const placeholderId = progress.entries['tool-live-image']!.shapeId
    const user: ChatBlock = {
      kind: 'user', id: 'user-live-image', turnId: 'turn-live-image', text: 'Build with an image',
      meta: {
        designDocumentTarget: durableTarget,
        designProfile: {
          version: 1, documentTarget: durableTarget, outputMedium: 'html',
          target: 'web', preset: 'none', context: { tone: [] }
        }
      }
    }
    const background: ChatBlock = {
      kind: 'assistant', id: 'assistant-live-image', turnId: 'turn-live-image',
      text: '```shapeops\n[{"op":"add","shape":{"type":"rect","name":"Card","x":-40,"y":-30,"width":180,"height":120}}]\n```'
    }
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: 'turn-live-image',
      currentTurnUserId: user.id, busy: true, blocks: [user, background, running], liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    const success: ChatBlock = {
      ...running, status: 'success', meta: {
        toolName: 'generate_image', sourceItemKind: 'tool_result',
        generatedFiles: [{
          relativePath: '.kun/images/live.png',
          absolutePath: '/workspace/.kun/images/live.png',
          completionIdentity: 'live-completion', width: 1200, height: 600
        }]
      }
    }
    await act(async () => {
      useChatStore.setState({ blocks: [user, background, success] })
    })

    const image = useCanvasShapeStore.getState().document.objects[placeholderId]!
    const card = Object.values(useCanvasShapeStore.getState().document.objects)
      .find((shape) => shape.name === 'Card')!
    expect(useChatStore.getState().currentTurnId).toBe('turn-live-image')
    expect(image).toMatchObject({
      type: 'image', imageUrl: '/workspace/.kun/images/live.png',
      width: 432, height: 216, aiImageHolder: false
    })
    expect(image.x + image.width <= card.x || card.x + card.width <= image.x ||
      image.y + image.height <= card.y || card.y + card.height <= image.y).toBe(true)

    const legacyAdd: ChatBlock = {
      kind: 'tool', id: 'tool-legacy-add', turnId: 'turn-live-image',
      summary: 'Add generated image', status: 'success',
      meta: { toolName: 'design_update_shapes', sourceItemKind: 'tool_result' },
      detail: '{"ops":[{"op":"add","shape":{"type":"image","name":"Duplicate","x":0,"y":0,"width":432,"height":216,"imageUrl":".kun/images/live.png"}}]}'
    }
    await act(async () => {
      useChatStore.setState({ blocks: [user, background, success, legacyAdd] })
    })
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image' && shape.imageUrl === '/workspace/.kun/images/live.png'))
      .toHaveLength(1)

    await act(async () => renderer?.unmount())
    useImageGenerationProgressStore.setState({ entries: {} })
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasViewportStore.getState().resetView()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })

  it('materializes an already successful active result after the bound canvas finishes hydrating', async () => {
    const previous = useChatStore.getState()
    const user: ChatBlock = {
      kind: 'user', id: 'user-delayed-image', turnId: 'turn-delayed-image', text: 'Create an image',
      meta: { designDocumentTarget: durableTarget }
    }
    const success: ChatBlock = {
      kind: 'tool', id: 'tool-delayed-image', turnId: 'turn-delayed-image',
      summary: 'Generated image', status: 'success', detail: '{}',
      meta: {
        toolName: 'generate_image', sourceItemKind: 'tool_result',
        generatedFiles: [{
          absolutePath: '/workspace/.kun/images/delayed.png',
          completionIdentity: 'delayed-completion', width: 800, height: 800
        }]
      }
    }
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), 'stale-canvas-document')
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: 'turn-delayed-image',
      currentTurnUserId: user.id, busy: true, blocks: [user, success], liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(0)

    await act(async () => {
      useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    })
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image' && shape.imageUrl === '/workspace/.kun/images/delayed.png'))
      .toHaveLength(1)

    await act(async () => renderer?.unmount())
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })

  it('shares receipts between live application and idle remount replay', async () => {
    const previous = useChatStore.getState()
    const blocks: ChatBlock[] = [
      {
        kind: 'user', id: 'user-live', turnId: 'turn-live', text: 'Build live',
        meta: { designDocumentTarget: durableTarget }
      },
      {
        kind: 'assistant', id: 'assistant-live', turnId: 'turn-live',
        text: '```shapeops\n[{"op":"add","shape":{"type":"rect","name":"Live card","x":10,"y":10,"width":100,"height":60}}]\n```'
      }
    ]
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: 'turn-live',
      currentTurnUserId: 'user-live', busy: true, blocks, liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    const visibleShapes = () => Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.id !== useCanvasShapeStore.getState().document.rootId)
    expect(visibleShapes()).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.rendererReplayKeys).toHaveLength(1)

    await act(async () => {
      useChatStore.setState({ currentTurnId: null, currentTurnUserId: null, busy: false })
      const materialized = useCanvasShapeStore.getState().document
      expect(materialized.rendererReplayWatermarkTurnId).toBe('turn-live')
      useCanvasShapeStore.getState().loadDocument({
        ...materialized,
        rendererReplayKeys: Array.from({ length: 4096 }, (_, index) => `evicted:${index}`)
      }, durableDocumentKey)
      renderer?.unmount()
      renderer = create(createElement(DurableDesignReplayHarness))
    })
    expect(visibleShapes()).toHaveLength(1)

    await act(async () => renderer?.unmount())
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })

  it('replays missed ShapeOps and generated images after remount and reload', async () => {
    const previous = useChatStore.getState()
    const blocks: ChatBlock[] = [
      {
        kind: 'user', id: 'user-shapes', turnId: 'turn-shapes', text: 'Build the board',
        meta: { designDocumentTarget: durableTarget }
      },
      {
        kind: 'assistant', id: 'assistant-shapes', turnId: 'turn-shapes',
        text: '```design_canvas\n{"action":"update_shapes","ops":[{"op":"add","shape":{"type":"text","name":"Title","textContent":"Dashboard","x":20,"y":20,"width":200,"height":40}}]}\n```'
      },
      {
        kind: 'tool', id: 'tool-shapes', turnId: 'turn-shapes', summary: 'Add card', status: 'success',
        meta: { toolName: 'design_update_shapes', sourceItemKind: 'tool_result' },
        detail: '{"ops":[{"op":"add","shape":{"type":"rect","name":"Card","x":20,"y":80,"width":240,"height":120}}]}'
      },
      {
        kind: 'user', id: 'user-image', turnId: 'turn-image', text: 'Create the hero image',
        meta: { designDocumentTarget: durableTarget }
      },
      {
        kind: 'tool', id: 'tool-image', turnId: 'turn-image', summary: 'Generated image', status: 'success',
        detail: '{}',
        meta: {
          toolName: 'generate_image', sourceItemKind: 'tool_result',
          generatedFiles: [{ relativePath: '.kun/images/hero.png', absolutePath: '/workspace/.kun/images/hero.png' }]
        }
      }
    ]
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: null, currentTurnUserId: null,
      busy: false, blocks, liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    const visibleShapes = () => Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.id !== useCanvasShapeStore.getState().document.rootId)
    expect(visibleShapes().map((shape) => shape.type).sort()).toEqual(['image', 'rect', 'text'])

    await act(async () => renderer?.unmount())
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    expect(visibleShapes()).toHaveLength(3)

    await act(async () => {
      useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    })
    expect(visibleShapes().map((shape) => shape.type).sort()).toEqual(['image', 'rect', 'text'])

    await act(async () => renderer?.unmount())
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })

  it('places a primary AI-image result even when the same turn applies ShapeOps', async () => {
    const previous = useChatStore.getState()
    const blocks: ChatBlock[] = [
      {
        kind: 'user', id: 'user-image-and-shape', turnId: 'turn-image-and-shape',
        text: 'Create the campaign visual',
        meta: {
          designDocumentTarget: durableTarget,
          designProfile: {
            version: 1,
            documentTarget: durableTarget,
            outputMedium: 'image',
            target: 'web',
            preset: 'none',
            context: { tone: [] }
          }
        }
      },
      {
        kind: 'assistant', id: 'assistant-image-and-shape', turnId: 'turn-image-and-shape',
        text: '```shapeops\n[{"op":"add","shape":{"type":"rect","name":"Backdrop","x":10,"y":10,"width":320,"height":240}}]\n```'
      },
      {
        kind: 'tool', id: 'tool-image-and-shape', turnId: 'turn-image-and-shape',
        summary: 'Generated image', status: 'success', detail: '{}',
        meta: {
          toolName: 'generate_image', sourceItemKind: 'tool_result',
          generatedFiles: [{
            relativePath: '.kun/images/campaign.png',
            absolutePath: '/workspace/.kun/images/campaign.png',
            completionIdentity: 'image-completion-1'
          }]
        }
      }
    ]
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: null, currentTurnUserId: null,
      busy: false, blocks, liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    const visibleShapes = () => Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.id !== useCanvasShapeStore.getState().document.rootId)
    expect(visibleShapes().map((shape) => shape.type).sort()).toEqual(['image', 'rect'])
    expect(useCanvasShapeStore.getState().document.rendererReplayKeys)
      .toEqual(expect.arrayContaining([expect.stringContaining('image:image-completion-1')]))

    await act(async () => {
      renderer?.unmount()
      renderer = create(createElement(DurableDesignReplayHarness))
    })
    expect(visibleShapes().map((shape) => shape.type).sort()).toEqual(['image', 'rect'])

    await act(async () => renderer?.unmount())
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })

  it('restores an original image-holder placement after app restart', async () => {
    const previous = useChatStore.getState()
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), durableDocumentKey)
    const holder = createDefaultShape('rect', 72, 96)
    holder.width = 480
    holder.height = 270
    useCanvasShapeStore.getState().addShape(holder)
    const persistedBeforeCompletion = structuredClone(useCanvasShapeStore.getState().document)
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasShapeStore.getState().loadDocument(persistedBeforeCompletion, durableDocumentKey)
    const blocks: ChatBlock[] = [
      {
        kind: 'user', id: 'user-restart-image', turnId: 'turn-restart-image',
        text: 'Generate the hero',
        meta: {
          designDocumentTarget: durableTarget,
          designProfile: {
            version: 1, documentTarget: durableTarget, outputMedium: 'image',
            target: 'web', preset: 'none', context: { tone: [] }
          },
          designImagePlacementTarget: {
            shapeId: holder.id, expectedHolderKind: 'implicit-rect'
          }
        }
      },
      {
        kind: 'tool', id: 'tool-restart-image', turnId: 'turn-restart-image',
        summary: 'Generated image', status: 'success', detail: '{}',
        meta: {
          toolName: 'generate_image', sourceItemKind: 'tool_result',
          generatedFiles: [{
            absolutePath: '/workspace/.kun/images/restarted.png',
            completionIdentity: 'restart-completion'
          }]
        }
      }
    ]
    useChatStore.setState({
      activeThreadId: 'thread-design', currentTurnId: null,
      currentTurnUserId: null, busy: false, blocks, liveAssistant: ''
    })

    let renderer: ReturnType<typeof create> | undefined
    await act(async () => { renderer = create(createElement(DurableDesignReplayHarness)) })
    expect(useCanvasShapeStore.getState().document.objects[holder.id]).toMatchObject({
      id: holder.id, type: 'image', imageUrl: '/workspace/.kun/images/restarted.png',
      x: 72, y: 96, width: 480, height: 270
    })
    expect(Object.values(useCanvasShapeStore.getState().document.objects)
      .filter((shape) => shape.type === 'image')).toHaveLength(1)

    await act(async () => renderer?.unmount())
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useChatStore.setState({
      activeThreadId: previous.activeThreadId, currentTurnId: previous.currentTurnId,
      currentTurnUserId: previous.currentTurnUserId, busy: previous.busy,
      blocks: previous.blocks, liveAssistant: previous.liveAssistant
    })
  })
})
