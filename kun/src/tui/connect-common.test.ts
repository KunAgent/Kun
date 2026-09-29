import { describe, expect, it } from 'vitest'
import {
  connectionPresets,
  connectionRequiresCredential
} from './connect-common.js'

describe('TUI connection catalog', () => {
  it('does not ship an OpenCode Free catalog entry', () => {
    expect(connectionPresets.find((entry) => entry.id === 'opencode-free')).toBeUndefined()
    expect(connectionPresets.filter((entry) => entry.category === 'Free')).toEqual([])
  })

  it('continues to require credentials for normal API providers', () => {
    const preset = connectionPresets.find((entry) => entry.id === 'zenmux')

    expect(preset).toMatchObject({
      category: 'API',
      credentialRequirement: 'required'
    })
    expect(connectionRequiresCredential(preset!)).toBe(true)
  })
})
