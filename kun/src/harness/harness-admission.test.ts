import { describe, expect, it } from 'vitest'
import {
  ADMISSION_RULES,
  checkHarnessAdmission,
  resolvePermissionMode
} from './harness-admission.js'
import { usageForTurn, isUnattendedTurn } from './usage-for-turn.js'
import { HarnessRouter } from './harness-router.js'
import { HarnessCatalog } from './harness-catalog.js'
import { effectiveCapabilitiesForRoute } from './effective-capabilities.js'
import {
  ANTIGRAVITY_CAPABILITIES,
  BUILTIN_HARNESSES,
  CLAUDE_CODE_CAPABILITIES,
  CURSOR_CAPABILITIES,
  KUN_NATIVE_CAPABILITIES
} from './builtin-harnesses.js'
import { agentSdkCapabilities } from '../runtime/agent-sdk/agent-sdk-runtime-stream.js'
import { cursorSdkCapabilities } from '../runtime/cursor/cursor-sdk-runtime-trace.js'
import { antigravityCapabilities } from '../runtime/antigravity/antigravity-cli-runtime.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import type {
  HarnessCapabilities,
  HarnessCapabilityKey
} from '../contracts/harness-capabilities.js'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

const ready: HarnessStatus = {
  harnessId: 'kun',
  installed: 'yes',
  login: 'signed-in',
  checkedAt: '2026-01-01T00:00:00.000Z'
}

const def = (id: string): HarnessDefinition =>
  BUILTIN_HARNESSES.find((d) => d.id === id)!

const admit = (input: {
  usage: Parameters<typeof checkHarnessAdmission>[0]['usage']
  harness?: HarnessDefinition
  effective?: HarnessCapabilities
  status?: HarnessStatus
  isolated?: boolean
  requestedPermissionMode?: string
  unattended?: boolean
  allowUnattendedFullAccess?: boolean
}) =>
  checkHarnessAdmission({
    usage: input.usage,
    harness: input.harness ?? def('claude-code'),
    effective: input.effective ?? CLAUDE_CODE_CAPABILITIES,
    status: input.status ?? ready,
    workspace: { isolated: input.isolated ?? false },
    ...(input.requestedPermissionMode !== undefined
      ? { requestedPermissionMode: input.requestedPermissionMode }
      : {}),
    unattended: input.unattended ?? false,
    allowUnattendedFullAccess: input.allowUnattendedFullAccess ?? false
  })

const without = (caps: HarnessCapabilities, key: HarnessCapabilityKey): HarnessCapabilities => ({
  ...caps,
  statuses: {
    ...caps.statuses,
    [key]: { supported: false as const, reason: 'upstream' as const }
  }
})

describe('checkHarnessAdmission matrix', () => {
  it.each(Object.keys(ADMISSION_RULES) as Array<keyof typeof ADMISSION_RULES>)(
    '%s: kun native loop admits',
    (usage) => {
      const result = admit({
        usage,
        harness: def('kun'),
        effective: KUN_NATIVE_CAPABILITIES
      })
      expect(result.ok).toBe(true)
    }
  )

  it.each(Object.entries(ADMISSION_RULES))('%s: missing a required capability rejects', (_usage, rule) => {
    for (const key of rule.required) {
      const result = admit({
        usage: _usage as keyof typeof ADMISSION_RULES,
        effective: without(CLAUDE_CODE_CAPABILITIES, key),
        status: { ...ready, installed: 'yes', login: 'signed-in' },
        isolated: true
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('capability_missing')
        expect(result.missing).toContain(key)
      }
    }
  })

  it('rejects an uninstalled harness before checking capabilities', () => {
    const result = admit({
      usage: 'one-to-one',
      status: { ...ready, harnessId: 'cursor', installed: 'no' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('harness_not_ready')
  })

  it('rejects a signed-out harness', () => {
    const result = admit({
      usage: 'one-to-one',
      status: { ...ready, harnessId: 'cursor', login: 'signed-out' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('harness_not_ready')
  })

  it('never gates the native loop on install status', () => {
    const result = admit({
      usage: 'one-to-one',
      harness: def('kun'),
      effective: KUN_NATIVE_CAPABILITIES,
      status: { ...ready, installed: 'unknown', login: 'unknown' }
    })
    expect(result.ok).toBe(true)
  })

  it('manager-worker rejects a sandbox-none harness outside isolation', () => {
    const result = admit({
      usage: 'manager-worker',
      harness: def('antigravity'),
      effective: {
        ...ANTIGRAVITY_CAPABILITIES,
        statuses: {
          ...ANTIGRAVITY_CAPABILITIES.statuses,
          abort: { supported: true },
          structuredStreaming: { supported: true }
        }
      },
      isolated: false
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('sandbox_insufficient')
  })

  it('manager-worker admits a sandbox-none harness in an isolated workspace', () => {
    const result = admit({
      usage: 'manager-worker',
      harness: def('antigravity'),
      effective: {
        ...ANTIGRAVITY_CAPABILITIES,
        statuses: {
          ...ANTIGRAVITY_CAPABILITIES.statuses,
          abort: { supported: true },
          structuredStreaming: { supported: true }
        }
      },
      isolated: true
    })
    expect(result.ok).toBe(true)
  })

  it('room-execution requires host sandbox', () => {
    const result = admit({
      usage: 'room-execution',
      effective: { ...CURSOR_CAPABILITIES, facts: { ...CURSOR_CAPABILITIES.facts, sandbox: 'native' } }
    })
    expect(result.ok).toBe(false)
  })

  it('plan-build admits an isolated-workspace harness without a sandbox', () => {
    const result = admit({
      usage: 'plan-build',
      harness: def('antigravity'),
      effective: {
        ...ANTIGRAVITY_CAPABILITIES,
        statuses: { ...ANTIGRAVITY_CAPABILITIES.statuses, abort: { supported: true } }
      },
      isolated: true
    })
    expect(result.ok).toBe(true)
  })
})

describe('resolvePermissionMode', () => {
  const claude = def('claude-code')

  it('falls back to the strictest level for unknown requests', () => {
    expect(resolvePermissionMode(claude, 'nonexistent', false, false)).toBe('default')
    expect(resolvePermissionMode(claude, undefined, false, false)).toBe('default')
  })

  it('keeps an explicitly requested level for attended turns', () => {
    expect(resolvePermissionMode(claude, 'bypassPermissions', false, false)).toBe('bypassPermissions')
  })

  it('clamps full-access on unattended turns unless the flag is on', () => {
    expect(resolvePermissionMode(claude, 'bypassPermissions', true, false)).toBe('default')
    expect(resolvePermissionMode(claude, 'bypassPermissions', true, true)).toBe('bypassPermissions')
    // acceptEdits maps to full-access on the Kun ladder, so it clamps too.
    expect(resolvePermissionMode(claude, 'acceptEdits', true, false)).toBe('default')
    // The strictest level itself is already safe unattended.
    expect(resolvePermissionMode(claude, 'default', true, false)).toBe('default')
  })
})

describe('usageForTurn', () => {
  const plainThread = { roomContext: undefined } as unknown as ThreadRecord
  const plainTurn = {} as Turn

  it('classifies rooms, graph, unattended, im, design, and one-to-one', () => {
    expect(usageForTurn(
      { roomContext: { roomId: 'r', memberId: 'm', kind: 'execution' } } as ThreadRecord,
      plainTurn
    )).toBe('room-execution')
    expect(usageForTurn(plainThread, { orchestration: 'graph' } as Turn)).toBe('graph-worker')
    expect(usageForTurn(
      plainThread,
      { orchestration: 'graph', graphLeadLifecycle: {} } as Turn
    )).toBe('graph-lead')
    expect(usageForTurn(plainThread, { imContext: true } as Turn)).toBe('im')
    expect(usageForTurn(plainThread, { clientSurface: 'im' } as Turn)).toBe('im')
    expect(usageForTurn(plainThread, { disableUserInput: true } as Turn)).toBe('scheduled')
    expect(usageForTurn(plainThread, { agentSurface: 'design' } as Turn)).toBe('design')
    expect(usageForTurn(plainThread, plainTurn)).toBe('one-to-one')
  })

  it('flags managed plan-build turns for the stricter admission usage', () => {
    expect(usageForTurn(plainThread, { planBuild: true } as Turn)).toBe('plan-build')
    // The explicit marker outranks even room/graph context: the
    // isolated-workspace rule is a property of the build, not the caller.
    expect(usageForTurn(
      { roomContext: { roomId: 'r', memberId: 'm', kind: 'execution' } } as ThreadRecord,
      { planBuild: true } as Turn
    )).toBe('plan-build')
    expect(usageForTurn(plainThread, { planBuild: true, orchestration: 'graph' } as Turn))
      .toBe('plan-build')
  })

  it('plan-build rejects a sandboxless harness without an isolated workspace', () => {
    const result = admit({
      usage: 'plan-build',
      harness: def('antigravity'),
      effective: {
        ...ANTIGRAVITY_CAPABILITIES,
        statuses: { ...ANTIGRAVITY_CAPABILITIES.statuses, abort: { supported: true } }
      },
      isolated: false
    })
    expect(result.ok).toBe(false)
  })

  it('detects unattended turns only via turn flags', () => {
    expect(isUnattendedTurn({} as Turn)).toBe(false)
    expect(isUnattendedTurn({ disableUserInput: true } as Turn)).toBe(true)
    expect(isUnattendedTurn({ imContext: true } as Turn)).toBe(true)
  })
})

describe('rooms equivalence (room-execution matches current room admission)', () => {
  const roomThread = {
    id: 't1',
    roomContext: { roomId: 'r1', memberId: 'm1', kind: 'execution' as const }
  } as ThreadRecord
  const roomTurn = { id: 'u1', threadId: 't1' } as Turn

  const router = (runtimeCaps: () => ReturnType<typeof agentSdkCapabilities>, transport: 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli') =>
    new HarnessRouter({
      enabled: () => true,
      catalog: new HarnessCatalog({ custom: () => [], enabledProfiles: () => [
        { harnessId: 'claude-code', credentialMode: 'native-login' },
        { harnessId: 'antigravity', credentialMode: 'native-login' },
        { harnessId: 'cursor', credentialMode: 'provider', providerId: 'default' }
      ] }),
      readiness: { configurationSignature: () => 'fixture', prepareTurn: async () => undefined, releaseTurn: () => undefined },
      runtimes: () => ({
        [transport]: {
          handlesProvider: () => true,
          capabilities: () => runtimeCaps(),
          runTurn: async () => 'completed' as const
        } satisfies DelegatedTurnRuntime
      }),
      providerKinds: () => ({ byId: {}, defaultKind: 'http' }),
      defaultModel: () => 'm'
    })

  it('admits the agent-sdk runtime (roomToolPolicy declared)', () => {
    const result = router(agentSdkCapabilities, 'agent-sdk').resolve(
      roomThread,
      { ...roomTurn, harnessId: 'claude-code' } as Turn
    )
    expect(result.ok).toBe(true)
  })

  it('rejects cursor and antigravity like today', () => {
    const cursor = router(() => cursorSdkCapabilities(true), 'cursor-sdk').resolve(
      roomThread,
      { ...roomTurn, harnessId: 'cursor', providerId: 'default' } as Turn
    )
    expect(cursor.ok).toBe(false)
    const antigravity = router(antigravityCapabilities, 'antigravity-cli').resolve(
      roomThread,
      { ...roomTurn, harnessId: 'antigravity' } as Turn
    )
    expect(antigravity.ok).toBe(false)
  })

  it('rejects claude when the runtime no longer reports roomToolPolicy', () => {
    const result = router(
      () => ({ ...agentSdkCapabilities(), roomToolPolicy: false }),
      'agent-sdk'
    ).resolve(roomThread, { ...roomTurn, harnessId: 'claude-code' } as Turn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('sandbox_insufficient')
  })
})
