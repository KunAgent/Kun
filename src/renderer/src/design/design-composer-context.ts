import { isHtmlFrame, type CanvasDocument, type CanvasShape } from './canvas/canvas-types'
import type { DesignArtifact } from './design-types'

export type DesignComposerContext = {
  id: string
  kind: 'html-artifact' | 'html-screen-frame' | 'html-element' | 'canvas-selection'
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
      const shape = selectedShapes[0]
      const artifact = artifacts.find((item) => item.id === shape.htmlArtifactId)
      if (artifact?.kind === 'html') {
        const chip = {
          id: `html-screen-frame:${shape.id}:${artifact.id}`,
          kind: 'html-screen-frame' as const,
          label: artifact.title || shape.name,
          detail: `${Math.round(shape.width)} x ${Math.round(shape.height)} - ${artifact.relativePath}`,
          removable: true
        }
        return suppressedIds.has(chip.id) ? [] : [{ kind: 'html-screen-frame', chip, artifact, shape }]
      }
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

  return []
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
