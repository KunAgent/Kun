import { describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import {
  pptCanvasOpenRequestForBlock,
  routePptCanvasOpenRequest
} from './workbench-ppt-whiteboard-routing'

function directionBundle() {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-a',
    childId: 'child-a',
    manifestPath: 'deck/.kun-ppt-review/manifest.json',
    previewMode: 'image-first',
    deckTitle: 'Direction deck',
    phase: 'awaiting_direction',
    recommendedDirectionId: 'signal',
    slides: [{ slideId: 'slide-1', index: 0, title: 'Opening' }],
    directions: ['editorial', 'signal', 'warm'].map((directionId, index) => ({
      directionId,
      name: `${directionId} direction`,
      rationale: `A distinct ${directionId} visual direction for this presentation.`,
      revision: 1,
      recommended: directionId === 'signal',
      fonts: [`Display ${index}`, `Body ${index}`],
      colors: ['#0F172A', '#F8FAFC', '#22C55E', '#F59E0B'],
      layout: `${index + 2}-column grid`,
      background: 'solid',
      imagery: 'editorial photography',
      previews: ['cover', 'representative', 'complex'].map((role) => ({
        role,
        imagePath: `.kun/images/${directionId}-${role}.png`
      }))
    }))
  }
}

function reviewBundle() {
  return {
    workflowId: 'workflow-a',
    childId: 'child-a',
    manifestPath: 'deck/.kun-ppt-review/manifest.json',
    deckTitle: 'Review deck',
    styleFingerprint: 'style-a',
    phase: 'awaiting_review',
    slides: [{
      slideId: 'slide-1', index: 0, title: 'Opening', revision: 1,
      status: 'ready', previewPath: '.kun/images/opening.png'
    }]
  }
}

function tool(detail: Record<string, unknown>): ToolBlock {
  return {
    kind: 'tool', id: 'tool-a', summary: 'PPT', status: 'success',
    meta: { toolName: 'ppt_agent' }, detail: JSON.stringify(detail)
  }
}

describe('PPT canvas open routing', () => {
  it('targets the current Work thread and workflow for a direction result', () => {
    expect(pptCanvasOpenRequestForBlock(tool({ directionBundle: directionBundle() }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a', sourcePath: '/work/brief.md'
    })).toEqual({
      target: 'write', reason: 'ppt-direction', blockId: 'tool-a', workspaceRoot: '/work',
      threadId: 'thread-a', workflowId: 'workflow-a', childId: 'child-a', sourcePath: '/work/brief.md',
      title: 'Direction deck',
      pptProjectionRequired: true,
      pptState: { phase: 'directions', revision: 1 }
    })
  })

  it('prefers the review projection and keeps Code compatible', () => {
    expect(pptCanvasOpenRequestForBlock(tool({
      directionBundle: directionBundle(), reviewBundle: reviewBundle()
    }), {
      route: 'chat', workspaceRoot: '/work', threadId: 'thread-a'
    })).toMatchObject({
      target: 'code', reason: 'ppt-review', blockId: 'tool-a',
      threadId: 'thread-a', workflowId: 'workflow-a', childId: 'child-a'
    })
  })

  it('rejects invalid, foreign, and unscoped results', () => {
    expect(pptCanvasOpenRequestForBlock(tool({ directionBundle: { phase: 'awaiting_direction' } }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a'
    })).toBeNull()
    expect(pptCanvasOpenRequestForBlock({ ...tool({ directionBundle: directionBundle() }), meta: { toolName: 'other' } }, {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a'
    })).toBeNull()
    expect(pptCanvasOpenRequestForBlock(tool({ directionBundle: directionBundle() }), {
      route: 'write', workspaceRoot: '/work', threadId: null
    })).toBeNull()
  })

  it('reports Work persistence failure so the caller may retry the block', async () => {
    const openCode = vi.fn()
    const openWork = vi.fn(async () => false)
    const request = pptCanvasOpenRequestForBlock(tool({ reviewBundle: reviewBundle() }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a'
    })!

    await expect(routePptCanvasOpenRequest(request, { openCode, openWork })).resolves.toBe(false)
    expect(openWork).toHaveBeenCalledWith(request)
    expect(openCode).not.toHaveBeenCalled()
  })

  it('prefers the payload title over the structured deck title', () => {
    expect(pptCanvasOpenRequestForBlock(tool({
      title: '  Text completion landscape  ', directionBundle: directionBundle()
    }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a'
    })).toMatchObject({
      target: 'write', title: 'Text completion landscape'
    })
  })

  it('falls back to the source-based legacy title when no title fields exist', () => {
    expect(pptCanvasOpenRequestForBlock(tool({
      childId: 'child-a', workflowId: 'workflow-a', phase: 'completed',
      deckArtifact: { output: 'presentations/final.pptx' }
    }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a', sourcePath: '/work/quarterly-brief.md'
    })).toMatchObject({
      title: 'quarterly-brief · Presentation review'
    })
    expect(pptCanvasOpenRequestForBlock(tool({
      childId: 'child-a', workflowId: 'workflow-a', phase: 'completed'
    }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a'
    })).toBeNull()
  })

  it('projects completed output metadata onto the bound Work whiteboard', () => {
    expect(pptCanvasOpenRequestForBlock(tool({
      childId: 'child-a', workflowId: 'workflow-a', phase: 'completed',
      deckArtifact: { output: 'presentations/final.pptx' }
    }), {
      route: 'write', workspaceRoot: '/work', threadId: 'thread-a'
    })).toMatchObject({
      target: 'write', reason: 'ppt-review', workflowId: 'workflow-a', childId: 'child-a',
      pptState: { phase: 'complete', revision: 0, outputPath: 'presentations/final.pptx' }
    })
  })
})
