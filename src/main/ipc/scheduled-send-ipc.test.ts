import { describe, expect, it } from 'vitest'
import { scheduleTaskCreatePayloadSchema } from './app-ipc-schemas'

describe('scheduled send IPC contract', () => {
  const future = '2099-01-01T10:00:00.000Z'

  function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: 'Scheduled send',
      prompt: 'Continue the existing investigation',
      workspaceRoot: '/tmp/project',
      sourceThreadId: 'thread-existing',
      providerId: 'provider-a',
      accountId: 'account-a',
      model: 'model-a',
      reasoningEffort: 'high',
      mode: 'agent',
      orchestration: 'direct',
      attachmentIds: ['attachment-a', 'attachment-b'],
      schedule: {
        kind: 'at',
        atTime: future,
        timeZone: 'Asia/Taipei'
      },
      ...overrides
    }
  }

  it('accepts a bounded existing-thread snapshot without a plan binding', () => {
    const parsed = scheduleTaskCreatePayloadSchema.parse(payload())

    expect(parsed).toMatchObject({
      sourceThreadId: 'thread-existing',
      providerId: 'provider-a',
      accountId: 'account-a',
      model: 'model-a',
      attachmentIds: ['attachment-a', 'attachment-b']
    })
    expect(parsed).not.toHaveProperty('sourcePlanId')
  })

  it('requires either an existing thread or a plan owner', () => {
    const withoutOwner = payload()
    delete withoutOwner.sourceThreadId

    expect(() => scheduleTaskCreatePayloadSchema.parse(withoutOwner)).toThrow()
  })

  it('bounds and deduplicates the frozen attachment snapshot', () => {
    const maximum = Array.from({ length: 8 }, (_, index) => `attachment-${index}`)

    expect(scheduleTaskCreatePayloadSchema.parse(payload({ attachmentIds: maximum })).attachmentIds)
      .toHaveLength(8)
    expect(() => scheduleTaskCreatePayloadSchema.parse(payload({
      attachmentIds: [...maximum, 'attachment-over-limit']
    }))).toThrow()
    expect(() => scheduleTaskCreatePayloadSchema.parse(payload({
      attachmentIds: ['attachment-a', 'attachment-a']
    }))).toThrow()
  })

  it('rejects unbounded routing snapshot identifiers', () => {
    expect(() => scheduleTaskCreatePayloadSchema.parse(payload({ accountId: 'a'.repeat(257) })))
      .toThrow()
    expect(() => scheduleTaskCreatePayloadSchema.parse(payload({ attachmentIds: ['a'.repeat(257)] })))
      .toThrow()
  })
})
