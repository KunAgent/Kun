import { describe, expect, it } from 'vitest'
import { modelListFromSharedConnections } from './upstream-models'

describe('upstream model picker leftover OpenCode Free', () => {
  it('omits leftover OpenCode Free connections from the composer picker', () => {
    const result = modelListFromSharedConnections({
      schemaVersion: 1,
      providers: [{
        id: 'opencode-free',
        name: 'OpenCore Free',
        presetSource: 'opencode-free',
        configured: true,
        credentialStatus: 'ready',
        models: ['big-pickle', 'gpt-5-nano']
      }, {
        id: 'opencode-free-2',
        name: 'OpenCore Free 2',
        configured: true,
        credentialStatus: 'ready',
        models: ['mimo-v2.5-free']
      }, {
        id: 'deepseek',
        name: 'DeepSeek',
        configured: true,
        credentialStatus: 'ready',
        models: ['deepseek-v4-pro']
      }]
    })

    expect(result && 'modelGroups' in result ? result.modelGroups?.map((group) => group.providerId) : [])
      .toEqual(['deepseek'])
  })
})
