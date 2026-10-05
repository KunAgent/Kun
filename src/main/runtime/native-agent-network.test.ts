import { describe, expect, it, vi } from 'vitest'
import { resolveNativeAgentNetworkSnapshot, refreshNativeAgentNetworkBeforeProbe } from './native-agent-network'
import { NATIVE_AGENT_NETWORK_ENV, consumeNativeAgentNetworkEnvironment } from '../../../kun/src/contracts/native-agent-network.js'

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } } }))

describe('desktop native Agent network policy', () => {
  it('uses known native destinations and preserves a uniform HTTP proxy', async () => {
    const resolver = vi.fn(async () => 'PROXY 127.0.0.1:7890; DIRECT')
    expect(await resolveNativeAgentNetworkSnapshot(resolver)).toEqual({
      installer: { source: 'system', proxyUrl: 'http://127.0.0.1:7890/' },
      codex: { source: 'system', proxyUrl: 'http://127.0.0.1:7890/' },
      antigravity: { source: 'system', proxyUrl: 'http://127.0.0.1:7890/' },
      'claude-code': { source: 'system', proxyUrl: 'http://127.0.0.1:7890/' }
    })
    expect(resolver.mock.calls).toHaveLength(16)
  })

  it('refuses to flatten per-destination rules and leaves direct PAC first choices direct', async () => {
    expect(await resolveNativeAgentNetworkSnapshot(async (url) =>
      url.includes('chatgpt.com') ? 'PROXY 127.0.0.1:7890' : 'DIRECT; PROXY 127.0.0.1:7890'
    )).toEqual({ installer: { source: 'direct' }, codex: { source: 'explicit-required' }, antigravity: { source: 'direct' }, 'claude-code': { source: 'direct' } })
  })

  it.each(['SOCKS5 127.0.0.1:1080', 'PROXY user:secret@proxy.invalid:8080', 'INVALID'])(
  'does not guess unsupported or authenticated system policy: %s', async (rule) => {
    const snapshot = await resolveNativeAgentNetworkSnapshot(async () => rule)
    expect(snapshot).toEqual({ installer: { source: 'explicit-required' }, codex: { source: 'explicit-required' },
      antigravity: { source: 'explicit-required' },
      'claude-code': { source: 'explicit-required' } })
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('removes private startup data before other children can inherit it', () => {
    const env = { [NATIVE_AGENT_NETWORK_ENV]: JSON.stringify({ codex: { source: 'direct' } }), PATH: '/bin' }
    expect(consumeNativeAgentNetworkEnvironment(env)).toEqual({ codex: { source: 'direct' } })
    expect(env).toEqual({ PATH: '/bin' })
    const malformed = { [NATIVE_AGENT_NETWORK_ENV]: 'private-invalid-value' }
    expect(() => consumeNativeAgentNetworkEnvironment(malformed)).toThrow('Invalid native Agent network launch policy')
    expect(malformed).toEqual({})
  })

  it('refreshes only explicit native connection actions through the owned runtime', async () => {
    const send = vi.fn(async (_body: string) => ({ ok: true, status: 200 }))
    await refreshNativeAgentNetworkBeforeProbe('/v1/harnesses', 'GET', send)
    await refreshNativeAgentNetworkBeforeProbe('/v1/harnesses/opencode/probe', 'POST', send)
    expect(send).not.toHaveBeenCalled()
    await refreshNativeAgentNetworkBeforeProbe('/v1/harnesses/codex/probe', 'POST', send)
    expect(JSON.parse(send.mock.calls[0]![0])).toEqual({ nativeAgentNetwork: {
      installer: { source: 'direct' }, codex: { source: 'direct' }, antigravity: { source: 'direct' }, 'claude-code': { source: 'direct' }
    } })
    await refreshNativeAgentNetworkBeforeProbe('/v1/harnesses/antigravity/test', 'POST', send)
    await refreshNativeAgentNetworkBeforeProbe('/v1/harnesses/claude-code/updates/start', 'POST', send)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('fails a rejected refresh explicitly and tolerates an old runtime without the endpoint', async () => {
    await expect(refreshNativeAgentNetworkBeforeProbe('/v1/harnesses/claude-code/test', 'POST',
      async () => ({ ok: false, status: 500 }))).rejects.toThrow('could not be refreshed')
    await expect(refreshNativeAgentNetworkBeforeProbe('/v1/harnesses/claude-code/test', 'POST',
      async () => ({ ok: false, status: 404 }))).resolves.toBeUndefined()
  })
})
