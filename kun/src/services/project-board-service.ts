import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { IdGenerator } from '../ports/id-generator.js'
import {
  ProjectBoardRevisionConflictError,
  type ProjectBoardStore
} from '../ports/project-board-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadService } from './thread-service.js'
import {
  ProjectBoardBulkConflictError,
  assertNoInProgressSelectionConflict,
  countLightweightCards,
  failureCodeForBulkError,
  groupSelectedPlanCards,
  lightweightBoardCards,
  runWithConcurrency,
  threadTodoCardId
} from './project-board-bulk-status-support.js'
import {
  ProjectBoardPlanMetadataCache,
  loadPlanMetadataConcurrently
} from './project-board-plan-metadata-cache.js'
import {
  PROJECT_BOARD_MAX_CARDS,
  type CreateManualProjectBoardCardRequest,
  type ManualProjectBoardCard,
  type PatchManualProjectBoardCardRequest,
  type PatchProjectBoardTodoOverlayRequest,
  type PatchProjectBoardCardStatusesRequest,
  type ProjectBoardCard,
  type ProjectBoardBulkStatusFailure,
  type ProjectBoardBulkStatusResponse,
  type ProjectBoardCounts,
  type ProjectBoardDocumentV1,
  type ProjectBoardSnapshotResponse,
  type ProjectBoardSummary,
  type ProjectBoardTodoOverlay
} from '../contracts/project-board.js'
import type { ThreadSummary, ThreadTodoItem } from '../contracts/threads.js'

const ORPHAN_OVERLAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

export type ProjectBoardServiceOptions = {
  store: ProjectBoardStore
  threadStore: ThreadStore
  threadService?: Pick<ThreadService, 'patchTodoStatuses'>
  planMetadataCache?: ProjectBoardPlanMetadataCache
  ids: IdGenerator
  nowIso: () => string
}

export class ProjectBoardService {
  private membershipsInFlight: Promise<BoardThreadMembership[]> | null = null
  private readonly membershipPathCache = new Map<
    string,
    { workspace: string; gitProjectRoot: string | null }
  >()
  private readonly planMetadataCache: ProjectBoardPlanMetadataCache

  constructor(private readonly options: ProjectBoardServiceOptions) {
    this.planMetadataCache = options.planMetadataCache ?? new ProjectBoardPlanMetadataCache()
  }

  async snapshot(input: {
    workspace: string
    includeArchived?: boolean
    cursor?: string
  }): Promise<ProjectBoardSnapshotResponse> {
    const workspaceRoot = await canonicalWorkspaceRoot(input.workspace)
    return this.snapshotCanonical(workspaceRoot, input)
  }

  async summaries(workspaces: readonly string[]): Promise<ProjectBoardSummary[]> {
    const startedAt = performance.now()
    const canonical = await Promise.all([...new Set(workspaces)].map(canonicalWorkspaceRoot))
    const memberships = await this.boardThreadMemberships()
    const summaries = await Promise.all(canonical.map(async (workspaceRoot) => {
      const document = (await this.options.store.read(workspaceRoot)).document
      const threads = memberships.filter((membership) =>
        threadMembershipMatchesProject(membership, workspaceRoot)).map(({ thread }) => thread)
      const cards = lightweightBoardCards(document, threads)
      const counts = countLightweightCards(cards.values())
      let latest: string | null = null
      for (const card of cards.values()) {
        if (!latest || card.updatedAt > latest) latest = card.updatedAt
      }
      return {
        workspaceRoot,
        total: counts.total,
        completed: counts.completed,
        inProgress: counts.inProgress,
        progress: counts.total === 0 ? 0 : counts.completed / counts.total,
        updatedAt: latest
      }
    }))
    logSlowBoardOperation('summaries', canonical.join('\0'), startedAt, {
      workspaces: canonical.length,
      threads: memberships.length,
      cards: summaries.reduce((total, summary) => total + summary.total, 0),
      planFiles: 0,
      metadataCacheHits: 0
    })
    return summaries
  }

  async createManualCard(
    request: CreateManualProjectBoardCardRequest
  ): Promise<ProjectBoardSnapshotResponse> {
    const workspaceRoot = await canonicalWorkspaceRoot(request.workspace)
    const now = this.options.nowIso()
    const id = this.options.ids.next('board')
    await this.mutate(workspaceRoot, request.expectedRevision, (document) => {
      const card: ManualProjectBoardCard = {
        id,
        title: request.title,
        description: request.description,
        status: request.status,
        category: request.category,
        priority: request.priority,
        archived: false,
        createdAt: now,
        updatedAt: now
      }
      document.manualCards[id] = card
      return document
    })
    return this.snapshotCanonical(workspaceRoot, {})
  }

  async patchManualCard(
    cardId: string,
    request: PatchManualProjectBoardCardRequest
  ): Promise<ProjectBoardSnapshotResponse> {
    const workspaceRoot = await canonicalWorkspaceRoot(request.workspace)
    const now = this.options.nowIso()
    await this.mutate(workspaceRoot, request.expectedRevision, (document) => {
      const current = document.manualCards[cardId]
      if (!current) throw new ProjectBoardNotFoundError(`manual board card not found: ${cardId}`)
      document.manualCards[cardId] = {
        ...current,
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
        ...(request.category !== undefined ? { category: request.category } : {}),
        ...(request.priority !== undefined ? { priority: request.priority } : {}),
        ...(request.archived !== undefined ? { archived: request.archived } : {}),
        updatedAt: now
      }
      return document
    })
    return this.snapshotCanonical(workspaceRoot, {})
  }

  async deleteManualCard(
    cardId: string,
    request: { workspace: string; expectedRevision: number }
  ): Promise<ProjectBoardSnapshotResponse> {
    const workspaceRoot = await canonicalWorkspaceRoot(request.workspace)
    await this.mutate(workspaceRoot, request.expectedRevision, (document) => {
      if (!document.manualCards[cardId]) {
        throw new ProjectBoardNotFoundError(`manual board card not found: ${cardId}`)
      }
      delete document.manualCards[cardId]
      return document
    })
    return this.snapshotCanonical(workspaceRoot, {})
  }

  async patchTodoOverlay(
    threadId: string,
    todoId: string,
    request: PatchProjectBoardTodoOverlayRequest
  ): Promise<ProjectBoardSnapshotResponse> {
    const workspaceRoot = await canonicalWorkspaceRoot(request.workspace)
    const threads = await this.boardThreads(workspaceRoot)
    const thread = threads.find((candidate) => candidate.id === threadId)
    const todo = thread?.todos?.items.find((candidate) =>
      candidate.id === todoId && candidate.source?.kind === 'plan')
    if (!todo) throw new ProjectBoardNotFoundError(`project board todo not found: ${threadId}/${todoId}`)
    const now = this.options.nowIso()
    const key = projectBoardTodoOverlayKey(threadId, todoId)
    await this.mutate(workspaceRoot, request.expectedRevision, (document) => {
      const current = document.todoOverlays[key] ?? emptyOverlay(threadId, todoId, now)
      document.todoOverlays[key] = {
        ...current,
        ...(request.category !== undefined ? { category: request.category } : {}),
        ...(request.priority !== undefined ? { priority: request.priority } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.archived !== undefined ? { archived: request.archived } : {}),
        updatedAt: now
      }
      return document
    }, threads)
    return this.snapshotCanonical(workspaceRoot, {})
  }

  async patchCardStatuses(
    request: PatchProjectBoardCardStatusesRequest
  ): Promise<ProjectBoardBulkStatusResponse> {
    const startedAt = performance.now()
    const workspaceRoot = await canonicalWorkspaceRoot(request.workspace)
    const read = await this.options.store.read(workspaceRoot)
    if (read.document.revision !== request.expectedRevision) {
      throw new ProjectBoardRevisionConflictError(
        request.expectedRevision,
        read.document.revision
      )
    }
    const threads = await this.boardThreads(workspaceRoot)
    const references = lightweightBoardCards(read.document, threads)
    const selected = request.cardIds.map((cardId) => {
      const card = references.get(cardId)
      if (!card) throw new ProjectBoardNotFoundError(`project board card not found: ${cardId}`)
      if (card.archived) {
        throw new ProjectBoardBulkConflictError(
          'archived_card',
          `archived project board card cannot move: ${cardId}`
        )
      }
      if (card.status !== request.fromStatus) {
        throw new ProjectBoardBulkConflictError(
          'stale_status',
          `project board card ${cardId} is no longer ${request.fromStatus}`
        )
      }
      return card
    })
    if (request.status === request.fromStatus) {
      return {
        workspaceRoot,
        revision: read.document.revision,
        counts: countLightweightCards(references.values()),
        updatedCards: [],
        failures: []
      }
    }
    assertNoInProgressSelectionConflict(selected, request.status)

    const planGroups = groupSelectedPlanCards(selected, threads)
    const updatedCards: ProjectBoardBulkStatusResponse['updatedCards'] = []
    const failures: ProjectBoardBulkStatusFailure[] = []
    await runWithConcurrency([...planGroups.values()], 4, async (group) => {
      const before = new Map(
        (group.thread.todos?.items ?? []).map((item) => [item.id, item])
      )
      try {
        if (!this.options.threadService) throw new Error('thread todo mutation is unavailable')
        const todos = await this.options.threadService.patchTodoStatuses(
          group.thread.id,
          group.todoIds,
          request.fromStatus,
          request.status
        )
        for (const item of todos.items) {
          const previous = before.get(item.id)
          if (item.source?.kind !== 'plan' || !previous || previous.status === item.status) continue
          updatedCards.push({
            id: threadTodoCardId(group.thread.id, item.id),
            status: item.status,
            updatedAt: item.updatedAt
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const cardId of group.cardIds) {
          failures.push({ cardId, code: failureCodeForBulkError(message), message })
        }
      }
    })

    const manualCards = selected.filter((card) => card.kind === 'manual')
    let revision = read.document.revision
    if (failures.length > 0) {
      for (const card of manualCards) {
        failures.push({
          cardId: card.id,
          code: 'skipped',
          message: 'manual card update skipped because a Plan card update failed'
        })
      }
    } else if (manualCards.length > 0) {
      const now = this.options.nowIso()
      try {
        const written = await this.options.store.mutate(
          workspaceRoot,
          request.expectedRevision,
          (document) => {
            for (const card of manualCards) {
              const current = document.manualCards[card.manualId]
              if (!current) throw new ProjectBoardNotFoundError(`manual board card not found: ${card.id}`)
              document.manualCards[card.manualId] = {
                ...current,
                status: request.status,
                updatedAt: now
              }
            }
            return document
          }
        )
        revision = written.document.revision
        for (const card of manualCards) {
          updatedCards.push({ id: card.id, status: request.status, updatedAt: now })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const card of manualCards) {
          failures.push({ cardId: card.id, code: failureCodeForBulkError(message), message })
        }
      }
    }

    const [latestDocument, latestThreads] = await Promise.all([
      this.options.store.read(workspaceRoot),
      this.boardThreads(workspaceRoot)
    ])
    revision = latestDocument.document.revision
    const response = {
      workspaceRoot,
      revision,
      counts: countLightweightCards(
        lightweightBoardCards(latestDocument.document, latestThreads).values()
      ),
      updatedCards,
      failures
    }
    logSlowBoardOperation('bulk-status', workspaceRoot, startedAt, {
      selected: request.cardIds.length,
      updated: updatedCards.length,
      failures: failures.length,
      threads: planGroups.size
    })
    return response
  }

  private async mutate(
    workspaceRoot: string,
    expectedRevision: number,
    update: (document: ProjectBoardDocumentV1) => ProjectBoardDocumentV1,
    knownThreads?: ThreadSummary[]
  ): Promise<void> {
    const threads = knownThreads ?? await this.boardThreads(workspaceRoot)
    const activeOverlayKeys = todoOverlayKeys(threads)
    const cutoff = Date.now() - ORPHAN_OVERLAY_RETENTION_MS
    await this.options.store.mutate(workspaceRoot, expectedRevision, (document) => {
      for (const [key, overlay] of Object.entries(document.todoOverlays)) {
        if (!activeOverlayKeys.has(key) && Date.parse(overlay.updatedAt) < cutoff) {
          delete document.todoOverlays[key]
        }
      }
      return update(document)
    })
  }

  private async snapshotCanonical(
    workspaceRoot: string,
    input: { includeArchived?: boolean; cursor?: string }
  ): Promise<ProjectBoardSnapshotResponse> {
    const startedAt = performance.now()
    const read = await this.options.store.read(workspaceRoot)
    const projection = await this.allCards(workspaceRoot, read.document)
    const allCards = projection.cards
    const counts = countCards(allCards)
    const visible = input.includeArchived ? allCards : allCards.filter((card) => !card.archived)
    const offset = decodeCursor(input.cursor)
    const cards = visible.slice(offset, offset + PROJECT_BOARD_MAX_CARDS)
    const nextOffset = offset + cards.length
    const truncated = nextOffset < visible.length
    const response = {
      workspaceRoot,
      revision: read.document.revision,
      cards,
      counts,
      truncated,
      ...(truncated ? { nextCursor: encodeCursor(nextOffset) } : {}),
      ...(read.warning ? { warning: read.warning } : {})
    }
    logSlowBoardOperation('snapshot', workspaceRoot, startedAt, {
      cards: allCards.length,
      returned: cards.length,
      truncated,
      planFiles: projection.planFiles,
      metadataCacheHits: projection.metadataCacheHits
    })
    return response
  }

  private async allCards(
    workspaceRoot: string,
    document: ProjectBoardDocumentV1,
    knownThreads?: ThreadSummary[]
  ): Promise<{
    cards: ProjectBoardCard[]
    planFiles: number
    metadataCacheHits: number
  }> {
    const threads = knownThreads ?? await this.boardThreads(workspaceRoot)
    const cards: ProjectBoardCard[] = Object.values(document.manualCards).map((card) => ({
      id: `manual:${card.id}`,
      kind: 'manual',
      workspaceRoot,
      title: card.title,
      description: card.description,
      status: card.status,
      category: card.category,
      priority: card.priority,
      archived: card.archived,
      updatedAt: card.updatedAt,
      source: { label: 'Manual' }
    }))
    const planPaths = new Set<string>()
    for (const thread of threads) {
      for (const todo of thread.todos?.items ?? []) {
        if (todo.source?.kind !== 'plan') continue
        const path = planPathForTodo(workspaceRoot, todo)
        if (path) planPaths.add(path)
      }
    }
    const loadedMetadata = await loadPlanMetadataConcurrently(
      [...planPaths],
      this.planMetadataCache,
      4
    )
    for (const thread of threads) {
      for (const todo of thread.todos?.items ?? []) {
        if (todo.source?.kind !== 'plan') continue
        const key = projectBoardTodoOverlayKey(thread.id, todo.id)
        const overlay = document.todoOverlays[key]
        const planPath = planPathForTodo(workspaceRoot, todo)
        const metadata = planPath
          ? loadedMetadata.metadata.get(planPath)?.get(todo.source.ordinal)
          : undefined
        cards.push({
          id: `todo:${thread.id}:${todo.id}`,
          kind: 'thread_todo',
          workspaceRoot,
          title: todo.content,
          description: overlay?.description || metadata?.description || '',
          status: todo.status,
          category: overlay?.category ?? 'plan',
          priority: overlay?.priority ?? null,
          archived: overlay?.archived ?? false,
          updatedAt: overlay && overlay.updatedAt > todo.updatedAt ? overlay.updatedAt : todo.updatedAt,
          source: {
            label: 'Plan',
            threadId: thread.id,
            todoId: todo.id,
            threadTitle: thread.title,
            planId: todo.source.planId,
            planRelativePath: todo.source.relativePath,
            ...(metadata?.sectionTitle ? { sectionTitle: metadata.sectionTitle } : {}),
            ordinal: todo.source.ordinal
          }
        })
      }
    }
    return {
      cards: cards.sort(compareCards),
      planFiles: planPaths.size,
      metadataCacheHits: loadedMetadata.cacheHits
    }
  }

  private async boardThreads(workspaceRoot: string): Promise<ThreadSummary[]> {
    return (await this.boardThreadMemberships())
      .filter((membership) => threadMembershipMatchesProject(membership, workspaceRoot))
      .map(({ thread }) => thread)
  }

  private async boardThreadMemberships(): Promise<BoardThreadMembership[]> {
    if (this.membershipsInFlight) return this.membershipsInFlight
    const task = (async () => {
      const threads = await this.options.threadStore.list({ includeArchived: false, includeSide: false })
      const candidates = threads.filter((thread) =>
        thread.status !== 'archived' &&
        thread.status !== 'deleted' &&
        thread.relation !== 'side' &&
        thread.agentSurface !== 'write')
      return Promise.all(candidates.map(async (thread) => {
        const rawWorkspace = thread.workspace ?? ''
        let resolved = this.membershipPathCache.get(rawWorkspace)
        if (!resolved) {
          const workspace = await realpath(resolve(rawWorkspace)).catch(() => resolve(rawWorkspace))
          resolved = { workspace, gitProjectRoot: await gitProjectRootForWorktree(workspace) }
          setBoundedCache(this.membershipPathCache, rawWorkspace, resolved, 512)
        }
        return { thread, ...resolved }
      }))
    })().finally(() => {
      if (this.membershipsInFlight === task) this.membershipsInFlight = null
    })
    this.membershipsInFlight = task
    return task
  }
}

export class ProjectBoardNotFoundError extends Error {
  override name = 'ProjectBoardNotFoundError'
}

export { ProjectBoardBulkConflictError } from './project-board-bulk-status-support.js'

export function projectBoardTodoOverlayKey(threadId: string, todoId: string): string {
  return Buffer.from(`${threadId}\0${todoId}`, 'utf8').toString('base64url')
}

async function canonicalWorkspaceRoot(workspace: string): Promise<string> {
  const trimmed = workspace.trim()
  if (!isAbsolute(trimmed)) throw new Error('project board workspace must be an absolute path')
  return realpath(resolve(trimmed))
}

function workspaceBelongsToProject(threadWorkspace: string, projectRoot: string): boolean {
  const normalized = resolve(threadWorkspace)
  if (pathIdentity(normalized) === pathIdentity(projectRoot)) return true
  const forward = normalized.replaceAll('\\', '/')
  const managed = forward.match(/\/\.kun\/worktrees\/(?:[0-9a-f]{4}|[0-9a-f-]{36})\/([^/]+)$/i)
  return Boolean(managed?.[1] && managed[1] === basename(projectRoot))
}

type BoardThreadMembership = {
  thread: ThreadSummary
  workspace: string
  gitProjectRoot: string | null
}

function threadMembershipMatchesProject(
  membership: BoardThreadMembership,
  projectRoot: string
): boolean {
  return workspaceBelongsToProject(membership.workspace, projectRoot) ||
    (membership.gitProjectRoot !== null &&
      pathIdentity(membership.gitProjectRoot) === pathIdentity(projectRoot))
}

function pathIdentity(path: string): string {
  return process.platform === 'win32' || process.platform === 'darwin'
    ? path.toLocaleLowerCase()
    : path
}

async function gitProjectRootForWorktree(workspace: string): Promise<string | null> {
  let dotGit: string
  try {
    dotGit = await readFile(resolve(workspace, '.git'), 'utf8')
  } catch {
    return null
  }
  const match = dotGit.match(/^gitdir:\s*(.+?)\s*$/im)
  if (!match?.[1]) return null
  const gitDir = resolve(workspace, match[1])
  const normalized = gitDir.replaceAll('\\', '/')
  const marker = normalized.toLocaleLowerCase().lastIndexOf('/.git/worktrees/')
  if (marker < 0) return null
  const root = normalized.slice(0, marker)
  return realpath(root).catch(() => resolve(root))
}

function emptyOverlay(threadId: string, todoId: string, now: string): ProjectBoardTodoOverlay {
  return { threadId, todoId, category: null, priority: null, description: '', archived: false, updatedAt: now }
}

function todoOverlayKeys(threads: readonly ThreadSummary[]): Set<string> {
  const keys = new Set<string>()
  for (const thread of threads) {
    for (const todo of thread.todos?.items ?? []) {
      if (todo.source?.kind === 'plan') keys.add(projectBoardTodoOverlayKey(thread.id, todo.id))
    }
  }
  return keys
}

function countCards(cards: readonly ProjectBoardCard[]): ProjectBoardCounts {
  const active = cards.filter((card) => !card.archived)
  return {
    pending: active.filter((card) => card.status === 'pending').length,
    inProgress: active.filter((card) => card.status === 'in_progress').length,
    completed: active.filter((card) => card.status === 'completed').length,
    archived: cards.length - active.length,
    total: active.length
  }
}

const PRIORITY_ORDER = new Map([['P0', 0], ['P1', 1], ['P2', 2]])
function compareCards(left: ProjectBoardCard, right: ProjectBoardCard): number {
  const byPriority = (PRIORITY_ORDER.get(left.priority ?? '') ?? 3) -
    (PRIORITY_ORDER.get(right.priority ?? '') ?? 3)
  if (byPriority !== 0) return byPriority
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt)
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id)
}

function setBoundedCache<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  capacity: number
): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > capacity) {
    const oldest = cache.keys().next().value as K | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function logSlowBoardOperation(
  operation: string,
  workspaceIdentity: string,
  startedAt: number,
  details: Record<string, unknown>
): void {
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10
  if (durationMs < 250) return
  const workspaceHash = createHash('sha256')
    .update(workspaceIdentity)
    .digest('hex')
    .slice(0, 12)
  console.warn(`[kun] slow project board operation: ${JSON.stringify({
    operation,
    durationMs,
    workspaceHash,
    ...details
  })}`)
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  const parsed = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('invalid project board cursor')
  return parsed
}

function planPathForTodo(
  workspaceRoot: string,
  todo: ThreadTodoItem
): string | null {
  const source = todo.source
  if (!source) return null
  const absolutePath = resolve(workspaceRoot, source.relativePath)
  const rel = relative(workspaceRoot, absolutePath)
  return rel.startsWith('..') || isAbsolute(rel) ? null : absolutePath
}
