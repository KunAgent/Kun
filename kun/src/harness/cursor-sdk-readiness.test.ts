import { describe, expect, it, vi } from 'vitest'
import { probeCursorSdkReadiness } from './cursor-sdk-readiness.js'
import { HarnessReadinessService } from './harness-readiness.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'

const api = vi.hoisted(() => ({ create: vi.fn(), resume: vi.fn(), store: vi.fn(), installation: vi.fn(async () => '1.0.24') }))
vi.mock('@cursor/sdk', () => ({ Agent: { create: api.create, resume: api.resume }, JsonlLocalAgentStore: api.store }))
vi.mock('./cursor-sdk-installation.js', () => ({ checkCursorSdkInstallation: api.installation }))

describe('Cursor SDK local readiness', () => {
  it('loads the required API without creating an agent, store, or remote request', async () => {
    const result = await probeCursorSdkReadiness(new AbortController().signal)
    expect(result).toMatchObject({ ok: true, supported: false, protocol: 'cursor-sdk-local-api', authentication: 'unverified' })
    expect(result.detail).toContain('no wire handshake')
    expect(api.create).not.toHaveBeenCalled()
    expect(api.resume).not.toHaveBeenCalled()
    expect(api.store).not.toHaveBeenCalled()
  })

  it('rejects an incomplete installed SDK contract', async () => {
    const result = await probeCursorSdkReadiness(new AbortController().signal,
      { loadSdk: async () => ({ Agent: { create: () => undefined } }) })
    expect(result.ok).toBe(false)
  })

  it('cancels a pending import without accepting its later success', async () => {
    const controller = new AbortController()
    const pending = probeCursorSdkReadiness(controller.signal, { loadSdk: () => new Promise(() => {}) })
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('fails closed when SDK import or required native helpers are broken', async () => {
    await expect(probeCursorSdkReadiness(new AbortController().signal, {
      loadSdk: async () => { throw new Error('missing SDK') }
    })).rejects.toThrow('missing SDK')
    await expect(probeCursorSdkReadiness(new AbortController().signal, {
      checkInstallation: async () => { throw new Error('missing native helper') }
    })).rejects.toThrow('missing native helper')
  })

  it('admits only a configured exact Cursor provider without claiming authentication', async () => {
    const profile = { harnessId: 'cursor', credentialMode: 'provider' as const, providerId: 'cursor-account' }
    const options = { providers: {
      'cursor-account': { kind: 'cursor-sdk' as const, apiKey: 'test-key', models: ['auto'] },
      'http-account': { kind: 'http' as const, apiKey: 'unrelated-key', models: ['auto'] }
    }, harnesses: HarnessesConfigSchema.parse({ enabledProfiles: [profile] }) }
    const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses.enabledProfiles })
    const service = new HarnessReadinessService({ options: () => options, catalog,
      detector: { status: async () => ({ harnessId: 'cursor', installed: 'yes', login: 'unknown', checkedAt: '2026-10-03T00:00:00.000Z' }) } })
    const result = await service.test(catalog.get('cursor')!, { level: 'handshake', ...profile, model: 'auto' })
    expect(result.ok).toBe(true)
    expect(result.readiness?.authentication).toBe('unverified')
    expect(result.handshake?.supported).toBe(false)
    expect((await service.test(catalog.get('cursor')!, {
      level: 'handshake', ...profile, model: 'not-configured'
    })).ok).toBe(false)
    expect((await service.test(catalog.get('cursor')!, {
      level: 'handshake', ...profile, providerId: 'http-account', model: 'auto'
    })).ok).toBe(false)
    api.installation.mockRejectedValueOnce(new Error('private installation path'))
    const broken = await service.test(catalog.get('cursor')!, { level: 'handshake', ...profile, model: 'auto' })
    expect(broken.ok).toBe(false)
    expect(JSON.stringify(broken)).not.toContain('private installation path')
    options.providers['cursor-account'].apiKey = ''
    expect((await service.test(catalog.get('cursor')!, { level: 'handshake', ...profile, model: 'auto' })).ok).toBe(false)
    await expect(service.assertReady({ ...profile, providerId: 'unenabled', model: 'auto' })).rejects.toThrow('disabled')
  })
})
