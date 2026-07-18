import type { CanvasDocument } from '../canvas/canvas-types'
import type { DesignSystem } from '../canvas/design-system-types'
import type { DesignArtifact, DesignDocument } from '../design-types'
import { groupDesignArtifacts } from '../design-artifact-actions'
import { buildDesignGraphFromCanvasDocument } from '../graph/design-graph-from-canvas'
import type { DesignGraphObject } from '../graph/design-graph-types'
import { buildDesignDirectionScorecard } from '../directions/direction-scorecard'
import {
  buildDesignToolProtocolManifest,
  DESIGN_TOOL_PROTOCOL_RESOURCE_ID
} from '../tool-protocol/design-tool-protocol'
import { collectCanvasImageAssets } from '../assets/design-asset-inventory'
import {
  buildDesignModeSurfaceManifest,
  DESIGN_MODE_SURFACE_RESOURCE_ID
} from '../design-mode/design-mode-surface'
import { buildCanvasMotionSummary } from '../canvas/canvas-motion-summary'

export const DESIGN_RESOURCE_SURFACE_PATH = '.kun-design/design-resources.json'

export type DesignResourceKind = 'board' | 'frame' | 'asset' | 'token' | 'component' | 'direction' | 'tool' | 'mode'

export type DesignResourceDescriptor = {
  uri: string
  name: string
  kind: DesignResourceKind
  mimeType: 'application/json'
  text: string
}

export type DesignResourceSurface = {
  version: 1
  kind: 'kun.design.resources'
  source: 'kun-design-mode'
  updatedAt: string
  document: { id: string; title: string }
  counts: Record<DesignResourceKind, number>
  resources: DesignResourceDescriptor[]
}

export type BuildDesignResourceSurfaceOptions = {
  document: DesignDocument | null
  canvasDocument: CanvasDocument
  designSystem: DesignSystem
  artifacts?: readonly DesignArtifact[]
  updatedAt?: string
}

function resourceUri(documentId: string, kind: DesignResourceKind, id: string): string {
  return `kun-design://documents/${encodeURIComponent(documentId)}/${kind}s/${encodeURIComponent(id)}`
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function artifactById(artifacts: readonly DesignArtifact[]): Map<string, DesignArtifact> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}

function framePayload(
  object: DesignGraphObject,
  artifact: DesignArtifact | undefined,
  canvasDocument: CanvasDocument
): Record<string, unknown> {
  const motionSummary = buildCanvasMotionSummary(canvasDocument, { preferredFrameId: object.id })
  const motionTimeline = motionSummary?.timelines.find((timeline) => timeline.frameId === object.id)
  return {
    id: object.id,
    name: object.name,
    kind: object.kind,
    parentId: object.parentId,
    childIds: object.children,
    bounds: object.bounds,
    source: object.source,
    artifactPath: artifact?.relativePath,
    artifactKind: artifact?.kind,
    htmlPath: artifact?.kind === 'html' ? artifact.relativePath : undefined,
    svgPath: artifact?.kind === 'svg' ? artifact.relativePath : undefined,
    designMdPath: artifact?.designMdPath,
    runningApp: object.metadata?.runningApp,
    direction: artifact?.direction,
    prototypeLinks: artifact?.prototypeLinks,
    codeBindings: object.metadata?.codeBindings,
    motionTimeline,
    ...(motionTimeline ? { reducedMotion: motionSummary?.reducedMotion } : {})
  }
}

function buildFrameResources(
  options: BuildDesignResourceSurfaceOptions,
  documentId: string
): DesignResourceDescriptor[] {
  const artifacts = options.artifacts ?? options.document?.artifacts ?? []
  const artifactsById = artifactById(artifacts)
  const graph = buildDesignGraphFromCanvasDocument(options.canvasDocument, {
    projectId: documentId,
    artifacts: [...artifacts],
    designSystem: options.designSystem,
    updatedAt: options.updatedAt
  })
  return Object.values(graph.objects)
    .filter((object) => object.kind === 'frame' || object.kind === 'html-frame' || object.kind === 'svg-frame' || object.kind === 'running-app-frame')
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((object) => {
      const artifactId = object.source?.artifactId ?? object.source?.htmlArtifactId
      const artifact = artifactId ? artifactsById.get(artifactId) : undefined
      return {
        uri: resourceUri(documentId, 'frame', object.id),
        name: object.name,
        kind: 'frame',
        mimeType: 'application/json',
        text: jsonText(framePayload(object, artifact, options.canvasDocument))
      }
    })
}

function buildTokenResources(
  system: DesignSystem,
  documentId: string
): DesignResourceDescriptor[] {
  return Object.values(system.tokens)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((token) => ({
      uri: resourceUri(documentId, 'token', token.name),
      name: token.name,
      kind: 'token',
      mimeType: 'application/json',
      text: jsonText(token)
    }))
}

function buildComponentResources(
  system: DesignSystem,
  documentId: string
): DesignResourceDescriptor[] {
  return Object.values(system.components)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((component) => ({
      uri: resourceUri(documentId, 'component', component.id),
      name: component.name,
      kind: 'component',
      mimeType: 'application/json',
      text: jsonText({
        id: component.id,
        name: component.name,
        version: component.version,
        slots: component.slots,
        rootShapeCount: component.tree.length,
        tree: component.tree
      })
    }))
}

function buildAssetResources(
  document: CanvasDocument,
  documentId: string
): DesignResourceDescriptor[] {
  return collectCanvasImageAssets(document).map((asset) => ({
    uri: resourceUri(documentId, 'asset', asset.id),
    name: asset.name,
    kind: 'asset',
    mimeType: 'application/json',
    text: jsonText(asset)
  }))
}

function buildDirectionResources(
  options: BuildDesignResourceSurfaceOptions,
  documentId: string
): DesignResourceDescriptor[] {
  const artifacts = options.artifacts ?? options.document?.artifacts ?? []
  const grouped = groupDesignArtifacts(artifacts)
  return [...grouped.directions, ...grouped.archivedDirections]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((direction) => ({
      uri: resourceUri(documentId, 'direction', direction.id),
      name: direction.name,
      kind: 'direction',
      mimeType: 'application/json',
      text: jsonText({
        id: direction.id,
        name: direction.name,
        status: direction.status,
        scorecard: buildDesignDirectionScorecard(direction, options.canvasDocument),
        screens: direction.artifacts.map((artifact) => ({
          id: artifact.id,
          title: artifact.title,
          htmlPath: artifact.relativePath,
          designMdPath: artifact.designMdPath,
          prototypeLinks: artifact.prototypeLinks,
          implementedAt: artifact.implementedAt
        }))
      })
    }))
}

function buildToolProtocolResource(documentId: string): DesignResourceDescriptor {
  return {
    uri: resourceUri(documentId, 'tool', DESIGN_TOOL_PROTOCOL_RESOURCE_ID),
    name: 'Design tool protocol',
    kind: 'tool',
    mimeType: 'application/json',
    text: jsonText(buildDesignToolProtocolManifest())
  }
}

function buildModeSurfaceResource(
  options: BuildDesignResourceSurfaceOptions,
  documentId: string
): DesignResourceDescriptor {
  const artifacts = options.artifacts ?? options.document?.artifacts ?? []
  return {
    uri: resourceUri(documentId, 'mode', DESIGN_MODE_SURFACE_RESOURCE_ID),
    name: 'Design mode surface',
    kind: 'mode',
    mimeType: 'application/json',
    text: jsonText(buildDesignModeSurfaceManifest({
      document: options.document,
      canvasDocument: options.canvasDocument,
      designSystem: options.designSystem,
      artifacts
    }))
  }
}

function buildBoardResource(
  options: BuildDesignResourceSurfaceOptions,
  documentId: string,
  title: string,
  counts: Record<DesignResourceKind, number>
): DesignResourceDescriptor {
  const artifacts = options.artifacts ?? options.document?.artifacts ?? []
  const graph = buildDesignGraphFromCanvasDocument(options.canvasDocument, {
    projectId: documentId,
    artifacts: [...artifacts],
    designSystem: options.designSystem,
    updatedAt: options.updatedAt
  })
  const motion = buildCanvasMotionSummary(options.canvasDocument)
  return {
    uri: resourceUri(documentId, 'board', 'main'),
    name: title,
    kind: 'board',
    mimeType: 'application/json',
    text: jsonText({
      id: documentId,
      title,
      counts,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        relativePath: artifact.relativePath,
        designMdPath: artifact.designMdPath
      })),
      graph: {
        projectId: graph.projectId,
        rootObjectIds: graph.rootObjectIds,
        objectCount: Object.keys(graph.objects).length,
        directionCount: Object.keys(graph.directions).length,
        designSystem: graph.designSystem,
        updatedAt: graph.updatedAt
      },
      motion
    })
  }
}

function resourceCounts(resources: readonly DesignResourceDescriptor[]): Record<DesignResourceKind, number> {
  return {
    board: resources.filter((resource) => resource.kind === 'board').length,
    frame: resources.filter((resource) => resource.kind === 'frame').length,
    asset: resources.filter((resource) => resource.kind === 'asset').length,
    token: resources.filter((resource) => resource.kind === 'token').length,
    component: resources.filter((resource) => resource.kind === 'component').length,
    direction: resources.filter((resource) => resource.kind === 'direction').length,
    tool: resources.filter((resource) => resource.kind === 'tool').length,
    mode: resources.filter((resource) => resource.kind === 'mode').length
  }
}

export function buildDesignResourceSurface(options: BuildDesignResourceSurfaceOptions): DesignResourceSurface {
  const documentId = options.document?.id ?? options.canvasDocument.graph?.projectId ?? 'kun-design'
  const title = options.document?.title ?? 'Kun design project'
  const withoutBoard = [
    ...buildFrameResources(options, documentId),
    ...buildAssetResources(options.canvasDocument, documentId),
    ...buildTokenResources(options.designSystem, documentId),
    ...buildComponentResources(options.designSystem, documentId),
    ...buildDirectionResources(options, documentId),
    buildModeSurfaceResource(options, documentId),
    buildToolProtocolResource(documentId)
  ]
  const counts = resourceCounts(withoutBoard)
  const resources = [buildBoardResource(options, documentId, title, { ...counts, board: 1 }), ...withoutBoard]
  return {
    version: 1,
    kind: 'kun.design.resources',
    source: 'kun-design-mode',
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    document: { id: documentId, title },
    counts: resourceCounts(resources),
    resources
  }
}

export function serializeDesignResourceSurface(surface: DesignResourceSurface): string {
  return `${JSON.stringify(surface, null, 2)}\n`
}
