import { describe, expect, it, vi } from 'vitest'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import { allSupportedStatuses } from '../contracts/harness-capabilities.js'
import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'
import type { SubagentRoutingDocument } from '../delegation/subagent-router.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import {
  costTierFromPricing,
  NoEligibleWorkerError,
  selectWorkerRoute,
  type WorkerSelectorDeps
} from './worker-selector.js'

const READY: HarnessStatus = {
  harnessId: 'kun',
  installed: 'yes',
  login: 'signed-in',
  checkedAt: '2026-01-01T00:00:00.000Z'
}

const ALL_SUPPORTED: HarnessCapabilities = {
  statuses: allSupportedStatuses(),
  facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
}

const def = (id: string): HarnessDefinition =>
  BUILTIN_HARNESSES.find((entry) => entry.id === id)!

function makeDeps(overrides: Partial<WorkerSelectorDeps> & {
  harnesses?: HarnessDefinition[]
  statuses?: Record<string, HarnessStatus>
  quotaEntries?: ProviderQuotaListResponse['entries']
} = {}): WorkerSelectorDeps {
  const defs = overrides.harnesses ?? [def('kun'), def('claude-code'), def('codex')]
  return {
    catalog: {
      list: () => defs,
      get: (id: string) => defs.find((entry) => entry.id === id),
      isDisabled: () => false
    },
    detector: {
      status: async (id) => overrides.statuses?.[id] ?? { ...READY, harnessId: id }
    },
    capabilitiesForRoute: async () => ALL_SUPPORTED,
    profiles: async () => [],
    quota: async () =>
      overrides.quotaEntries
        ? { entries: overrides.quotaEntries, refreshedAt: '2026-01-01T00:00:00.000Z' }
        : null,
    agentOrder: () => [],
    recentFailures: async () => 0,
    modelCostTier: () => 0,
    isolated: true,
    unattended: false,
    allowUnattendedFullAccess: false,
    managerRoute: () => ({ model: 'deepseek-chat', providerId: 'deepseek' }),
    language: () => 'en',
    ...overrides
  }
}

const baseInput = { task: 'fix the flaky login test', teamId: 'thr_mgr', workspace: '/repo' }

describe('selectWorkerRoute', () => {
  it('admits only ready harnesses and picks a stable winner', async () => {
    const deps = makeDeps({
      statuses: {
        kun: { ...READY, harnessId: 'kun' },
        'claude-code': { ...READY, harnessId: 'claude-code' },
        codex: { ...READY, harnessId: 'codex', installed: 'no' }
      }
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(['kun', 'claude-code']).toContain(selection.route.harnessId)
    expect(selection.alternatives.every((c) => c.route.harnessId !== 'codex')).toBe(true)
  })

  it('excludes a quota-exhausted (>=95%) route entirely', async () => {
    const deps = makeDeps({
      agentOrder: () => ['claude-code', 'kun'],
      quotaEntries: [{
        providerId: 'claude-subscription',
        providerName: 'Claude',
        presetId: 'claude-subscription',
        status: 'available',
        metrics: [{ id: 'session', label: '5h', unit: '%', usedPercent: 97 }]
      }]
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.route.harnessId).not.toBe('claude-code')
    expect(selection.reason).toMatch(/quota 97% used/i)
  })

  it('penalizes a >=80% quota route without excluding it', async () => {
    const deps = makeDeps({
      harnesses: [def('claude-code')],
      quotaEntries: [{
        providerId: 'claude-subscription',
        providerName: 'Claude',
        presetId: 'claude-subscription',
        status: 'available',
        metrics: [{ id: 'session', label: '5h', unit: '%', usedPercent: 85 }]
      }]
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.route.harnessId).toBe('claude-code')
  })

  it('ignores quota entries that are not available or unknown', async () => {
    const deps = makeDeps({
      agentOrder: () => ['claude-code', 'kun'],
      quotaEntries: [{
        providerId: 'claude-subscription',
        providerName: 'Claude',
        presetId: 'claude-subscription',
        status: 'error',
        metrics: [{ id: 'session', label: '5h', unit: '%', usedPercent: 99 }]
      }]
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.route.harnessId).toBe('claude-code')
  })

  it('honors the user preference order as a score bonus', async () => {
    const unordered = await selectWorkerRoute(makeDeps(), baseInput)
    expect(unordered.route.harnessId).toBe('claude-code') // lexical tiebreak
    const preferred = await selectWorkerRoute(
      makeDeps({ agentOrder: () => ['kun', 'claude-code', 'codex'] }),
      baseInput
    )
    expect(preferred.route.harnessId).toBe('kun')
  })

  it('penalizes recent same-team same-harness failures', async () => {
    const deps = makeDeps({
      agentOrder: () => ['claude-code', 'kun'],
      recentFailures: async (_teamId, harnessId) => (harnessId === 'claude-code' ? 4 : 0)
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    // claude-code: 0.5 - 1.2 < kun: 0.333
    expect(selection.route.harnessId).toBe('kun')
  })

  it('is deterministic for identical inputs', async () => {
    const deps = makeDeps()
    const a = await selectWorkerRoute(deps, baseInput)
    const b = await selectWorkerRoute(deps, baseInput)
    expect(a).toEqual(b)
  })

  it('consults the optional tie-breaker only when top-2 are within 0.05', async () => {
    // All-default scoring ties; the arbiter promotes the lexical runner-up.
    const harnesses = [def('kun'), def('claude-code'), def('cursor')]
    const tieBreak = vi.fn(async () => 'b' as const)
    const tied = await selectWorkerRoute(makeDeps({ harnesses, tieBreak }), baseInput)
    expect(tieBreak).toHaveBeenCalledTimes(1)
    expect(tied.route.harnessId).toBe('cursor')
    expect(tied.reason).toMatch(/tie-break/)
    expect(tied.alternatives.map((c) => c.route.harnessId)).toEqual(['claude-code', 'kun'])

    // A preference bonus widens the gap beyond the arbitration window.
    const gap = vi.fn(async () => 'b' as const)
    const decided = await selectWorkerRoute(
      makeDeps({ harnesses, tieBreak: gap, agentOrder: () => ['claude-code', 'kun', 'cursor'] }),
      baseInput
    )
    expect(gap).not.toHaveBeenCalled()
    expect(decided.route.harnessId).toBe('claude-code')

    // An arbiter failure keeps the deterministic order.
    const broken = await selectWorkerRoute(
      makeDeps({ harnesses, tieBreak: async () => { throw new Error('offline') } }),
      baseInput
    )
    expect(broken.route.harnessId).toBe('claude-code')
  })

  it('excludes the reviewed worker harness for cross-review and errors when nothing is left', async () => {
    const deps = makeDeps({ harnesses: [def('claude-code')] })
    const selection = await selectWorkerRoute(deps, { ...baseInput, exclude: { harnessIds: ['codex'] } })
    expect(selection.route.harnessId).toBe('claude-code')

    await expect(
      selectWorkerRoute(deps, { ...baseInput, exclude: { harnessIds: ['claude-code'] } })
    ).rejects.toThrow(NoEligibleWorkerError)
    await expect(
      selectWorkerRoute(deps, { ...baseInput, exclude: { harnessIds: ['claude-code'] } })
        .catch((error) => error as NoEligibleWorkerError)
    ).resolves.toMatchObject({ rejections: [expect.stringContaining('excluded')] })
  })

  it('reports signed-out harnesses in the rejection summary', async () => {
    const deps = makeDeps({
      harnesses: [def('kun'), def('claude-code')],
      statuses: {
        kun: { ...READY, harnessId: 'kun' },
        'claude-code': { ...READY, harnessId: 'claude-code', login: 'signed-out' }
      }
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.route.harnessId).toBe('kun')
    expect(selection.reason).toMatch(/signed out/i)
  })

  it('prefers a profile whose delegationNotes match the task', async () => {
    const docs: SubagentRoutingDocument[] = [{
      kind: 'profile',
      id: 'reviewer',
      source: 'configured',
      profile: {
        mode: 'subagent',
        toolPolicy: 'inherit',
        name: 'Reviewer',
        description: 'reviews diffs',
        delegationNotes: 'login flaky test quarantine specialist'
      }
    }]
    const deps = makeDeps({
      profiles: async () => docs,
      agentOrder: () => ['claude-code']
    })
    const selection = await selectWorkerRoute(deps, {
      ...baseInput,
      role: 'reviewer',
      task: 'quarantine the flaky login test'
    })
    expect(selection.profileId).toBe('reviewer')
    expect(selection.route.harnessId).toBe('kun')
    expect(selection.reason).toMatch(/matched/i)
  })

  it('routes a harness-bound profile onto its harness', async () => {
    const docs: SubagentRoutingDocument[] = [{
      kind: 'profile',
      id: 'claude-fixer',
      source: 'configured',
      profile: {
        mode: 'subagent',
        toolPolicy: 'inherit',
        name: 'Claude Fixer',
        delegationNotes: 'login test fixer',
        harnessId: 'claude-code',
        credentialMode: 'native-login',
        model: 'claude-sonnet-4-6'
      }
    }]
    const deps = makeDeps({ profiles: async () => docs })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.profileId).toBe('claude-fixer')
    expect(selection.route).toMatchObject({
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      model: 'claude-sonnet-4-6'
    })
  })

  it('rejects profile candidates with an invalid harness binding', async () => {
    const docs: SubagentRoutingDocument[] = [{
      kind: 'profile',
      id: 'ghost',
      source: 'configured',
      profile: {
        mode: 'subagent',
        toolPolicy: 'inherit',
        name: 'Ghost',
        harnessId: 'nope' as never,
        credentialMode: 'native-login'
      }
    }]
    const deps = makeDeps({ harnesses: [def('kun')], profiles: async () => docs })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.route.harnessId).toBe('kun')
    expect(selection.profileId).toBeUndefined()
  })

  it('surfaces cost-tier differences between priced models', async () => {
    const deps = makeDeps({
      harnesses: [def('kun'), def('cursor')],
      agentOrder: () => ['cursor', 'kun'],
      modelCostTier: (route) => (route.harnessId === 'cursor' ? 2 : 0)
    })
    const selection = await selectWorkerRoute(deps, baseInput)
    expect(selection.route.harnessId).toBe('kun')
  })
})

describe('costTierFromPricing', () => {
  it('tiers by summed per-million list price and treats unknown as free', () => {
    expect(costTierFromPricing(undefined)).toBe(0)
    expect(costTierFromPricing({ inputUsdPerMillion: 0.5, outputUsdPerMillion: 1 })).toBe(0)
    expect(costTierFromPricing({ inputUsdPerMillion: 5, outputUsdPerMillion: 15 })).toBe(1)
    expect(costTierFromPricing({ inputUsdPerMillion: 20, outputUsdPerMillion: 40 })).toBe(2)
  })
})
