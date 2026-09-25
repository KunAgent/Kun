import type { DelegatedRuntimeCapabilities } from '../../runtime/delegated-turn-runtime.js'
import type { HarnessCapabilities } from '../../contracts/harness-capabilities.js'
import raw from './capability-fixtures.json'

export type CapabilityFixtureCase = {
  name: string
  legacy: DelegatedRuntimeCapabilities
  base: HarnessCapabilities
  expected: HarnessCapabilities
}

/** Shared with `src/shared/harness-capabilities` tests via the JSON sibling file. */
export const CAPABILITY_FIXTURES = raw as { cases: CapabilityFixtureCase[] }
