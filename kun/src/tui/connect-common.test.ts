import { describe, expect, it } from 'vitest'
import {
  connectionPresets,
  connectionRequiresCredential
} from './connect-common.js'

describe('TUI connection catalog', () => {
  it('keeps OpenCore Free in the Free group and permits anonymous connection', () => {
    const preset = connectionPresets.find((entry) => entry.id === 'opencode-free')

    expect(preset).toMatchObject({
      category: 'Free',
      kind: 'http',
      authType: 'api-key',
      credentialRequirement: 'optional',
      endpointFormat: 'chat_completions',
      models: [
        'big-pickle',
        'mimo-v2.5-free',
        'ling-3.0-flash-fin-free',
        'nemotron-3-ultra-free',
        'nemotron-3.5-lightning-free'
      ]
    })
    expect(connectionRequiresCredential(preset!)).toBe(false)
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
