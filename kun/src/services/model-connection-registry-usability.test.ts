import { describe, expect, it } from 'vitest'
import {
  configuredFallback,
  isRetiredOpenCodeFreeConnection
} from './model-connection-registry-usability.js'
import type { StoredProfile } from './model-connection-registry-core.js'

function profile(input: Partial<StoredProfile> & Pick<StoredProfile, 'id'>): StoredProfile {
  return {
    accountId: `account:${input.id}`,
    name: input.id,
    kind: 'http',
    authType: 'api-key',
    endpointFormat: 'chat_completions',
    useProxy: false,
    configured: true,
    models: ['model'],
    selectedModel: 'model',
    ...input
  }
}

describe('retired OpenCode Free connections', () => {
  it('matches the retired id family and preset, not custom zen endpoints', () => {
    expect(isRetiredOpenCodeFreeConnection({ id: 'opencode-free' })).toBe(true)
    expect(isRetiredOpenCodeFreeConnection({ id: 'opencode-free-2' })).toBe(true)
    expect(isRetiredOpenCodeFreeConnection({ id: 'custom-zen', presetSource: 'opencode-free' })).toBe(true)
    expect(isRetiredOpenCodeFreeConnection({ id: 'opencode-go', presetSource: 'opencode-go' })).toBe(false)
    expect(isRetiredOpenCodeFreeConnection({ id: 'custom-zen' })).toBe(false)
  })

  it('does not use a leftover Free profile as the configured fallback', () => {
    const fallback = configuredFallback([
      profile({ id: 'opencode-free', presetSource: 'opencode-free', selectedModel: 'big-pickle', models: ['big-pickle'] }),
      profile({ id: 'deepseek', selectedModel: 'deepseek-chat', models: ['deepseek-chat'] })
    ], new Map([
      ['opencode-free', { credentialStatus: 'ready' }],
      ['deepseek', { credentialStatus: 'ready' }]
    ]))
    expect(fallback?.profile.id).toBe('deepseek')
    expect(fallback?.model).toBe('deepseek-chat')
  })
})
