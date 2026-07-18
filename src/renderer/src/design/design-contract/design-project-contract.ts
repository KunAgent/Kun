import { designSpecPath } from '../design-foundation'
import { PROJECT_DESIGN_MD_PATH } from '../design-md/design-md-paths'
import { buildStitchDesignMarkdown, STITCH_DESIGN_MD_PATH } from '../design-md-compat'
import type { CanvasDocument } from '../canvas/canvas-types'
import type { DesignSystem } from '../canvas/design-system-types'
import type { DesignContext } from '../design-context'
import type { DesignArtifact, DesignDocument } from '../design-types'
import type { DesignGraph, DesignGraphObject } from '../graph/design-graph-types'
import { buildDesignGraphFromCanvasDocument } from '../graph/design-graph-from-canvas'
import { summarizeCodeBindingsForSnapshot } from '../code-binding/code-binding-summary'
import { designToolProtocolSummaryLines } from '../tool-protocol/design-tool-protocol'
import { collectCanvasImageAssets } from '../assets/design-asset-inventory'
import {
  buildDesignModeSurfaceManifest,
  designModeSurfaceSummaryLines
} from '../design-mode/design-mode-surface'
import { designModeWorkflowSummaryLines } from '../design-mode/design-mode-workflow'
import { buildCanvasMotionSummary } from '../canvas/canvas-motion-summary'

const GRAPH_OBJECT_LIMIT = 12
const JOURNAL_ENTRY_LIMIT = 8
const CODE_BINDING_LIMIT = 12

export type BuildDesignProjectContractMarkdownOptions = {
  document: DesignDocument | null
  canvasDocument: CanvasDocument
  designSystem: DesignSystem
  designContext: DesignContext
  artifacts?: readonly DesignArtifact[]
  updatedAt?: string
}

export type DesignProjectContractSummary = {
  path: string
  title: string
  artifactCount: number
  screenCount: number
  svgArtifactCount: number
  objectCount: number
  rootObjectCount: number
  directionCount: number
  assetCount: number
  modelReadyAssetCount: number
  modeSurfaceCount: number
  readyModeSurfaceCount: number
  codeBindingCount: number
  staleCodeBindingCount: number
  missingCodeBindingCount: number
  journalEntryCount: number
  motionTimelineCount: number
  motionTrackCount: number
  motionKeyframeCount: number
}

function code(value: string | undefined): string {
  return value ? `\`${value}\`` : '`TBD`'
}

function sortedGraphObjects(graph: DesignGraph): DesignGraphObject[] {
  const rootOrder = new Map(graph.rootObjectIds.map((id, index) => [id, index]))
  return Object.values(graph.objects).sort((a, b) => {
    const aRoot = rootOrder.get(a.id)
    const bRoot = rootOrder.get(b.id)
    if (aRoot !== undefined || bRoot !== undefined) {
      return (aRoot ?? Number.MAX_SAFE_INTEGER) - (bRoot ?? Number.MAX_SAFE_INTEGER)
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}

function formatBounds(object: DesignGraphObject): string {
  if (!object.bounds) return ''
  const { x, y, width, height } = object.bounds
  return ` @ ${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)}`
}

function formatObjectSource(object: DesignGraphObject): string {
  const artifactId = object.source?.artifactId ?? object.source?.htmlArtifactId
  const parts = [
    artifactId
      ? `${object.source?.artifactKind === 'svg' ? 'SVG artifact' : 'artifact'} ${code(artifactId)}`
      : '',
    object.source?.componentId ? `component ${code(object.source.componentId)}` : ''
  ].filter(Boolean)
  return parts.length > 0 ? `; ${parts.join('; ')}` : ''
}

function formatGraphObjects(graph: DesignGraph): string[] {
  const objects = sortedGraphObjects(graph)
  if (objects.length === 0) return ['_No canvas objects exported yet._']
  const visible = objects.slice(0, GRAPH_OBJECT_LIMIT).map((object) => {
    const parent = object.parentId ? `; parent ${code(object.parentId)}` : ''
    const children = object.children.length > 0 ? `; ${object.children.length} child object(s)` : ''
    return `- ${code(object.id)} ${object.kind}: ${object.name}${formatBounds(object)}${parent}${children}${formatObjectSource(object)}`
  })
  if (objects.length > visible.length) {
    visible.push(`- _${objects.length - visible.length} more canvas object(s) omitted._`)
  }
  return visible
}

function formatGraphDirections(graph: DesignGraph): string[] {
  const directions = Object.values(graph.directions)
  if (directions.length === 0) return ['_No named design directions on the canvas yet._']
  return directions
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((direction) => {
      const scorecard = direction.scorecard
      const readiness = scorecard
        ? `; ${scorecard.readiness}; score ${scorecard.score}/100; cost ${scorecard.implementationCost}`
        : ''
      const risks = scorecard?.risks.length ? `; risks ${scorecard.risks.join(', ')}` : ''
      const created = direction.createdAt ? `; created ${direction.createdAt}` : ''
      return `- ${direction.name} (${direction.status}): ${direction.objectIds.length} canvas object(s)${readiness}${risks}${created}`
    })
}

function buildGraphSection(graph: DesignGraph): string[] {
  return [
    '## Design Graph',
    '',
    `- Project id: ${code(graph.projectId)}`,
    `- Canvas objects: ${Object.keys(graph.objects).length}`,
    `- Root objects: ${graph.rootObjectIds.length}`,
    `- Directions: ${Object.keys(graph.directions).length}`,
    ...(graph.updatedAt ? [`- Updated: ${graph.updatedAt}`] : []),
    '',
    '### Root Objects',
    '',
    ...formatGraphObjects(graph),
    '',
    '### Directions',
    '',
    ...formatGraphDirections(graph)
  ]
}

function operationTypes(entry: NonNullable<CanvasDocument['operationJournal']>[number]): string {
  return [...new Set(entry.operations.map((operation) => operation.type))].join(', ') || 'operation'
}

function buildJournalSection(canvasDocument: CanvasDocument): string[] {
  const entries = (canvasDocument.operationJournal ?? []).slice(-JOURNAL_ENTRY_LIMIT)
  return [
    '## Canvas Operation Journal',
    '',
    ...(entries.length > 0
      ? entries.map((entry) => {
          const errors = entry.errors.length > 0 ? `; ${entry.errors.length} error(s)` : ''
          return `- ${entry.createdAt}: ${entry.label} (${entry.status}); ${operationTypes(entry)}; ${entry.affectedIds.length} affected object(s)${errors}`
        })
      : ['_No canvas operation journal entries exported yet._'])
  ]
}

function buildCodeBindingSection(canvasDocument: CanvasDocument): string[] {
  const summary = summarizeCodeBindingsForSnapshot(canvasDocument, undefined, CODE_BINDING_LIMIT)
  if (!summary) {
    return ['## Code Bindings', '', '_No design-to-code bindings captured yet._']
  }
  return [
    '## Code Bindings',
    '',
    `- Bindings: ${summary.count}`,
    `- Bound canvas objects: ${summary.boundObjectCount}`,
    `- Stale: ${summary.staleCount}`,
    `- Missing: ${summary.missingCount}`,
    '',
    ...summary.entries.map((entry) => {
      const target = [
        entry.sourceFile ? code(entry.sourceFile) : '',
        entry.componentName ? `component ${code(entry.componentName)}` : '',
        entry.routePath ? `route ${code(entry.routePath)}` : '',
        entry.domId ? `dom ${code(entry.domId)}` : '',
        entry.onlookId ? `onlook ${code(entry.onlookId)}` : ''
      ].filter(Boolean).join('; ')
      return `- ${code(entry.designObjectId)} -> ${entry.kind} (${entry.status})${target ? `; ${target}` : ''}`
    }),
    ...(summary.omitted ? [`- _${summary.omitted} more binding(s) omitted._`] : [])
  ]
}

function buildAssetSection(canvasDocument: CanvasDocument): string[] {
  const assets = collectCanvasImageAssets(canvasDocument)
  return [
    '## Assets',
    '',
    ...(assets.length > 0
      ? assets.map((asset) => {
          const ready = asset.modelReady ? 'model-ready' : 'reference-only'
          return `- ${code(asset.id)} ${asset.kind}: ${asset.name}; ${code(asset.path)}; ${asset.sourceKind}; ${ready}; ${Math.round(asset.bounds.width)}x${Math.round(asset.bounds.height)}`
        })
      : ['_No reusable canvas assets exported yet._'])
  ]
}

function buildMotionSection(canvasDocument: CanvasDocument): string[] {
  const summary = buildCanvasMotionSummary(canvasDocument)
  if (!summary) {
    return ['## Design Motion', '', '_No frame/layer Motion timelines exported yet._']
  }
  const timelineLines = summary.timelines.map((timeline) => {
    const trackDetails = timeline.tracks
      .map((track) => `${code(track.id)} ${track.targetName} (${code(track.targetShapeId)}): ${track.property}; ${track.keyframeCount} keyframe(s)`)
      .join('; ')
    return `- ${code(timeline.id)} ${timeline.frameName} (${code(timeline.frameId)}): ${timeline.durationMs}ms; ${timeline.playback}; ${timeline.trackCount} track(s); ${timeline.keyframeCount} keyframe(s)${trackDetails ? `; ${trackDetails}` : ''}`
  })
  return [
    '## Design Motion',
    '',
    `- Timelines: ${summary.timelineCount}`,
    `- Property tracks: ${summary.trackCount}`,
    `- Keyframes: ${summary.keyframeCount}`,
    '- Reduced motion: disable automatic playback when preferred; keep editing, deterministic scrubbing, and end-state inspection available.',
    '',
    ...timelineLines,
    ...(summary.omittedTimelines ? [`- _${summary.omittedTimelines} more timeline(s) omitted._`] : [])
  ]
}

function buildDesignDocumentSection(options: BuildDesignProjectContractMarkdownOptions): string[] {
  const document = options.document
  const artifacts = options.artifacts ?? document?.artifacts ?? []
  return [
    '## Design Document',
    '',
    `- Document: ${document ? `${document.title} (${code(document.id)})` : '`TBD`'}`,
    `- Artifacts: ${artifacts.length}`,
    `- HTML screens: ${artifacts.filter((artifact) => artifact.kind === 'html').length}`,
    `- SVG artifacts: ${artifacts.filter((artifact) => artifact.kind === 'svg').length}`,
    `- Canvas artifacts: ${artifacts.filter((artifact) => artifact.kind === 'canvas').length}`,
    ...(document?.activeArtifactId ? [`- Active artifact: ${code(document.activeArtifactId)}`] : [])
  ]
}

function buildDesignModeSection(options: BuildDesignProjectContractMarkdownOptions): string[] {
  const manifest = buildDesignModeSurfaceManifest({
    document: options.document,
    canvasDocument: options.canvasDocument,
    designSystem: options.designSystem,
    artifacts: options.artifacts ?? options.document?.artifacts ?? []
  })
  return [
    '## Design Mode',
    '',
    `- Recommended surface: ${manifest.recommendedSurfaceId ? code(manifest.recommendedSurfaceId) : '`TBD`'}`,
    `- Screens: ${manifest.counts.screenCount}`,
    `- SVG artifacts: ${manifest.counts.svgArtifactCount}`,
    `- Directions: ${manifest.counts.directionCount}`,
    `- Objects: ${manifest.counts.objectCount}`,
    '',
    ...designModeSurfaceSummaryLines(manifest),
    '',
    '### Workflow',
    '',
    `- Recommended step: ${manifest.workflow.recommendedStepId ? code(manifest.workflow.recommendedStepId) : '`TBD`'}`,
    ...designModeWorkflowSummaryLines(manifest.workflow)
  ]
}

function buildAgentContractSection(): string[] {
  return [
    '## Agent Contract',
    '',
    '- Use this file as the project-level source of truth before generating screens, editing code, or syncing to external design tools.',
    '- Treat Design Graph ids as stable canvas object ids. Preserve them when applying focused design operations.',
    '- Read each screen DESIGN.md for detailed states, responsive behavior, and implementation notes.',
    '- Treat SVG artifact files as standalone vector sources; preserve stable element ids and declarative animation when iterating them.',
    '- Treat Design Motion as the canonical per-frame/layer timeline summarized above. It is separate from standalone SVG inner animation and Prototype screen navigation.',
    '- Honor prefers-reduced-motion by disabling automatic playback while preserving deterministic scrub and end-state access.',
    '- When code bindings are active, prefer targeted source edits over regenerating entire files.',
    '- If a binding is stale or missing, repair the binding first or ask for confirmation before overwriting production code.',
    '',
    '### Tool Protocol',
    '',
    ...designToolProtocolSummaryLines()
  ]
}

function buildGraph(options: BuildDesignProjectContractMarkdownOptions): DesignGraph {
  const projectId = options.document?.id ?? options.canvasDocument.graph?.projectId ?? 'kun-design'
  return buildDesignGraphFromCanvasDocument(options.canvasDocument, {
    projectId,
    artifacts: [...(options.artifacts ?? options.document?.artifacts ?? [])],
    designSystem: options.designSystem,
    updatedAt: options.updatedAt ?? options.canvasDocument.graph?.updatedAt
  })
}

export function summarizeDesignProjectContract(
  options: BuildDesignProjectContractMarkdownOptions
): DesignProjectContractSummary {
  const graph = buildGraph(options)
  const codeBindings = options.canvasDocument.codeBindings ?? []
  const artifacts = options.artifacts ?? options.document?.artifacts ?? []
  const modeManifest = buildDesignModeSurfaceManifest({
    document: options.document,
    canvasDocument: options.canvasDocument,
    designSystem: options.designSystem,
    artifacts
  })
  const motion = buildCanvasMotionSummary(options.canvasDocument)
  return {
    path: STITCH_DESIGN_MD_PATH,
    title: options.document?.title ?? 'Kun design project',
    artifactCount: artifacts.length,
    screenCount: artifacts.filter((artifact) => artifact.kind === 'html').length,
    svgArtifactCount: artifacts.filter((artifact) => artifact.kind === 'svg').length,
    objectCount: Object.keys(graph.objects).length,
    rootObjectCount: graph.rootObjectIds.length,
    directionCount: Object.keys(graph.directions).length,
    assetCount: collectCanvasImageAssets(options.canvasDocument).length,
    modelReadyAssetCount: collectCanvasImageAssets(options.canvasDocument).filter((asset) => asset.modelReady).length,
    modeSurfaceCount: modeManifest.surfaces.length,
    readyModeSurfaceCount: modeManifest.surfaces.filter((surface) => surface.status === 'ready').length,
    codeBindingCount: codeBindings.length,
    staleCodeBindingCount: codeBindings.filter((binding) => binding.status === 'stale').length,
    missingCodeBindingCount: codeBindings.filter((binding) => binding.status === 'missing').length,
    journalEntryCount: options.canvasDocument.operationJournal?.length ?? 0,
    motionTimelineCount: motion?.timelineCount ?? 0,
    motionTrackCount: motion?.trackCount ?? 0,
    motionKeyframeCount: motion?.keyframeCount ?? 0
  }
}

export function buildDesignProjectContractMarkdown(
  options: BuildDesignProjectContractMarkdownOptions
): string {
  const document = options.document
  const artifacts = options.artifacts ?? document?.artifacts ?? []
  const graph = buildGraph(options)
  const base = buildStitchDesignMarkdown({
    title: document?.title,
    brief: options.designContext.designGuidelines,
    designContext: options.designContext,
    designSystem: options.designSystem,
    designSystemMdPath: PROJECT_DESIGN_MD_PATH,
    projectBriefPath: document ? designSpecPath(document.id) : undefined,
    artifacts,
    updatedAt: options.updatedAt
  }).trimEnd()

  return [
    base,
    '',
    ...buildDesignDocumentSection({ ...options, artifacts }),
    '',
    ...buildDesignModeSection({ ...options, artifacts }),
    '',
    ...buildGraphSection(graph),
    '',
    ...buildMotionSection(options.canvasDocument),
    '',
    ...buildJournalSection(options.canvasDocument),
    '',
    ...buildCodeBindingSection(options.canvasDocument),
    '',
    ...buildAssetSection(options.canvasDocument),
    '',
    ...buildAgentContractSection(),
    ''
  ].join('\n')
}
