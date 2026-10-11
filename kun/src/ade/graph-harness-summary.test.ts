import { describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../contracts/harness.js'
import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import { createGraphHarnessSummary } from './graph-harness-summary.js'

const def = (id: string) => BUILTIN_HARNESSES.find((entry) => entry.id === id)!

function ready(id: string): HarnessStatus {
  return {
    harnessId: id,
    installed: 'yes',
    login: 'signed-in',
    checkedAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeDeps(overrides: {
  harnesses?: ReturnType<typeof def>[]
  disabled?: (id: string) => boolean
  statuses?: Record<string, HarnessStatus | undefined>
  quota?: ProviderQuotaListResponse | null
} = {}) {
  const defs = overrides.harnesses ?? [def('kun'), def('claude-code')]
  const detector = {
    cachedStatus: (id: string) =>
      overrides.statuses && id in overrides.statuses
        ? overrides.statuses[id]
        : ready(id),
    status: vi.fn(async (id: string) => ready(id))
  }
  return {
    deps: {
      catalog: {
        list: () => defs,
        isDisabled: overrides.disabled ?? (() => false)
      },
      detector,
      quota: async () => overrides.quota ?? null
    },
    detector
  }
}

describe('createGraphHarnessSummary', () => {
  it('lists each ready harness with name, suitability, and quota state', async () => {
    const { deps } = makeDeps({
      quota: {
        refreshedAt: '2026-01-01T00:00:00.000Z',
        entries: [{
          providerId: 'claude-subscription',
          providerName: 'Claude',
          presetId: 'claude-subscription',
          status: 'available',
          metrics: [{ id: 'session', label: '5h', unit: '%', usedPercent: 40 }]
        }]
      }
    })
    const summary = await createGraphHarnessSummary(deps)()
    expect(summary).toContain('Graph worker harnesses')
    expect(summary).toContain('- kun (Kun) — Kun agent loop')
    expect(summary).toContain('- claude-code (Claude Code) — delegated agent loop')
    expect(summary).toContain('quota: 40% used')
    expect(summary).toContain('quota: unknown')
  })

  it('omits disabled and not-installed harnesses', async () => {
    const { deps } = makeDeps({
      harnesses: [def('kun'), def('claude-code'), def('cursor')],
      disabled: (id) => id === 'claude-code',
      statuses: { cursor: { ...ready('cursor'), installed: 'no' } }
    })
    const summary = await createGraphHarnessSummary(deps)()
    expect(summary).toContain('- kun')
    expect(summary).not.toContain('claude-code')
    expect(summary).not.toContain('- cursor')
  })

  it('skips harnesses with no cached status and refreshes in the background', async () => {
    const { deps, detector } = makeDeps({ statuses: { 'claude-code': undefined } })
    const summary = await createGraphHarnessSummary(deps)()
    expect(summary).not.toContain('claude-code')
    expect(detector.status).toHaveBeenCalledWith('claude-code')
  })

  it('notes an installed-but-signed-out harness', async () => {
    const { deps } = makeDeps({
      statuses: { 'claude-code': { ...ready('claude-code'), login: 'signed-out' } }
    })
    const summary = await createGraphHarnessSummary(deps)()
    expect(summary).toContain('installed, not logged in')
  })

  it('returns undefined when no harness is ready', async () => {
    const { deps } = makeDeps({
      harnesses: [def('claude-code')],
      statuses: { 'claude-code': { ...ready('claude-code'), installed: 'no' } }
    })
    await expect(createGraphHarnessSummary(deps)()).resolves.toBeUndefined()
  })
})
