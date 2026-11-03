import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL_STATES_CACHE_MS,
  connectionCredentialStateById,
  fetchSharedModelConnectionCredentialStates,
  resetSharedModelConnectionCredentialStatesCache,
  providerHasUsableCredential,
  sharedModelConnectionHasUsableCredential,
  shouldWarnMissingProviderCredential
} from './provider-credential-readiness'

describe('provider credential readiness', () => {
  it('treats plaintext apiKey as usable without a shared connection', () => {
    expect(providerHasUsableCredential({ id: 'deepseek', apiKey: 'sk-test' }, undefined)).toBe(true)
  })

  it('treats configured shared connections as usable when apiKey is redacted', () => {
    expect(providerHasUsableCredential(
      { id: 'grok-subscription', apiKey: '' },
      { id: 'grok-subscription', configured: true, credentialStatus: 'ready' }
    )).toBe(true)
    expect(sharedModelConnectionHasUsableCredential({
      configured: true,
      credentialStatus: 'ready'
    })).toBe(true)
  })

  it('rejects missing or unreadable shared credentials', () => {
    expect(providerHasUsableCredential(
      { id: 'grok-subscription', apiKey: '' },
      { id: 'grok-subscription', configured: true, credentialStatus: 'missing' }
    )).toBe(false)
    expect(providerHasUsableCredential(
      { id: 'grok-subscription', apiKey: '' },
      { id: 'grok-subscription', configured: true, credentialStatus: 'unreadable' }
    )).toBe(false)
    expect(providerHasUsableCredential(
      { id: 'grok-subscription', apiKey: '' },
      { id: 'grok-subscription', configured: false }
    )).toBe(false)
  })

  it('looks up credential state by provider id', () => {
    const states = [
      { id: 'deepseek', configured: true, credentialStatus: 'ready' as const },
      { id: 'grok-subscription', configured: true, credentialStatus: 'missing' as const }
    ]
    expect(connectionCredentialStateById(states, 'grok-subscription')).toEqual(states[1])
    expect(connectionCredentialStateById(states, 'missing')).toBeUndefined()
  })

  it('does not warn for redacted Grok OAuth when the shared connection is ready', () => {
    expect(shouldWarnMissingProviderCredential({
      usingCustomProvider: false,
      provider: { id: 'grok-subscription', apiKey: '' },
      connectionCredentials: [
        { id: 'grok-subscription', configured: true, credentialStatus: 'ready' }
      ]
    })).toBe(false)
  })

  it('warns for redacted Grok OAuth when the shared connection is missing credentials', () => {
    expect(shouldWarnMissingProviderCredential({
      usingCustomProvider: false,
      provider: { id: 'grok-subscription', apiKey: '' },
      connectionCredentials: [
        { id: 'grok-subscription', configured: true, credentialStatus: 'missing' }
      ]
    })).toBe(true)
  })

  it('suppresses the missing-key warning while credential state is still loading', () => {
    expect(shouldWarnMissingProviderCredential({
      usingCustomProvider: false,
      provider: { id: 'grok-subscription', apiKey: '' },
      connectionCredentials: null
    })).toBe(false)
  })
})

describe('shared credential state reads', () => {
  const body = JSON.stringify({ schemaVersion: 1, providers: [{ id: 'stt', configured: true, credentialStatus: 'ready' }] })
  afterEach(() => {
    resetSharedModelConnectionCredentialStatesCache()
    vi.unstubAllGlobals()
  })

  it('shares one request between concurrent callers and reuses it briefly', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    const [first, second] = await Promise.all([
      fetchSharedModelConnectionCredentialStates(),
      fetchSharedModelConnectionCredentialStates()
    ])
    await fetchSharedModelConnectionCredentialStates()
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(connectionCredentialStateById(first, 'stt')).toMatchObject({ credentialStatus: 'ready' })
  })

  it('reads again for Settings and after the cache window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await fetchSharedModelConnectionCredentialStates()
    await fetchSharedModelConnectionCredentialStates({ fresh: true })
    vi.setSystemTime(Date.now() + CREDENTIAL_STATES_CACHE_MS + 1)
    await fetchSharedModelConnectionCredentialStates()
    expect(runtimeRequest).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})
