import { describe, expect, it } from 'vitest'
import { modelProviderPatchSchema } from './settings-model'

describe('provider deletion settings IPC', () => {
  it('accepts explicit removal and restoration of bundled providers', () => {
    const patch = { providers: [], excludedBuiltinProviderIds: ['deepseek', 'opencode-free'] }
    expect(modelProviderPatchSchema.parse(patch)).toEqual(patch)
    expect(modelProviderPatchSchema.parse({ excludedBuiltinProviderIds: [] }))
      .toEqual({ excludedBuiltinProviderIds: [] })
  })

  it('rejects unknown built-in IDs', () => {
    expect(() => modelProviderPatchSchema.parse({ excludedBuiltinProviderIds: ['custom'] })).toThrow()
  })
})
