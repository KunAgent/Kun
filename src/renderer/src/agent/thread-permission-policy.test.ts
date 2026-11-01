import { afterEach, describe, expect, it, vi } from 'vitest'
import { rendererRuntimeClient } from './runtime-client'
import { syncThreadPermissionPolicy, threadPolicyFrozenError } from './thread-permission-policy'

const fullAccess = {
  approvalPolicy: 'auto' as const,
  sandboxMode: 'danger-full-access' as const,
  approvalReviewer: 'user' as const
}

afterEach(() => vi.restoreAllMocks())

describe('syncThreadPermissionPolicy', () => {
  it('writes the whole composer authority onto the conversation', async () => {
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest')
      .mockResolvedValue({ ok: true, status: 200, body: '{}' })

    await expect(syncThreadPermissionPolicy(' thr_1 ', fullAccess)).resolves.toBe('applied')

    expect(request).toHaveBeenCalledWith('/v1/threads/thr_1', 'PATCH', JSON.stringify(fullAccess))
  })

  it('skips an empty conversation id without calling the runtime', async () => {
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest')

    await expect(syncThreadPermissionPolicy('  ', fullAccess)).resolves.toBe('applied')

    expect(request).not.toHaveBeenCalled()
  })

  it('treats a frozen room policy as an expected outcome', async () => {
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({
      ok: false,
      status: 500,
      body: JSON.stringify({ message: 'room thread execution policy is frozen; change the room configuration or task instead' })
    })

    await expect(syncThreadPermissionPolicy('thr_room', fullAccess)).resolves.toBe('room_frozen')
  })

  it('rethrows a real refusal so the composer can report it', async () => {
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 'validation_error', message: 'invalid update thread body' })
    })

    await expect(syncThreadPermissionPolicy('thr_1', fullAccess)).rejects.toThrow(/invalid update thread body/)
  })
})

describe('threadPolicyFrozenError', () => {
  it('matches only the room-freeze refusal', () => {
    expect(threadPolicyFrozenError(new Error('room thread execution policy is frozen; change the room'))).toBe(true)
    expect(threadPolicyFrozenError(new Error('thread not found: thr_1'))).toBe(false)
    expect(threadPolicyFrozenError('room thread execution policy is frozen')).toBe(true)
  })
})
