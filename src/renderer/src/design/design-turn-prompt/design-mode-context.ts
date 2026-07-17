import type { DesignModeSurfaceManifest } from '../design-mode/design-mode-surface'
import {
  buildDesignModeWorkflowRecommendation,
  type DesignModeWorkflowRecommendation
} from '../design-mode/design-mode-workflow'

const MAX_WORKFLOW_STEPS = 6

function formatRecommendation(recommendation: DesignModeWorkflowRecommendation | null): string[] {
  if (!recommendation) return ['- Recommended step: none']
  return [
    `- Recommended step: ${recommendation.stepId} via ${recommendation.toolId} on ${recommendation.surfaceId}`,
    `- Recommendation reason: ${recommendation.reason}`,
    `- ${recommendation.toolCallLine}`,
    ...recommendation.promptInstructionLines.map((line) => `- ${line}`)
  ]
}

function formatSurfaces(manifest: DesignModeSurfaceManifest): string[] {
  return manifest.surfaces.map((surface) =>
    `- ${surface.id}: ${surface.status}, ${surface.healthScore}/100, tools ${surface.toolIds.join(', ') || 'none'}`
  )
}

function formatWorkflowSteps(manifest: DesignModeSurfaceManifest): string[] {
  const steps = manifest.workflow.steps
    .filter((step) => step.status === 'recommended' || step.status === 'available' || step.status === 'blocked')
    .slice(0, MAX_WORKFLOW_STEPS)
  if (steps.length === 0) return ['- All tracked workflow steps are complete.']
  return steps.map((step) =>
    `- ${step.id}: ${step.status}; ${step.toolId}; ${step.reason}`
  )
}

export function formatDesignModeContextLines(
  manifest: DesignModeSurfaceManifest | undefined
): string[] {
  if (!manifest) return []
  const recommendation = buildDesignModeWorkflowRecommendation(manifest.workflow)
  return [
    'Design mode workflow contract:',
    `- Recommended surface: ${manifest.recommendedSurfaceId ?? 'none'}`,
    ...formatRecommendation(recommendation),
    `- Counts: ${manifest.counts.screenCount} screen(s), ${manifest.counts.directionCount} direction(s), ${manifest.counts.objectCount} object(s), ${manifest.counts.activeBindingCount} active code binding(s).`,
    '- Use the recommended step as the default tool lane unless the user explicitly asks for a different design mode.',
    'Surfaces:',
    ...formatSurfaces(manifest),
    'Workflow:',
    ...formatWorkflowSteps(manifest),
    ''
  ]
}
