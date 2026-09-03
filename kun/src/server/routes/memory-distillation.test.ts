import { describe, expect, it, vi } from 'vitest'
import type { MemoryDistillationCoordinator } from '../../memory/memory-distillation-coordinator.js'
import {
  decideMemoryDistillationCandidate,
  listMemoryDistillationCandidates
} from './memory-distillation.js'

describe('memory distillation routes', () => {
  it('requires a host workspace for listing and decisions', async () => {
    const coordinator = {} as MemoryDistillationCoordinator
    const listed = await listMemoryDistillationCandidates(
      coordinator,
      new Request('http://kun.local/v1/memory/distillation')
    )
    expect(listed.status).toBe(400)
    const decided = await decideMemoryDistillationCandidate(
      coordinator,
      'mdc_1',
      new Request('http://kun.local/v1/memory/distillation/mdc_1/decision', {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow' })
      })
    )
    expect(decided).not.toBeInstanceOf(Response)
    expect(decided.status).toBe(400)
  })

  it('lists pending candidates in the requested workspace', async () => {
    const list = vi.fn(async () => [{ id: 'mdc_1' }])
    const response = await listMemoryDistillationCandidates(
      { list } as unknown as MemoryDistillationCoordinator,
      new Request('http://kun.local/v1/memory/distillation?workspace=D%3A%2Fworkspace-a')
    )
    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith('D:/workspace-a', 'pending')
    expect(JSON.parse(response.body)).toEqual({ candidates: [{ id: 'mdc_1' }] })
  })

  it('validates and forwards one user decision', async () => {
    const decide = vi.fn(async () => ({ id: 'mdc_1', status: 'allowed' }))
    const response = await decideMemoryDistillationCandidate(
      { decide } as unknown as MemoryDistillationCoordinator,
      'mdc_1',
      new Request(
        'http://kun.local/v1/memory/distillation/mdc_1/decision?workspace=D%3A%2Fworkspace-a',
        { method: 'POST', body: JSON.stringify({ decision: 'allow' }) }
      )
    )
    expect(response).not.toBeInstanceOf(Response)
    if (response instanceof Response) throw new Error('expected JSON response')
    expect(response.status).toBe(200)
    expect(decide).toHaveBeenCalledWith('mdc_1', { decision: 'allow' }, 'D:/workspace-a')
  })
})
