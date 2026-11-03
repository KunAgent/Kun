import { describe, expect, it, vi } from 'vitest'
import { claudeSubscriptionKeychainAccount, readClaudeSubscriptionKeychain } from './claude-subscription-keychain.js'

describe('Claude keychain account isolation', () => {
  it('matches the SDK USER, userInfo and sanitized fallback rules', () => {
    const username = vi.fn(() => 'fallback-user')
    expect(claudeSubscriptionKeychainAccount({ USER: 'selected-user' }, 'darwin', username)).toBe('selected-user')
    expect(username).not.toHaveBeenCalled()
    expect(claudeSubscriptionKeychainAccount({}, 'darwin', username)).toBe('fallback-user')
    expect(claudeSubscriptionKeychainAccount({ USER: 'not a safe account' }, 'darwin', username)).toBe('claude-code-user')
    expect(claudeSubscriptionKeychainAccount({}, 'darwin', () => { throw new Error('unavailable') })).toBe('claude-code-user')
  })
  it('addresses both the exact service and account without reading any real credentials', async () => {
    const execute = vi.fn(async () => ({ stdout: 'fake-keychain-payload' }))
    expect(await readClaudeSubscriptionKeychain('selected-user', execute)).toBe('fake-keychain-payload')
    expect(execute).toHaveBeenCalledWith('/usr/bin/security',
      ['find-generic-password', '-a', 'selected-user', '-w', '-s', 'Claude Code-credentials'],
      expect.objectContaining({ encoding: 'utf8', timeout: 2_000 }))
  })
  it('distinguishes absent credentials from an inaccessible account', async () => {
    expect(await readClaudeSubscriptionKeychain('selected-user', async () => { throw { code: 44 } })).toBe('')
    await expect(readClaudeSubscriptionKeychain('selected-user', async () => { throw { code: 36 } }))
      .rejects.toThrow('Native subscription credentials are unavailable')
  })
})
