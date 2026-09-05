import { create, type StoreApi } from 'zustand'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../lib/workspace-path'
import i18n from '../i18n'
import { projectBoardApi, ProjectBoardApiError } from './project-board-api'
import {
  DEFAULT_PROJECT_BOARD_FILTERS,
  type ProjectBoardCard,
  type ProjectBoardBulkStatusResponse,
  type ProjectBoardCategory,
  type ProjectBoardFilters,
  type ProjectBoardPriority,
  type ProjectBoardSnapshot,
  type ProjectBoardStatus,
  type ProjectBoardSummary,
  type ProjectBoardTab
} from './project-board-types'

const SELECTED_WORKSPACE_KEY = 'kun:project-board:selected-workspace:v1'
const FILTERS_KEY_PREFIX = 'kun:project-board:filters:v1:'
const SUMMARY_CACHE_MS = 30_000
const inflightLoads = new Map<string, Promise<void>>()
const summaryLoadedAtByWorkspace = new Map<string, number>()
const boardRetryByWorkspace = new Map<string, { failures: number; nextRetryAt: number }>()
const summaryRetryByWorkspace = new Map<string, { failures: number; nextRetryAt: number }>()
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const

export type ProjectBoardMoveResult = {
  updatedCardIds: string[]
  failedCardIds: string[]
}

export type ProjectBoardState = {
  selectedWorkspaceRoot: string
  snapshotByWorkspace: Record<string, ProjectBoardSnapshot>
  summariesByWorkspace: Record<string, ProjectBoardSummary>
  loading: boolean
  mutatingCardIds: Record<string, true>
  loadedAtByWorkspace: Record<string, number>
  error: string | null
  searchQuery: string
  filters: ProjectBoardFilters
  activeTab: ProjectBoardTab
  selectWorkspace(workspaceRoot: string): void
  setSearchQuery(query: string): void
  setFilters(filters: ProjectBoardFilters): void
  setActiveTab(tab: ProjectBoardTab): void
  loadBoard(workspaceRoot: string, options?: { force?: boolean }): Promise<void>
  loadMore(workspaceRoot: string): Promise<void>
  refreshSummaries(workspaceRoots: string[], options?: { force?: boolean }): Promise<void>
  createManualCard(input: {
    title: string
    description?: string
    status: ProjectBoardStatus
    category?: ProjectBoardCategory
    priority?: ProjectBoardPriority
  }): Promise<string | null>
  patchManualCard(cardId: string, patch: {
    title?: string
    description?: string
    status?: ProjectBoardStatus
    category?: ProjectBoardCategory
    priority?: ProjectBoardPriority
    archived?: boolean
  }): Promise<void>
  deleteManualCard(cardId: string): Promise<void>
  patchTodoOverlay(card: ProjectBoardCard, patch: {
    category?: ProjectBoardCategory | null
    priority?: ProjectBoardPriority
    description?: string
    archived?: boolean
  }): Promise<void>
  moveCard(card: ProjectBoardCard, status: ProjectBoardStatus): Promise<ProjectBoardMoveResult>
  moveCards(cards: ProjectBoardCard[], status: ProjectBoardStatus): Promise<ProjectBoardMoveResult>
}

export const useProjectBoardStore = create<ProjectBoardState>((set, get) => ({
  selectedWorkspaceRoot: readStorage(SELECTED_WORKSPACE_KEY),
  snapshotByWorkspace: {},
  summariesByWorkspace: {},
  loading: false,
  mutatingCardIds: {},
  loadedAtByWorkspace: {},
  error: null,
  searchQuery: '',
  filters: DEFAULT_PROJECT_BOARD_FILTERS,
  activeTab: 'board',

  selectWorkspace(workspaceRoot) {
    const normalized = normalizeWorkspaceRoot(workspaceRoot)
    if (!normalized) return
    writeStorage(SELECTED_WORKSPACE_KEY, normalized)
    set({
      selectedWorkspaceRoot: normalized,
      searchQuery: '',
      filters: readFilters(normalized),
      error: null
    })
  },

  setSearchQuery(searchQuery) { set({ searchQuery }) },
  setFilters(filters) {
    const workspace = get().selectedWorkspaceRoot
    if (workspace) writeStorage(`${FILTERS_KEY_PREFIX}${workspaceRootIdentityKey(workspace)}`, JSON.stringify(filters))
    set({ filters })
  },
  setActiveTab(activeTab) { set({ activeTab }) },

  async loadBoard(workspaceRoot, _options = {}) {
    const workspace = normalizeWorkspaceRoot(workspaceRoot)
    if (!workspace) return
    const key = workspaceRootIdentityKey(workspace)
    if (inflightLoads.has(key)) return inflightLoads.get(key)
    const force = _options.force === true
    const retry = boardRetryByWorkspace.get(key)
    if (!force && retry && Date.now() < retry.nextRetryAt) return
    const selectedAtStart = get().selectedWorkspaceRoot
    const task = (async () => {
      if (workspaceRootIdentityKey(selectedAtStart) === key) set({ loading: true, error: null })
      try {
        const snapshot = await projectBoardApi.snapshot(workspace, { includeArchived: true })
        boardRetryByWorkspace.delete(key)
        const loadedAt = Date.now()
        set((state) => ({
          snapshotByWorkspace: {
            ...state.snapshotByWorkspace,
            [workspace]: snapshot,
            [snapshot.workspaceRoot]: snapshot
          },
          loadedAtByWorkspace: {
            ...state.loadedAtByWorkspace,
            [workspace]: loadedAt,
            [snapshot.workspaceRoot]: loadedAt
          },
          summariesByWorkspace: withSnapshotSummary(
            state.summariesByWorkspace,
            workspace,
            snapshot,
            loadedAt
          ),
          ...(workspaceRootIdentityKey(state.selectedWorkspaceRoot) === key
            ? { loading: false, error: snapshot.warning ?? null }
            : {})
        }))
      } catch (error) {
        recordRetryFailure(boardRetryByWorkspace, key)
        set((state) => workspaceRootIdentityKey(state.selectedWorkspaceRoot) === key
          ? { loading: false, error: errorMessage(error) }
          : state)
      }
    })().finally(() => {
      if (inflightLoads.get(key) === task) inflightLoads.delete(key)
    })
    inflightLoads.set(key, task)
    return task
  },

  async loadMore(workspaceRoot) {
    const workspace = normalizeWorkspaceRoot(workspaceRoot)
    const current = get().snapshotByWorkspace[workspace]
    if (!current?.nextCursor) return
    try {
      const page = await projectBoardApi.snapshot(workspace, {
        includeArchived: true,
        cursor: current.nextCursor
      })
      set((state) => ({
        snapshotByWorkspace: {
          ...state.snapshotByWorkspace,
          [workspace]: {
            ...page,
            cards: [...current.cards, ...page.cards]
          }
        }
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  async refreshSummaries(workspaceRoots, options = {}) {
    const roots = uniqueWorkspaces(workspaceRoots)
    if (roots.length === 0) return
    const now = Date.now()
    const pending = options.force ? roots : roots.filter((workspace) =>
      now - (summaryLoadedAtByWorkspace.get(workspaceRootIdentityKey(workspace)) ?? 0) >= SUMMARY_CACHE_MS &&
      now >= (summaryRetryByWorkspace.get(workspaceRootIdentityKey(workspace))?.nextRetryAt ?? 0))
    if (pending.length === 0) return
    try {
      const batches: string[][] = []
      for (let index = 0; index < pending.length; index += 32) batches.push(pending.slice(index, index + 32))
      const summaries: ProjectBoardSummary[] = []
      for (const batch of batches) summaries.push(...await projectBoardApi.summaries(batch))
      for (const workspace of pending) {
        const key = workspaceRootIdentityKey(workspace)
        summaryLoadedAtByWorkspace.set(key, Date.now())
        summaryRetryByWorkspace.delete(key)
      }
      set((state) => ({
        summariesByWorkspace: summaries.reduce<Record<string, ProjectBoardSummary>>((all, summary) => {
          all[summary.workspaceRoot] = summary
          const requested = roots.find((root) =>
            workspaceRootIdentityKey(root) === workspaceRootIdentityKey(summary.workspaceRoot))
          if (requested) all[requested] = summary
          return all
        }, { ...state.summariesByWorkspace })
      }))
    } catch {
      for (const workspace of pending) {
        recordRetryFailure(summaryRetryByWorkspace, workspaceRootIdentityKey(workspace))
      }
      // Sidebar summaries are supplementary; the page owns the visible error state.
    }
  },

  async createManualCard(input) {
    const workspace = get().selectedWorkspaceRoot
    const snapshot = get().snapshotByWorkspace[workspace]
    if (!workspace || !snapshot) return null
    const previousIds = new Set(snapshot.cards.map((card) => card.id))
    const next = await mutateSnapshot(set, get, '__new__', () => projectBoardApi.createCard({
      workspace,
      expectedRevision: snapshot.revision,
      ...input
    }))
    return next?.cards.find((card) => !previousIds.has(card.id))?.id ?? null
  },

  async patchManualCard(cardId, patch) {
    const workspace = get().selectedWorkspaceRoot
    const snapshot = get().snapshotByWorkspace[workspace]
    if (!workspace || !snapshot) return
    await mutateSnapshot(set, get, cardId, () => projectBoardApi.patchCard(cardId, {
      workspace,
      expectedRevision: snapshot.revision,
      ...patch
    }))
  },

  async deleteManualCard(cardId) {
    const workspace = get().selectedWorkspaceRoot
    const snapshot = get().snapshotByWorkspace[workspace]
    if (!workspace || !snapshot) return
    await mutateSnapshot(set, get, cardId, () =>
      projectBoardApi.deleteCard(cardId, workspace, snapshot.revision))
  },

  async patchTodoOverlay(card, patch) {
    const workspace = get().selectedWorkspaceRoot
    const snapshot = get().snapshotByWorkspace[workspace]
    if (!workspace || !snapshot) return
    await mutateSnapshot(set, get, card.id, () => projectBoardApi.patchTodoOverlay(card, {
      workspace,
      expectedRevision: snapshot.revision,
      ...patch
    }))
  },

  async moveCard(card, status) {
    return get().moveCards([card], status)
  },

  async moveCards(cards, status) {
    if (cards.length === 0) return { updatedCardIds: [], failedCardIds: [] }
    const fromStatus = cards[0]?.status
    if (!fromStatus || cards.some((card) => card.status !== fromStatus)) {
      set({ error: i18n.t('common:projectBoardSameColumnRequired') })
      return { updatedCardIds: [], failedCardIds: cards.map((card) => card.id) }
    }
    if (fromStatus === status) {
      return { updatedCardIds: [], failedCardIds: [] }
    }
    if (status === 'in_progress' && hasInProgressSelectionConflict(cards)) {
      set({ error: i18n.t('common:projectBoardInProgressSelectionConflict') })
      return { updatedCardIds: [], failedCardIds: cards.map((card) => card.id) }
    }
    const workspace = get().selectedWorkspaceRoot
    const snapshot = get().snapshotByWorkspace[workspace]
    if (!workspace || !snapshot) {
      return { updatedCardIds: [], failedCardIds: cards.map((card) => card.id) }
    }
    const cardIds = cards.map((card) => card.id)
    const pendingIds = Object.fromEntries(cardIds.map((id) => [id, true])) as Record<string, true>
    const optimistic = replaceCardStatuses(snapshot, new Set(cardIds), status)
    set((state) => ({
      snapshotByWorkspace: { ...state.snapshotByWorkspace, [workspace]: optimistic },
      mutatingCardIds: { ...state.mutatingCardIds, ...pendingIds },
      error: null
    }))
    try {
      const response = await projectBoardApi.patchCardStatuses({
        workspace,
        expectedRevision: snapshot.revision,
        cardIds,
        fromStatus,
        status
      })
      applyBulkStatusResponse(set, workspace, snapshot, cardIds, response)
      const failed = new Set(response.failures.map((failure) => failure.cardId))
      return {
        updatedCardIds: cardIds.filter((id) => !failed.has(id)),
        failedCardIds: cardIds.filter((id) => failed.has(id))
      }
    } catch (error) {
      set((state) => ({
        snapshotByWorkspace: { ...state.snapshotByWorkspace, [workspace]: snapshot },
        mutatingCardIds: withoutKeys(state.mutatingCardIds, cardIds),
        ...(workspaceRootIdentityKey(state.selectedWorkspaceRoot) === workspaceRootIdentityKey(workspace)
          ? { error: errorMessage(error) }
          : {})
      }))
      if (error instanceof ProjectBoardApiError && error.status === 409) {
        await get().loadBoard(workspace, { force: true })
        set({ error: error.message })
      }
      return { updatedCardIds: [], failedCardIds: cardIds }
    }
  }
}))

type StoreSet = StoreApi<ProjectBoardState>['setState']
type StoreGet = StoreApi<ProjectBoardState>['getState']

async function mutateSnapshot(
  set: StoreSet,
  get: StoreGet,
  cardId: string,
  mutation: () => Promise<ProjectBoardSnapshot>
): Promise<ProjectBoardSnapshot | null> {
  const workspace = get().selectedWorkspaceRoot
  set((state) => ({
    mutatingCardIds: { ...state.mutatingCardIds, [cardId]: true },
    error: null
  }))
  try {
    const next = await mutation()
    applySnapshot(set, workspace, next, null, [cardId])
    return next
  } catch (error) {
    if (error instanceof ProjectBoardApiError && error.snapshot) {
      applySnapshot(set, workspace, error.snapshot, error.message, [cardId])
    } else {
      set((state) => ({
        mutatingCardIds: withoutKeys(state.mutatingCardIds, [cardId]),
        ...(workspaceRootIdentityKey(state.selectedWorkspaceRoot) === workspaceRootIdentityKey(workspace)
          ? { error: errorMessage(error) }
          : {})
      }))
    }
    return null
  }
}

function applySnapshot(
  set: StoreSet,
  workspace: string,
  snapshot: ProjectBoardSnapshot,
  error: string | null = null,
  clearedIds: string[] = []
): void {
  set((state) => ({
    snapshotByWorkspace: {
      ...state.snapshotByWorkspace,
      [workspace]: snapshot,
      [snapshot.workspaceRoot]: snapshot
    },
    loadedAtByWorkspace: {
      ...state.loadedAtByWorkspace,
      [workspace]: Date.now(),
      [snapshot.workspaceRoot]: Date.now()
    },
    summariesByWorkspace: withSnapshotSummary(
      state.summariesByWorkspace,
      workspace,
      snapshot,
      Date.now()
    ),
    mutatingCardIds: withoutKeys(state.mutatingCardIds, clearedIds),
    ...(workspaceRootIdentityKey(state.selectedWorkspaceRoot) === workspaceRootIdentityKey(workspace)
      ? { error }
      : {})
  }))
}

function replaceCardStatuses(
  snapshot: ProjectBoardSnapshot,
  cardIds: ReadonlySet<string>,
  status: ProjectBoardStatus
): ProjectBoardSnapshot {
  const now = new Date().toISOString()
  const cards = snapshot.cards.map((card) =>
    cardIds.has(card.id) ? { ...card, status, updatedAt: now } : card)
  return { ...snapshot, cards, counts: countsFor(cards) }
}

function applyBulkStatusResponse(
  set: StoreSet,
  workspace: string,
  original: ProjectBoardSnapshot,
  selectedIds: string[],
  response: ProjectBoardBulkStatusResponse
): void {
  const selected = new Set(selectedIds)
  const originalById = new Map(original.cards.map((card) => [card.id, card]))
  const deltas = new Map(response.updatedCards.map((delta) => [delta.id, delta]))
  const failed = new Set(response.failures.map((failure) => failure.cardId))
  set((state) => {
    const current = state.snapshotByWorkspace[workspace] ?? original
    const cards = current.cards.map((card) => {
      const delta = deltas.get(card.id)
      if (delta) return { ...card, status: delta.status, updatedAt: delta.updatedAt }
      if (selected.has(card.id) && failed.has(card.id)) return originalById.get(card.id) ?? card
      return card
    })
    const snapshot = {
      ...current,
      workspaceRoot: response.workspaceRoot,
      revision: response.revision,
      counts: response.counts,
      cards
    }
    const loadedAt = Date.now()
    return {
      snapshotByWorkspace: {
        ...state.snapshotByWorkspace,
        [workspace]: snapshot,
        [response.workspaceRoot]: snapshot
      },
      summariesByWorkspace: withSnapshotSummary(
        state.summariesByWorkspace,
        workspace,
        snapshot,
        loadedAt
      ),
      loadedAtByWorkspace: {
        ...state.loadedAtByWorkspace,
        [workspace]: loadedAt,
        [response.workspaceRoot]: loadedAt
      },
      mutatingCardIds: withoutKeys(state.mutatingCardIds, selectedIds),
      error: response.failures.length > 0
        ? i18n.t('common:projectBoardPartialMove', {
            moved: selectedIds.length - response.failures.length,
            failed: response.failures.length
          })
        : null
    }
  })
}

function withoutKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (keys.length === 0) return record
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
}

function hasInProgressSelectionConflict(cards: readonly ProjectBoardCard[]): boolean {
  const threadIds = new Set<string>()
  for (const card of cards) {
    if (card.kind !== 'thread_todo' || !card.source.threadId) continue
    if (threadIds.has(card.source.threadId)) return true
    threadIds.add(card.source.threadId)
  }
  return false
}

function recordRetryFailure(
  registry: Map<string, { failures: number; nextRetryAt: number }>,
  key: string
): void {
  const failures = Math.min((registry.get(key)?.failures ?? 0) + 1, RETRY_DELAYS_MS.length)
  const delay = RETRY_DELAYS_MS[Math.max(0, failures - 1)]
  registry.set(key, { failures, nextRetryAt: Date.now() + delay })
}

function withSnapshotSummary(
  summaries: Record<string, ProjectBoardSummary>,
  workspace: string,
  snapshot: ProjectBoardSnapshot,
  loadedAt: number
): Record<string, ProjectBoardSummary> {
  const total = snapshot.counts.total
  const summary: ProjectBoardSummary = {
    workspaceRoot: snapshot.workspaceRoot,
    total,
    completed: snapshot.counts.completed,
    inProgress: snapshot.counts.inProgress,
    progress: total === 0 ? 0 : snapshot.counts.completed / total,
    updatedAt: snapshot.cards.reduce<string | null>((latest, card) =>
      !latest || card.updatedAt > latest ? card.updatedAt : latest, null) ??
      new Date(loadedAt).toISOString()
  }
  return { ...summaries, [workspace]: summary, [snapshot.workspaceRoot]: summary }
}

function countsFor(cards: ProjectBoardCard[]): ProjectBoardSnapshot['counts'] {
  const active = cards.filter((card) => !card.archived)
  return {
    pending: active.filter((card) => card.status === 'pending').length,
    inProgress: active.filter((card) => card.status === 'in_progress').length,
    completed: active.filter((card) => card.status === 'completed').length,
    archived: cards.length - active.length,
    total: active.length
  }
}

function uniqueWorkspaces(workspaces: string[]): string[] {
  const seen = new Set<string>()
  return workspaces.map(normalizeWorkspaceRoot).filter((workspace) => {
    const key = workspaceRootIdentityKey(workspace)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readFilters(workspace: string): ProjectBoardFilters {
  try {
    const raw = readStorage(`${FILTERS_KEY_PREFIX}${workspaceRootIdentityKey(workspace)}`)
    if (!raw) return DEFAULT_PROJECT_BOARD_FILTERS
    const value = JSON.parse(raw) as Partial<ProjectBoardFilters>
    return {
      categories: Array.isArray(value.categories) ? value.categories : [],
      priorities: Array.isArray(value.priorities) ? value.priorities : [],
      sources: Array.isArray(value.sources) ? value.sources : [],
      showCompleted: value.showCompleted !== false
    }
  } catch {
    return DEFAULT_PROJECT_BOARD_FILTERS
  }
}

function readStorage(key: string): string {
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}
function writeStorage(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* storage is optional */ }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
