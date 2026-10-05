import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { nativeAgentNetworkEnv, nativeAgentNetworkStatus } from './native-agent-network.js'
import { RuntimeConfigApplyRequest } from '../contracts/runtime-config.js'
import { KunConfigSchema } from '../config/kun-config.js'
import type { NativeAgentNetworkSnapshot } from '../contracts/native-agent-network.js'
import { AgentSdkModelProbe } from './agent-sdk-model-probe.js'
import type { SdkApi } from '../runtime/agent-sdk/sdk-protocol.js'
import { checkHarnessAdmission } from './harness-admission.js'

afterEach(() => vi.unstubAllEnvs())
const snapshot = { codex: { source: 'system', proxyUrl: 'http://proxy.invalid:7890/' },
  antigravity: { source: 'system', proxyUrl: 'http://proxy.invalid:7890/' },
  'claude-code': { source: 'system', proxyUrl: 'http://proxy.invalid:7890/' } } as const
const codex = () => new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => snapshot }).get('codex')!

describe('runtime-only native Agent network selection', () => {
  it('applies the desktop proxy only to the native Antigravity CLI definition', () => {
    const definition = new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => snapshot }).get('antigravity')!
    expect(nativeAgentNetworkEnv(definition, {}).HTTPS_PROXY).toBe(snapshot.antigravity.proxyUrl)
    expect(JSON.stringify(definition)).not.toContain('proxy.invalid')
    expect(nativeAgentNetworkEnv({ ...definition, id: 'custom' }, {})).toEqual({})
  })
  it('carries policy through a private definition clone without serializing its address', () => {
    const original = codex()
    const clone = { ...original, launch: { ...original.launch!, command: '/other/codex' } }
    expect(nativeAgentNetworkEnv(clone, {}).HTTPS_PROXY).toBe(snapshot.codex.proxyUrl)
    expect(nativeAgentNetworkStatus(clone, {}).networkSource).toBe('system')
    expect(JSON.stringify(clone)).not.toContain('proxy.invalid')
    expect(JSON.stringify(nativeAgentNetworkStatus(clone, {}))).not.toContain('proxy.invalid')
    expect(nativeAgentNetworkEnv({ ...clone, transport: 'acp' }, {})).toEqual({})
  })

  it('does not apply a native system rule to a custom/other agent or an ACP transport pin', () => {
    const catalog = new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => snapshot,
      transportOverrides: () => ({ codex: 'acp' }) })
    expect(nativeAgentNetworkEnv(catalog.get('codex'), {})).toEqual({})
    expect(nativeAgentNetworkEnv(catalog.get('opencode'), {})).toEqual({})
  })

  it('keeps explicit process, launch, and secret env authoritative, including explicit empty strings', () => {
    expect(nativeAgentNetworkEnv(codex(), { HTTPS_PROXY: 'http://explicit.invalid:8080' })).toEqual({})
    expect(nativeAgentNetworkEnv(codex(), {}, { https_proxy: '' })).toEqual({})
    const launch = { ...codex(), launch: { ...codex().launch!, env: { ALL_PROXY: 'socks5://custom.invalid:1080' } } }
    expect(nativeAgentNetworkEnv(launch, {})).toEqual({})
  })

  it('preserves bypass rules and always keeps system proxy away from local authenticated services', () => {
    const env = nativeAgentNetworkEnv(codex(), { NO_PROXY: 'private.test', no_proxy: 'other.test' })
    expect(env.NO_PROXY).toBe('private.test,other.test,localhost,127.0.0.1,::1,[::1]')
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it('changes opaque fingerprint on a hot policy change and refuses unrepresentable policy', () => {
    let policy: NativeAgentNetworkSnapshot = snapshot
    const catalog = new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => policy })
    const before = nativeAgentNetworkStatus(catalog.get('codex')!, {}).networkFingerprint
    policy = { codex: { source: 'explicit-required' } }
    const def = catalog.get('codex')!
    expect(nativeAgentNetworkStatus(def, {}).networkFingerprint).not.toBe(before)
    expect(() => nativeAgentNetworkEnv(def, {})).toThrow('Configure explicit proxy environment')
    expect(nativeAgentNetworkEnv(def, { HTTPS_PROXY: 'http://explicit.invalid:8080' })).toEqual({})
  })

  it('invalidates the opaque connection identity when launch arguments change', () => {
    const def = new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => snapshot }).get('codex')!
    const before = nativeAgentNetworkStatus(def, {}).networkFingerprint
    const changed = { ...def, launch: { ...def.launch!, args: ['app-server', '--config', 'updated'] } }
    expect(nativeAgentNetworkStatus(changed, {}).networkFingerprint).not.toBe(before)
    expect(JSON.stringify(nativeAgentNetworkStatus(changed, {}))).not.toContain('updated')
  })

  it('accepts the field only at the in-memory apply boundary, not the persisted config', () => {
    expect(RuntimeConfigApplyRequest.parse({ nativeAgentNetwork: snapshot }).nativeAgentNetwork).toEqual(snapshot)
    expect(KunConfigSchema.safeParse({ nativeAgentNetwork: snapshot }).success).toBe(false)
  })

  it('rejects native automatic dispatch on unresolved policy but permits an explicit gateway route', () => {
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(name, undefined)
    const harness = new HarnessCatalog({ custom: () => [],
      nativeAgentNetwork: () => ({ 'claude-code': { source: 'explicit-required' } }) }).get('claude-code')!
    const input = { usage: 'manager-worker' as const, harness, effective: harness.capabilities,
      status: { harnessId: harness.id, installed: 'yes' as const, login: 'signed-in' as const,
        checkedAt: '2026-09-30T00:00:00.000Z' }, workspace: { isolated: true },
      unattended: true, allowUnattendedFullAccess: false }
    expect(checkHarnessAdmission({ ...input, credentialMode: 'native-login' })).toMatchObject({
      ok: false, code: 'harness_not_ready', message: expect.stringContaining('proxy environment')
    })
    expect(checkHarnessAdmission({ ...input, credentialMode: 'kun-gateway' }).ok).toBe(true)
  })

  it('uses the same policy for Claude model probes and invalidates the model cache on change', async () => {
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(name, undefined)
    let policy: NativeAgentNetworkSnapshot = snapshot
    const catalog = new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => policy })
    const query = vi.fn((_input: unknown) => ({ supportedModels: async () => [{ value: 'test-model' }], close: vi.fn() }))
    const probe = new AgentSdkModelProbe({ loadSdk: async () => ({ query }) as unknown as SdkApi })
    await probe.probe(catalog.get('claude-code')!)
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({
      env: expect.objectContaining({ HTTPS_PROXY: snapshot['claude-code'].proxyUrl })
    }) }))
    policy = { 'claude-code': { source: 'direct' } }
    await probe.probe(catalog.get('claude-code')!)
    expect(query).toHaveBeenCalledTimes(2)
  })
})
