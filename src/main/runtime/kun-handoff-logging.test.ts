import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunHandoffEvent } from './kun-installed-build-handoff'

const logger = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn()
}))

vi.mock('../logger', () => logger)

import { kunHandoffLogDetail, logKunHandoffEvent } from './kun-handoff-logging'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Kun handoff logging', () => {
  it('records only allow-listed, abbreviated lifecycle diagnostics', () => {
    const event = {
      reason: 'installed-build-change',
      phase: 'stop-runtimes',
      elapsedMs: 412,
      targetBuildId: 'b'.repeat(64),
      probeClassification: 'runtime-discovery-compatible',
      postcondition: 'drained',
      result: 'forced',
      owner: {
        kind: 'runtime',
        flavor: 'production',
        instanceId: 'runtime-1',
        pid: 4312,
        port: 18899,
        buildId: 'a'.repeat(64)
      },
      runtimeToken: 'runtime-secret',
      managerToken: 'manager-secret',
      settings: '{"apiKey":"settings-secret"}',
      command: '/Applications/Old Kun.app/Contents/MacOS/Kun --secret'
    } as unknown as KunHandoffEvent

    const detail = kunHandoffLogDetail(event)
    const serialized = JSON.stringify(detail)

    expect(detail).toMatchObject({
      reason: 'installed-build-change',
      phase: 'stop-runtimes',
      elapsedMs: 412,
      targetBuildId: 'b'.repeat(12),
      probeClassification: 'runtime-discovery-compatible',
      postcondition: 'drained',
      result: 'forced',
      ownerKind: 'runtime',
      flavor: 'production',
      pid: 4312,
      buildId: 'a'.repeat(12)
    })
    expect(serialized).not.toContain('runtime-secret')
    expect(serialized).not.toContain('manager-secret')
    expect(serialized).not.toContain('settings-secret')
    expect(serialized).not.toContain('/Applications/Old Kun.app')
    expect(serialized).not.toContain('a'.repeat(64))
    expect(serialized).not.toContain('b'.repeat(64))
  })

  it('uses warning severity only for failed handoff events', () => {
    const failed: KunHandoffEvent = {
      reason: 'in-app-update',
      phase: 'verify-drained',
      elapsedMs: 40,
      result: 'failed',
      code: 'postcondition_failed'
    }
    logKunHandoffEvent(failed)
    logKunHandoffEvent({ ...failed, result: 'graceful' })

    expect(logger.logWarn).toHaveBeenCalledOnce()
    expect(logger.logInfo).toHaveBeenCalledOnce()
  })
})
