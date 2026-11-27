import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileProjectBoardStore } from '../../adapters/file/file-project-board-store.js'
import { ProjectBoardService } from '../../services/project-board-service.js'
import { RemoteFacade } from '../facade.js'
import { remoteFixture } from '../testing/runtime.test-support.js'

describe('remote project board', () => {
  async function boardFixture() {
    const f = await remoteFixture()
    let seq = 0
    f.runtime.projectBoardService = new ProjectBoardService({
      store: new FileProjectBoardStore({ dataDir: join(f.root, '.kun-data') }),
      threadStore: f.h.threadStore,
      threadService: f.h.threads,
      ids: { next: (prefix: string) => `${prefix}_${++seq}` },
      nowIso: () => new Date().toISOString()
    })
    const facade = new RemoteFacade(f.runtime, f.router)
    const call = (method: string, params: unknown, requestId?: string) =>
      facade.execute(f.envelope(method, params, requestId)) as Promise<any>
    return { ...f, facade, call }
  }

  it('supports manual card CRUD, plan card overlay/move, idempotent create receipts, and revision conflict rejections without leaking paths', async () => {
    const f = await boardFixture()
    try {
      const thread = await f.code('Plan thread')
      const planDir = join(f.root, '.kunsdd', 'plan')
      await mkdir(planDir, { recursive: true })
      const relativePath = '.kunsdd/plan/board-plan.md'
      const markdown = ['# Board Plan', '- [ ] Ship mobile project todos'].join('\n')
      await writeFile(join(f.root, relativePath), markdown, 'utf8')
      await f.h.threads.syncTodosFromPlan(thread.id, {
        planId: 'plan_board',
        relativePath,
        markdown,
        mode: 'plan_write'
      })

      const catalog = await f.call('catalog.get', {})
      const projectId = catalog.projects[0].id as string
      expect(catalog.capabilityDescriptors.some((d: any) => d.operation === 'project.board.get')).toBe(true)

      const initial = await f.call('project.board.get', { projectId, includeArchived: true })
      expect(initial.projectId).toBe(projectId)
      expect(initial.revision).toBe('board-v1:0')
      expect(initial.cards).toHaveLength(1)
      expect(JSON.stringify(initial)).not.toContain(f.root)
      const planCard = initial.cards[0]
      expect(planCard.kind).toBe('thread_todo')

      // Create manual card and replay same requestId to verify receipt idempotency
      const createRes = await f.call('project.board.create', {
        projectId,
        expectedRevision: initial.revision,
        title: 'Add voice quick-entry',
        description: 'Support iOS speech recognition',
        status: 'pending',
        category: 'interaction',
        priority: 'P0'
      }, 'req_create_1')
      expect(createRes.receipt.status).toBe('applied')
      const afterCreate = createRes.receipt.result
      expect(afterCreate.revision).toBe('board-v1:1')
      expect(afterCreate.cards).toHaveLength(2)

      const replayed = await f.call('project.board.create', {
        projectId,
        expectedRevision: initial.revision,
        title: 'Add voice quick-entry',
        description: 'Support iOS speech recognition',
        status: 'pending',
        category: 'interaction',
        priority: 'P0'
      }, 'req_create_1')
      expect(replayed.receipt.result.cards).toHaveLength(2)

      // Stale revision produces definitive REVISION_CONFLICT receipt
      const conflict = await f.call('project.board.create', {
        projectId,
        expectedRevision: 'board-v1:0',
        title: 'Stale write',
        status: 'pending'
      }, 'req_stale')
      expect(conflict.receipt.status).toBe('reconciliation_required')
      expect(conflict.receipt.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })

      // Plan card overlay update + status move syncs back to plan markdown & thread todos
      const overlayRes = await f.call('project.board.update', {
        projectId,
        cardId: planCard.id,
        expectedRevision: afterCreate.revision,
        priority: 'P1',
        category: 'sync',
        description: 'Synced from mobile'
      })
      expect(overlayRes.receipt.status).toBe('applied')
      const afterOverlay = overlayRes.receipt.result
      const updatedPlanCard = afterOverlay.cards.find((c: any) => c.id === planCard.id)
      expect(updatedPlanCard).toMatchObject({
        priority: 'P1',
        category: 'sync',
        description: 'Synced from mobile'
      })

      // Plan card title modification is rejected at protocol validation boundary
      await expect(f.call('project.board.update', {
        projectId,
        cardId: planCard.id,
        expectedRevision: afterOverlay.revision,
        title: 'Illegal overwrite'
      })).rejects.toThrow('INVALID_REQUEST')

      // Move both cards to completed
      const manualCard = afterOverlay.cards.find((c: any) => c.kind === 'manual')
      const moveRes = await f.call('project.board.move', {
        projectId,
        expectedRevision: afterOverlay.revision,
        cardIds: [manualCard.id, planCard.id],
        fromStatus: 'pending',
        status: 'completed'
      })
      expect(moveRes.receipt.status).toBe('applied')
      expect(moveRes.receipt.result.failures).toEqual([])
      expect(moveRes.receipt.result.counts.completed).toBe(2)

      const summary = await f.call('project.board.summary', { projectId })
      expect(summary).toMatchObject({
        projectId,
        total: 2,
        pending: 0,
        inProgress: 0,
        completed: 2,
        progress: 1
      })

      // Delete manual card
      const deleteRes = await f.call('project.board.delete', {
        projectId,
        cardId: manualCard.id,
        expectedRevision: moveRes.receipt.result.revision
      })
      expect(deleteRes.receipt.status).toBe('applied')
      expect(deleteRes.receipt.result.cards).toHaveLength(1)
    } finally {
      await f.close()
    }
  })
})
