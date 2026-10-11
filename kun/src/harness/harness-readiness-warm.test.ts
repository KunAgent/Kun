import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { HarnessReadinessService, PROOF_DISPLAY_TTL_MS, PROOF_TTL_MS, type HarnessReadinessDeps } from './harness-readiness.js'
import type { ReadinessOptions } from './harness-readiness-profile.js'

const route = { harnessId: 'opencode', credentialMode: 'kun-gateway' as const, providerId: 'account-a', model: 'model-a' }
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function fixture(extra: Partial<HarnessReadinessDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-readiness-warm-')); dirs.push(dir)
  const command = join(dir, 'opencode'); await writeFile(command, '#!/bin/sh\nexit 0\n')
  const options: ReadinessOptions = { model: 'model-a', providers: {
    'account-a': { kind: 'http', apiKey: 'secret-a', baseUrl: 'https://api.example.com', models: ['model-a'] }
  }, harnesses: HarnessesConfigSchema.parse({ binaryPaths: { opencode: command },
    defaults: { opencode: { credentialMode: 'kun-gateway', providerId: 'account-a', model: 'model-a' } },
    enabledProfiles: [{ harnessId: 'opencode', credentialMode: 'kun-gateway', providerId: 'account-a' }] }) }
  let clock = 1_000_000
  const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses!.enabledProfiles })
  const detector = { status: vi.fn(async (): Promise<HarnessStatus> => ({ harnessId: 'opencode', installed: 'yes' as const, login: 'unknown' as const,
    ready: 'yes' as const, resolvedCommand: command, checkedAt: '2026-10-06T00:00:00.000Z' })) }
  const handshake = vi.fn<NonNullable<HarnessReadinessDeps['handshake']>>(async () => ({ ok: true, supported: true, protocol: 'acp' }))
  const build = (more: Partial<HarnessReadinessDeps> = {}) => new HarnessReadinessService({
    options: () => options, catalog, detector, handshake, revision: () => 1, nowMs: () => clock, ...extra, ...more })
  const service = build()
  const settle = (target = service) => vi.waitFor(() => expect(target.checking('opencode')).toBe(false))
  return { service, build, dir, handshake, settle, advance: (ms: number) => { clock += ms } }
}

describe('background readiness warming', () => {
  it('retries a failed warm-up with backoff instead of leaving the Agent unready forever', async () => {
    const f = await fixture()
    f.handshake.mockResolvedValueOnce({ ok: false, supported: true, protocol: 'acp', detail: 'Failed to load team settings' })
    f.service.warmProfiles('opencode'); await f.settle()
    expect(await f.service.readyProfiles('opencode')).toEqual([])
    f.service.warmProfiles('opencode'); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(1)
    f.advance(16_000)
    f.service.warmProfiles('opencode'); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(2)
    expect(await f.service.readyProfiles('opencode')).toHaveLength(1)
  })

  it('never re-spawns an Agent from list polling while its proof is still displayable', async () => {
    const f = await fixture()
    f.service.warmProfiles('opencode'); await f.settle()
    const [first] = await f.service.readyProfiles('opencode')
    expect(Date.parse(first!.expiresAt)).toBe(1_000_000 + PROOF_DISPLAY_TTL_MS)
    // Past the admission TTL the Agent still shows as ready and polling stays quiet.
    f.advance(PROOF_TTL_MS + 60_000)
    for (let poll = 0; poll < 5; poll += 1) { f.service.warmProfiles('opencode'); await f.settle() }
    expect(f.handshake).toHaveBeenCalledTimes(1)
    expect(await f.service.readyProfiles('opencode')).toEqual([first])
    // Only once the display window ends does the next list poll check again.
    f.advance(PROOF_DISPLAY_TTL_MS)
    expect(await f.service.readyProfiles('opencode')).toEqual([])
    f.service.warmProfiles('opencode'); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(2)
  })

  it('refreshes a stale proof on explicit intent and keeps it through a transient failure', async () => {
    const f = await fixture()
    f.service.warmProfiles('opencode'); await f.settle()
    const [first] = await f.service.readyProfiles('opencode')
    f.advance(PROOF_TTL_MS + 1_000)
    f.handshake.mockResolvedValueOnce({ ok: false, supported: true, protocol: 'acp', detail: 'Temporary backend timeout' })
    f.service.warmProfiles('opencode', { refreshStale: true }); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(2)
    expect(await f.service.readyProfiles('opencode')).toEqual([first])
    f.service.warmProfiles('opencode', { refreshStale: true }); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(2)
    f.advance(16_000)
    f.service.warmProfiles('opencode', { refreshStale: true }); await f.settle()
    const [refreshed] = await f.service.readyProfiles('opencode')
    expect(Date.parse(refreshed!.expiresAt)).toBeGreaterThan(Date.parse(first!.expiresAt))
  })

  it('restores display proofs after a restart without spawning, and re-checks before admission', async () => {
    const proofStorePath = join(tmpdir(), `kun-readiness-proofs-${process.pid}-${Date.now()}.json`)
    const f = await fixture({ proofStorePath })
    f.service.warmProfiles('opencode'); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => {
      const { readFile } = await import('node:fs/promises')
      expect(JSON.parse(await readFile(proofStorePath, 'utf8')).proofs).toHaveLength(1)
    }, { timeout: 3_000 })
    const [checked] = await f.service.readyProfiles('opencode')
    expect(checked?.readiness?.usable).toBe(true)
    const restarted = f.build()
    restarted.warmProfiles('opencode'); await f.settle(restarted)
    const restored = await restarted.readyProfiles('opencode')
    expect(restored).toHaveLength(1)
    // The last check result survives the restart so clients can show it again.
    expect(restored[0]?.readiness).toEqual(checked?.readiness)
    expect(f.handshake).toHaveBeenCalledTimes(1)
    await restarted.assertReady(route)
    expect(f.handshake).toHaveBeenCalledTimes(2)
    await rm(proofStorePath, { force: true })
  })

  it('reports a first check as verifying but a refresh of a valid proof as still usable', async () => {
    const f = await fixture()
    let release!: () => void
    const held = () => new Promise<{ ok: true; supported: true; protocol: 'acp' }>((resolve) => {
      release = () => resolve({ ok: true, supported: true, protocol: 'acp' })
    })
    f.handshake.mockImplementationOnce(held)
    f.service.warmProfiles('opencode')
    await vi.waitFor(() => expect(f.handshake).toHaveBeenCalledTimes(1))
    expect(f.service.verifying('opencode')).toBe(true)
    release(); await f.settle()
    expect(f.service.verifying('opencode')).toBe(false)

    f.advance(PROOF_TTL_MS + 1_000)
    f.handshake.mockImplementationOnce(held)
    f.service.warmProfiles('opencode', { refreshStale: true })
    await vi.waitFor(() => expect(f.handshake).toHaveBeenCalledTimes(2))
    expect(f.service.checking('opencode')).toBe(true)
    expect(f.service.verifying('opencode')).toBe(false)
    expect(await f.service.readyProfiles('opencode')).toHaveLength(1)
    release(); await f.settle()
  })
})
