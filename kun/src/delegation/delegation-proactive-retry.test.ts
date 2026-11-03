import { describe, expect, it } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { ChildRunRecord } from './delegation-runtime.js'
import { proactiveRetryStatus } from './delegation-proactive-retry.js'

const policy = SubagentsCapabilityConfig.parse({
  enabled: true,
  maxParallel: 2,
  proactiveRetry: { enabled: true, maxAttempts: 3 }
}).proactiveRetry

function failedRecord(patch: Partial<ReturnType<typeof ChildRunRecord.parse>> = {}) {
  return ChildRunRecord.parse({
    id: 'child_retry',
    parentThreadId: 'parent',
    parentTurnId: 'turn-1',
    launcher: 'delegate_task',
    prompt: 'trace the browser auto-open chain',
    workspace: '/workspace',
    profile: 'explore',
    profileSnapshot: { mode: 'subagent', toolPolicy: 'readOnly' },
    security: { sandboxRoot: '/workspace', memoryEnabled: false },
    status: 'failed',
    terminationReason: 'child_error',
    resumable: true,
    failure: { source: 'runtime', code: 'turn_step_limit' },
    resumeCount: 0,
    proactiveRetryCount: 0,
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:01:00.000Z',
    ...patch
  })
}

describe('proactiveRetryStatus', () => {
  it('marks a failed resumable delegate_task child eligible while attempts remain', () => {
    expect(proactiveRetryStatus(failedRecord(), policy)).toEqual({
      enabled: true, eligible: true, count: 0, limit: 3, remaining: 3
    })
  })

  /**
   * `resumeChild` refuses a proactive resume unless the run is an ordinary
   * `delegate_task` child, so a notice must never advertise eligibility for
   * the other launchers: the parent would only hit "not owned by ordinary
   * delegate_task" when it tried to continue that exact child.
   */
  it('keeps eligibility aligned with the resume guard for other launchers', () => {
    for (const launcher of ['manager-worker', 'graph', 'component_design', 'diagram_design'] as const) {
      expect(proactiveRetryStatus(failedRecord({ launcher }), policy).eligible).toBe(false)
    }
  })

  it('never advertises eligibility for a Fast Context child, even with a stale resumable flag', () => {
    expect(proactiveRetryStatus(failedRecord({
      launcher: 'fast_context', fastContext: true, resumable: true
    }), policy)).toMatchObject({ enabled: true, eligible: false })
  })

  it('drops eligibility when the policy is disabled or attempts are exhausted', () => {
    expect(proactiveRetryStatus(failedRecord(), { ...policy, enabled: false }).eligible).toBe(false)
    expect(proactiveRetryStatus(failedRecord({ proactiveRetryCount: 3 }), policy))
      .toMatchObject({ eligible: false, remaining: 0 })
  })

  it('stays ineligible for stopped or completed runs', () => {
    expect(proactiveRetryStatus(
      failedRecord({ status: 'aborted', terminationReason: 'user_stop' }), policy
    ).eligible).toBe(false)
    expect(proactiveRetryStatus(
      failedRecord({ status: 'completed', terminationReason: undefined }), policy
    ).eligible).toBe(false)
  })
})
