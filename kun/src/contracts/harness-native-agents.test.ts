import { describe, expect, it } from 'vitest'
import { nativeAgentsFromAcpModes } from './harness-native-agents.js'

describe('nativeAgentsFromAcpModes', () => {
  it('keeps id, name and description of each advertised mode once', () => {
    expect(nativeAgentsFromAcpModes({ currentModeId: 'build', availableModes: [
      { id: 'build', name: 'build', description: 'The default agent.' },
      { id: 'plan', name: 'plan' },
      { id: 'build', name: 'duplicate' },
      { id: ' ', name: 'blank' },
      { name: 'missing id' }
    ] })).toEqual([
      { id: 'build', name: 'build', description: 'The default agent.' },
      { id: 'plan', name: 'plan' }
    ])
  })
  it('returns an empty list for absent or malformed modes', () => {
    expect(nativeAgentsFromAcpModes(undefined)).toEqual([])
    expect(nativeAgentsFromAcpModes({ availableModes: 'build' })).toEqual([])
  })
})
