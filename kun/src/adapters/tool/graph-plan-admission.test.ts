import { describe, expect, it, vi } from 'vitest'
import type { GraphPlanV1 } from '../../contracts/graph.js'
import type { HarnessStatus } from '../../contracts/harness.js'
import type { HarnessCapabilities } from '../../contracts/harness-capabilities.js'
import {
  allSupportedStatuses,
  unsupported
} from '../../contracts/harness-capabilities.js'
import type { GraphRuntimeConfig } from '../../config/kun-config.js'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import { testGraphPlan } from '../../graph/graph-test-fixtures.test-support.js'
import {
  checkGraphPlanHarnesses,
  type GraphPlanHarnessAdmission
} from './graph-plan-admission.js'

const READY: HarnessStatus = {
  harnessId: 'claude-code',
  installed: 'yes',
  login: 'signed-in',
  checkedAt: '2026-01-01T00:00:00.000Z'
}

const ALL_SUPPORTED: HarnessCapabilities = {
  statuses: allSupportedStatuses(),
  facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
}

const ISOLATION: GraphRuntimeConfig['writeIsolation'] = {
  mode: 'worktree',
  allowWorktrees: true,
  leaseTtlMs: 30_000,
  preserveFailedWorktrees: false
}

function planWith(taskPatches: Record<string, unknown>[]): GraphPlanV1 {
  const plan = testGraphPlan()
  return {
    ...plan,
    nodes: plan.nodes.map((node, index) => ({
      ...node,
      ...(taskPatches[index] ?? {})
    }))
  }
}

function ephemeralWith(harnessId: string, credentialMode?: string) {
  return {
    kind: 'ephemeral' as const,
    name: 'Worker',
    systemPrompt: 'Do the task.',
    toolPolicy: 'readOnly' as const,
    blockedTools: [],
    blockedSkills: [],
    blockedMcpServers: [],
    ...(harnessId ? { harnessId } : {}),
    ...(credentialMode ? { credentialMode } : {})
  }
}

function makeAdmission(overrides: Partial<GraphPlanHarnessAdmission> = {}) {
  const detector = {
    status: vi.fn(async (id: string) => ({ ...READY, harnessId: id }))
  }
  const admission: GraphPlanHarnessAdmission = {
    catalog: {
      get: (id: string) => BUILTIN_HARNESSES.find((entry) => entry.id === id),
      isDisabled: () => false
    },
    detector,
    capabilitiesForRoute: async () => ALL_SUPPORTED,
    ...overrides
  }
  return { admission, detector }
}

describe('checkGraphPlanHarnesses', () => {
  it('returns no issues for a routable pinned harness', async () => {
    const plan = planWith([
      { assignment: ephemeralWith('claude-code', 'native-login') },
      { assignment: ephemeralWith('claude-code') }
    ])
    const { admission } = makeAdmission()
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues).toEqual([])
  })

  it('skips nodes that do not name a harness', async () => {
    const plan = planWith([
      { assignment: ephemeralWith('') },
      { assignment: { kind: 'existing' as const, profileId: 'worker' } }
    ])
    const { admission, detector } = makeAdmission()
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues).toEqual([])
    expect(detector.status).not.toHaveBeenCalled()
  })

  it('reports an unknown harness as a per-node issue', async () => {
    const plan = planWith([{ assignment: ephemeralWith('not-a-harness') }])
    const { admission } = makeAdmission()
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'harness_unknown',
      path: ['plan', 'tasks', 0, 'harnessId']
    })
  })

  it('reports a disabled harness as unavailable', async () => {
    const plan = planWith([{ assignment: ephemeralWith('claude-code') }])
    const { admission } = makeAdmission({
      catalog: {
        get: (id: string) => BUILTIN_HARNESSES.find((entry) => entry.id === id),
        isDisabled: (id) => id === 'claude-code'
      }
    })
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues[0]).toMatchObject({ code: 'harness_unavailable' })
  })

  it('reports an unsupported credentialMode on its own path', async () => {
    const plan = planWith([
      { assignment: ephemeralWith('claude-code', 'provider') }
    ])
    const { admission } = makeAdmission()
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues[0]).toMatchObject({
      code: 'credential_unsupported',
      path: ['plan', 'tasks', 0, 'credentialMode']
    })
  })

  it('turns a capability probe failure into an issue instead of throwing', async () => {
    const plan = planWith([{ assignment: ephemeralWith('claude-code') }])
    const { admission } = makeAdmission({
      capabilitiesForRoute: async () => {
        throw new Error('probe crashed')
      }
    })
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues[0]).toMatchObject({ code: 'harness_unavailable' })
  })

  it('reports a capability admission failure with the verdict code', async () => {
    const plan = planWith([{ assignment: ephemeralWith('claude-code') }])
    const { admission } = makeAdmission({
      capabilitiesForRoute: async () => ({
        statuses: {
          ...allSupportedStatuses(),
          kunTools: unsupported('not-implemented')
        },
        facts: ALL_SUPPORTED.facts
      })
    })
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues[0]).toMatchObject({ code: 'capability_missing' })
    expect(issues[0]!.message).toContain('claude-code')
  })

  it('reports a non-ready harness through admission verdicts', async () => {
    const plan = planWith([{ assignment: ephemeralWith('claude-code') }])
    const { admission } = makeAdmission({
      detector: {
        status: async (id: string) => ({
          ...READY,
          harnessId: id,
          installed: 'no' as const
        })
      }
    })
    const issues = await checkGraphPlanHarnesses({ plan, admission, isolation: ISOLATION })
    expect(issues[0]).toMatchObject({ code: 'harness_not_ready' })
  })
})
