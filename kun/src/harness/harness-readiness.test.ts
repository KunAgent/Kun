import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { HarnessReadinessService, type HarnessReadinessDeps } from './harness-readiness.js'
import { harnessProfileKey, type ReadinessOptions } from './harness-readiness-profile.js'

const route = { harnessId: 'opencode', credentialMode: 'kun-gateway' as const, providerId: 'account-a', model: 'model-a' }
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
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
  const service = new HarnessReadinessService({ options: () => options, catalog, detector, handshake, revision: () => revision })
  const test = () => service.test(catalog.get('opencode')!, { level: 'handshake', ...route })
  const enable = () => { options.harnesses!.enabledProfiles = [{ harnessId: route.harnessId, credentialMode: route.credentialMode, providerId: route.providerId }]; revision++ }
  return { options, catalog, detector, handshake, service, test, enable, command, revise: () => revision++ }
}

describe('explicit per-profile readiness', () => {
  it('defaults all external profiles off, including installed ones and legacy native profiles', async () => {
    const f = await fixture()
    expect(f.catalog.isDisabled('opencode')).toBe(true)
    expect(f.catalog.isProfileEnabled(route)).toBe(false)
    await expect(f.service.assertReady(route)).rejects.toThrow('disabled')
    expect(f.detector.status).not.toHaveBeenCalled()
  })
  it('only an exact opted-in profile may launch; configured key never claims validated auth or quota', async () => {
    const f = await fixture(); const tested = await f.test()
    expect(tested.ok).toBe(true)
    expect(tested.readiness?.authentication).toBe('unverified')
    f.enable()
    expect(await f.service.readyProfiles('opencode')).toEqual([expect.objectContaining({ providerId: 'account-a', expiresAt: expect.any(String) })])
    await expect(f.service.assertReady({ ...route, providerId: 'account-b' })).rejects.toThrow('disabled')
    await expect(f.service.assertReady(route)).resolves.toMatch(/^[a-f0-9]{64}$/)
    expect(f.handshake).toHaveBeenCalledTimes(2)
  })
  it('does not infer native authentication from initialize, authMethods or an arbitrary model list', async () => {
    const f = await fixture()
    const definition = f.catalog.get('opencode')!
    // This negative case must not consume the developer's real OAuth account.
    vi.spyOn(f.catalog, 'get').mockReturnValue({ ...definition,
      launch: { ...definition.launch!, env: { XDG_DATA_HOME: dirname(f.command) } } })
    const result = await f.service.test(f.catalog.get('opencode')!, { level: 'handshake', credentialMode: 'native-login' })
    expect(result.ok).toBe(false)
    expect(result.readiness?.checks.find((check) => check.id === 'credentials')?.ok).toBe(false)
  })
  it('rejects a missing provider, missing credential, incompatible model, and failed handshake', async () => {
    const f = await fixture()
    expect((await f.service.test(f.catalog.get('opencode')!, { level: 'handshake', ...route, model: 'invented' })).ok).toBe(false)
    f.options.providers!['account-a'].apiKey = ''
    expect((await f.test()).ok).toBe(false)
    f.options.providers!['account-a'].apiKey = 'secret-a'
    f.handshake.mockResolvedValueOnce({ ok: false, supported: true, protocol: 'acp' })
    expect((await f.test()).ok).toBe(false)
  })
  it('rejects credential edits while a check is pending and never caches their old result', async () => {
    const f = await fixture(); f.enable()
    let finish!: (value: { ok: boolean; supported: boolean; protocol: string }) => void
    f.handshake.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const checking = f.test()
    await vi.waitFor(() => expect(finish).toBeDefined())
    f.options.providers!['account-a'].apiKey = 'rotated'
    finish({ ok: true, supported: true, protocol: 'acp' })
    expect((await checking).ok).toBe(false)
    expect(await f.service.readyProfiles('opencode')).toEqual([])
  })
  it('fences disable/re-enable ABA and superseding checks with runtime revisions', async () => {
    const f = await fixture(); f.enable()
    let finish!: (value: { ok: boolean; supported: boolean; protocol: string }) => void
    f.handshake.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const checking = f.test(); await vi.waitFor(() => expect(finish).toBeDefined())
    f.options.harnesses!.enabledProfiles = []; f.revise(); f.enable()
    finish({ ok: true, supported: true, protocol: 'acp' })
    expect((await checking).ok).toBe(false)
    expect(await f.service.readyProfiles('opencode')).toEqual([])
  })
  it('cancels finitely, ignores late success, and does not infer', async () => {
    const f = await fixture(); const controller = new AbortController()
    let finish!: (value: { ok: boolean; supported: boolean; protocol: string }) => void
    f.handshake.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const checking = f.service.test(f.catalog.get('opencode')!, { level: 'handshake', ...route }, controller.signal)
    await vi.waitFor(() => expect(finish).toBeDefined()); controller.abort()
    expect((await checking).ok).toBe(false)
    finish({ ok: true, supported: true, protocol: 'acp' }); f.enable()
    expect(await f.service.readyProfiles('opencode')).toEqual([])
  })
  it('invalidates a proof when a same-path binary changes and prevents post-setup launch', async () => {
    const f = await fixture(); f.enable()
    await f.service.prepareTurn('thread', 'turn', route, f.service.configurationSignature(route), new AbortController().signal)
    await writeFile(f.command, '#!/bin/sh\n# replaced same version\nexit 0\n')
    expect(await f.service.readyProfiles('opencode')).toEqual([])
    await expect(f.service.validateTurn('thread', 'turn', new AbortController().signal)).rejects.toThrow('readiness proof')
  })
  it('keeps native profile keys independent from provider labels and separates provider accounts', () => {
    expect(harnessProfileKey({ ...route, providerId: 'default', credentialMode: 'native-login' })).toBe('["opencode","native-login",""]')
    expect(harnessProfileKey({ ...route, credentialMode: 'native-login' })).not.toBe(harnessProfileKey({ ...route, credentialMode: 'native-login', providerId: 'account-b' }))
    expect(harnessProfileKey(route)).not.toBe(harnessProfileKey({ ...route, providerId: 'account-b' }))
  })
})

it('rechecks persisted enabled profiles after a runtime restart without creating an inference turn', async () => {
  const f = await fixture(); f.enable()
  expect(await f.service.readyProfiles('opencode')).toEqual([])
  f.service.warmProfiles('opencode')
  await vi.waitFor(async () => expect(await f.service.readyProfiles('opencode')).toHaveLength(1))
  expect(f.handshake).toHaveBeenCalledTimes(1)
  expect(f.handshake.mock.calls[0]?.[0]).toMatchObject({ id: 'opencode' })
})

it('keeps a default native opt-in from authorizing a named native account', async () => {
  const f = await fixture()
  f.options.harnesses!.enabledProfiles = [{ harnessId: 'claude-code', credentialMode: 'native-login' }]
  const named = { harnessId: 'claude-code', credentialMode: 'native-login' as const, providerId: 'subscription-account', model: 'default' }
  expect(f.catalog.isProfileEnabled(named)).toBe(false)
  await expect(f.service.assertReady(named)).rejects.toThrow('disabled')
})

it('rejects an unrelated configured provider at native readiness even when its profile was opted in', async () => {
  const f = await fixture()
  const incompatible = { harnessId: 'codex', credentialMode: 'native-login' as const,
    providerId: 'account-a', model: 'default' }
  f.options.harnesses!.enabledProfiles = [incompatible]
  const result = await f.service.test(f.catalog.get('codex')!, { level: 'handshake', ...incompatible })
  expect(result.ok).toBe(false)
  expect(result.readiness?.checks.find((check) => check.id === 'configuration')).toMatchObject({
    ok: false, detail: 'Native login cannot use an unrelated provider profile'
  })
  await expect(f.service.assertReady(incompatible)).rejects.toThrow('unrelated provider profile')
  expect(await f.service.readyProfiles('codex')).toEqual([])
  expect(f.handshake).not.toHaveBeenCalled()
})

it('rejects an authoritative native model mismatch without sending a prompt', async () => {
  const f = await fixture()
  f.detector.status.mockResolvedValue({ harnessId: 'opencode', installed: 'yes', ready: 'yes', login: 'signed-in',
    resolvedCommand: f.command, checkedAt: '2026-10-03T00:00:00.000Z' })
  f.handshake.mockResolvedValue({ ok: true, supported: true, protocol: 'acp', models: ['actual-model'] })
  const result = await f.service.test(f.catalog.get('opencode')!, { level: 'handshake', credentialMode: 'native-login', model: 'made-up-model' })
  expect(result.readiness?.checks.find((check) => check.id === 'protocol')?.ok).toBe(false)
  expect(result.ok).toBe(false)
})

it('validates the actual acting route and pins the checked executable before launch', async () => {
  const f = await fixture(); f.enable()
  const signal = new AbortController().signal
  await f.service.prepareTurn('thread', 'turn', route, f.service.configurationSignature(route), signal)
  expect(f.service.commandForTurn('thread', 'turn')).toBe(f.command)
  await expect(f.service.validateTurn('thread', 'turn', signal, { ...route, providerId: 'account-b' })).rejects.toThrow('does not match')
})

it('cancels a stalled secret lookup at the final launch boundary', async () => {
  const f = await fixture(); f.enable()
  f.options.providers!['account-a'].credentialSourceId = 'credential-ref'
  const resolveProviderCredential = vi.fn(async (): Promise<{ apiKey: string } | null> => ({ apiKey: 'selected-secret' }))
  const service = new HarnessReadinessService({ options: () => f.options, catalog: f.catalog, detector: f.detector,
    handshake: f.handshake, resolveProviderCredential })
  await service.prepareTurn('thread', 'turn', route, service.configurationSignature(route), new AbortController().signal)
  resolveProviderCredential.mockImplementation(() => new Promise(() => {}))
  const controller = new AbortController()
  const validation = service.validateTurn('thread', 'turn', controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(validation).rejects.toThrow('cancelled')
})

it('rejects disable/re-enable during final asynchronous credential validation', async () => {
  const f = await fixture(); f.enable()
  f.options.providers!['account-a'].credentialSourceId = 'credential-ref'
  let revision = 0
  const resolveProviderCredential = vi.fn(async (): Promise<{ apiKey: string } | null> => ({ apiKey: 'selected-secret' }))
  const service = new HarnessReadinessService({ options: () => f.options, catalog: f.catalog, detector: f.detector,
    handshake: f.handshake, resolveProviderCredential, revision: () => revision })
  const signal = new AbortController().signal
  await service.prepareTurn('thread', 'turn', route, service.configurationSignature(route), signal)
  let finish!: (value: { apiKey: string }) => void
  resolveProviderCredential.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const validation = service.validateTurn('thread', 'turn', signal)
  await vi.waitFor(() => expect(finish).toBeDefined())
  f.options.harnesses!.enabledProfiles = []; revision++
  f.enable(); revision++
  finish({ apiKey: 'selected-secret' })
  await expect(validation).rejects.toThrow('changed during launch validation')
})

it('detects native profile file A-to-B-to-A edits during a handshake', async () => {
  const f = await fixture()
  const profilePath = join(dirname(f.command), 'opencode.json')
  await writeFile(profilePath, '{"model":"a"}')
  const original = f.catalog.get('opencode')!
  const definition = { ...original, launch: { ...original.launch!, env: { ...original.launch?.env, OPENCODE_CONFIG: profilePath } } }
  const get = f.catalog.get.bind(f.catalog)
  vi.spyOn(f.catalog, 'get').mockImplementation((id) => id === 'opencode' ? definition : get(id))
  f.handshake.mockImplementationOnce(async () => {
    await writeFile(profilePath, '{"model":"b"}')
    await writeFile(profilePath, '{"model":"a"}')
    // Deterministic even on low timestamp-resolution filesystems.
    await utimes(profilePath, new Date('2025-01-01'), new Date('2025-01-01'))
    return { ok: true, supported: true, protocol: 'acp' }
  })
  const result = await f.test()
  expect(result.ok).toBe(false)
  expect(result.readiness?.detail).toContain('changed')
  expect(await f.service.readyProfiles('opencode')).toEqual([])
})

it('requires a reported catalog for an explicit native model even when account status is known', async () => {
  const f = await fixture()
  f.handshake.mockResolvedValue({ ok: true, supported: true, protocol: 'codex-app-server', authentication: 'verified' })
  const result = await f.service.test(f.catalog.get('codex')!, { level: 'handshake', credentialMode: 'native-login', model: 'invented-native-model' })
  expect(result.readiness?.checks.find((check) => check.id === 'protocol')?.ok).toBe(false)
  expect(result.ok).toBe(false)
})
