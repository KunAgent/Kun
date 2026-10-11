import { describe, expect, it } from 'vitest'
import type { AdeHarnessTestResult } from '@shared/ade-harnesses'
import { agentReadinessFailure } from './agent-enablement-operation'

describe('enablement failure remediation', () => {
  it('identifies the observed OpenCode plugin crash separately from account errors', () => {
    const result = { harnessId: 'opencode', readiness: {
      checks: [{ id: 'credentials', ok: true }, { id: 'protocol', ok: false,
        detail: "ACP process exited: fn3 is not a function. (In 'fn3(input)', 'fn3' is an instance of Object)" }]
    } } as AdeHarnessTestResult
    expect(agentReadinessFailure(result).message).toBe('agentEnablement.opencodePluginFailed')
    expect(agentReadinessFailure({ ...result, harnessId: 'devin' }).message).toBe('agentEnablement.failures.protocol')
  })
})
