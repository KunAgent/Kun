import type { CanvasShape, Rect } from './canvas-types'
import { isHtmlFrame, shapeBounds } from './canvas-types'
import type { DesignArtifact } from '../design-types'
import { buildPrototypeHref } from '../design-turn-prompt'

const FLOW_LANE_OFFSET = 96

export type PrototypeFlowEdge = {
  id: string
  sourceArtifactId: string
  targetArtifactId: string
  sourceTitle: string
  targetTitle: string
  label?: string
  href?: string
  x1: number
  y1: number
  x2: number
  y2: number
  controlX: number
  controlY: number
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function titleTokens(title: string): string[] {
  return normalizeTitle(title).split(' ').filter(Boolean)
}

function fuzzyTitleMatch(query: string, candidate: string): boolean {
  const queryTokens = titleTokens(query)
  const candidateTokens = titleTokens(candidate)
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false
  return (
    queryTokens.every((token) => candidateTokens.includes(token)) ||
    candidateTokens.every((token) => queryTokens.includes(token))
  )
}

function center(bounds: Rect): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function overlappingHorizontalLane(
  bounds: readonly Rect[],
  x1: number,
  x2: number,
  preferTop: boolean,
  topClearance: number
): number {
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  const crossed = bounds.filter((bound) => bound.x <= maxX && bound.x + bound.width >= minX)
  const candidates = crossed.length > 0 ? crossed : bounds
  const top = Math.min(...candidates.map((bound) => bound.y))
  const bottom = Math.max(...candidates.map((bound) => bound.y + bound.height))
  return preferTop ? top - FLOW_LANE_OFFSET - topClearance : bottom + FLOW_LANE_OFFSET
}

function overlappingVerticalLane(bounds: readonly Rect[], y1: number, y2: number, preferLeft: boolean): number {
  const minY = Math.min(y1, y2)
  const maxY = Math.max(y1, y2)
  const crossed = bounds.filter((bound) => bound.y <= maxY && bound.y + bound.height >= minY)
  const candidates = crossed.length > 0 ? crossed : bounds
  const left = Math.min(...candidates.map((bound) => bound.x))
  const right = Math.max(...candidates.map((bound) => bound.x + bound.width))
  return preferLeft ? left - FLOW_LANE_OFFSET : right + FLOW_LANE_OFFSET
}

function routeBetweenFrames(
  sourceFrame: CanvasShape,
  targetFrame: CanvasShape,
  frameBounds: readonly Rect[],
  topClearance: number
): Pick<PrototypeFlowEdge, 'x1' | 'y1' | 'x2' | 'y2' | 'controlX' | 'controlY'> {
  const source = shapeBounds(sourceFrame)
  const target = shapeBounds(targetFrame)
  const sourceCenter = center(source)
  const targetCenter = center(target)
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    const targetIsRight = dx >= 0
    const x1 = targetIsRight ? source.x + source.width : source.x
    const x2 = targetIsRight ? target.x : target.x + target.width
    const y1 = sourceCenter.y
    const y2 = targetCenter.y
    return {
      x1,
      y1,
      x2,
      y2,
      controlX: (x1 + x2) / 2,
      controlY: overlappingHorizontalLane(frameBounds, x1, x2, targetIsRight, topClearance)
    }
  }

  const targetIsBelow = dy >= 0
  const x1 = sourceCenter.x
  const x2 = targetCenter.x
  const y1 = targetIsBelow ? source.y + source.height : source.y
  const y2 = targetIsBelow ? target.y : target.y + target.height
  return {
    x1,
    y1,
    x2,
    y2,
    controlX: overlappingVerticalLane(frameBounds, y1, y2, !targetIsBelow),
    controlY: (y1 + y2) / 2
  }
}

function sortByCanvasReadingOrder(
  a: DesignArtifact,
  b: DesignArtifact,
  framesByArtifactId: Map<string, CanvasShape>
): number {
  const aBounds = shapeBounds(framesByArtifactId.get(a.id)!)
  const bBounds = shapeBounds(framesByArtifactId.get(b.id)!)
  const rowDelta = aBounds.y - bBounds.y
  if (Math.abs(rowDelta) > 48) return rowDelta
  return aBounds.x - bBounds.x
}

export function computePrototypeFlowEdges(
  artifacts: readonly DesignArtifact[],
  objects: Record<string, CanvasShape>,
  /** Extra canvas-unit room kept above boards (their label row) for top lanes. */
  options: { topClearance?: number } = {}
): PrototypeFlowEdge[] {
  const topClearance = Math.max(0, options.topClearance ?? 0)
  const framesByArtifactId = new Map<string, CanvasShape>()
  for (const shape of Object.values(objects)) {
    if (!shape || shape.visible === false || !isHtmlFrame(shape) || !shape.htmlArtifactId) continue
    framesByArtifactId.set(shape.htmlArtifactId, shape)
  }

  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const htmlArtifacts = artifacts.filter((artifact) => artifact.kind === 'html')
  const frameBounds = Array.from(framesByArtifactId.values()).map(shapeBounds)
  const uniqueArtifactByTitle = (title: string): DesignArtifact | undefined => {
    const normalized = normalizeTitle(title)
    if (!normalized) return undefined
    const exactMatches = htmlArtifacts.filter((artifact) => normalizeTitle(artifact.title) === normalized)
    if (exactMatches.length === 1) return exactMatches[0]
    if (exactMatches.length > 1) return undefined
    const fuzzyMatches = htmlArtifacts.filter((artifact) => fuzzyTitleMatch(title, artifact.title))
    return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined
  }
  const edges: PrototypeFlowEdge[] = []
  const seen = new Set<string>()
  const visibleHtmlArtifacts = artifacts
    .filter((artifact) => artifact.kind === 'html' && framesByArtifactId.has(artifact.id))
    .sort((a, b) => sortByCanvasReadingOrder(a, b, framesByArtifactId))
  const fallbackTargetByArtifactId = new Map<string, DesignArtifact>()
  if (visibleHtmlArtifacts.length > 1) {
    visibleHtmlArtifacts.forEach((artifact, index) => {
      fallbackTargetByArtifactId.set(artifact.id, visibleHtmlArtifacts[(index + 1) % visibleHtmlArtifacts.length])
    })
  }
  const visibleOutboundCountByArtifactId = new Map<string, number>()

  const addEdge = (
    artifact: DesignArtifact,
    targetArtifact: DesignArtifact,
    link: { label?: string; href?: string },
    kind: 'explicit' | 'fallback'
  ): void => {
    if (targetArtifact.kind !== 'html' || targetArtifact.id === artifact.id) return
    const sourceFrame = framesByArtifactId.get(artifact.id)
    const targetFrame = framesByArtifactId.get(targetArtifact.id)
    if (!sourceFrame || !targetFrame) return
    const key = `${artifact.id}->${targetArtifact.id}:${link.label ?? link.href ?? kind}`
    if (seen.has(key)) return
    seen.add(key)
    visibleOutboundCountByArtifactId.set(artifact.id, (visibleOutboundCountByArtifactId.get(artifact.id) ?? 0) + 1)
    const route = routeBetweenFrames(sourceFrame, targetFrame, frameBounds, topClearance)
    edges.push({
      id: key,
      sourceArtifactId: artifact.id,
      targetArtifactId: targetArtifact.id,
      sourceTitle: artifact.title,
      targetTitle: targetArtifact.title,
      ...(link.label ? { label: link.label } : {}),
      ...(link.href ? { href: link.href } : {}),
      ...route
    })
  }

  for (const artifact of artifacts) {
    if (artifact.kind !== 'html' || !framesByArtifactId.has(artifact.id)) continue

    for (const link of artifact.prototypeLinks ?? []) {
      const targetArtifact =
        (link.targetArtifactId ? artifactsById.get(link.targetArtifactId) : undefined) ??
        uniqueArtifactByTitle(link.targetTitle)
      if (!targetArtifact) continue
      addEdge(artifact, targetArtifact, link, 'explicit')
    }

    if (
      (artifact.prototypeLinks?.length ?? 0) === 0 &&
      (visibleOutboundCountByArtifactId.get(artifact.id) ?? 0) === 0
    ) {
      const fallbackTarget = fallbackTargetByArtifactId.get(artifact.id)
      if (fallbackTarget) {
        addEdge(
          artifact,
          fallbackTarget,
          {
            href: buildPrototypeHref(artifact.relativePath, fallbackTarget.relativePath)
          },
          'fallback'
        )
      }
    }
  }

  return edges
}
