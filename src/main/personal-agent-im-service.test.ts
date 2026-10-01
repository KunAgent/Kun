import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import { defaultClawSettings, type AppSettingsV1 } from '../shared/app-settings'
import type { PersonalImConnection, PersonalImStore } from './personal-agent-im-store'
import { PersonalAgentImService } from './personal-agent-im-service'

vi.mock('./weixin-bridge-channel', () => ({ startWeixinLogin: vi.fn(), waitForWeixinLogin: vi.fn(),
  startAccountMonitor: vi.fn(), stopWeixinChannels: vi.fn(),
  textFromItemList: () => 'Hello from WeChat' }))
vi.mock('./claw-platform-install', () => ({ startFeishuInstallQrcode: vi.fn(), pollFeishuInstall: vi.fn() }))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0)) await stop(); vi.useRealTimers() })

function fixture(options: { unavailable?: boolean; initial?: PersonalImConnection[]; provider?: 'feishu' | 'weixin' } = {}) {
  const settings = { claw: defaultClawSettings() } as AppSettingsV1
  let saved = structuredClone(options.initial ?? [])
  const secureStore: PersonalImStore = { assertAvailable: vi.fn(() => { if (options.unavailable) throw new Error('Unlock your operating system credential store') }),
    load: vi.fn(async () => structuredClone(saved)), save: vi.fn(async (value) => { saved = structuredClone(value) }) }
  const feishu = { sync: vi.fn(async () => {}), stop: vi.fn(async () => {}), sendText: vi.fn(async () => ({ ok: true as const })) }
  const runtimeRequest = vi.fn(async (_settings, path: string) => ({ ok: true, status: 200,
    body: JSON.stringify(path.endsWith('/messages') ? { requestId: 'request-1' } : path.includes('/delivery?')
      ? { messages: [{ id: 'result-1', text: 'Done', seq: 12 }], cursor: 12, hasMore: false, attention: [] }
      : { agentId: 'agent-1', provider: options.provider ?? 'feishu', status: 'requested' }) }))
  const startFeishu = vi.fn(async () => ({ ok: true as const, url: 'https://open.feishu.cn/official', deviceCode: 'SECRET-DEVICE', userCode: '', expireIn: 300, interval: 3 }))
  const pollFeishu = vi.fn(async () => ({ done: true as const, kind: 'feishu' as const, appId: 'app1', appSecret: 'SECRET-APP', domain: 'feishu', ownerId: 'owner' }))
  const logError = vi.fn()
  const service = new PersonalAgentImService({ store: { load: async () => settings } as never,
    secureStore, runtimeRequest, feishu, startFeishu, pollFeishu, logError,
    startWeixin: vi.fn(async () => ({ sessionKey: 'weixin-session', qrUrl: 'https://weixin.qq.com/official' })),
    pollWeixin: vi.fn(async () => ({ connected: true, userId: 'owner', accountId: 'account1' })), startWeixinMonitor: vi.fn(async () => {}) })
  cleanup.push(() => service.stop())
  const request = { roomId: 'room', cardId: 'card' }
  const connect = async () => {
    const qr = await service.handle({ ...request, action: 'start' })
    if (qr.status !== 'qr') throw new Error(JSON.stringify(qr))
    const result = await service.handle({ ...request, action: 'poll', attemptId: qr.attemptId })
    if (result.status !== 'connected') throw new Error(JSON.stringify(result))
    return result.connectionId
  }
  const message = (changes: Partial<NormalizedMessage> = {}) => ({ chatType: 'p2p', senderId: 'owner', chatId: 'chat', messageId: 'message-1', content: 'Do the task', ...changes }) as NormalizedMessage
  return { service, settings, connect, request, message, runtimeRequest, startFeishu, pollFeishu, feishu, secureStore, logError, saved: () => saved }
}

describe('private Agent IM consent and sender boundary', () => {
  it('does not register or expose credentials before a desktop start action', async () => {
    const f = fixture()
    expect(await f.service.handle({ ...f.request, action: 'status' })).toEqual({ status: 'requested' })
    expect(f.startFeishu).not.toHaveBeenCalled()
    const qr = await f.service.handle({ ...f.request, action: 'start' })
    expect(qr.status).toBe('qr')
    expect(JSON.stringify(qr)).not.toContain('SECRET-DEVICE')
    expect(f.runtimeRequest.mock.calls.some(([, path]) => path.endsWith('/complete'))).toBe(false)
  })
  it('fails closed before requesting credentials if protected storage is unavailable', async () => {
    const f = fixture({ unavailable: true })
    expect((await f.service.handle({ ...f.request, action: 'start' })).status).toBe('error')
    expect(f.startFeishu).not.toHaveBeenCalled()
  })
  it('rejects a provider response without a verified scanning identity', async () => {
    const f = fixture()
    f.pollFeishu.mockResolvedValueOnce({ done: true, kind: 'feishu', appId: 'app1', appSecret: 'SECRET-APP', domain: 'feishu', ownerId: '' })
    const qr = await f.service.handle({ ...f.request, action: 'start' })
    expect(qr.status).toBe('qr')
    const result = await f.service.handle({ ...f.request, action: 'poll', attemptId: qr.status === 'qr' ? qr.attemptId : '' })
    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(f.saved()).toHaveLength(0)
  })
  it('ignores unknown senders, groups and unknown chat types before any runtime request', async () => {
    const f = fixture(), id = await f.connect()
    f.runtimeRequest.mockClear()
    await f.service.feishuInbound(id, f.message({ senderId: 'stranger' }))
    await f.service.feishuInbound(id, f.message({ chatType: 'group' }))
    await f.service.feishuInbound(id, f.message({ chatType: undefined }))
    expect(f.runtimeRequest).not.toHaveBeenCalled()
  })
  it('uses the same room, delivers once, and deduplicates a replay after completion', async () => {
    const f = fixture(), id = await f.connect()
    await f.service.feishuInbound(id, f.message())
    await vi.waitFor(() => expect(f.feishu.sendText).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(f.saved()[0].delivery?.cursor).toBe(12))
    await f.service.feishuInbound(id, f.message())
    expect(f.feishu.sendText).toHaveBeenCalledTimes(1)
    expect(f.runtimeRequest).toHaveBeenCalledWith(expect.anything(), `/v1/rooms/room/im-connections/${id}/messages`, expect.objectContaining({ body: expect.stringContaining('"senderId":"owner"') }))
  })
  it('cancels a successful late provider poll without binding or enabling', async () => {
    const f = fixture()
    let release!: (value: Awaited<ReturnType<typeof f.pollFeishu>>) => void
    f.pollFeishu.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const qr = await f.service.handle({ ...f.request, action: 'start' })
    if (qr.status !== 'qr') throw new Error('no QR')
    const polling = f.service.handle({ ...f.request, action: 'poll', attemptId: qr.attemptId })
    await vi.waitFor(() => expect(f.pollFeishu).toHaveBeenCalled())
    await f.service.handle({ ...f.request, action: 'cancel', attemptId: qr.attemptId })
    release({ done: true, kind: 'feishu', appId: 'app1', appSecret: 'SECRET-APP', domain: 'feishu', ownerId: 'owner' })
    expect(await polling).toEqual({ status: 'cancelled' })
    expect(f.saved()).toHaveLength(0)
  })
  it('cancels during the final credential commit before opening the transport', async () => {
    const f = fixture()
    let release!: () => void, saves = 0
    vi.mocked(f.secureStore.save).mockImplementation(async () => {
      if (++saves === 2) await new Promise<void>((resolve) => { release = resolve })
    })
    const qr = await f.service.handle({ ...f.request, action: 'start' })
    if (qr.status !== 'qr') throw new Error('no QR')
    const polling = f.service.handle({ ...f.request, action: 'poll', attemptId: qr.attemptId })
    await vi.waitFor(() => expect(release).toBeDefined())
    const cancelling = f.service.handle({ ...f.request, action: 'cancel', attemptId: qr.attemptId })
    release()
    await cancelling
    expect(await polling).toEqual({ status: 'cancelled' })
    expect(f.feishu.sync).not.toHaveBeenCalled()
    expect(f.runtimeRequest.mock.calls.some(([, path]) => path.endsWith('/disconnect'))).toBe(true)
  })

  it('cancels while transport connection is still starting and closes inbound admission immediately', async () => {
    const f = fixture()
    let release!: () => void
    f.feishu.sync.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    const qr = await f.service.handle({ ...f.request, action: 'start' })
    if (qr.status !== 'qr') throw new Error('no QR')
    const polling = f.service.handle({ ...f.request, action: 'poll', attemptId: qr.attemptId })
    await vi.waitFor(() => expect(release).toBeDefined())
    await f.service.handle({ ...f.request, action: 'cancel', attemptId: qr.attemptId })
    expect(f.saved()[0].enabled).toBe(false)
    f.runtimeRequest.mockClear()
    await f.service.feishuInbound(f.saved()[0].id, f.message())
    expect(f.runtimeRequest).not.toHaveBeenCalled()
    release()
    expect(await polling).toEqual({ status: 'cancelled' })
  })
  it('does not share an official account with a legacy open channel', async () => {
    const f = fixture()
    f.settings.claw.channels.push({ id: 'old', enabled: true, platformCredential: { kind: 'feishu', appId: 'app1' } } as never)
    const qr = await f.service.handle({ ...f.request, action: 'start' })
    if (qr.status !== 'qr') throw new Error('no QR')
    expect(await f.service.handle({ ...f.request, action: 'poll', attemptId: qr.attemptId })).toMatchObject({ status: 'error', message: expect.stringContaining('already connected') })
    expect(f.saved()).toHaveLength(0)
  })

  it('cleans failed starts instead of exhausting the attempt limit', async () => {
    const f = fixture()
    f.startFeishu.mockRejectedValue(new Error('private-secret-in-provider-error'))
    for (let i = 0; i < 12; i++) expect((await f.service.handle({ ...f.request, cardId: 'card-' + i, action: 'start' })).status).toBe('error')
    expect(f.startFeishu).toHaveBeenCalledTimes(12)
    expect(f.logError).not.toHaveBeenCalled()
  })
  it('allows retry after the OS store is unlocked', async () => {
    const f = fixture()
    vi.mocked(f.secureStore.load).mockRejectedValueOnce(new Error('locked'))
    expect((await f.service.handle({ ...f.request, action: 'status' })).status).toBe('error')
    expect((await f.service.handle({ ...f.request, action: 'start' })).status).toBe('qr')
  })
  it('retains a terminal delivery while more scanned pages remain', async () => {
    const f = fixture(), id = await f.connect()
    f.runtimeRequest.mockImplementation(async (_s, path) => ({ ok: true, status: 200, body: JSON.stringify(path.endsWith('/messages') ? { requestId: 'request-1' } :
      { messages: [], cursor: 100, hasMore: true, attention: [] }) }))
    await f.service.feishuInbound(id, f.message())
    await vi.waitFor(() => expect(f.saved()[0].delivery?.cursor).toBe(100))
    expect(f.saved()[0].delivery).toBeDefined()
  })
  it('recovers a durable cursor on restart and delivers later background replies without a new command', async () => {
    const f = fixture(), id = await f.connect()
    await f.service.feishuInbound(id, f.message())
    await vi.waitFor(() => expect(f.saved()[0].delivery?.cursor).toBe(12))
    await f.service.stop()
    const restarted = fixture({ initial: f.saved() })
    restarted.runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({
      messages: [{ id: 'background-result', text: 'Worker finished', seq: 20 }], cursor: 20, hasMore: false, attention: [] }) })
    await restarted.service.sync(restarted.settings)
    await vi.waitFor(() => expect(restarted.feishu.sendText).toHaveBeenCalledWith(id, 'chat', 'Worker finished'))
    expect(restarted.runtimeRequest.mock.calls[0][1]).toContain('cursor=12')
  })
  it('disconnects admission and drops delivery fetched before disconnect', async () => {
    const f = fixture(), id = await f.connect()
    let release!: (value: { ok: boolean; status: number; body: string }) => void
    f.runtimeRequest.mockImplementation(async (_s, path) => path.includes('/delivery?')
      ? new Promise((resolve) => { release = resolve }) : { ok: true, status: 200, body: JSON.stringify({ requestId: 'request-1' }) })
    await f.service.feishuInbound(id, f.message())
    await vi.waitFor(() => expect(release).toBeDefined())
    await f.service.handle({ ...f.request, action: 'disconnect' })
    release({ ok: true, status: 200, body: JSON.stringify({ messages: [{ id: 'late', text: 'late', seq: 99 }], cursor: 99, hasMore: false, attention: [] }) })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(f.feishu.sendText).not.toHaveBeenCalled()
  })

  it('binds official WeChat owner and never falls through a disconnected known account', async () => {
    const f = fixture({ provider: 'weixin' })
    await f.connect()
    expect(await f.service.weixinInbound({ from_user_id: 'stranger', message_id: '1' }, 'account1')).toBe(true)
    await f.service.handle({ ...f.request, action: 'disconnect' })
    f.runtimeRequest.mockClear()
    expect(await f.service.weixinInbound({ from_user_id: 'owner', message_id: '1' }, 'account1')).toBe(true)
    expect(f.runtimeRequest).not.toHaveBeenCalled()
  })
})
