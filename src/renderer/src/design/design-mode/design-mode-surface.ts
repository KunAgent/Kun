import type { CanvasDocument, CanvasShape } from '../canvas/canvas-types'
import { isHtmlFrame } from '../canvas/canvas-types'
import type { DesignSystem } from '../canvas/design-system-types'
import { collectCanvasImageAssets } from '../assets/design-asset-inventory'
import { groupDesignArtifacts } from '../design-artifact-actions'
import type { DesignArtifact, DesignDocument } from '../design-types'
import {
  buildDesignModeWorkflowPlan,
  type DesignModeWorkflowPlan
} from './design-mode-workflow'

export const DESIGN_MODE_SURFACE_RESOURCE_ID = 'design-mode-surface'

export type DesignModeSurfaceId =
  | 'agent'
  | 'canvas'
  | 'design-tools'
  | 'whiteboard'
  | 'code-bridge'
  | 'handoff'

export type DesignModeSurfaceStatus = 'active' | 'ready' | 'needs-setup' | 'blocked'

export type DesignModeSurface = {
  id: DesignModeSurfaceId
  status: DesignModeSurfaceStatus
  healthScore: number
  toolIds: string[]
  resourceKinds: string[]
  evidence: string[]
}

export type DesignModeSurfaceCounts = {
  screenCount: number
  svgArtifactCount: number
  directionCount: number
  objectCount: number
  tokenCount: number
  componentCount: number
  assetCount: number
  runningAppFrameCount: number
  activeBindingCount: number
  staleBindingCount: number
  missingBindingCount: number
  operationCount: number
  critiqueEntryCount: number
  agentNoteCount: number
  motionTimelineCount: number
  motionTrackCount: number
  motionKeyframeCount: number
}

export type DesignModeSurfaceManifest = {
  version: 1
  kind: 'kun.design.mode-surface'
  source: 'kun-design-mode'
  document: { id: string; title: string } | null
  counts: DesignModeSurfaceCounts
  surfaces: DesignModeSurface[]
  recommendedSurfaceId: DesignModeSurfaceId | null
  workflow: DesignModeWorkflowPlan
}

export type BuildDesignModeSurfaceManifestOptions = {
  document: DesignDocument | null
  canvasDocument: CanvasDocument
  designSystem: DesignSystem
  artifacts?: readonly DesignArtifact[]
}

const SURFACE_ORDER: DesignModeSurfaceId[] = [
  'agent',
  'canvas',
  'design-tools',
  'whiteboard',
  'code-bridge',
  'handoff'
]

function htmlScreenArtifacts(artifacts: readonly DesignArtifact[]): DesignArtifact[] {
  return artifacts.filter((artifact) => artifact.kind === 'html' && !artifact.role)
}

function svgArtifacts(artifacts: readonly DesignArtifact[]): DesignArtifact[] {
  return artifacts.filter((artifact) => artifact.kind === 'svg')
}

function canvasObjects(document: CanvasDocument): CanvasShape[] {
  return Object.values(document.objects).filter((shape): shape is CanvasShape => Boolean(shape))
}

function countHtmlFrames(document: CanvasDocument): number {
  return canvasObjects(document).filter((shape) => isHtmlFrame(shape)).length
}

function countRunningAppFrames(document: CanvasDocument): number {
  return canvasObjects(document).filter((shape) => shape.type === 'frame' && Boolean(shape.runningApp?.url)).length
}

function countAgentNotes(document: CanvasDocument): number {
  return canvasObjects(document).filter((shape) => Boolean(shape.agentNote) && !shape.agentNote?.resolved).length
}

function countCritiqueEntries(document: CanvasDocument): number {
  return (document.operationJournal ?? []).filter((entry) =>
    /critique|lint|repair|validate/i.test(entry.label) ||
    entry.operations.some((operation) => operation.type === 'lint_design')
  ).length
}

function countDirections(artifacts: readonly DesignArtifact[]): number {
  return groupDesignArtifacts(artifacts).directions.length
}

function countCanvasObjects(document: CanvasDocument): number {
  return Math.max(0, Object.keys(document.objects).length - 1)
}

function countsFor(options: BuildDesignModeSurfaceManifestOptions): DesignModeSurfaceCounts {
  const artifacts = options.artifacts ?? options.document?.artifacts ?? []
  const bindings = options.canvasDocument.codeBindings ?? []
  const motionTimelines = Object.values(options.canvasDocument.motion?.timelines ?? {})
  return {
    screenCount: Math.max(htmlScreenArtifacts(artifacts).length, countHtmlFrames(options.canvasDocument)),
    svgArtifactCount: svgArtifacts(artifacts).length,
    directionCount: countDirections(artifacts),
    objectCount: countCanvasObjects(options.canvasDocument),
    tokenCount: Object.keys(options.designSystem.tokens).length,
    componentCount: Object.keys(options.designSystem.components).length,
    assetCount: collectCanvasImageAssets(options.canvasDocument).length,
    runningAppFrameCount: countRunningAppFrames(options.canvasDocument),
    activeBindingCount: bindings.filter((binding) => binding.status === 'active').length,
    staleBindingCount: bindings.filter((binding) => binding.status === 'stale').length,
    missingBindingCount: bindings.filter((binding) => binding.status === 'missing').length,
    operationCount: options.canvasDocument.operationJournal?.length ?? 0,
    critiqueEntryCount: countCritiqueEntries(options.canvasDocument),
    agentNoteCount: countAgentNotes(options.canvasDocument),
    motionTimelineCount: motionTimelines.length,
    motionTrackCount: motionTimelines.reduce((sum, timeline) => sum + timeline.tracks.length, 0),
    motionKeyframeCount: motionTimelines.reduce(
      (sum, timeline) => sum + timeline.tracks.reduce((trackSum, track) => trackSum + track.keyframes.length, 0),
      0
    )
  }
}

function surface(
  id: DesignModeSurfaceId,
  status: DesignModeSurfaceStatus,
  healthScore: number,
  toolIds: string[],
  resourceKinds: string[],
  evidence: string[]
): DesignModeSurface {
  return {
    id,
    status,
    healthScore: Math.max(0, Math.min(100, Math.round(healthScore))),
    toolIds,
    resourceKinds,
    evidence: evidence.filter(Boolean)
  }
}

function agentSurface(document: DesignDocument | null, counts: DesignModeSurfaceCounts): DesignModeSurface {
  if (!document) {
    return surface('agent', 'blocked', 0, ['design.plan'], ['board'], ['No active design document'])
  }
  const status: DesignModeSurfaceStatus = counts.directionCount > 0 || counts.operationCount > 0
    ? 'active'
    : counts.screenCount > 0 || counts.svgArtifactCount > 0
      ? 'ready'
      : 'needs-setup'
  return surface('agent', status, 45 + counts.directionCount * 15 + counts.operationCount * 4, [
    'design.plan',
    'design.generate_directions',
    'design.critique',
    'design_svg_create'
  ], ['direction', 'tool'], [
    `${counts.directionCount} direction(s)`,
    `${counts.svgArtifactCount} SVG artifact(s)`,
    `${counts.operationCount} operation journal entry(s)`
  ])
}

function canvasSurface(counts: DesignModeSurfaceCounts): DesignModeSurface {
  const status: DesignModeSurfaceStatus = counts.objectCount > 0 ? 'active' : 'needs-setup'
  return surface('canvas', status, counts.objectCount > 0 ? 70 : 20, [
    'design.ops',
    'design.generate_screen',
    'design_svg_create',
    'design_motion_set_timeline',
    'design_motion_upsert_keyframes',
    'design_motion_apply_preset',
    'design_motion_delete'
  ], ['board', 'frame', 'asset', 'svg'], [
    `${counts.objectCount} object(s)`,
    `${counts.svgArtifactCount} SVG artifact(s)`,
    `${counts.assetCount} asset(s)`,
    `${counts.motionTimelineCount} Motion timeline(s)`,
    `${counts.motionTrackCount} animated track(s)`
  ])
}

function designToolsSurface(counts: DesignModeSurfaceCounts): DesignModeSurface {
  const systemCount = counts.tokenCount + counts.componentCount
  const status: DesignModeSurfaceStatus = systemCount > 0 || counts.operationCount > 0 || counts.svgArtifactCount > 0 || counts.motionTimelineCount > 0
    ? 'active'
    : counts.screenCount > 0
      ? 'ready'
      : 'needs-setup'
  return surface('design-tools', status, 35 + systemCount * 10 + counts.operationCount * 3 + counts.motionTimelineCount * 4, [
    'design.system',
    'design.repair',
    'design_svg_inspect',
    'design_svg_edit',
    'design_svg_animate',
    'design_svg_validate',
    'design_motion_upsert_keyframes',
    'design_motion_apply_preset'
  ], ['token', 'component', 'svg', 'tool'], [
    `${counts.tokenCount} token(s)`,
    `${counts.componentCount} component(s)`,
    `${counts.svgArtifactCount} SVG artifact(s)`,
    `${counts.motionKeyframeCount} Motion keyframe(s)`
  ])
}

function whiteboardSurface(counts: DesignModeSurfaceCounts): DesignModeSurface {
  const findings = counts.critiqueEntryCount + counts.agentNoteCount
  const status: DesignModeSurfaceStatus = findings > 0
    ? 'active'
    : counts.screenCount > 0 || counts.svgArtifactCount > 0 || counts.objectCount > 0
      ? 'ready'
      : 'needs-setup'
  return surface('whiteboard', status, 40 + findings * 12 + (counts.screenCount + counts.svgArtifactCount) * 4, [
    'design.critique',
    'design.repair'
  ], ['board', 'frame', 'direction'], [
    `${counts.critiqueEntryCount} critique pass(es)`,
    `${counts.agentNoteCount} open note(s)`,
    `${counts.svgArtifactCount} SVG artifact(s)`
  ])
}

function codeBridgeSurface(counts: DesignModeSurfaceCounts): DesignModeSurface {
  if (counts.staleBindingCount > 0 || counts.missingBindingCount > 0) {
    return surface('code-bridge', 'blocked', 35, ['design.bind_code', 'design.implement'], ['frame', 'tool'], [
      `${counts.staleBindingCount} stale binding(s)`,
      `${counts.missingBindingCount} missing binding(s)`
    ])
  }
  const wired = counts.activeBindingCount + counts.runningAppFrameCount
  const status: DesignModeSurfaceStatus = wired > 0 ? 'active' : counts.screenCount > 0 ? 'needs-setup' : 'blocked'
  return surface('code-bridge', status, wired > 0 ? 70 + wired * 8 : 20, [
    'design.bind_code',
    'design.implement'
  ], ['frame', 'tool'], [
    `${counts.activeBindingCount} active binding(s)`,
    `${counts.runningAppFrameCount} running app frame(s)`
  ])
}

function handoffSurface(document: DesignDocument | null, counts: DesignModeSurfaceCounts): DesignModeSurface {
  if (!document) {
    return surface('handoff', 'blocked', 0, ['design.export'], ['board'], ['No active design document'])
  }
  const hasContent = counts.screenCount > 0 || counts.svgArtifactCount > 0 || counts.objectCount > 0 || counts.tokenCount > 0 || counts.assetCount > 0
  const status: DesignModeSurfaceStatus = hasContent ? 'ready' : 'needs-setup'
  return surface('handoff', status, hasContent ? 75 : 20, ['design.export'], [
    'board',
    'frame',
    'svg',
    'direction',
    'asset',
    'tool'
  ], [
    `${counts.screenCount} screen(s)`,
    `${counts.svgArtifactCount} SVG artifact(s)`,
    `${counts.assetCount} asset(s)`,
    `${counts.motionTimelineCount} bounded Motion timeline(s) for handoff`
  ])
}

function recommendedSurfaceId(surfaces: readonly DesignModeSurface[]): DesignModeSurfaceId | null {
  const byId = new Map(surfaces.map((item) => [item.id, item]))
  return SURFACE_ORDER.find((id) => byId.get(id)?.status === 'needs-setup') ??
    SURFACE_ORDER.find((id) => byId.get(id)?.status === 'blocked') ??
    SURFACE_ORDER.find((id) => byId.get(id)?.status === 'ready') ??
    null
}

export function buildDesignModeSurfaceManifest(
  options: BuildDesignModeSurfaceManifestOptions
): DesignModeSurfaceManifest {
  const counts = countsFor(options)
  const surfaces = [
    agentSurface(options.document, counts),
    canvasSurface(counts),
    designToolsSurface(counts),
    whiteboardSurface(counts),
    codeBridgeSurface(counts),
    handoffSurface(options.document, counts)
  ]
  const manifest = {
    version: 1,
    kind: 'kun.design.mode-surface',
    source: 'kun-design-mode',
    document: options.document ? { id: options.document.id, title: options.document.title } : null,
    counts,
    surfaces,
    recommendedSurfaceId: recommendedSurfaceId(surfaces)
  } satisfies Omit<DesignModeSurfaceManifest, 'workflow'>
  return {
    ...manifest,
    workflow: buildDesignModeWorkflowPlan(manifest)
  }
}

export function designModeSurfaceSummaryLines(manifest: DesignModeSurfaceManifest): string[] {
  return manifest.surfaces.map((item) => {
    const tools = item.toolIds.length > 0 ? `; tools ${item.toolIds.join(', ')}` : ''
    const evidence = item.evidence.length > 0 ? `; ${item.evidence.join('; ')}` : ''
    return `- ${item.id} (${item.status}): ${item.healthScore}/100${tools}${evidence}`
  })
}
