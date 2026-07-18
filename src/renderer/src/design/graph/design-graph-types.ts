import type { Fill, Rect, Stroke } from '../canvas/canvas-types'
import type { DesignDirectionScorecard } from '../directions/direction-scorecard'
import type { DesignDirectionStatus } from '../design-types'

export type DesignGraphVersion = 1

export type DesignGraphObjectKind =
  | 'board'
  | 'frame'
  | 'html-frame'
  | 'svg-frame'
  | 'running-app-frame'
  | 'shape'
  | 'component'
  | 'token'
  | 'asset'
  | 'agent-note'

export type DesignGraphSource = {
  canvasShapeId?: string
  artifactId?: string
  artifactKind?: 'html' | 'svg'
  /** @deprecated Use artifactId for new consumers. */
  htmlArtifactId?: string
  runningAppUrl?: string
  componentId?: string
  tokenName?: string
  assetPath?: string
}

export type DesignGraphObject = {
  id: string
  kind: DesignGraphObjectKind
  name: string
  parentId: string | null
  children: string[]
  bounds?: Rect
  visible?: boolean
  locked?: boolean
  source?: DesignGraphSource
  style?: {
    fills?: Fill[]
    strokes?: Stroke[]
    opacity?: number
    cornerRadius?: number | [number, number, number, number]
  }
  text?: {
    content?: string
    fontSize?: number
    fontFamily?: string
    fontWeight?: number
    color?: string
  }
  metadata?: Record<string, unknown>
}

export type DesignGraphDirection = {
  id: string
  name: string
  status: DesignDirectionStatus
  objectIds: string[]
  createdAt?: string
  scorecard?: DesignDirectionScorecard
}

export type DesignGraphTokenUsage = {
  objectId: string
  prop: string
}

export type DesignGraphTokenSummary = {
  name: string
  kind: string
  usageCount: number
  usedBy: DesignGraphTokenUsage[]
}

export type DesignGraphComponentSummary = {
  id: string
  name: string
  version: number
  slotCount: number
  rootShapeCount: number
  usageCount: number
  instanceIds: string[]
}

export type DesignGraphDesignSystem = {
  tokenCount: number
  componentCount: number
  tokenUsageCount: number
  componentInstanceCount: number
  tokens: DesignGraphTokenSummary[]
  components: DesignGraphComponentSummary[]
}

export type DesignGraph = {
  version: DesignGraphVersion
  projectId: string
  rootObjectIds: string[]
  objects: Record<string, DesignGraphObject>
  directions: Record<string, DesignGraphDirection>
  designSystem?: DesignGraphDesignSystem
  updatedAt?: string
}

export type DesignOperationType =
  | 'create_frame'
  | 'create_shape'
  | 'update_shape'
  | 'delete_shape'
  | 'move_shape'
  | 'resize_shape'
  | 'arrange_shapes'
  | 'group_shapes'
  | 'define_token'
  | 'apply_token'
  | 'define_component'
  | 'instantiate_component'
  | 'generate_screen'
  | 'bind_code'
  | 'lint_design'
  | 'update_motion'
  | 'legacy_shape_op'

export type DesignOperation = {
  id: string
  type: DesignOperationType
  label: string
  source: 'canvas' | 'agent' | 'code-bridge' | 'import'
  createdAt: string
  targetIds: string[]
  payload: unknown
}

export type DesignOperationJournalEntry = {
  id: string
  label: string
  createdAt: string
  status: 'applied' | 'partial'
  operations: DesignOperation[]
  affectedIds: string[]
  errors: Array<{ code: string; message: string; suggestion?: string }>
}
