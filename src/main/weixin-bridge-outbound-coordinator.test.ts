import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: 'initial-token',
  restore: vi.fn(async () => undefined),
  send: vi.fn(async (_input: { contextToken?: string }) => ({ messageId: 'wx_message_1' }))
}))

vi.mock('./logger', () => ({ logError: vi.fn() }))
vi.mock('./weixin-bridge-storage', () => ({
  normalizeAccountId: (value: string) => value.trim(),
  resolveWeixinAccount: vi.fn(async (accountId: string) => ({
    accountId,
    baseUrl: 'https://weixin.invalid',
    cdnBaseUrl: 'https://cdn.invalid',
    token: 'account-token',
    configured: true
  }))
}))
vi.mock('./weixin-bridge-channel', () => ({
  getContextToken: () => mocks.token,
  restoreContextTokens: mocks.restore,
  sendMessageWeixin: mocks.send,
  sendGeneratedFilesWeixin: vi.fn(async () => undefined)
}))

import {
  coordinateWeixinOutbound,
  localSendResponse,
  resetWeixinOutboundCoordinator
} from './weixin-bridge-outbound-coordinator'

describe('Weixin outbound coordinator', () => {
  beforeEach(() => {
    resetWeixinOutboundCoordinator()
    mocks.token = 'initial-token'
    mocks.restore.mockClear()
    mocks.send.mockClear()
  })

  it('deduplicates the same idempotent request and rejects key reuse with another payload', async () => {
    const request = {
      accountId: 'account-1',
      to: 'user-1',
      text: 'hello',
      idempotencyKey: 'request-1'
    }
    const first = coordinateWeixinOutbound(request)
    const duplicate = coordinateWeixinOutbound(request)

    await expect(first).resolves.toEqual({ ok: true, messageId: 'wx_message_1' })
    await expect(duplicate).resolves.toEqual({ ok: true, messageId: 'wx_message_1' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    await expect(coordinateWeixinOutbound({ ...request, text: 'different' })).resolves.toEqual({
      ok: false,
      message: 'Idempotency key was already used for a different request.'
    })
  })

  it('reads the latest context token when each queued send reaches the head', async () => {
    let releaseFirst!: () => void
    mocks.send.mockImplementationOnce(async (input: { contextToken?: string }) => {
      expect(input.contextToken).toBe('initial-token')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      return { messageId: 'first' }
    })
    const first = coordinateWeixinOutbound({ accountId: 'account-1', to: 'user-1', text: 'first' })
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))
    const second = coordinateWeixinOutbound({ accountId: 'account-1', to: 'user-1', text: 'second' })
    mocks.token = 'rolled-token'
    releaseFirst()

    await first
    await second
    expect(mocks.send.mock.calls[1]?.[0]).toMatchObject({ contextToken: 'rolled-token' })
    expect(mocks.restore).toHaveBeenCalledTimes(1)
  })

  it('maps only a confirmed upstream send to accepted', () => {
    expect(localSendResponse({ ok: true, messageId: 'wx-1' }, 'key-1')).toEqual({
      status: 'accepted',
      messageId: 'wx-1',
      idempotencyKey: 'key-1'
    })
    expect(localSendResponse({ ok: false, message: 'business error ret=1' }, 'key-2'))
      .toMatchObject({ status: 'rejected', error: { code: 'send_failed' } })
  })
})
