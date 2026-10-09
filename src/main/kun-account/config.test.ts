import { expect, it } from 'vitest'
import { KUN_ACCOUNT_CLIENT_ID, KUN_ACCOUNT_REDIRECT } from './config'

it('ships a registered Public client and an exact loopback callback instead of a placeholder', () => {
  expect(KUN_ACCOUNT_CLIENT_ID).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)
  expect(KUN_ACCOUNT_REDIRECT).toBe('http://127.0.0.1:43187/auth/callback')
})
