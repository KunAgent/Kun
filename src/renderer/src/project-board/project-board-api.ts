import {
  KUN_PROJECT_BOARD_CARDS_PATH,
  KUN_PROJECT_BOARD_CARD_STATUS_PATH,
  KUN_PROJECT_BOARD_SNAPSHOT_PATH,
  KUN_PROJECT_BOARD_SUMMARIES_PATH,
  kunProjectBoardCardPath,
  kunProjectBoardTodoOverlayPath
} from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type {
  ProjectBoardCard,
  ProjectBoardBulkStatusResponse,
  ProjectBoardCategory,
  ProjectBoardPriority,
  ProjectBoardSnapshot,
  ProjectBoardStatus,
  ProjectBoardSummary
} from './project-board-types'

export class ProjectBoardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly snapshot?: ProjectBoardSnapshot
  ) {
    super(message)
    this.name = 'ProjectBoardApiError'
  }
}

export const projectBoardApi = {
  snapshot(workspace: string, options: { includeArchived?: boolean; cursor?: string } = {}) {
    const params = new URLSearchParams({ workspace })
    if (options.includeArchived) params.set('includeArchived', 'true')
    if (options.cursor) params.set('cursor', options.cursor)
    return request<ProjectBoardSnapshot>(`${KUN_PROJECT_BOARD_SNAPSHOT_PATH}?${params}`, 'GET')
  },

  summaries(workspaces: string[]) {
    return request<{ summaries: ProjectBoardSummary[] }>(
      KUN_PROJECT_BOARD_SUMMARIES_PATH,
      'POST',
      { workspaces }
    ).then((response) => response.summaries)
  },

  createCard(input: {
    workspace: string
    expectedRevision: number
    title: string
    description?: string
    status: ProjectBoardStatus
    category?: ProjectBoardCategory
    priority?: ProjectBoardPriority
  }) {
    return request<ProjectBoardSnapshot>(KUN_PROJECT_BOARD_CARDS_PATH, 'POST', input)
  },

  patchCard(cardId: string, input: {
    workspace: string
    expectedRevision: number
    title?: string
    description?: string
    status?: ProjectBoardStatus
    category?: ProjectBoardCategory
    priority?: ProjectBoardPriority
    archived?: boolean
  }) {
    return request<ProjectBoardSnapshot>(kunProjectBoardCardPath(stripManualPrefix(cardId)), 'PATCH', input)
  },

  patchCardStatuses(input: {
    workspace: string
    expectedRevision: number
    cardIds: string[]
    fromStatus: ProjectBoardStatus
    status: ProjectBoardStatus
  }) {
    return request<ProjectBoardBulkStatusResponse>(
      KUN_PROJECT_BOARD_CARD_STATUS_PATH,
      'PATCH',
      input
    )
  },

  deleteCard(cardId: string, workspace: string, expectedRevision: number) {
    return request<ProjectBoardSnapshot>(
      kunProjectBoardCardPath(stripManualPrefix(cardId)),
      'DELETE',
      { workspace, expectedRevision }
    )
  },

  patchTodoOverlay(card: ProjectBoardCard, input: {
    workspace: string
    expectedRevision: number
    category?: ProjectBoardCategory | null
    priority?: ProjectBoardPriority
    description?: string
    archived?: boolean
  }) {
    if (!card.source.threadId || !card.source.todoId) throw new Error('Plan card source is unavailable')
    return request<ProjectBoardSnapshot>(
      kunProjectBoardTodoOverlayPath(card.source.threadId, card.source.todoId),
      'PATCH',
      input
    )
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await rendererRuntimeClient.runtimeRequest(
    path,
    method,
    body === undefined ? undefined : JSON.stringify(body)
  )
  let parsed: any = null
  try {
    parsed = JSON.parse(response.body)
  } catch {
    // Error below carries a stable fallback.
  }
  if (!response.ok) {
    throw new ProjectBoardApiError(
      parsed?.message || 'Project board request failed',
      response.status,
      parsed?.snapshot
    )
  }
  if (!parsed) throw new ProjectBoardApiError('Project board returned invalid data', response.status)
  return parsed as T
}

function stripManualPrefix(cardId: string): string {
  return cardId.startsWith('manual:') ? cardId.slice('manual:'.length) : cardId
}
