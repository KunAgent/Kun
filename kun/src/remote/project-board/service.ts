import { createHash } from 'node:crypto'
import type {
  RemoteProjectBoardCard,
  RemoteProjectBoardMoveResult,
  RemoteProjectBoardSnapshot,
  RemoteProjectBoardSummary
} from '@kun/remote-protocol'
import type { ProjectBoardCard, ProjectBoardSnapshotResponse } from '../../contracts/project-board.js'
import { ProjectBoardRevisionConflictError } from '../../ports/project-board-store.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import {
  ProjectBoardBulkConflictError,
  ProjectBoardNotFoundError,
  type ProjectBoardService
} from '../../services/project-board-service.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { projects } from '../files/project-directory.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { workSpaces } from '../work/spaces.js'

export const boardRevision = (revision: number) => `board-v1:${revision}`

function parseExpectedRevision(expectedRevision: string): number {
  const value = Number(expectedRevision.slice('board-v1:'.length))
  if (!Number.isSafeInteger(value) || value < 0) throw new RemoteNoEffect('INVALID_REQUEST')
  return value
}

function deterministicManualId(scope: RemoteScope, requestId: string): string {
  return 'board_mobile_' + createHash('sha256').update(receiptKey(scope, requestId)).digest('hex').slice(0, 24)
}

function parseTodoCardId(cardId: string): { threadId: string; todoId: string } {
  const sep = cardId.indexOf(':', 5)
  if (!cardId.startsWith('todo:') || sep <= 5 || sep >= cardId.length - 1) {
    throw new RemoteNoEffect('INVALID_REQUEST')
  }
  return { threadId: cardId.slice(5, sep), todoId: cardId.slice(sep + 1) }
}

function formatCard(projectId: string, card: ProjectBoardCard): RemoteProjectBoardCard {
  const { workspaceRoot: _workspaceRoot, ...rest } = card
  return { ...rest, projectId }
}

function formatSnapshot(projectId: string, snapshot: ProjectBoardSnapshotResponse): RemoteProjectBoardSnapshot {
  return {
    projectId,
    revision: boardRevision(snapshot.revision),
    cards: snapshot.cards.map((card) => formatCard(projectId, card)),
    counts: snapshot.counts,
    truncated: snapshot.truncated,
    ...(snapshot.nextCursor ? { nextCursor: snapshot.nextCursor } : {}),
    ...(snapshot.warning ? { warning: snapshot.warning } : {})
  }
}

export class RemoteProjectBoard {
  constructor(private runtime: ServerRuntime) {}

  private requireService(): ProjectBoardService {
    if (!this.runtime.projectBoardService) throw new Error('UNSUPPORTED_OPERATION')
    return this.runtime.projectBoardService
  }

  private async resolveWorkspace(projectId: string, forMutation = false): Promise<string> {
    const hit = (await projects(this.runtime)).find((entry) => entry.id === projectId)
      ?? (await workSpaces(this.runtime)).find((entry) => entry.id === projectId)
    if (!hit) {
      if (forMutation) throw new RemoteNoEffect('NOT_FOUND')
      throw new Error('NOT_FOUND')
    }
    return hit.path
  }

  private mapError(error: unknown): never {
    if (error instanceof RemoteNoEffect) throw error
    if (error instanceof ProjectBoardRevisionConflictError) throw new RemoteNoEffect('REVISION_CONFLICT')
    if (error instanceof ProjectBoardNotFoundError) throw new RemoteNoEffect('NOT_FOUND')
    if (error instanceof ProjectBoardBulkConflictError) throw new RemoteNoEffect('REVISION_CONFLICT')
    throw error
  }

  async preflight(method: string, p: any): Promise<void> {
    const service = this.requireService()
    const workspace = await this.resolveWorkspace(p.projectId, true)
    const expected = parseExpectedRevision(p.expectedRevision)
    const snapshot = await service.snapshot({ workspace, includeArchived: true, readOnly: true })
    if (snapshot.revision !== expected) throw new RemoteNoEffect('REVISION_CONFLICT')

    if (method === 'project.board.update') {
      if (p.cardId.startsWith('todo:') && p.title !== undefined) throw new RemoteNoEffect('INVALID_REQUEST')
      if (p.cardId.startsWith('manual:') && p.category === null) throw new RemoteNoEffect('INVALID_REQUEST')
      await service.card({ workspace, cardId: p.cardId }).catch((err) => this.mapError(err))
    } else if (method === 'project.board.delete') {
      if (!p.cardId.startsWith('manual:')) throw new RemoteNoEffect('INVALID_REQUEST')
      await service.card({ workspace, cardId: p.cardId }).catch((err) => this.mapError(err))
    } else if (method === 'project.board.move') {
      const byId = new Map(snapshot.cards.map((card) => [card.id, card]))
      const inProgressThreads = new Set<string>()
      for (const cardId of p.cardIds as string[]) {
        const card = byId.get(cardId)
        if (!card) throw new RemoteNoEffect('NOT_FOUND')
        if (card.archived || card.status !== p.fromStatus) throw new RemoteNoEffect('REVISION_CONFLICT')
        if (p.status === 'in_progress' && card.kind === 'thread_todo' && card.source.threadId) {
          if (inProgressThreads.has(card.source.threadId)) throw new RemoteNoEffect('REVISION_CONFLICT')
          inProgressThreads.add(card.source.threadId)
        }
      }
    }
  }

  async get(p: { projectId: string; includeArchived?: boolean; cursor?: string }): Promise<RemoteProjectBoardSnapshot> {
    const service = this.requireService()
    const workspace = await this.resolveWorkspace(p.projectId)
    const snapshot = await service.snapshot({
      workspace,
      includeArchived: p.includeArchived ?? true,
      ...(p.cursor ? { cursor: p.cursor } : {})
    })
    return formatSnapshot(p.projectId, snapshot)
  }

  async summary(projectId: string): Promise<RemoteProjectBoardSummary> {
    const service = this.requireService()
    const workspace = await this.resolveWorkspace(projectId)
    const [row] = await service.summaries([workspace])
    if (!row) {
      return { projectId, total: 0, pending: 0, inProgress: 0, completed: 0, progress: 0, updatedAt: null }
    }
    const pending = Math.max(0, row.total - row.completed - row.inProgress)
    return {
      projectId,
      total: row.total,
      pending,
      inProgress: row.inProgress,
      completed: row.completed,
      progress: row.progress,
      updatedAt: row.updatedAt
    }
  }

  async dispatch(envelope: Envelope, p: any): Promise<unknown> {
    const { method, requestId } = envelope.call
    if (method === 'project.board.get') return this.get(p)
    if (method === 'project.board.summary') return this.summary(p.projectId)

    const service = this.requireService()
    const workspace = await this.resolveWorkspace(p.projectId, true)
    const expectedRevision = parseExpectedRevision(p.expectedRevision)

    try {
      switch (method) {
        case 'project.board.create': {
          const id = deterministicManualId(envelope, requestId)
          await service.createManualCard({
            id,
            workspace,
            expectedRevision,
            title: p.title,
            description: p.description ?? '',
            status: p.status,
            category: p.category ?? 'other',
            priority: p.priority ?? null
          })
          return formatSnapshot(p.projectId, await service.snapshot({ workspace, includeArchived: true }))
        }
        case 'project.board.update': {
          if (p.cardId.startsWith('manual:')) {
            if (p.category === null) throw new RemoteNoEffect('INVALID_REQUEST')
            await service.patchManualCard(p.cardId.slice('manual:'.length), {
              workspace,
              expectedRevision,
              ...(p.title !== undefined ? { title: p.title } : {}),
              ...(p.description !== undefined ? { description: p.description } : {}),
              ...(p.status !== undefined ? { status: p.status } : {}),
              ...(p.category !== undefined ? { category: p.category } : {}),
              ...(p.priority !== undefined ? { priority: p.priority } : {}),
              ...(p.archived !== undefined ? { archived: p.archived } : {})
            })
            return formatSnapshot(p.projectId, await service.snapshot({ workspace, includeArchived: true }))
          }
          if (p.title !== undefined) throw new RemoteNoEffect('INVALID_REQUEST')
          const { threadId, todoId } = parseTodoCardId(p.cardId)
          if (p.status !== undefined) {
            const current = await service.card({ workspace, cardId: p.cardId })
            if (current.revision !== expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
            if (current.card.status !== p.status) {
              const moved = await service.patchCardStatuses({
                workspace,
                expectedRevision,
                cardIds: [p.cardId],
                fromStatus: current.card.status,
                status: p.status
              })
              if (moved.failures.length > 0) {
                const code = moved.failures[0]?.code
                throw new RemoteNoEffect(code === 'source_missing' ? 'NOT_FOUND' : 'REVISION_CONFLICT')
              }
            }
          }
          const hasOverlay = [p.description, p.category, p.priority, p.archived].some((v) => v !== undefined)
          if (hasOverlay) {
            await service.patchTodoOverlay(threadId, todoId, {
              workspace,
              expectedRevision,
              ...(p.description !== undefined ? { description: p.description } : {}),
              ...(p.category !== undefined ? { category: p.category } : {}),
              ...(p.priority !== undefined ? { priority: p.priority } : {}),
              ...(p.archived !== undefined ? { archived: p.archived } : {})
            })
          }
          return formatSnapshot(p.projectId, await service.snapshot({ workspace, includeArchived: true }))
        }
        case 'project.board.move': {
          const moved = await service.patchCardStatuses({
            workspace,
            expectedRevision,
            cardIds: p.cardIds,
            fromStatus: p.fromStatus,
            status: p.status
          })
          const result: RemoteProjectBoardMoveResult = {
            projectId: p.projectId,
            revision: boardRevision(moved.revision),
            counts: moved.counts,
            updatedCards: moved.updatedCards,
            failures: moved.failures
          }
          return result
        }
        case 'project.board.delete': {
          if (!p.cardId.startsWith('manual:')) throw new RemoteNoEffect('INVALID_REQUEST')
          await service.deleteManualCard(p.cardId.slice('manual:'.length), {
            workspace,
            expectedRevision
          })
          return formatSnapshot(p.projectId, await service.snapshot({ workspace, includeArchived: true }))
        }
        default:
          throw new RemoteNoEffect('INVALID_REQUEST')
      }
    } catch (error) {
      this.mapError(error)
    }
  }

  async recover(scope: RemoteScope, receipt: Receipt): Promise<RemoteProjectBoardSnapshot | undefined> {
    if (receipt.method !== 'project.board.create' || !this.runtime.projectBoardService) return undefined
    const projectId = receipt.params?.projectId
    if (typeof projectId !== 'string') return undefined
    const workspace = await this.resolveWorkspace(projectId).catch(() => null)
    if (!workspace) return undefined
    const id = deterministicManualId(scope, receipt.requestId)
    const snapshot = await this.runtime.projectBoardService.snapshot({ workspace, includeArchived: true })
    if (!snapshot.cards.some((card) => card.id === `manual:${id}`)) return undefined
    return formatSnapshot(projectId, snapshot)
  }
}
