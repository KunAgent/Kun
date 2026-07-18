import { describe, expect, it } from 'vitest'
import type { DesignModeSurfaceManifest } from './design-mode-surface'
import {
  buildDesignModeWorkflowRecommendation,
  buildDesignModeWorkflowStepRecommendation,
  buildDesignModeWorkflowPlan,
  designModeWorkflowSummaryLines,
  getRecommendedDesignModeWorkflowStep
} from './design-mode-workflow'

function manifestPatch(
  counts: Partial<DesignModeSurfaceManifest['counts']> = {}
): Pick<DesignModeSurfaceManifest, 'counts' | 'document' | 'recommendedSurfaceId' | 'surfaces'> {
  return {
    document: { id: 'doc', title: 'Ops app' },
    recommendedSurfaceId: 'canvas',
    surfaces: [
      { id: 'agent', status: 'ready', healthScore: 50, toolIds: ['design.plan'], resourceKinds: ['direction'], evidence: [] },
      { id: 'canvas', status: 'ready', healthScore: 50, toolIds: ['design.ops'], resourceKinds: ['board'], evidence: [] },
      { id: 'design-tools', status: 'needs-setup', healthScore: 20, toolIds: ['design.system'], resourceKinds: ['token'], evidence: [] },
      { id: 'whiteboard', status: 'needs-setup', healthScore: 20, toolIds: ['design.critique'], resourceKinds: ['board'], evidence: [] },
      { id: 'code-bridge', status: 'needs-setup', healthScore: 20, toolIds: ['design.bind_code'], resourceKinds: ['frame'], evidence: [] },
      { id: 'handoff', status: 'ready', healthScore: 50, toolIds: ['design.export'], resourceKinds: ['board'], evidence: [] }
    ],
    counts: {
      screenCount: 0,
      svgArtifactCount: 0,
      directionCount: 0,
      objectCount: 0,
      tokenCount: 0,
      componentCount: 0,
      assetCount: 0,
      runningAppFrameCount: 0,
      activeBindingCount: 0,
      staleBindingCount: 0,
      missingBindingCount: 0,
      operationCount: 0,
      critiqueEntryCount: 0,
      agentNoteCount: 0,
      motionTimelineCount: 0,
      motionTrackCount: 0,
      motionKeyframeCount: 0,
      ...counts
    }
  }
}

describe('design mode workflow', () => {
  it('recommends the first missing Stitch-style tool step', () => {
    const plan = buildDesignModeWorkflowPlan(manifestPatch({
      screenCount: 1,
      directionCount: 1,
      objectCount: 2
    }))

    expect(plan).toMatchObject({
      version: 1,
      kind: 'kun.design.mode-workflow',
      recommendedStepId: 'extract-design-system'
    })
    expect(plan.steps.find((step) => step.id === 'extract-design-system')).toMatchObject({
      toolId: 'design.system',
      status: 'recommended',
      inputs: expect.arrayContaining(['selected objects'])
    })
    expect(getRecommendedDesignModeWorkflowStep(plan)).toMatchObject({
      id: 'extract-design-system',
      toolId: 'design.system'
    })
    expect(buildDesignModeWorkflowRecommendation(plan)).toMatchObject({
      stepId: 'extract-design-system',
      surfaceId: 'design-tools',
      toolId: 'design.system',
      inputSummary: expect.stringContaining('selected objects'),
      promptHeading: 'Recommended design-mode workflow step: extract-design-system.',
      toolInputSeed: {
        toolId: 'design.system',
        input: {
          action: 'template',
          operation: 'create',
          name: 'Project design system',
          mode: 'light'
        }
      },
      toolCallLine: expect.stringContaining('Suggested tool call: design.system'),
      promptInstructionLines: expect.arrayContaining([
        expect.stringContaining('Tool input seed:')
      ])
    })
    expect(designModeWorkflowSummaryLines(plan).join('\n')).toContain(
      'extract-design-system (recommended): design.system'
    )
  })

  it('builds a tool recommendation for a specific workflow step', () => {
    const plan = buildDesignModeWorkflowPlan(manifestPatch({ screenCount: 1 }))
    const recommendation = buildDesignModeWorkflowStepRecommendation(plan, 'extract-design-system')

    expect(recommendation).toMatchObject({
      stepId: 'extract-design-system',
      toolId: 'design.system',
      toolInputSeed: {
        toolId: 'design.system',
        input: { action: 'template' }
      },
      toolCallLine: expect.stringContaining('Suggested tool call: design.system')
    })
  })

  it('blocks document-dependent workflow steps when there is no active design document', () => {
    const plan = buildDesignModeWorkflowPlan({
      ...manifestPatch(),
      document: null
    })

    expect(plan.recommendedStepId).toBeNull()
    expect(getRecommendedDesignModeWorkflowStep(plan)).toBeNull()
    expect(buildDesignModeWorkflowRecommendation(plan)).toBeNull()
    expect(plan.steps.find((step) => step.id === 'plan-directions')).toMatchObject({
      status: 'blocked',
      reason: 'No active design document is available.'
    })
    expect(plan.steps.find((step) => step.id === 'generate-first-screen')).toMatchObject({
      status: 'blocked'
    })
  })

  it('keeps export handoff available for an SVG-only design document', () => {
    const plan = buildDesignModeWorkflowPlan(manifestPatch({ svgArtifactCount: 1 }))

    expect(plan.steps.find((step) => step.id === 'export-handoff')).toMatchObject({
      status: 'available',
      reason: expect.stringContaining('1 SVG artifact(s)')
    })
  })
})
