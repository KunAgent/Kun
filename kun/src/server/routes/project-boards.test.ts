import { describe, expect, it, vi } from 'vitest'
import {
  ProjectBoardBulkConflictError,
  ProjectBoardNotFoundError,
  ProjectBoardReadUnavailableError,
  type ProjectBoardService
} from '../../services/project-board-service.js'
import { getProjectBoardCard, patchProjectBoardCardStatuses } from './project-boards.js'

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

describe('exact project board card route', () => {
  it('returns one full projected identity and passes the exact prefixed ID to the service', async () => {
    const result = { workspaceRoot: '/project', revision: 7, card: { id: 'manual:card-1000', kind: 'manual', workspaceRoot: '/project',
      title: 'Deep card', description: '', status: 'pending', category: 'other', priority: null, archived: true,
      updatedAt: '2026-09-15T00:00:00Z', source: { label: 'Manual' } } }
    const card = vi.fn().mockResolvedValue(result)
    const response = await getProjectBoardCard({ card } as unknown as ProjectBoardService, 'manual:card-1000',
      new Request('http://localhost/v1/project-boards/cards/manual%3Acard-1000?workspace=%2Fproject'))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual(result)
    expect(card).toHaveBeenCalledWith({ workspace: '/project', cardId: 'manual:card-1000' })
  })
  it('uses 404 only for actual absence and preserves unavailable data as 503', async () => {
    const card = vi.fn().mockRejectedValue(new ProjectBoardNotFoundError('missing'))
    const request = new Request('http://localhost/v1/project-boards/cards/manual%3Aone?workspace=%2Fproject')
    expect((await getProjectBoardCard({ card } as unknown as ProjectBoardService, 'manual:one', request)).status).toBe(404)
    card.mockRejectedValue(new ProjectBoardReadUnavailableError('corrupt data'))
    expect((await getProjectBoardCard({ card } as unknown as ProjectBoardService, 'manual:one', request)).status).toBe(503)
    expect((await getProjectBoardCard({ card } as unknown as ProjectBoardService, 'manual:one', new Request('http://localhost/cards/manual%3Aone'))).status).toBe(400)
  })
})

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
