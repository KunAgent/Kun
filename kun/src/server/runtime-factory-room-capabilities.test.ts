import { describe, expect, it } from 'vitest'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { roomUnsupportedProviderIdsForOptions } from './runtime-factory-model.js'

function options(): KunServeRuntimeOptions {
  return {
    providers: {
      api: { kind: 'http' },
      claude: { kind: 'agent-sdk' },
      cursor: { kind: 'cursor-sdk' },
      gravity: { kind: 'antigravity-cli' }
    }
  } as unknown as KunServeRuntimeOptions
}

describe('room execution engine capabilities', () => {
  it('requires native tool gating as well as the Kun bridge', () => {
    expect([...roomUnsupportedProviderIdsForOptions(options())]).toEqual(['gravity', 'cursor'])
  })
})
