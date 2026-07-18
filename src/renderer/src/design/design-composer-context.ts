import { artifactDirOf } from './design-artifact-persistence'
import { isDirectImageUrl } from './canvas/canvas-image-source'
import { embeddedArtifactOf, isHtmlFrame, isSvgFrame, type CanvasDocument, type CanvasShape } from './canvas/canvas-types'
import {
  defaultFrameSizeForDesignTarget,
  normalizeDesignTarget,
  type DesignTarget
} from './design-context'
import type { DesignArtifact } from './design-types'

export type DesignComposerContext = {
  id: string
  kind: 'design-target' | 'html-artifact' | 'html-screen-frame' | 'html-element' | 'svg-artifact' | 'svg-artifact-frame' | 'canvas-selection' | 'extension-context'
  label: string
  detail?: string
  removable?: boolean
}

export type DesignHtmlElementContext = {
  artifactId: string
  artifactTitle: string
  artifactRelativePath: string
  selector: string
  tagName: string
  text: string
  html: string
}

export type DesignComposerContextTarget =
  | {
      kind: 'html-artifact'
      chip: DesignComposerContext
      artifact: DesignArtifact
    }
  | {
      kind: 'html-screen-frame'
      chip: DesignComposerContext
      artifact: DesignArtifact
      shape: CanvasShape
    }
  | {
      kind: 'html-element'
      chip: DesignComposerContext
      artifact: DesignArtifact
      element: DesignHtmlElementContext
    }
  | {
      kind: 'svg-artifact'
      chip: DesignComposerContext
      artifact: DesignArtifact
    }
  | {
      kind: 'svg-artifact-frame'
      chip: DesignComposerContext
      artifact: DesignArtifact
      shape: CanvasShape
    }
  | {
      kind: 'canvas-selection'
      chip: DesignComposerContext
      selectedIds: string[]
      selectedShapes: CanvasShape[]
    }

export function resolveDesignComposerContextTargets(input: {
  artifacts: readonly DesignArtifact[]
  activeArtifactId: string | null
  canvasDocument: CanvasDocument
  selectedIds: ReadonlySet<string>
  suppressedIds?: ReadonlySet<string>
}): DesignComposerContextTarget[] {
  const { artifacts, activeArtifactId, canvasDocument, selectedIds } = input
  const suppressedIds = input.suppressedIds ?? new Set<string>()
  const active = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null

  if (active?.kind === 'canvas') {
    const selectedShapes = Array.from(selectedIds)
      .map((id) => canvasDocument.objects[id])
      .filter((shape): shape is CanvasShape => Boolean(shape))
    if (selectedShapes.length === 1 && isHtmlFrame(selectedShapes[0])) {
      const target = resolveDesignComposerScreenFrameTarget({
        artifacts,
        canvasDocument,
        shapeId: selectedShapes[0].id,
        suppressedIds
      })
      if (target) return [target]
    }
    if (selectedShapes.length === 1 && isSvgFrame(selectedShapes[0])) {
      const target = resolveDesignComposerSvgFrameTarget({
        artifacts,
        canvasDocument,
        shapeId: selectedShapes[0].id,
        suppressedIds
      })
      if (target) return [target]
    }
    if (selectedShapes.length > 0) {
      const sortedIds = selectedShapes.map((shape) => shape.id).sort()
      const only = selectedShapes.length === 1 ? selectedShapes[0] : null
      const chip = {
        id: `canvas-selection:${sortedIds.join(',')}`,
        kind: 'canvas-selection' as const,
        label: only ? only.name : `${selectedShapes.length} selected layers`,
        detail: only
          ? `${only.type} - ${Math.round(only.width)} x ${Math.round(only.height)}`
          : active.title,
        removable: true
      }
      return suppressedIds.has(chip.id)
        ? []
        : [{ kind: 'canvas-selection', chip, selectedIds: sortedIds, selectedShapes }]
    }
    return []
  }

  if (active?.kind === 'html') {
    const chip = {
      id: `html-artifact:${active.id}`,
      kind: 'html-artifact' as const,
      label: active.title,
      detail: active.relativePath,
      removable: true
    }
    return suppressedIds.has(chip.id) ? [] : [{ kind: 'html-artifact', chip, artifact: active }]
  }

  if (active?.kind === 'svg') {
    const chip = {
      id: `svg-artifact:${active.id}`,
      kind: 'svg-artifact' as const,
      label: active.title,
      detail: active.relativePath,
      removable: true
    }
    return suppressedIds.has(chip.id) ? [] : [{ kind: 'svg-artifact', chip, artifact: active }]
  }

  return []
}

export function resolveDesignComposerSvgFrameTarget(input: {
  artifacts: readonly DesignArtifact[]
  canvasDocument: CanvasDocument
  shapeId: string | null | undefined
  suppressedIds?: ReadonlySet<string>
}): Extract<DesignComposerContextTarget, { kind: 'svg-artifact-frame' }> | null {
  const shapeId = input.shapeId?.trim()
  if (!shapeId) return null
  const shape = input.canvasDocument.objects[shapeId]
  const reference = shape ? embeddedArtifactOf(shape) : null
  if (!shape || !isSvgFrame(shape) || reference?.kind !== 'svg') return null
  const artifact = input.artifacts.find((item) => item.id === reference.id)
  if (artifact?.kind !== 'svg') return null
  const chip = {
    id: `svg-artifact-frame:${shape.id}:${artifact.id}`,
    kind: 'svg-artifact-frame' as const,
    label: artifact.title || shape.name,
    detail: `${Math.round(shape.width)} x ${Math.round(shape.height)} - ${artifact.relativePath}`,
    removable: true
  }
  return input.suppressedIds?.has(chip.id)
    ? null
    : { kind: 'svg-artifact-frame', chip, artifact, shape }
}

export function resolveDesignComposerScreenFrameTarget(input: {
  artifacts: readonly DesignArtifact[]
  canvasDocument: CanvasDocument
  shapeId: string | null | undefined
  suppressedIds?: ReadonlySet<string>
}): Extract<DesignComposerContextTarget, { kind: 'html-screen-frame' }> | null {
  const shapeId = input.shapeId?.trim()
  if (!shapeId) return null
  const shape = input.canvasDocument.objects[shapeId]
  if (!shape || !isHtmlFrame(shape)) return null
  const artifact = input.artifacts.find((item) => item.id === shape.htmlArtifactId)
  if (artifact?.kind !== 'html') return null
  const chip = {
    id: `html-screen-frame:${shape.id}:${artifact.id}`,
    kind: 'html-screen-frame' as const,
    label: artifact.title || shape.name,
    detail: `${Math.round(shape.width)} x ${Math.round(shape.height)} - ${artifact.relativePath}`,
    removable: true
  }
  return input.suppressedIds?.has(chip.id)
    ? null
    : { kind: 'html-screen-frame', chip, artifact, shape }
}

export function designHtmlElementContextTarget(input: {
  artifacts: readonly DesignArtifact[]
  element: DesignHtmlElementContext
  suppressedIds?: ReadonlySet<string>
}): DesignComposerContextTarget | null {
  const artifact = input.artifacts.find((item) => item.id === input.element.artifactId)
  if (artifact?.kind !== 'html') return null
  const text = input.element.text.trim()
  const label = text ? `${input.element.tagName.toLowerCase()}: ${text}` : `${input.element.tagName.toLowerCase()} element`
  const chip = {
    id: `html-element:${input.element.artifactId}:${input.element.selector}`,
    kind: 'html-element' as const,
    label,
    detail: input.element.selector,
    removable: true
  }
  return input.suppressedIds?.has(chip.id)
    ? null
    : {
        kind: 'html-element',
        chip,
        artifact,
        element: {
          ...input.element,
          artifactRelativePath: artifact.relativePath,
          artifactTitle: artifact.title
        }
      }
}

export function designComposerContextChips(targets: readonly DesignComposerContextTarget[]): DesignComposerContext[] {
  return targets.map((target) => target.chip)
}

export function designTargetContextChip(input: {
  designTarget?: DesignTarget
  label: string
  detail?: string
}): DesignComposerContext {
  const target = normalizeDesignTarget(input.designTarget)
  return {
    id: `design-target:${target}`,
    kind: 'design-target',
    label: input.label,
    ...(input.detail ? { detail: input.detail } : {}),
    removable: false
  }
}

export function buildDesignTargetContextChip(input: {
  designTarget?: DesignTarget
  webLabel: string
  appLabel: string
  detail: (input: { width: number; height: number; target: DesignTarget }) => string
}): DesignComposerContext {
  const target = normalizeDesignTarget(input.designTarget)
  const size = defaultFrameSizeForDesignTarget(target)
  return designTargetContextChip({
    designTarget: target,
    label: target === 'app' ? input.appLabel : input.webLabel,
    detail: input.detail({ ...size, target })
  })
}

export function resolveDesignComposerContextViewTargets(input: {
  route: string
  artifacts: readonly DesignArtifact[]
  activeArtifactId: string | null
  canvasDocument: CanvasDocument
  selectedIds: ReadonlySet<string>
  suppressedIds?: ReadonlySet<string>
  htmlElementContext?: DesignHtmlElementContext | null
}): DesignComposerContextTarget[] {
  if (input.route !== 'design') return []
  const elementTarget = input.htmlElementContext
    ? designHtmlElementContextTarget({
        artifacts: input.artifacts,
        element: input.htmlElementContext,
        suppressedIds: input.suppressedIds
      })
    : null
  const baseTargets = resolveDesignComposerContextTargets({
    artifacts: input.artifacts,
    activeArtifactId: input.activeArtifactId,
    canvasDocument: input.canvasDocument,
    selectedIds: input.selectedIds,
    suppressedIds: input.suppressedIds
  })
  return elementTarget ? [elementTarget, ...baseTargets] : baseTargets
}

export function designComposerContextTargetsKey(
  targets: readonly DesignComposerContextTarget[]
): string {
  return targets.map((target) => target.chip.id).join('|')
}

export function designContextChipsForRoute(input: {
  route: string
  targetChip: DesignComposerContext
  targets: readonly DesignComposerContextTarget[]
}): DesignComposerContext[] {
  return input.route === 'design'
    ? [input.targetChip, ...designComposerContextChips(input.targets)]
    : []
}

export function isHtmlElementContextChipId(id: string): boolean {
  return id.startsWith('html-element:')
}

export function nextSuppressedDesignContextIds(
  current: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(current)
  next.add(id)
  return next
}

export function reconcileDesignHtmlElementContext(input: {
  current: DesignHtmlElementContext | null
  route: string
  artifacts: readonly DesignArtifact[]
  activeArtifactId: string | null
}): DesignHtmlElementContext | null {
  if (!input.current) return input.current
  if (input.route !== 'design') return null
  const active = input.artifacts.find((artifact) => artifact.id === input.activeArtifactId) ?? null
  if (active?.kind === 'canvas') {
    return input.artifacts.some((artifact) => artifact.id === input.current?.artifactId)
      ? input.current
      : null
  }
  return input.current.artifactId === input.activeArtifactId ? input.current : null
}

/**
 * A selected design artifact conveyed to the agent as a path pointer rather than
 * inlined content. `path`/`directory` are workspace-relative. The design turn
 * prompt renders these so the agent is TOLD where the selected page / canvas /
 * image lives (and can read it on demand) instead of us dumping full HTML/JSON
 * into the turn.
 */
export type DesignContextLocation = {
  title: string
  kind: 'html' | 'svg' | 'canvas' | 'image'
  path: string
  directory: string
}

function dirOfPath(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '.' : path.slice(0, i)
}

/**
 * Map the resolved composer-context targets to lightweight path pointers for the
 * agent. HTML targets point at their artifact file; a canvas selection points at
 * the board's `canvas.json`; image shapes with a workspace-relative `imageUrl`
 * (i.e. saved files, not inline data URLs) point at the image file. Inline
 * (data:/http/blob) images are skipped — those ride along as composer attachments.
 */
export function designSelectedContextLocations(input: {
  targets: readonly DesignComposerContextTarget[]
  /** The active board/canvas artifact, used to locate a canvas-selection. */
  canvasArtifact?: Pick<DesignArtifact, 'title' | 'relativePath'> | null
}): DesignContextLocation[] {
  const out: DesignContextLocation[] = []
  for (const target of input.targets) {
    if (
      target.kind === 'html-artifact' ||
      target.kind === 'html-screen-frame' ||
      target.kind === 'html-element'
    ) {
      const path = target.artifact.relativePath.trim()
      if (path) {
        out.push({
          title: target.artifact.title || target.chip.label,
          kind: 'html',
          path,
          directory: artifactDirOf(path)
        })
      }
      continue
    }
    if (target.kind === 'svg-artifact' || target.kind === 'svg-artifact-frame') {
      const path = target.artifact.relativePath.trim()
      if (path) {
        out.push({
          title: target.artifact.title || target.chip.label,
          kind: 'svg',
          path,
          directory: artifactDirOf(path)
        })
      }
      continue
    }
    if (target.kind === 'canvas-selection') {
      const canvasPath = input.canvasArtifact?.relativePath.trim()
      if (canvasPath) {
        out.push({
          title: input.canvasArtifact?.title || 'Design canvas',
          kind: 'canvas',
          path: canvasPath,
          directory: artifactDirOf(canvasPath)
        })
      }
      for (const shape of target.selectedShapes) {
        const imageUrl = shape.imageUrl?.trim()
        if (shape.type === 'image' && imageUrl && !isDirectImageUrl(imageUrl)) {
          out.push({
            title: shape.name || 'Image',
            kind: 'image',
            path: imageUrl,
            directory: dirOfPath(imageUrl)
          })
        }
      }
    }
  }
  return out
}
