import { expect, it, vi } from 'vitest'
import { providerCredentialLease } from './provider-credential-lease.js'

it('keeps the admitted API identity when a connection is replaced mid-turn', async () => {
  const resolve = vi.fn(async () => ({ apiKey: 'replacement', headers: { organization: 'other' }, refreshable: false }))
  const lease = providerCredentialLease(resolve, { apiKey: 'original', headers: { organization: 'first' } })
  expect(await lease()).toEqual({ apiKey: 'original', headers: { organization: 'first' }, refreshable: false })
})

it('refreshes OAuth within the same account but cannot switch to a different account', async () => {
  const resolve = vi.fn(async () => ({ apiKey: 'refreshed', headers: { 'ChatGPT-Account-Id': 'one' }, refreshable: true }))
  const lease = providerCredentialLease(resolve, { apiKey: 'original', headers: { 'ChatGPT-Account-Id': 'one' } })
  expect((await lease()).apiKey).toBe('refreshed')
  resolve.mockResolvedValueOnce({ apiKey: 'another-account', headers: { 'ChatGPT-Account-Id': 'two' }, refreshable: true })
  expect(await lease()).toMatchObject({ apiKey: 'refreshed', headers: { 'ChatGPT-Account-Id': 'one' }, refreshable: false })
})

it('does not use the cached key when the protected resolver fails closed', async () => {
  const lease = providerCredentialLease(async () => { throw new Error('credential unavailable') }, { apiKey: 'old-key' })
  await expect(lease()).rejects.toThrow('credential unavailable')
})
