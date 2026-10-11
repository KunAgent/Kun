import { describe, expect, it } from 'vitest'
import { resolveDelegatedCredentialContext } from './delegated-credentials.js'
import type { HarnessDefinition } from '../contracts/harness.js'

const definition = {
  id: 'codex',
  displayName: 'Codex',
  transport: 'acp',
  credentialModes: ['native-login', 'kun-gateway'],
  gateway: {
    protocol: 'openai-responses',
    env: { baseUrl: 'KUN_GATEWAY_BASE_URL', token: 'KUN_GATEWAY_TOKEN' },
    stripEnv: ['OPENAI_API_KEY', 'CODEX_HOME']
  },
  builtin: true
} as unknown as HarnessDefinition

const baseInput = {
  definition,
  threadId: 't1',
  turnId: 'u1'
} as const

describe('resolveDelegatedCredentialContext', () => {
  it('kun-gateway folds the route into identity and exposes wireModel', async () => {
    const resolve = async () => ({ KUN_GATEWAY_TOKEN: 'tok' })
    const result = await resolveDelegatedCredentialContext(resolve, {
      ...baseInput,
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-chat'
    })
    expect(result.env).toEqual({ KUN_GATEWAY_TOKEN: 'tok' })
    expect(result.wireModel).toBe('kun/deepseek/deepseek-chat')
    expect(result.credentialIdentity).toContain('scrypt-v1:')
    // Same route → same identity (pool reuse); different model → different.
    const other = await resolveDelegatedCredentialContext(resolve, {
      ...baseInput,
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-reasoner'
    })
    expect(other.credentialIdentity).not.toBe(result.credentialIdentity)
  })

  it('does not double-wrap a model already in kun/ form', async () => {
    const result = await resolveDelegatedCredentialContext(
      async () => ({}),
      {
        ...baseInput,
        credentialMode: 'kun-gateway',
        providerId: 'deepseek',
        model: 'kun/deepseek/deepseek-chat'
      }
    )
    // wireModel stays undefined — the model field already IS the gateway id,
    // so `ctx.model` falls through unchanged.
    expect(result.wireModel).toBeUndefined()
  })

  it('native-login resolves to no env and no wireModel', async () => {
    const result = await resolveDelegatedCredentialContext(undefined, {
      ...baseInput,
      credentialMode: 'native-login',
      providerId: 'openai',
      model: 'gpt-5'
    })
    expect(result.env).toEqual({})
    expect(result.wireModel).toBeUndefined()
  })

  it('kun-gateway without a resolver fails fast', async () => {
    await expect(
      resolveDelegatedCredentialContext(undefined, {
        ...baseInput,
        credentialMode: 'kun-gateway',
        providerId: 'deepseek',
        model: 'deepseek-chat'
      })
    ).rejects.toThrow('credential resolver')
  })
})
