import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  activeCanvasTurnMatchesThread,
  canvasReplayStateForStoreUpdate,
  hasDispatchedSvgFollowup,
  latestGeneratedImageRelativePathForTurn,
  latestGeneratedImageUrlForTurn,
  looksLikeExistingCanvasImageEditRequest,
  replayActiveCanvasTurn,
  resolveGeneratedImageFallbackTarget,
  rewriteGeneratedImageUrlsForTurn,
  shouldApplyDesignCanvasToolBlock,
  shouldApplyDurableSvgCreate,
  shouldReplayIdleCanvasToolBlock,
  takeNextReadyScreenGeneration
} from './use-apply-shape-ops-live'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape } from './canvas-types'

describe('replayActiveCanvasTurn', () => {
  it('marks durable SVG and Motion results for idle remount replay', () => {
    const block = (toolName: string): ToolBlock => ({
      kind: 'tool',
      id: `tool-${toolName}`,
      summary: toolName,
      status: 'success',
      meta: { toolName, sourceItemKind: 'tool_result' },
      detail: '{}'
    })
    expect(shouldReplayIdleCanvasToolBlock(block('design_motion_upsert_keyframes'))).toBe(true)
    expect(shouldReplayIdleCanvasToolBlock(block('design_svg_create'))).toBe(true)
    expect(shouldReplayIdleCanvasToolBlock(block('design_update_shapes'))).toBe(false)
  })

  it('replays existing tool blocks and streaming text when enabled mid-turn', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-1',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'draw a diagram' },
          toolBlock,
          { kind: 'assistant', id: 'assistant-1', text: 'Working on it.' }
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(toolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('replays only tool blocks after the current turn user block', () => {
    const oldToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-old',
      summary: 'old canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const currentToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-current',
      summary: 'current canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: 'turn-2',
        currentTurnUserId: 'user-2',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'old request' },
          oldToolBlock,
          { kind: 'assistant', id: 'assistant-1', text: 'Done.' },
          { kind: 'user', id: 'user-2', text: 'current request' },
          currentToolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(currentToolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('stops replay at the next user block if the current user id is stale', () => {
    const currentToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-current',
      summary: 'current canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const nextToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-next',
      summary: 'next canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'current request' },
          currentToolBlock,
          { kind: 'user', id: 'user-2', text: 'future request' },
          nextToolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(currentToolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no turn is active', () => {
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: null,
        blocks: [
          {
            kind: 'tool',
            id: 'tool-1',
            summary: 'canvas op',
            status: 'success',
            meta: { toolName: 'design_update_shapes' },
            detail: '{"ops":[]}'
          }
        ]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).not.toHaveBeenCalled()
    expect(processStreaming).not.toHaveBeenCalled()
  })

  it('can scope replay to the active code whiteboard thread', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-1',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        activeThreadId: 'thread-code',
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'draw a diagram' },
          toolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming,
      'thread-code'
    )

    expect(activeCanvasTurnMatchesThread({ activeThreadId: 'thread-code' }, 'thread-code')).toBe(true)
    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('does not replay canvas output from another thread', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-foreign',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        activeThreadId: 'thread-other',
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'draw a diagram' },
          toolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming,
      'thread-code'
    )

    expect(activeCanvasTurnMatchesThread({ activeThreadId: 'thread-other' }, 'thread-code')).toBe(false)
    expect(applyToolBlock).not.toHaveBeenCalled()
    expect(processStreaming).not.toHaveBeenCalled()
  })

  it('can replay tool blocks that arrive in the same update that clears the turn id', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-late',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()
    const replayState = canvasReplayStateForStoreUpdate(
      {
        activeThreadId: 'thread-code',
        currentTurnId: null,
        currentTurnUserId: null,
        blocks: [
          { kind: 'user', id: 'user-1', text: 'put it on the canvas' },
          toolBlock
        ] satisfies ChatBlock[]
      },
      {
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1'
      }
    )

    replayActiveCanvasTurn(replayState, applyToolBlock, processStreaming, 'thread-code')

    expect(replayState.currentTurnId).toBe('turn-1')
    expect(replayState.currentTurnUserId).toBe('user-1')
    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(toolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('only treats final tool_result blocks as renderer-applied design tool output', () => {
    const completedCall: ToolBlock = {
      kind: 'tool',
      id: 'tool-call-1',
      summary: 'design_create_screen',
      status: 'success',
      meta: { toolName: 'design_create_screen', sourceItemKind: 'tool_call' },
      detail: '{"name":"Home","brief":"Create a landing page"}'
    }
    const finalResult: ToolBlock = {
      ...completedCall,
      meta: { toolName: 'design_create_screen', sourceItemKind: 'tool_result' },
      detail: '{"ok":true,"tool":"design_create_screen","action":"create_screen","ops":[{"op":"add-screen","name":"Home"}]}'
    }
    const legacyResult: ToolBlock = {
      ...finalResult,
      meta: { toolName: 'design_create_screen' }
    }

    expect(shouldApplyDesignCanvasToolBlock(completedCall)).toBe(false)
    expect(shouldApplyDesignCanvasToolBlock(finalResult)).toBe(true)
    expect(shouldApplyDesignCanvasToolBlock(legacyResult)).toBe(true)
    expect(shouldApplyDesignCanvasToolBlock({
      ...finalResult,
      id: 'tool-export-1',
      meta: { toolName: 'design_export_canvas', sourceItemKind: 'tool_result' },
      detail: '{"ok":true,"action":"export_canvas"}'
    })).toBe(true)
    expect(shouldApplyDesignCanvasToolBlock({
      ...finalResult,
      id: 'tool-motion-1',
      meta: { toolName: 'design_motion_upsert_keyframes', sourceItemKind: 'tool_result' },
      detail: '{"ok":true,"motionOps":[]}'
    })).toBe(true)
  })
})

describe('durable SVG create replay', () => {
  const toolBlock: ToolBlock = {
    kind: 'tool',
    id: 'tool-svg-1',
    summary: 'create svg',
    status: 'success',
    meta: { toolName: 'design_svg_create', sourceItemKind: 'tool_result' },
    detail: '{}'
  }
  const baseArtifact = {
    id: 'svg-aabbccddeeff',
    kind: 'svg' as const,
    title: 'Orbit',
    relativePath: '.kun-design/doc/svg-aabbccddeeff/v1.svg',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    versions: []
  }

  it('replays a stable create result when its artifact was never reserved', () => {
    expect(shouldApplyDurableSvgCreate({
      artifactId: baseArtifact.id,
      toolBlockId: toolBlock.id,
      artifacts: [],
      blocks: [toolBlock]
    })).toBe(true)
  })

  it('recovers a pending artifact only while no dedicated follow-up exists', () => {
    const pending = { ...baseArtifact, previewStatus: 'pending' as const }
    expect(shouldApplyDurableSvgCreate({
      artifactId: pending.id,
      toolBlockId: toolBlock.id,
      artifacts: [pending],
      blocks: [toolBlock]
    })).toBe(true)

    const blocks: ChatBlock[] = [
      toolBlock,
      {
        kind: 'user',
        id: 'user-svg-followup',
        text: `Reserved SVG file: ${pending.relativePath}\nUse the structured SVG tools.`
      }
    ]
    expect(hasDispatchedSvgFollowup(blocks, toolBlock.id, pending.relativePath)).toBe(true)
    expect(shouldApplyDurableSvgCreate({
      artifactId: pending.id,
      toolBlockId: toolBlock.id,
      artifacts: [pending],
      blocks
    })).toBe(false)
  })

  it('does not replay completed artifacts or legacy results without a stable id', () => {
    expect(shouldApplyDurableSvgCreate({
      artifactId: baseArtifact.id,
      toolBlockId: toolBlock.id,
      artifacts: [{ ...baseArtifact, previewStatus: 'ready' }],
      blocks: [toolBlock]
    })).toBe(false)
    expect(shouldApplyDurableSvgCreate({
      toolBlockId: toolBlock.id,
      artifacts: [],
      blocks: [toolBlock]
    })).toBe(false)
  })
})

describe('generated image canvas fallback helpers', () => {
  it('detects existing-image edit requests from visible user copy', () => {
    expect(looksLikeExistingCanvasImageEditRequest('按图片批注修改：换个颜色的鞋')).toBe(true)
    expect(looksLikeExistingCanvasImageEditRequest('change the selected image shoes to red')).toBe(true)
    expect(looksLikeExistingCanvasImageEditRequest('生成一个新的品牌 logo')).toBe(false)
  })

  it('extracts the newest generated image file from generate_image tool blocks', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'generate',
        status: 'success',
        meta: {
          toolName: 'generate_image',
          generatedFiles: [{ relativePath: '.deepseekgui-images/old.png' }]
        }
      },
      {
        kind: 'tool',
        id: 'tool-2',
        summary: 'speech',
        status: 'success',
        meta: {
          toolName: 'generate_speech',
          generatedFiles: [{ relativePath: '.deepseekgui-audio/voice.mp3' }]
        }
      },
      {
        kind: 'tool',
        id: 'tool-3',
        summary: 'generate',
        status: 'success',
        meta: {
          toolName: 'mcp__kun__generate_image',
          generatedFiles: [{ relativePath: '.deepseekgui-images/new.png' }]
        }
      }
    ]

    expect(latestGeneratedImageRelativePathForTurn(blocks)).toBe('.deepseekgui-images/new.png')
  })

  it('prefers absolute generated image paths for canvas image URLs', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'generate',
        status: 'success',
        meta: {
          toolName: 'generate_image',
          generatedFiles: [{
            relativePath: '.deepseekgui-images/new.png',
            absolutePath: '/Users/zxy/.kun/default_workspace/.deepseekgui-images/new.png'
          }]
        }
      }
    ]

    expect(latestGeneratedImageUrlForTurn(blocks)).toBe('/Users/zxy/.kun/default_workspace/.deepseekgui-images/new.png')
    expect(
      rewriteGeneratedImageUrlsForTurn(
        {
          action: 'update_shapes',
          ops: [{
            op: 'update',
            id: 'shape-1',
            patch: { imageUrl: '.deepseekgui-images/new.png' }
          }]
        },
        blocks
      )
    ).toEqual({
      action: 'update_shapes',
      ops: [{
        op: 'update',
        id: 'shape-1',
        patch: { imageUrl: '/Users/zxy/.kun/default_workspace/.deepseekgui-images/new.png' }
      }]
    })
  })

  it('extracts generated image paths from assistant markdown image output', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'assistant',
        id: 'assistant-1',
        text: 'Done.\n![generated image](.deepseekgui-images/native.png)\n'
      }
    ]

    expect(latestGeneratedImageRelativePathForTurn(blocks)).toBe('.deepseekgui-images/native.png')
  })

  it('resolves a fallback target only for one selected filled image', () => {
    const document = createEmptyDocument()
    const image = createDefaultShape('image', 0, 0)
    image.imageUrl = '.deepseekgui-images/source.png'
    document.objects[image.id] = image
    document.objects[document.rootId] = {
      ...document.objects[document.rootId]!,
      children: [image.id]
    }

    expect(
      resolveGeneratedImageFallbackTarget({
        document,
        selectedIds: new Set([image.id]),
        userText: '换个颜色的鞋'
      })
    ).toEqual({ id: image.id, imageUrl: '.deepseekgui-images/source.png' })
    expect(
      resolveGeneratedImageFallbackTarget({
        document,
        selectedIds: new Set([image.id]),
        userText: '生成一个新的品牌 logo'
      })
    ).toBeNull()
    expect(
      resolveGeneratedImageFallbackTarget({
        document,
        selectedIds: new Set(),
        userText: '换个颜色的鞋'
      })
    ).toBeNull()
  })
})

describe('screen generation queue helpers', () => {
  it('waits while a chat turn is active without consuming the queue', () => {
    const document = createEmptyDocument()
    const frame = createHtmlFrameShape('Home', 0, 0, 'artifact-home', 'desktop')
    document.objects[frame.id] = frame
    const queue = [{ shapeId: frame.id, userPrompt: 'make a home screen' }]

    expect(takeNextReadyScreenGeneration({
      pendingScreens: queue,
      document,
      currentTurnId: 'turn-running'
    })).toBeNull()
    expect(queue).toHaveLength(1)
  })

  it('waits while chat is busy without consuming the queue', () => {
    const document = createEmptyDocument()
    const frame = createHtmlFrameShape('Home', 0, 0, 'artifact-home', 'desktop')
    document.objects[frame.id] = frame
    const queue = [{ shapeId: frame.id, userPrompt: 'make a home screen' }]

    expect(takeNextReadyScreenGeneration({
      pendingScreens: queue,
      document,
      currentTurnId: null,
      busy: true
    })).toBeNull()
    expect(queue).toHaveLength(1)
  })

  it('waits while runtime work is still pending without consuming the queue', () => {
    const document = createEmptyDocument()
    const frame = createHtmlFrameShape('Home', 0, 0, 'artifact-home', 'desktop')
    document.objects[frame.id] = frame
    const queue = [{ shapeId: frame.id, userPrompt: 'make a home screen' }]

    expect(takeNextReadyScreenGeneration({
      pendingScreens: queue,
      document,
      currentTurnId: null,
      pendingRuntimeWork: true
    })).toBeNull()
    expect(queue).toHaveLength(1)
  })

  it('skips deleted or non-html frames and returns the next live html screen', () => {
    const document = createEmptyDocument()
    const plainFrame = createDefaultShape('frame', 0, 0)
    const htmlFrame = createHtmlFrameShape('Settings', 0, 0, 'artifact-settings', 'desktop')
    document.objects[plainFrame.id] = plainFrame
    document.objects[htmlFrame.id] = htmlFrame
    const queue = [
      { shapeId: 'deleted-screen', userPrompt: 'deleted' },
      { shapeId: plainFrame.id, userPrompt: 'plain frame' },
      { shapeId: htmlFrame.id, userPrompt: 'settings', brief: 'Settings screen' }
    ]

    expect(takeNextReadyScreenGeneration({
      pendingScreens: queue,
      document,
      currentTurnId: null
    })).toEqual({ shapeId: htmlFrame.id, userPrompt: 'settings', brief: 'Settings screen' })
    expect(queue).toEqual([])
  })

  it('skips html frames whose artifact link no longer exists', () => {
    const document = createEmptyDocument()
    const removedArtifactFrame = createHtmlFrameShape('Deleted', 0, 0, 'artifact-deleted', 'desktop')
    const liveArtifactFrame = createHtmlFrameShape('Live', 0, 0, 'artifact-live', 'desktop')
    document.objects[removedArtifactFrame.id] = removedArtifactFrame
    document.objects[liveArtifactFrame.id] = liveArtifactFrame
    const queue = [
      { shapeId: removedArtifactFrame.id, userPrompt: 'deleted' },
      { shapeId: liveArtifactFrame.id, userPrompt: 'live' }
    ]

    expect(takeNextReadyScreenGeneration({
      pendingScreens: queue,
      document,
      currentTurnId: null,
      htmlArtifactIds: new Set(['artifact-live'])
    })).toEqual({ shapeId: liveArtifactFrame.id, userPrompt: 'live' })
    expect(queue).toEqual([])
  })
})
