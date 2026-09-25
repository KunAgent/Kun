import { describe, expect, it } from 'vitest'
import { KUN_TOOL_PERMISSION_MODES } from '../contracts/policy.js'
import { HarnessDefinitionSchema } from '../contracts/harness.js'
import {
  HarnessCapabilitiesSchema,
  unsupported,
  type HarnessCapabilities
} from '../contracts/harness-capabilities.js'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import {
  capabilitiesV2FromLegacy,
  intersectCapabilities,
  weakestSandbox,
  weakestUsage
} from './effective-capabilities.js'
import { CAPABILITY_FIXTURES } from './__fixtures__/capability-fixtures.js'

const RANK = new Map(KUN_TOOL_PERMISSION_MODES.map((m, i) => [m, i]))

describe('builtin harnesses', () => {
  it('every builtin definition parses against the schema', () => {
    for (const def of BUILTIN_HARNESSES) {
      expect(() => HarnessDefinitionSchema.parse(def)).not.toThrow()
    }
  })

  it('fixture bases stay in sync with builtin capability declarations', () => {
    for (const c of CAPABILITY_FIXTURES.cases) {
      const def = BUILTIN_HARNESSES.find((d) => d.id === c.name)
      expect(def, `fixture ${c.name}`).toBeDefined()
      expect(HarnessCapabilitiesSchema.parse(c.base)).toEqual(def!.capabilities)
    }
  })

  it('permission modes are sorted strictest to widest', () => {
    for (const def of BUILTIN_HARNESSES) {
      const ranks = def.permissionModes.map((m) => RANK.get(m.kunPermissionMode)!)
      const sorted = [...ranks].sort((a, b) => a - b)
      expect(ranks, def.id).toEqual(sorted)
    }
  })
})

describe('intersectCapabilities', () => {
  const base: HarnessCapabilities = {
    statuses: Object.fromEntries(
      Object.keys(CAPABILITY_FIXTURES.cases[0]!.base.statuses).map((k) => [
        k,
        { supported: true }
      ])
    ) as HarnessCapabilities['statuses'],
    facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
  }

  it('keeps the first layer that marks a capability unsupported', () => {
    const narrowed: HarnessCapabilities = {
      statuses: { ...base.statuses, abort: unsupported('platform') },
      facts: base.facts
    }
    const narrowedAgain: HarnessCapabilities = {
      statuses: { ...base.statuses, abort: unsupported('upstream', { upstreamRef: 'x' }) },
      facts: base.facts
    }
    const result = intersectCapabilities(base, narrowed, narrowedAgain)
    expect(result.statuses.abort).toEqual({ supported: false, reason: 'platform' })
  })

  it('reports supported when every layer supports', () => {
    const result = intersectCapabilities(base, base)
    expect(result.statuses.abort).toEqual({ supported: true })
  })

  it('takes the weakest facts across layers', () => {
    const other: HarnessCapabilities = {
      statuses: base.statuses,
      facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }
    }
    const result = intersectCapabilities(base, other)
    expect(result.facts.sandbox).toBe('none')
    expect(result.facts.usageReporting).toBe('none')
    expect(result.facts.compactionOwner).toBe('harness')
  })

  it('weakestSandbox and weakestUsage orderings', () => {
    expect(weakestSandbox(['host', 'native', 'none'])).toBe('none')
    expect(weakestSandbox(['host', 'native'])).toBe('native')
    expect(weakestSandbox([])).toBe('host')
    expect(weakestUsage(['exact', 'estimated', 'none'])).toBe('none')
    expect(weakestUsage(['exact'])).toBe('exact')
  })
})

describe('capabilitiesV2FromLegacy', () => {
  it.each(CAPABILITY_FIXTURES.cases.map((c) => [c.name, c] as const))(
    '%s derives v2 statuses matching the shared fixture',
    (_name, c) => {
      const result = capabilitiesV2FromLegacy(c.legacy, c.base)
      expect(HarnessCapabilitiesSchema.parse(result)).toEqual(result)
      expect(result).toEqual(c.expected)
    }
  )
})
