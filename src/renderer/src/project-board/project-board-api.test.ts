import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectBoardApi } from './project-board-api'

const runtimeRequest = vi.hoisted(() => vi.fn())
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest } }))
beforeEach(() => runtimeRequest.mockReset())

describe('exact Project Board card API', () => {
  it('uses an exact GET target while retaining the manual prefix and encoded workspace', async () => {
    const response = { workspaceRoot: '/project space', revision: 2, card: { id: 'manual:deep-card' } }
    runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(response) })
    expect(await projectBoardApi.card('/project space', 'manual:deep-card')).toEqual(response)
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/project-boards/cards/manual%3Adeep-card?workspace=%2Fproject+space', 'GET', undefined)
  })
  it('propagates a real missing/unavailable result rather than opening a different card', async () => {
    runtimeRequest.mockResolvedValue({ ok: false, status: 404, body: JSON.stringify({ message: 'Card missing' }) })
    await expect(projectBoardApi.card('/project', 'todo:thread:old')).rejects.toMatchObject({ status: 404, message: 'Card missing' })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })
})
