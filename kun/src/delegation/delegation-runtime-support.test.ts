import { describe, expect, it } from 'vitest'
import { ChildRunRecord } from './delegation-runtime-contracts.js'
import { buildFailedChildRecord, childAbortOutcome } from './delegation-runtime-support.js'

function runningRecord(patch: Partial<ReturnType<typeof ChildRunRecord.parse>> = {}) {
  return ChildRunRecord.parse({
    id: 'child_fc',
    parentThreadId: 'parent',
    parentTurnId: 'turn-1',
    launcher: 'fast_context',
    prompt: 'retrieve evidence',
    workspace: '/workspace',
    profile: 'explore',
    profileSnapshot: { mode: 'subagent', toolPolicy: 'readOnly' },
    security: { sandboxRoot: '/workspace', memoryEnabled: false },
    status: 'running',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:30.000Z',
    ...patch
  })
}

function failedBuild(error: string) {
  const current = runningRecord()
  return buildFailedChildRecord(current, {
    signal: new AbortController().signal,
    runtimeRestart: false,
    abort: childAbortOutcome(new AbortController().signal, false, new Error(error)),
    parentTurnId: 'turn-1',
    childId: current.id,
    startedAt: '2026-08-19T00:00:30.000Z',
    finishedAt: '2026-08-19T00:01:00.000Z',
    previewChars: 4_000
  })
}

describe('buildFailedChildRecord error sanitization', () => {
  it('rewrites error text that self-describes a completed child', () => {
    const fakeSummary = 'status: completed childId: child_fc toolInvocations: 6 durationMs: 11480'
    const record = failedBuild(fakeSummary)
    expect(record.status).toBe('failed')
    expect(record.error).toBe('Child result materialization failed; open the child session for details.')
  })

  it('rewrites JSON-style completed markers the same way', () => {
    const record = failedBuild('{"status":"completed","childId":"child_fc"}')
    expect(record.error).toBe('Child result materialization failed; open the child session for details.')
  })

  it('keeps genuine failure messages untouched', () => {
    const record = failedBuild('model provider returned HTTP 520')
    expect(record.error).toBe('model provider returned HTTP 520')
  })
})
