import { describe, expect, it } from 'vitest'
import { parseWorkflowSecretReference } from './workflow-secret-reference'

describe('parseWorkflowSecretReference', () => {
  it('normalizes a reference and keeps only non-secret identifiers', () => {
    expect(
      parseWorkflowSecretReference({
        credentialSourceId: '  cred_google  ',
        accountId: ' account-1 ',
        secretName: ' access-token '
      })
    ).toEqual({
      credentialSourceId: 'cred_google',
      accountId: 'account-1',
      secretName: 'access-token'
    })
  })

  it.each([
    undefined,
    null,
    [],
    {},
    { credentialSourceId: '' },
    { credentialSourceId: 'cred', value: 'plain-secret' },
    { credentialSourceId: 'cred', token: 'oauth-token' },
    { credentialSourceId: 'cred', apiKey: 'api-key' },
    { credentialSourceId: 'cred', secret: 'secret' }
  ])('rejects malformed or secret-bearing input: %j', (value) => {
    expect(parseWorkflowSecretReference(value)).toBeNull()
  })

  it('rejects control characters and oversized identifiers', () => {
    expect(parseWorkflowSecretReference({ credentialSourceId: 'cred\nsource' })).toBeNull()
    expect(parseWorkflowSecretReference({ credentialSourceId: 'cred\n' })).toBeNull()
    expect(parseWorkflowSecretReference({ credentialSourceId: '\tcred' })).toBeNull()
    expect(parseWorkflowSecretReference({ credentialSourceId: 'x'.repeat(257) })).toBeNull()
    expect(parseWorkflowSecretReference({ credentialSourceId: 'cred', accountId: 42 })).toBeNull()
  })

  it('does not mutate or retain the input object', () => {
    const input = { credentialSourceId: 'cred', accountId: 'account' }
    const parsed = parseWorkflowSecretReference(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    input.accountId = 'changed'
    expect(parsed?.accountId).toBe('account')
  })
})
