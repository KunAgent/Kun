import type { DelegatedRuntimeCapabilities } from '../../runtime/delegated-turn-runtime.js'
import type { HarnessCapabilities } from '../../contracts/harness-capabilities.js'
import raw from './capability-fixtures.json'
import rawDelegated from './capability-fixtures-delegated.json'

export type CapabilityFixtureCase = {
  name: string
  legacy: DelegatedRuntimeCapabilities
  base: HarnessCapabilities
  expected: HarnessCapabilities
}

/** Shared with `src/shared/harness-capabilities` tests via the JSON sibling files. */
export const CAPABILITY_FIXTURES = {
  cases: [
    ...(raw as { cases: CapabilityFixtureCase[] }).cases,
    ...(rawDelegated as { cases: CapabilityFixtureCase[] }).cases
  ]
}
