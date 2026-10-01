import { beforeEach, expect, it, vi } from 'vitest'
import { protectedWeixinContextRecord, readProtectedWeixinContexts } from './personal-agent-weixin-context'
const mocks = vi.hoisted(() => ({ load: vi.fn(), protect: vi.fn((text: string) => Buffer.from(text).toString('base64')),
  unprotect: vi.fn((text: string) => Buffer.from(text, 'base64').toString()) }))
vi.mock('./weixin-bridge-storage', () => ({ loadWeixinAccountData: mocks.load }))
vi.mock('./personal-agent-im-secrets', () => ({ protectPersonalImSecret: mocks.protect, unprotectPersonalImSecret: mocks.unprotect }))
beforeEach(() => { mocks.load.mockReset(); mocks.protect.mockClear(); mocks.unprotect.mockClear() })
it('protects and restores reply tickets for a private-Agent account', async () => {
  mocks.load.mockResolvedValue({ protectedToken: 'os-protected-bot-token' })
  const record = await protectedWeixinContextRecord('account', { owner: 'private-reply-ticket' })
  expect(JSON.stringify(record)).not.toContain('private-reply-ticket')
  expect(readProtectedWeixinContexts(record)).toEqual({ owner: 'private-reply-ticket' })
})
it('retains the legacy account format and never silently falls back when OS protection fails', async () => {
  mocks.load.mockResolvedValue({ token: 'legacy' })
  expect(await protectedWeixinContextRecord('legacy', { owner: 'ticket' })).toEqual({ owner: 'ticket' })
  mocks.load.mockResolvedValue({ protectedToken: 'protected' })
  mocks.protect.mockImplementationOnce(() => { throw new Error('locked') })
  await expect(protectedWeixinContextRecord('private', { owner: 'secret' })).rejects.toThrow('locked')
})
