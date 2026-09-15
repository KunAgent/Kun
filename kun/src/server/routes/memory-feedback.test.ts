import { describe, expect, it, vi } from 'vitest'
import {
  MemoryFeedbackServiceError
} from '../../memory/memory-feedback-service.js'
import {
  confirmMemory,
  correctMemory,
  memoryDiagnostics
} from './memory.js'

function jsonBody(response: Response | { body: string }): unknown {
  if (response instanceof Response) throw new Error('expected JSON response')
  return JSON.parse(response.body)
}

describe('memory feedback routes', () => {
  it('uses the path memory id when forwarding confirmation', async () => {
    const confirm = vi.fn(async (request: unknown) => ({
      memoryId: (request as { memoryId: string }).memoryId,
      eventId: 'feedback-confirm-event',
      confirmedAt: '2026-09-15T00:00:00.000Z',
      replayed: false
    }))
    const response = await confirmMemory(
      { confirm } as never,
      'mem_1',
      new Request('http://kun.local/v1/memory/mem_1/confirm', {
        method: 'POST',
        body: JSON.stringify({ operationId: 'op_1', access: { workspace: 'D:/workspace' } })
      })
    )

    expect(response).not.toBeInstanceOf(Response)
    if (response instanceof Response) throw new Error('expected JSON response')
    expect(response.status).toBe(200)
    expect(jsonBody(response)).toEqual({
      confirmation: {
        memoryId: 'mem_1',
        eventId: 'feedback-confirm-event',
        confirmedAt: '2026-09-15T00:00:00.000Z',
        replayed: false
      }
    })
    expect(confirm).toHaveBeenCalledWith({
      operationId: 'op_1',
      memoryId: 'mem_1',
      access: { workspace: 'D:/workspace' }
    })
  })

  it('rejects a body that targets a different memory than the URL', async () => {
    const confirm = vi.fn()
    const response = await confirmMemory(
      { confirm } as never,
      'mem_1',
      new Request('http://kun.local/v1/memory/mem_1/confirm', {
        method: 'POST',
        body: JSON.stringify({ operationId: 'op_1', memoryId: 'mem_2' })
      })
    )

    expect(response).not.toBeInstanceOf(Response)
    if (response instanceof Response) throw new Error('expected JSON response')
    expect(response.status).toBe(400)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('forwards correction fields and maps service errors', async () => {
    const correct = vi.fn(async () => ({
      previousMemoryId: 'mem_1',
      replacementMemoryId: 'mem_correction_1',
      eventId: 'feedback-correct-event',
      correctedAt: '2026-09-15T00:00:00.000Z',
      replayed: false
    }))
    const response = await correctMemory(
      { correct } as never,
      'mem_1',
      new Request('http://kun.local/v1/memory/mem_1/correct', {
        method: 'POST',
        body: JSON.stringify({
          operationId: 'op_2',
          access: { project: 'project-a' },
          replacement: { content: 'Corrected fact', confidence: 0.9 }
        })
      })
    )

    expect(response).not.toBeInstanceOf(Response)
    if (response instanceof Response) throw new Error('expected JSON response')
    expect(response.status).toBe(200)
    expect(correct).toHaveBeenCalledWith({
      operationId: 'op_2',
      memoryId: 'mem_1',
      access: { project: 'project-a' },
      replacement: { content: 'Corrected fact', confidence: 0.9 }
    })

    const unavailable = await confirmMemory(
      { confirm: vi.fn(async () => {
        throw new MemoryFeedbackServiceError('inactive', 'memory is not active')
      }) } as never,
      'mem_1',
      new Request('http://kun.local/v1/memory/mem_1/confirm', {
        method: 'POST',
        body: JSON.stringify({ operationId: 'op_3' })
      })
    )
    expect(unavailable).not.toBeInstanceOf(Response)
    if (unavailable instanceof Response) throw new Error('expected JSON response')
    expect(unavailable.status).toBe(409)
    expect(jsonBody(unavailable)).toMatchObject({ code: 'conflict' })
  })

  it('adds bounded feedback diagnostics without changing memory diagnostics', async () => {
    const response = await memoryDiagnostics(
      { diagnostics: vi.fn(async () => ({
        enabled: true,
        rootDir: 'D:/workspace/.kun/memory',
        activeCount: 1,
        tombstoneCount: 0
      })) } as never,
      { diagnostics: vi.fn(async () => ({
        enabled: false,
        state: 'disabled' as const,
        projection: 'ready' as const,
        eventCount: 0,
        aggregateCount: 0,
        duplicateCount: 0,
        malformedCount: 0
      })) } as never
    )

    expect(response.status).toBe(200)
    expect(jsonBody(response)).toMatchObject({
      enabled: true,
      activeCount: 1,
      feedback: { enabled: false, state: 'disabled', eventCount: 0 }
    })
  })
})
