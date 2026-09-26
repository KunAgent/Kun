export type DesignOutputMedium = 'html' | 'image'
export type DesignTarget = 'web' | 'app'
export type DesignSystemPreset =
  | 'none'
  | 'shadcn'
  | 'radix'
  | 'material'
  | 'ios'
  | 'fluent'
  | 'ant'
  | 'chakra'
  | 'carbon'
  | 'polaris'
  | 'bootstrap'
  | 'geist'
  | 'brutalism'
  | 'editorial'
export type DesignPresetSource =
  | 'explicit'
  | 'root-design-md'
  | 'workspace-default'
  | 'none'

export type DesignStyleSnapshot = {
  version: 1
  source: 'root-design-md'
  /** Hash of the complete source file, even when the parsed snapshot is truncated. */
  sourceHash: string
  /** Human-readable project style name parsed from DESIGN.md. */
  sourceName: string
  /** Stable, bounded JSON projection of the parsed DESIGN.md style contract. */
  content: string
  truncated?: boolean
}

export type DesignDocumentTarget = {
  documentId: string
  boardArtifactId: string
}

export type DesignImagePlacementTarget = {
  shapeId: string
  expectedImageUrl?: string
  expectedHolderKind?: 'explicit' | 'implicit-image' | 'implicit-frame' | 'implicit-rect'
}

export type DesignContextSnapshot = {
  designType?: 'brand' | 'product'
  brandColor?: string
  tone: string[]
  designGuidelines?: string
  radius?: 'sharp' | 'soft' | 'rounded' | 'pill'
  density?: 'compact' | 'cozy' | 'spacious'
  fontStyle?: 'system' | 'geometric' | 'humanist' | 'serif' | 'mono'
}

export type DesignTaskProfileInput = {
  version: 1
  documentTarget: DesignDocumentTarget
  outputMedium: DesignOutputMedium
  target: DesignTarget
  preset: DesignSystemPreset
  presetSource?: DesignPresetSource
  styleSnapshot?: DesignStyleSnapshot
  /** Renderer locked with the task. Missing means the legacy Kun canvas. */
  canvasEngine?: 'kun' | 'excalidraw'
  context: DesignContextSnapshot
}

export type DesignTaskProfile = DesignTaskProfileInput & {
  lockedAtTurnId: string
}

export function cloneDesignDocumentTarget(target: DesignDocumentTarget): DesignDocumentTarget {
  return { documentId: target.documentId, boardArtifactId: target.boardArtifactId }
}

export function cloneDesignTaskProfile(profile: DesignTaskProfile): DesignTaskProfile {
  return {
    ...profile,
    documentTarget: cloneDesignDocumentTarget(profile.documentTarget),
    ...(profile.styleSnapshot ? { styleSnapshot: { ...profile.styleSnapshot } } : {}),
    context: { ...profile.context, tone: [...profile.context.tone] }
  }
}
