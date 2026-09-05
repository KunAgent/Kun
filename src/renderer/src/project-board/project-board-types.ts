export type ProjectBoardStatus = 'pending' | 'in_progress' | 'completed'
export const PROJECT_BOARD_DRAG_MIME = 'application/x-kun-project-board-cards'
export type ProjectBoardPriority = 'P0' | 'P1' | 'P2' | null
export type ProjectBoardCategory =
  | 'feature'
  | 'bug'
  | 'refactor'
  | 'tech_debt'
  | 'docs'
  | 'test'
  | 'api'
  | 'sync'
  | 'ui'
  | 'interaction'
  | 'chore'
  | 'other'

export type ProjectBoardCard = {
  id: string
  kind: 'manual' | 'thread_todo'
  workspaceRoot: string
  title: string
  description: string
  status: ProjectBoardStatus
  category: ProjectBoardCategory | 'plan'
  priority: ProjectBoardPriority
  archived: boolean
  updatedAt: string
  source: {
    label: 'Manual' | 'Plan'
    threadId?: string
    todoId?: string
    threadTitle?: string
    planId?: string
    planRelativePath?: string
    sectionTitle?: string
    ordinal?: number
  }
}

export type ProjectBoardCounts = {
  pending: number
  inProgress: number
  completed: number
  archived: number
  total: number
}

export type ProjectBoardSnapshot = {
  workspaceRoot: string
  revision: number
  cards: ProjectBoardCard[]
  counts: ProjectBoardCounts
  truncated: boolean
  nextCursor?: string
  warning?: string
}

export type ProjectBoardSummary = {
  workspaceRoot: string
  total: number
  completed: number
  inProgress: number
  progress: number
  updatedAt: string | null
}

export type ProjectBoardStatusDelta = {
  id: string
  status: ProjectBoardStatus
  updatedAt: string
}

export type ProjectBoardBulkStatusFailure = {
  cardId: string
  code: 'write_failed' | 'source_missing' | 'stale_status' | 'skipped'
  message: string
}

export type ProjectBoardBulkStatusResponse = {
  workspaceRoot: string
  revision: number
  counts: ProjectBoardCounts
  updatedCards: ProjectBoardStatusDelta[]
  failures: ProjectBoardBulkStatusFailure[]
}

export type ProjectBoardFilters = {
  categories: ProjectBoardCategory[]
  priorities: Array<'P0' | 'P1' | 'P2' | 'none'>
  sources: Array<'manual' | 'plan'>
  showCompleted: boolean
}

export type ProjectBoardTab = 'overview' | 'board' | 'archive'

export const PROJECT_BOARD_CATEGORIES: ProjectBoardCategory[] = [
  'feature', 'bug', 'refactor', 'tech_debt', 'docs', 'test',
  'api', 'sync', 'ui', 'interaction', 'chore', 'other'
]

export const DEFAULT_PROJECT_BOARD_FILTERS: ProjectBoardFilters = {
  categories: [],
  priorities: [],
  sources: [],
  showCompleted: true
}
