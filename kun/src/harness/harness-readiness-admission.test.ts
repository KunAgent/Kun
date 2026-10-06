import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { HarnessReadinessService, type HarnessReadinessDeps } from './harness-readiness.js'
import type { ReadinessOptions } from './harness-readiness-profile.js'

const route = { harnessId: 'opencode', credentialMode: 'kun-gateway' as const, providerId: 'account-a', model: 'model-a' }
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture(nowMs?: () => number) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-readiness-test-')); dirs.push(dir)
  const command = join(dir, 'opencode'); await writeFile(command, '#!/bin/sh\nexit 0\n')
  const options: ReadinessOptions = { model: 'model-a', providers: {
    'account-a': { kind: 'http', apiKey: 'secret-a', baseUrl: 'https://api.example.com', models: ['model-a'] },
    'account-b': { kind: 'http', apiKey: 'secret-b', baseUrl: 'https://api.example.com', models: ['model-a'] }
  }, harnesses: HarnessesConfigSchema.parse({ binaryPaths: { opencode: command } }) }
  let revision = 0
  const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses!.enabledProfiles })
  const detector = { status: vi.fn(async (): Promise<HarnessStatus> => ({ harnessId: 'opencode', installed: 'yes' as const, login: 'unknown' as const,
    ready: 'yes' as const, resolvedCommand: command, checkedAt: '2026-10-03T00:00:00.000Z' })) }
  const handshake = vi.fn<NonNullable<HarnessReadinessDeps['handshake']>>(async () => ({ ok: true, supported: true, protocol: 'acp' }))
  const service = new HarnessReadinessService({ options: () => options, catalog, detector, handshake, revision: () => revision, ...(nowMs ? { nowMs } : {}) })
  const test = () => service.test(catalog.get('opencode')!, { level: 'handshake', ...route })
  const enable = () => { options.harnesses!.enabledProfiles = [{ harnessId: route.harnessId, credentialMode: route.credentialMode, providerId: route.providerId }]; revision++ }
  return { options, catalog, detector, handshake, service, test, enable, command, revise: () => revision++ }
}

describe('parallel readiness admission', () => {
  it('admits parallel turns for the same unchanged profile and model', async () => {
    const f = await fixture(); f.enable()
    const finishes: Array<() => void> = []
    f.handshake.mockImplementation(() => new Promise((resolve) => {
      finishes.push(() => resolve({ ok: true, supported: true, protocol: 'acp' }))
    }))
    const signal = new AbortController().signal
    const signature = f.service.configurationSignature(route)
    const admissions = Promise.allSettled([
      f.service.prepareTurn('thread-a', 'turn', route, signature, signal),
      f.service.prepareTurn('thread-b', 'turn', route, signature, signal)
    ])
    await vi.waitFor(() => expect(finishes).toHaveLength(2))
    finishes.forEach((finish) => finish())
    expect(await admissions).toEqual([{ status: 'fulfilled', value: undefined }, { status: 'fulfilled', value: undefined }])
    await expect(f.service.validateTurn('thread-a', 'turn', signal)).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(f.service.validateTurn('thread-b', 'turn', signal)).resolves.toMatch(/^[a-f0-9]{64}$/)
  })
  it('reuses an unexpired unchanged proof for later admissions without a new handshake', async () => {
    const f = await fixture(); f.enable()
    const signal = new AbortController().signal
    const signature = f.service.configurationSignature(route)
    await f.service.prepareTurn('thread-a', 'turn', route, signature, signal)
    expect(f.handshake).toHaveBeenCalledTimes(1)
    await f.service.prepareTurn('thread-b', 'turn', route, signature, signal)
    await f.service.prepareTurn('thread-c', 'turn', route, signature, signal)
    expect(f.handshake).toHaveBeenCalledTimes(1)
    await expect(f.service.validateTurn('thread-c', 'turn', signal)).resolves.toMatch(/^[a-f0-9]{64}$/)
  })
  it('re-checks instead of reusing a proof after a configuration revision or an identity change', async () => {
    const f = await fixture(); f.enable()
    const signal = new AbortController().signal
    await f.service.assertReady(route, signal)
    f.revise()
    await f.service.assertReady(route, signal)
    expect(f.handshake).toHaveBeenCalledTimes(2)
    f.options.providers!['account-a'].apiKey = 'rotated'
    await f.service.assertReady(route, signal)
    expect(f.handshake).toHaveBeenCalledTimes(3)
  })
  it('keeps an admitted turn valid while another unchanged admission is checking', async () => {
    let clock = 1_000_000
    const f = await fixture(() => clock); f.enable()
    const signal = new AbortController().signal
    const signature = f.service.configurationSignature(route)
    await f.service.prepareTurn('thread-a', 'turn', route, signature, signal)
    // Nearly expired: the next admission re-validates instead of reusing.
    clock += 5 * 60_000 - 5_000
    let finish!: () => void
    f.handshake.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ ok: true, supported: true, protocol: 'acp' })
    }))
    const admission = f.service.prepareTurn('thread-b', 'turn', route, signature, signal)
    await vi.waitFor(() => expect(finish).toBeDefined())
    const validation = await Promise.allSettled([f.service.validateTurn('thread-a', 'turn', signal)])
    finish(); await admission
    expect(validation).toEqual([{ status: 'fulfilled', value: expect.any(String) }])
  })
  it('keeps different models independently valid without duplicating their enabled profile', async () => {
    const f = await fixture(); f.enable()
    f.options.providers!['account-a'].models = ['model-a', 'model-b']
    const other = { ...route, model: 'model-b' }
    const signal = new AbortController().signal
    await Promise.all([
      f.service.prepareTurn('thread-a', 'turn', route, f.service.configurationSignature(route), signal),
      f.service.prepareTurn('thread-b', 'turn', other, f.service.configurationSignature(other), signal)
    ])
    await expect(f.service.validateTurn('thread-a', 'turn', signal, route)).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(f.service.validateTurn('thread-b', 'turn', signal, other)).resolves.toMatch(/^[a-f0-9]{64}$/)
    expect(await f.service.readyProfiles('opencode')).toHaveLength(1)
  })
  it('does not let one cancelled admission cancel or grant another admission', async () => {
    const f = await fixture(); f.enable()
    const finishes: Array<() => void> = []
    f.handshake.mockImplementation(() => new Promise((resolve) => {
      finishes.push(() => resolve({ ok: true, supported: true, protocol: 'acp' }))
    }))
    const controller = new AbortController()
    const cancelled = Promise.allSettled([f.service.assertReady(route, controller.signal)])
    const accepted = f.service.assertReady(route)
    await vi.waitFor(() => expect(finishes).toHaveLength(2))
    controller.abort(new Error('cancelled admission'))
    expect(await cancelled).toEqual([{ status: 'rejected', reason: expect.any(Error) }])
    finishes[0]!()
    expect(await f.service.readyProfiles('opencode')).toEqual([])
    finishes[1]!()
    await expect(accepted).resolves.toMatch(/^[a-f0-9]{64}$/)
    expect(await f.service.readyProfiles('opencode')).toHaveLength(1)
  })
  it('revokes prior proofs on a failed fresh admission and fences older pending success', async () => {
    let clock = 1_000_000
    const f = await fixture(() => clock); f.enable()
    const signal = new AbortController().signal
    await f.service.prepareTurn('thread', 'turn', route, f.service.configurationSignature(route), signal)
    clock += 5 * 60_000 - 5_000
    let finish!: () => void
    f.handshake.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ ok: true, supported: true, protocol: 'acp' })
    }))
    const older = Promise.allSettled([f.service.assertReady(route)])
    await vi.waitFor(() => expect(finish).toBeDefined())
    f.handshake.mockResolvedValueOnce({ ok: false, supported: true, protocol: 'acp', detail: 'Runtime rejected handshake' })
    await expect(f.service.assertReady(route)).rejects.toThrow('Runtime rejected handshake')
    finish()
    expect(await older).toEqual([{ status: 'rejected', reason: expect.any(Error) }])
    expect(await f.service.readyProfiles('opencode')).toEqual([])
    await expect(f.service.validateTurn('thread', 'turn', signal)).rejects.toThrow('changed before launch')
  })
  it.each(['disable', 'disable-reenable', 'credential-edit', 'explicit-test'] as const)(
    'keeps the %s fence while parallel admissions are pending', async (change) => {
      const f = await fixture(); f.enable()
      const finishes: Array<() => void> = []
      f.handshake.mockImplementation(() => new Promise((resolve) => {
        finishes.push(() => resolve({ ok: true, supported: true, protocol: 'acp' }))
      }))
      const admissions = Promise.allSettled([f.service.assertReady(route), f.service.assertReady(route)])
      await vi.waitFor(() => expect(finishes).toHaveLength(2))
      if (change === 'disable' || change === 'disable-reenable') {
        f.options.harnesses!.enabledProfiles = []; f.revise()
        if (change === 'disable-reenable') f.enable()
      } else if (change === 'credential-edit') {
        f.options.providers!['account-a'].apiKey = 'rotated'
      } else {
        const controller = new AbortController(); controller.abort()
        expect((await f.service.test(f.catalog.get('opencode')!, { level: 'handshake', ...route }, controller.signal)).ok).toBe(false)
      }
      finishes.forEach((finish) => finish())
      expect(await admissions).toEqual([
        { status: 'rejected', reason: expect.any(Error) }, { status: 'rejected', reason: expect.any(Error) }
      ])
      expect(await f.service.readyProfiles('opencode')).toEqual([])
    })
  it('does not replace a proof during another turn final credential validation', async () => {
    const f = await fixture(); f.enable()
    f.options.providers!['account-a'].credentialSourceId = 'credential-ref'
    const resolveProviderCredential = vi.fn(async (): Promise<{ apiKey: string } | null> => ({ apiKey: 'selected-secret' }))
    const service = new HarnessReadinessService({ options: () => f.options, catalog: f.catalog, detector: f.detector,
      handshake: f.handshake, resolveProviderCredential })
    const signal = new AbortController().signal
    const signature = service.configurationSignature(route)
    await service.prepareTurn('thread-a', 'turn', route, signature, signal)
    let finish!: (value: { apiKey: string }) => void
    resolveProviderCredential.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const validation = service.validateTurn('thread-a', 'turn', signal)
    await vi.waitFor(() => expect(finish).toBeDefined())
    await service.prepareTurn('thread-b', 'turn', route, signature, signal)
    finish({ apiKey: 'selected-secret' })
    await expect(validation).resolves.toMatch(/^[a-f0-9]{64}$/)
  })
  it('does not let background warming invalidate a different model launch', async () => {
    const f = await fixture(); f.enable()
    f.options.providers!['account-a'].models = ['model-a', 'model-b']
    const other = { ...route, model: 'model-b' }
    const signal = new AbortController().signal
    await f.service.prepareTurn('thread', 'turn', other, f.service.configurationSignature(other), signal)
    f.service.warmProfiles('opencode')
    await vi.waitFor(() => expect(f.service.checking('opencode')).toBe(false))
    await expect(f.service.validateTurn('thread', 'turn', signal, other)).resolves.toMatch(/^[a-f0-9]{64}$/)
  })
  it('keeps the system-native route separate from a named Settings default', async () => {
    const f = await fixture()
    const native = { harnessId: 'claude-code', credentialMode: 'native-login' as const, model: 'default' }
    f.options.providers!['subscription-account'] = { kind: 'agent-sdk', apiKey: 'named-token' }
    f.options.harnesses!.defaults = { 'claude-code': { ...native, providerId: 'subscription-account' } }
    f.options.harnesses!.enabledProfiles = [{ harnessId: 'claude-code', credentialMode: 'native-login' }]
    f.detector.status.mockResolvedValue({ harnessId: 'claude-code', installed: 'yes', login: 'signed-in',
      resolvedCommand: f.command, checkedAt: '2026-10-03T00:00:00.000Z' })
    expect(f.service.route(f.catalog.get('claude-code')!, native)).toEqual(native)
    const signal = new AbortController().signal
    const explicitDefault = { ...native, providerId: 'default' }
    expect(f.service.configurationSignature(explicitDefault)).toBe(f.service.configurationSignature(native))
    await Promise.all([
      f.service.prepareTurn('thread', 'turn', native, f.service.configurationSignature(native), signal),
      f.service.prepareTurn('thread-default', 'turn', explicitDefault, f.service.configurationSignature(explicitDefault), signal)
    ])
    expect(f.handshake.mock.calls[0]?.[2].CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    await expect(f.service.validateTurn('thread', 'turn', signal, explicitDefault)).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(f.service.validateTurn('thread-default', 'turn', signal, native)).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(f.service.assertReady({ ...native, providerId: 'subscription-account' })).rejects.toThrow('disabled')
  })
})
