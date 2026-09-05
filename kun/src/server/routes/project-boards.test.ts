import { describe, expect, it, vi } from 'vitest'
import {
  ProjectBoardBulkConflictError,
  type ProjectBoardService
} from '../../services/project-board-service.js'
import { patchProjectBoardCardStatuses } from './project-boards.js'

function request(body: unknown): Request {
  return new Request('http://localhost/v1/project-boards/cards/status', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const validBody = {
  workspace: '/project',
  expectedRevision: 1,
  cardIds: ['manual:one'],
  fromStatus: 'pending',
  status: 'completed'
}

describe('project board bulk status route', () => {
  it('returns 207 when the service reports partial failures', async () => {
    const patchCardStatuses = vi.fn(async () => ({
      workspaceRoot: '/project',
      revision: 2,
      counts: { pending: 1, inProgress: 0, completed: 1, archived: 0, total: 2 },
      updatedCards: [{
        id: 'manual:one', status: 'completed' as const, updatedAt: '2026-09-01T00:00:00.000Z'
      }],
      failures: [{
        cardId: 'manual:two', code: 'write_failed' as const, message: 'disk error'
      }]
    }))
    const response = await patchProjectBoardCardStatuses(
      { patchCardStatuses } as unknown as ProjectBoardService,
      request({ ...validBody, cardIds: ['manual:one', 'manual:two'] })
    )
    expect(response.status).toBe(207)
    expect(JSON.parse((response as { body: string }).body))
      .toMatchObject({ failures: [{ cardId: 'manual:two' }] })
  })

  it('rejects duplicate ids before invoking the service', async () => {
    const patchCardStatuses = vi.fn()
    const response = await patchProjectBoardCardStatuses(
      { patchCardStatuses } as unknown as ProjectBoardService,
      request({ ...validBody, cardIds: ['manual:one', 'manual:one'] })
    )
    expect(response.status).toBe(400)
    expect(patchCardStatuses).not.toHaveBeenCalled()
  })

  it('returns a typed 409 for an in-progress selection conflict', async () => {
    const patchCardStatuses = vi.fn(async () => {
      throw new ProjectBoardBulkConflictError('in_progress_conflict', 'same thread')
    })
    const response = await patchProjectBoardCardStatuses(
      { patchCardStatuses } as unknown as ProjectBoardService,
      request(validBody)
    )
    expect(response.status).toBe(409)
    expect(JSON.parse((response as { body: string }).body))
      .toMatchObject({ code: 'in_progress_conflict' })
  })
})
