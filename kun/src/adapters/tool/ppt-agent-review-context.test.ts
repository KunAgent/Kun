import { describe, expect, it } from 'vitest'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import { TurnSchema, type Turn } from '../../contracts/turns.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { PptReviewBundleV1 } from '../../ppt/ppt-review-manifest.js'
import { createPptGeometryQaReport } from '../../ppt/ppt-geometry-qa-report.js'
import {
  buildPptAgentToolProvider,
  type PptAgentTurnReader,
  type PptReviewContextV1
} from './ppt-agent-tool-provider.js'
import {
  buildPptAgentLocalTools,
  PPT_READ_REVIEW_CONTEXT_TOOL_NAME
} from './ppt-agent-local-tools.js'

const CHILD_ID = 'child_ppt_review'
const WORKFLOW_ID = 'ppt_workflow'

const persistedBundle: PptReviewBundleV1 = {
  workflowId: WORKFLOW_ID,
  childId: CHILD_ID,
  manifestPath: '.kun/ppt/ppt_workflow/.kun-ppt-review/manifest.json',
  previewMode: 'image-first' as const,
  deckTitle: 'Review deck',
  styleFingerprint: 'style-1',
  designGovernance: {
    policyVersion: '1.0.0', policyHash: 'b'.repeat(64), category: 'business-plan',
    categoryGuide: 'slides_categories/business_plan.md', planFingerprint: 'a'.repeat(64), planRevision: 1
  },
  phase: 'awaiting_review' as const,
  slides: [
    {
      slideId: 'slide-1', index: 0, title: 'Opening',
      previewPath: '.kun/ppt/ppt_workflow/previews/slide-1.png',
      revision: 2, status: 'ready' as const
    },
    {
      slideId: 'slide-2', index: 1, title: 'Details',
      previewPath: '.kun/ppt/ppt_workflow/previews/slide-2.png',
      revision: 4, status: 'ready' as const
    }
  ]
}

const baseContext: ToolHostContext = {
  threadId: 'thr_main',
  turnId: 'turn_followup',
  workspace: process.cwd(),
  agentSurface: 'code',
  clientSurface: 'gui',
  approvalPolicy: 'auto',
  approvalReviewer: 'user',
  awaitApproval: async () => 'allow',
  model: {
    id: 'main-model',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    contextWindowTokens: 128_000
  },
  abortSignal: new AbortController().signal
}

function makeTurnReader(slides: PptReviewContextV1['slides']): PptAgentTurnReader {
  return {
    getTurn: async (threadId, turnId): Promise<Turn> => {
      const prompt = '请按当前白板反馈继续'
      const composerContext = {
        schemaVersion: 1 as const,
        id: 'preview-ppt-review-111111111111111111111111',
        title: 'PPT review',
        summary: 'Selected slides for PPT review',
        reference: {
          kind: 'ppt-review' as const,
          schemaVersion: 1 as const,
          workflowId: WORKFLOW_ID,
          childId: CHILD_ID,
          slides
        },
        revision: 1,
        generation: 1,
        attachmentId: `dev-preview-context:${'1'.repeat(64)}`,
        provenance: { source: 'dev-preview' as const, workspaceId: 'a'.repeat(64) }
      }
      return TurnSchema.parse({
        id: turnId,
        threadId,
        status: 'running',
        prompt,
        agentSurface: 'code',
        composerContexts: [composerContext],
        items: [{
          id: `item_${turnId}_user`,
          turnId,
          threadId,
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: prompt,
          composerContexts: [composerContext],
          createdAt: '2026-08-12T00:00:00.000Z'
        }],
        createdAt: '2026-08-12T00:00:00.000Z'
      })
    }
  }
}

function makeRuntime(
  onResume?: (input: Record<string, unknown>) => void,
  bundle: PptReviewBundleV1 = persistedBundle,
  resumedBundle: PptReviewBundleV1 = bundle
): DelegationRuntime {
  return {
    enabled: () => true,
    diagnostics: async () => ({
      enabled: true,
      active: 0,
      childRuns: [{ id: CHILD_ID, reviewBundle: bundle }],
      aggregates: []
    }),
    resumeChild: async (input: Record<string, unknown>) => {
      onResume?.(input)
      return {
        id: CHILD_ID,
        status: 'completed',
        reviewBundle: resumedBundle,
        reviewBundleParentTurnId: baseContext.turnId,
        deckArtifact: {
          output: 'presentations/review-deck.pptx',
          workflowId: WORKFLOW_ID,
          projectDir: '.kun/ppt/ppt_workflow',
          planFingerprint: 'a'.repeat(64),
          slides: 2,
          editableSlides: 2,
          validated: true
        },
        deckArtifactParentTurnId: baseContext.turnId,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      }
    }
  } as unknown as DelegationRuntime
}

function tool(
  runtime: DelegationRuntime,
  slides: PptReviewContextV1['slides'],
  config = () => ({ enabled: true, imageGenAvailable: true })
) {
  return buildPptAgentToolProvider(
    runtime,
    config,
    makeTurnReader(slides)
  )[0].tools[0]
}

describe('ppt_agent structured review freshness', () => {
  it('exposes validated annotations only through the dedicated scoped tool', async () => {
    const annotations = ['Move the title left']
    const scopedContext: ToolHostContext = {
      ...baseContext,
      pptWorkflowScope: {
        action: 'revise_previews', workflowId: WORKFLOW_ID,
        projectDir: '.kun/ppt/ppt_workflow', parentThreadId: 'thr_main', previewMode: 'image-first',
        reviewContext: { childId: CHILD_ID, slides: [{ slideId: 'slide-1', revision: 2, annotations }] }
      }
    }
    const reviewTool = buildPptAgentLocalTools()
      .find((candidate) => candidate.name === PPT_READ_REVIEW_CONTEXT_TOOL_NAME)!
    expect(reviewTool.shouldAdvertise?.(scopedContext)).toBe(true)
    await expect(reviewTool.execute({}, scopedContext)).resolves.toMatchObject({
      output: { workflowId: WORKFLOW_ID, childId: CHILD_ID, slides: [{ annotations }] }
    })
  })

  it.each([
    {
      action: 'approve_and_build' as const,
      slides: [{ slideId: 'unknown-slide', revision: 1 }],
      error: 'unknown slideId unknown-slide'
    },
    {
      action: 'revise_previews' as const,
      slides: [
        { slideId: 'slide-1', revision: 2 },
        { slideId: 'slide-1', revision: 2 }
      ],
      error: 'duplicate slideId slide-1'
    },
    {
      action: 'retry_failed' as const,
      slides: [{ slideId: 'slide-2', revision: 3 }],
      error: 'stale slide revision for slide-2: expected 4, received 3'
    }
  ])('fails closed for $action when review identity is stale', async ({ action, slides, error }) => {
    let resumed = false
    const result = await tool(makeRuntime(() => { resumed = true }), slides).execute({
      action,
      childId: CHILD_ID,
      workflowId: WORKFLOW_ID
    }, baseContext)

    expect(result).toMatchObject({
      isError: true,
      output: { phase: 'source_unavailable', error: expect.stringContaining(error) }
    })
    expect(resumed).toBe(false)
  })

  it('keeps annotations in host scope and out of source text and host control', async () => {
    let resumed: Record<string, unknown> | undefined
    const annotation = 'Make the title larger and left aligned'
    const result = await tool(
      makeRuntime((input) => { resumed = input }),
      [{ slideId: 'slide-1', revision: 2, annotations: [annotation] }]
    ).execute({
      action: 'approve_and_build',
      childId: CHILD_ID,
      workflowId: WORKFLOW_ID
    }, baseContext)

    expect(result.isError).toBeFalsy()
    expect(String(resumed?.controlPrompt)).not.toContain(annotation)
    expect(resumed?.source).toMatchObject({
      prompt: '请按当前白板反馈继续',
      composerContexts: []
    })
    expect(JSON.stringify(resumed?.source)).not.toContain(annotation)
    expect(resumed?.pptWorkflowScope).toMatchObject({
      action: 'approve_and_build',
      workflowId: WORKFLOW_ID,
      projectDir: '.kun/ppt/ppt_workflow',
      parentThreadId: 'thr_main',
      previewMode: 'image-first',
      reviewContext: {
        childId: CHILD_ID,
        slides: [{ slideId: 'slide-1', revision: 2, annotations: [annotation] }]
      }
    })
  })

  it('returns a completed warning projection beside the validated deck without failing approval', async () => {
    const warning = createPptGeometryQaReport({
      slideCount: 2,
      issues: [{
        rule: 'text.minimum_font_size', severity: 'warning', slideIndex: 0, shapeId: 'caption-1',
        rect: { x: 0.1, y: 0.8, width: 0.3, height: 0.1 },
        message: 'Caption is below the governed size', repairHint: 'Increase the caption size'
      }]
    }).issues[0]
    const completedBundle: PptReviewBundleV1 = {
      ...persistedBundle,
      phase: 'completed',
      slides: persistedBundle.slides.map((slide) => ({
        ...slide,
        qaIssues: slide.index === 0 ? [warning] : []
      }))
    }
    const result = await tool(
      makeRuntime(undefined, persistedBundle, completedBundle),
      [{ slideId: 'slide-1', revision: 2 }]
    ).execute({
      action: 'approve_and_build', childId: CHILD_ID, workflowId: WORKFLOW_ID
    }, baseContext)

    expect(result).toMatchObject({
      isError: false,
      output: {
        phase: 'completed',
        deckArtifact: { validated: true, output: 'presentations/review-deck.pptx' },
        reviewBundle: {
          phase: 'completed',
          slides: [{ qaIssues: [{ severity: 'warning', shapeId: 'caption-1' }] }, { qaIssues: [] }]
        }
      }
    })
  })

  it('does not switch an image-first workflow to editable when image generation disappears', async () => {
    let resumed = false
    const result = await tool(
      makeRuntime(() => { resumed = true }),
      [{ slideId: 'slide-1', revision: 2 }],
      () => ({ enabled: true, imageGenAvailable: false })
    ).execute({
      action: 'revise_previews', childId: CHILD_ID, workflowId: WORKFLOW_ID
    }, baseContext)

    expect(result).toMatchObject({
      isError: true,
      output: { phase: 'failed_recoverable', mode: 'visual-first', error: expect.stringContaining('whole-page generated previews') }
    })
    expect(resumed).toBe(false)
  })

  it('keeps an editable workflow editable after image generation becomes available', async () => {
    let resumed: Record<string, unknown> | undefined
    const editableBundle = { ...persistedBundle, previewMode: 'editable' as const }
    const result = await tool(
      makeRuntime((input) => { resumed = input }, editableBundle),
      [{ slideId: 'slide-1', revision: 2 }]
    ).execute({
      action: 'revise_previews', childId: CHILD_ID, workflowId: WORKFLOW_ID
    }, baseContext)

    expect(result).toMatchObject({ isError: false, output: { mode: 'native', phase: 'awaiting_review' } })
    expect(String(resumed?.controlPrompt)).toContain('PPT EDITABLE REVIEW FOLLOW-UP')
    expect(String(resumed?.controlPrompt)).not.toContain('Regenerate only requested slideIds')
  })

  it('does not auto-migrate a pre-governance review workflow', async () => {
    let resumed = false
    const { previewMode: _previewMode, designGovernance: _governance, ...legacyBundle } = persistedBundle
    const result = await tool(
      makeRuntime(() => { resumed = true }, legacyBundle),
      [{ slideId: 'slide-1', revision: 2 }]
    ).execute({
      action: 'revise_previews', childId: CHILD_ID, workflowId: WORKFLOW_ID
    }, baseContext)

    expect(result).toMatchObject({
      isError: true,
      output: { phase: 'unavailable', error: expect.stringContaining('cannot be migrated in place') }
    })
    expect(resumed).toBe(false)
  })
})
