import {
  createSvgFrameShape,
  embeddedArtifactOf,
  isArtifactFrame,
  isSvgFrame,
  shapeBounds,
  type CanvasDocument,
  type CanvasShape,
  type Rect
} from './canvas/canvas-types'
import { placeRectInViewportAvoiding, rectsAlmostEqual } from './canvas/canvas-placement'
import { useCanvasViewportStore } from './canvas/canvas-viewport-store'
import { type DesignTarget } from './design-context'
import {
  buildHtmlArtifactSyncKey,
  syncHtmlArtifactsToBoardDocument,
  syncHtmlFrameNodesToArtifacts,
  type SyncHtmlArtifactsToBoardResult
} from './design-board'
import type { DesignArtifact, DesignArtifactNode } from './design-types'
import { assignAgentBoardSections } from './design-board-sections'
import { useDesignWorkspaceStore } from './design-workspace-store'

function cloneDocument(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    objects: Object.fromEntries(
      Object.entries(doc.objects).map(([id, shape]) => [id, { ...shape, children: [...shape.children] }])
    )
  }
}

function descendantIds(objects: Record<string, CanvasShape>, id: string): string[] {
  const shape = objects[id]
  if (!shape) return []
  return shape.children.flatMap((childId) => [childId, ...descendantIds(objects, childId)])
}

function documentShapeIdsInOrder(doc: CanvasDocument): string[] {
  const visited = new Set<string>()
  const ordered: string[] = []
  const visit = (id: string): void => {
    if (visited.has(id)) return
    const shape = doc.objects[id]
    if (!shape) return
    visited.add(id)
    ordered.push(id)
    for (const childId of shape.children) visit(childId)
  }
  visit(doc.rootId)
  for (const id of Object.keys(doc.objects)) visit(id)
  return ordered
}

export function buildDesignArtifactSyncKey(
  artifacts: readonly DesignArtifact[],
  designTarget: DesignTarget | undefined
): string {
  return [
    buildHtmlArtifactSyncKey(artifacts, designTarget),
    ...artifacts
      .filter((artifact) => artifact.kind === 'svg')
      .map((artifact) => {
        const node = artifact.node
        return [
          artifact.id,
          artifact.title,
          artifact.previewStatus ?? '',
          artifact.relativePath,
          node?.x ?? '',
          node?.y ?? '',
          node?.width ?? '',
          node?.height ?? '',
          node?.sizeMode ?? '',
          node?.boardHidden ? 'hidden' : ''
        ].join(':')
      })
  ].join('|')
}

export type RemovedLinkedArtifactReference = {
  artifactId: string
  kind: 'html' | 'svg'
  /** HTML version id when the removed frame was stamped with one. */
  versionId?: string
}

function documentHasArtifactFrame(
  doc: CanvasDocument,
  reference: { id: string; kind: 'html' | 'svg'; versionId?: string }
): boolean {
  return Object.values(doc.objects).some((shape) => {
    const current = embeddedArtifactOf(shape)
    if (!isArtifactFrame(shape) || !current) return false
    if (current.id !== reference.id || current.kind !== reference.kind) return false
    // A version-stamped HTML frame is only a replacement for the SAME version;
    // deleting one historical version must not be masked by another version's
    // frame still being on the board.
    if (reference.versionId === undefined) return true
    return (current.versionId ?? undefined) === reference.versionId
  })
}

/**
 * File-artifact references whose linked frame disappeared from the board,
 * compared by { artifactId, kind, versionId }. A legacy frame without a version
 * id matches any frame of the same artifact so the old single-frame behavior
 * (and SVG one-to-one sync) is preserved.
 */
export function removedLinkedArtifactReferences(
  before: CanvasDocument,
  after: CanvasDocument
): RemovedLinkedArtifactReference[] {
  const removed: RemovedLinkedArtifactReference[] = []
  for (const shape of Object.values(before.objects)) {
    const reference = embeddedArtifactOf(shape)
    if (!isArtifactFrame(shape) || !reference) continue
    if (!documentHasArtifactFrame(after, reference)) {
      removed.push({
        artifactId: reference.id,
        kind: reference.kind,
        ...(reference.versionId ? { versionId: reference.versionId } : {})
      })
    }
  }
  return removed
}

/** File artifacts whose last linked frame disappeared from the board. */
export function removedLinkedArtifactIds(
  before: CanvasDocument,
  after: CanvasDocument
): string[] {
  const removed = new Set<string>()
  for (const shape of Object.values(before.objects)) {
    const reference = embeddedArtifactOf(shape)
    if (!isArtifactFrame(shape) || !reference) continue
    if (!documentHasArtifactFrame(after, reference)) removed.add(reference.id)
  }
  return [...removed]
}

function linkedSvgFrames(doc: CanvasDocument): Map<string, CanvasShape> {
  const frames = new Map<string, CanvasShape>()
  for (const id of documentShapeIdsInOrder(doc)) {
    const shape = doc.objects[id]
    const reference = shape ? embeddedArtifactOf(shape) : null
    if (shape && isSvgFrame(shape) && reference?.kind === 'svg' && !frames.has(reference.id)) {
      frames.set(reference.id, shape)
    }
  }
  return frames
}

/** Keep first-class SVG artifacts and their whiteboard frames in one-to-one sync. */
export function syncSvgArtifactsToBoardDocument(
  doc: CanvasDocument,
  artifacts: readonly DesignArtifact[]
): SyncHtmlArtifactsToBoardResult {
  const svgArtifacts = artifacts.filter((artifact) => artifact.kind === 'svg')
  const svgArtifactIds = new Set(svgArtifacts.map((artifact) => artifact.id))
  const seenArtifactIds = new Set<string>()
  const addedFrameIds: string[] = []
  const updatedFrameIds: string[] = []
  const removedFrameIds: string[] = []
  let next: CanvasDocument | null = null

  for (const id of documentShapeIdsInOrder(doc)) {
    const shape = doc.objects[id]
    const reference = shape ? embeddedArtifactOf(shape) : null
    if (!shape || !isSvgFrame(shape) || reference?.kind !== 'svg') continue
    const duplicate = seenArtifactIds.has(reference.id)
    const missingArtifact = !svgArtifactIds.has(reference.id)
    if (!duplicate && !missingArtifact) {
      seenArtifactIds.add(reference.id)
      continue
    }
    if (!next) next = cloneDocument(doc)
    const existing = next.objects[shape.id]
    if (!existing) continue
    for (const removeId of [shape.id, ...descendantIds(next.objects, shape.id)]) {
      delete next.objects[removeId]
    }
    if (existing.parentId && next.objects[existing.parentId]) {
      const parent = next.objects[existing.parentId]
      next.objects[existing.parentId] = {
        ...parent,
        children: parent.children.filter((childId) => childId !== shape.id)
      }
    }
    removedFrameIds.push(shape.id)
  }

  const workingDoc = next ?? doc
  const framesByArtifactId = linkedSvgFrames(workingDoc)
  const occupiedRects: Rect[] = Object.values(workingDoc.objects)
    .filter((shape) => shape.visible !== false && isArtifactFrame(shape))
    .map(shapeBounds)

  for (const artifact of svgArtifacts) {
    const existing = framesByArtifactId.get(artifact.id)
    if (existing) {
      const currentRoot = (next ?? workingDoc).objects[(next ?? workingDoc).rootId]
      const rootHasFrame = currentRoot?.children.includes(existing.id) ?? false
      if (existing.parentId !== workingDoc.rootId || !rootHasFrame || existing.frameId !== null) {
        if (!next) next = cloneDocument(workingDoc)
        const current = next.objects[existing.id]
        const root = next.objects[next.rootId]
        if (current && root) {
          if (current.parentId && current.parentId !== next.rootId && next.objects[current.parentId]) {
            const oldParent = next.objects[current.parentId]
            next.objects[current.parentId] = {
              ...oldParent,
              children: oldParent.children.filter((childId) => childId !== current.id)
            }
          }
          next.objects[current.id] = { ...current, parentId: next.rootId, frameId: null }
          if (!root.children.includes(current.id)) {
            next.objects[next.rootId] = { ...root, children: [...root.children, current.id] }
          }
          if (!updatedFrameIds.includes(current.id)) updatedFrameIds.push(current.id)
        }
      }
      const width = Math.max(64, existing.width)
      const height = Math.max(64, existing.height)
      const name = artifact.title || existing.name
      if (name !== existing.name || width !== existing.width || height !== existing.height) {
        if (!next) next = cloneDocument(workingDoc)
        next.objects[existing.id] = { ...next.objects[existing.id], name, width, height }
        if (!updatedFrameIds.includes(existing.id)) updatedFrameIds.push(existing.id)
      }
      continue
    }
    if (artifact.node?.boardHidden) continue
    if (!next) next = cloneDocument(workingDoc)
    const root = next.objects[next.rootId]
    if (!root) continue
    const fallbackSize = {
      width: Math.max(64, artifact.node?.width ?? 640),
      height: Math.max(64, artifact.node?.height ?? 480)
    }
    const rect = artifact.node
      ? { x: artifact.node.x, y: artifact.node.y, ...fallbackSize }
      : placeRectInViewportAvoiding(fallbackSize, useCanvasViewportStore.getState().vbox, occupiedRects)
    const frame = createSvgFrameShape(
      artifact.title || 'SVG motion',
      rect.x,
      rect.y,
      artifact.id,
      rect.width,
      rect.height
    )
    frame.parentId = next.rootId
    next.objects[frame.id] = frame
    next.objects[next.rootId] = { ...root, children: [...root.children, frame.id] }
    occupiedRects.push(shapeBounds(frame))
    addedFrameIds.push(frame.id)
  }

  return { document: next ?? workingDoc, addedFrameIds, updatedFrameIds, removedFrameIds }
}

export function syncDesignArtifactsToBoardDocument(
  doc: CanvasDocument,
  artifacts: readonly DesignArtifact[]
): SyncHtmlArtifactsToBoardResult {
  const html = syncHtmlArtifactsToBoardDocument(doc, artifacts)
  const sectioned = assignAgentBoardSections(html.document, html.addedFrameIds, artifacts)
  const svg = syncSvgArtifactsToBoardDocument(sectioned, artifacts)
  const root = svg.document.objects[svg.document.rootId]
  const normalChildren = root?.children.filter((id) => !isArtifactFrame(svg.document.objects[id])) ?? []
  const portalChildren = root?.children.filter((id) => isArtifactFrame(svg.document.objects[id])) ?? []
  const orderedChildren = [...normalChildren, ...portalChildren]
  const portalOrderChanged = Boolean(root && root.children.some((id, index) => id !== orderedChildren[index]))
  const document = portalOrderChanged && root
    ? {
        ...svg.document,
        objects: { ...svg.document.objects, [root.id]: { ...root, children: orderedChildren } }
      }
    : svg.document
  return {
    document,
    addedFrameIds: [...html.addedFrameIds, ...svg.addedFrameIds],
    updatedFrameIds: [...html.updatedFrameIds, ...svg.updatedFrameIds],
    removedFrameIds: [...html.removedFrameIds, ...svg.removedFrameIds]
  }
}

function nodeRect(node: DesignArtifactNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

export function syncSvgFrameNodesToArtifacts(doc: CanvasDocument): void {
  const designStore = useDesignWorkspaceStore.getState()
  const syncedArtifactIds = new Set<string>()
  for (const id of documentShapeIdsInOrder(doc)) {
    const shape = doc.objects[id]
    const reference = shape ? embeddedArtifactOf(shape) : null
    if (!shape || !isSvgFrame(shape) || reference?.kind !== 'svg') continue
    if (syncedArtifactIds.has(reference.id)) continue
    const artifact = designStore.artifacts.find(
      (item) => item.id === reference.id && item.kind === 'svg'
    )
    if (!artifact) continue
    syncedArtifactIds.add(reference.id)
    const nextNode: DesignArtifactNode = {
      x: Math.round(shape.x),
      y: Math.round(shape.y),
      width: Math.max(64, Math.round(shape.width)),
      height: Math.max(64, Math.round(shape.height)),
      sizeMode: 'manual',
      boardHidden: false,
      viewMode: 'preview'
    }
    const current = artifact.node
    if (
      current &&
      rectsAlmostEqual(nodeRect(current), nodeRect(nextNode)) &&
      current.sizeMode === nextNode.sizeMode &&
      current.boardHidden === nextNode.boardHidden
    ) {
      continue
    }
    designStore.updateArtifactNode(artifact.id, nextNode)
  }
}

export function syncDesignArtifactFrameNodesToArtifacts(doc: CanvasDocument): void {
  syncHtmlFrameNodesToArtifacts(doc)
  syncSvgFrameNodesToArtifacts(doc)
}
