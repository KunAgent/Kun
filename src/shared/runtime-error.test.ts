import { describe, expect, it } from 'vitest'
import {
  isDeterministicKunRejection,
  isKnownKunErrorCode,
  parseRuntimeErrorBody,
  parseThreadBusyDetails,
  runtimeErrorToError
} from './runtime-error'

describe('runtime error parsing', () => {
  it('parses Kun code, message, and details payloads', () => {
    const parsed = parseRuntimeErrorBody(
      JSON.stringify({
        code: 'attachment_validation_failed',
        message: 'image is too large',
        details: [{ path: ['dataBase64'], message: 'too big' }]
      }),
      'fallback'
    )

    expect(parsed).toEqual({
      code: 'attachment_validation_failed',
      message: 'image is too large',
      details: [{ path: ['dataBase64'], message: 'too big' }]
    })
  })

  it('round trips structured runtime errors through Error instances', () => {
    const error = runtimeErrorToError({
      code: 'provider_unavailable',
      message: 'provider failed',
      details: { status: 503 }
    })

    expect(parseRuntimeErrorBody(error.message, 'fallback')).toEqual({
      code: 'provider_unavailable',
      message: 'provider failed',
      details: { status: 503 }
    })
  })

  it('preserves thread_busy and reads its sanitized structured details', () => {
    const parsed = parseRuntimeErrorBody(
      JSON.stringify({
        code: 'thread_busy',
        message: 'thread already has an active turn',
        details: {
          threadId: 'thr_1',
          activeTurnId: 'turn_1',
          ownerFlavor: 'production',
          acquiredAt: '2026-08-09T10:00:00.000Z',
          expiresAt: '2026-08-09T10:00:30.000Z'
        }
      }),
      'fallback'
    )

    expect(parsed.code).toBe('thread_busy')
    expect(isKnownKunErrorCode(parsed.code)).toBe(true)
    expect(parseThreadBusyDetails(parsed.details)).toEqual({
      threadId: 'thr_1',
      activeTurnId: 'turn_1',
      ownerFlavor: 'production',
      acquiredAt: '2026-08-09T10:00:00.000Z',
      expiresAt: '2026-08-09T10:00:30.000Z'
    })
    expect(JSON.stringify(parsed)).not.toContain('ownerInstanceId')
  })

  it('recognizes the task-surface and design-profile lock codes', () => {
    const surfaceLocked = parseRuntimeErrorBody(
      JSON.stringify({
        code: 'task_surface_locked',
        message: 'task surface is locked to write'
      }),
      'fallback'
    )
    const profileLocked = parseRuntimeErrorBody(
      JSON.stringify({
        code: 'design_profile_locked',
        message: 'Design task profile is locked'
      }),
      'fallback'
    )

    expect(surfaceLocked.code).toBe('task_surface_locked')
    expect(profileLocked.code).toBe('design_profile_locked')
    expect(isKnownKunErrorCode(surfaceLocked.code)).toBe(true)
    expect(isKnownKunErrorCode(profileLocked.code)).toBe(true)
  })

  it('classifies deterministic client rejections from retryable outcomes', () => {
    expect(isDeterministicKunRejection('task_surface_locked')).toBe(true)
    expect(isDeterministicKunRejection('design_profile_locked')).toBe(true)
    expect(isDeterministicKunRejection('validation_error')).toBe(true)
    expect(isDeterministicKunRejection('conflict')).toBe(true)
    expect(isDeterministicKunRejection('not_found')).toBe(true)
    // Unknown, offline, and internal outcomes may succeed on a retry.
    expect(isDeterministicKunRejection('unknown')).toBe(false)
    expect(isDeterministicKunRejection('runtime_offline')).toBe(false)
    expect(parseRuntimeErrorBody(
      JSON.stringify({ code: 'runtime_shutting_down', message: 'Kun application is shutting down' }),
      'fallback'
    ).code).toBe('runtime_shutting_down')
    expect(isDeterministicKunRejection('internal_error')).toBe(false)
  })
})
