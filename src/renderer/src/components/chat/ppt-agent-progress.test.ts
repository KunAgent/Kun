import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import {
  pptAgentAction,
  pptAgentProgress,
  pptWorkflowHasLaterCall,
  pptWorkflowUsedDirections,
  readPptAgentResult,
  type PptProgressStepState
} from './ppt-agent-progress'

function states(progress: ReturnType<typeof pptAgentProgress>): Record<string, PptProgressStepState> {
  return Object.fromEntries(progress.steps.map((step) => [step.id, step.state]))
}

function pptBlock(id: string, detail: Record<string, unknown>, action?: string): ChatBlock {
  return {
    kind: 'tool',
    id,
    summary: 'ppt_agent',
    status: 'success',
    detail: JSON.stringify(detail),
    meta: { toolName: 'ppt_agent', ...(action ? { action } : {}) }
  }
}

const reviewResult = {
  workflowId: 'ppt_1',
  childId: 'child_1',
  phase: 'awaiting_review',
  imageAssets: 'unavailable',
  reviewBundle: {
    slides: [
      { slideId: 's1', assets: [{ path: 'deck/media/line.png', origin: 'user' }] },
      { slideId: 's2', assets: [{ path: 'deck/media/line.png', origin: 'user' }, { path: 'deck/media/scene.png', origin: 'generated' }] },
      { slideId: 's3' }
    ]
  }
}

describe('readPptAgentResult', () => {
  it('summarizes review pages, unique image origins, and native-only slides', () => {
    expect(readPptAgentResult(JSON.stringify(reviewResult))).toEqual({
      workflowId: 'ppt_1',
      childId: 'child_1',
      phase: 'awaiting_review',
      imageAssets: 'unavailable',
      review: { slides: 3, userImages: 1, generatedImages: 1, projectImages: 0, nativeSlides: 1 }
    })
  })

  it('reads directions, QA counts, and the validated deck', () => {
    const result = readPptAgentResult(JSON.stringify({
      workflowId: 'ppt_1',
      phase: 'completed',
      directionBundle: { directions: [{ name: 'Calm', recommended: false }, { name: 'Bold', recommended: true }] },
      reviewBundle: { slides: [{ slideId: 's1', qaIssues: [{ severity: 'warning' }, { severity: 'unchecked' }] }] },
      deckArtifact: { output: 'presentations/q3.pptx', slides: 12, editableSlides: 12, validated: true }
    }))
    expect(result).toMatchObject({
      directions: { count: 2, recommendedName: 'Bold' },
      review: { slides: 1, nativeSlides: 1, qa: { errors: 0, warnings: 1 } },
      deck: { output: 'presentations/q3.pptx', slides: 12, editableSlides: 12, validated: true }
    })
  })

  it('ignores argument payloads and malformed details', () => {
    expect(readPptAgentResult(JSON.stringify({ action: 'start', title: 'Deck' }))).toBeUndefined()
    expect(readPptAgentResult('not json')).toBeUndefined()
  })
})

describe('pptAgentProgress', () => {
  it('waits on review with the direction step skipped for a direct start', () => {
    const progress = pptAgentProgress({
      action: 'start', result: readPptAgentResult(JSON.stringify(reviewResult)),
      running: false, failed: false, usedDirections: false
    })
    expect(states(progress)).toEqual({
      plan: 'done', direction: 'skipped', build: 'done', preview: 'done', review: 'waiting', export: 'todo'
    })
  })

  it('waits on the direction choice', () => {
    const progress = pptAgentProgress({
      action: 'start',
      result: readPptAgentResult(JSON.stringify({ workflowId: 'ppt_1', phase: 'awaiting_direction', directionBundle: { directions: [{}] } })),
      running: false, failed: false, usedDirections: false
    })
    expect(states(progress)).toMatchObject({ plan: 'done', direction: 'waiting', build: 'todo' })
  })

  it('follows the child live, using only tools that belong to one step', () => {
    const planning = pptAgentProgress({ action: 'start', running: true, failed: false, usedDirections: false, activityTool: 'write' })
    expect(states(planning)).toMatchObject({ plan: 'current', direction: 'todo' })
    const sampling = pptAgentProgress({
      action: 'start', running: true, failed: false, usedDirections: false, activityTool: 'ppt_create_direction_bundle'
    })
    expect(states(sampling)).toMatchObject({ plan: 'done', direction: 'current' })
    const rendering = pptAgentProgress({
      action: 'start', running: true, failed: false, usedDirections: false, activityTool: 'ppt_generate_previews'
    })
    expect(states(rendering)).toMatchObject({ plan: 'done', direction: 'skipped', build: 'done', preview: 'current' })
  })

  it('marks export as the failing step of an approval and completes everything on success', () => {
    const failed = pptAgentProgress({
      action: 'approve_and_build',
      result: readPptAgentResult(JSON.stringify({ workflowId: 'ppt_1', phase: 'failed_recoverable' })),
      running: false, failed: true, usedDirections: true
    })
    expect(states(failed)).toMatchObject({ direction: 'done', review: 'done', export: 'error' })
    const done = pptAgentProgress({
      action: 'approve_and_build',
      result: readPptAgentResult(JSON.stringify({ workflowId: 'ppt_1', phase: 'completed' })),
      running: false, failed: false, usedDirections: false
    })
    expect(states(done)).toEqual({
      plan: 'done', direction: 'skipped', build: 'done', preview: 'done', review: 'done', export: 'done'
    })
  })
})

describe('workflow history across cards', () => {
  const blocks = [
    pptBlock('b1', { workflowId: 'ppt_1', phase: 'awaiting_direction' }),
    pptBlock('b2', { workflowId: 'ppt_1', phase: 'awaiting_review' }, 'select_direction'),
    pptBlock('b3', { action: 'approve_and_build', childId: 'child_1', workflowId: 'ppt_1' }, 'approve_and_build')
  ]

  it('remembers that the workflow chose a direction earlier', () => {
    expect(pptWorkflowUsedDirections(blocks, 'ppt_1')).toBe(true)
    expect(pptWorkflowUsedDirections(blocks, 'ppt_other')).toBe(false)
  })

  it('treats a card as stale once a later call continues its workflow', () => {
    expect(pptWorkflowHasLaterCall(blocks, 'b2', 'ppt_1')).toBe(true)
    expect(pptWorkflowHasLaterCall(blocks, 'b3', 'ppt_1')).toBe(false)
    expect(pptAgentAction(blocks[2])).toBe('approve_and_build')
  })
})
