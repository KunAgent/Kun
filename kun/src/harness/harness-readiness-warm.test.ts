import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { HarnessReadinessService, PROOF_REFRESH_AHEAD_MS, type HarnessReadinessDeps } from './harness-readiness.js'
import type { ReadinessOptions } from './harness-readiness-profile.js'

const route = { harnessId: 'opencode', credentialMode: 'kun-gateway' as const, providerId: 'account-a', model: 'model-a' }
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function fixture() {
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
  const service = new HarnessReadinessService({ options: () => options, catalog, detector, handshake, revision: () => 1, nowMs: () => clock })
  const settle = () => vi.waitFor(() => expect(service.checking('opencode')).toBe(false))
  return { service, handshake, settle, advance: (ms: number) => { clock += ms } }
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

  it('re-validates ahead of expiry and keeps the proof through a transient refresh failure', async () => {
    const f = await fixture()
    f.service.warmProfiles('opencode'); await f.settle()
    const [first] = await f.service.readyProfiles('opencode')
    f.advance(5 * 60_000 - PROOF_REFRESH_AHEAD_MS + 1_000)
    f.handshake.mockResolvedValueOnce({ ok: false, supported: true, protocol: 'acp', detail: 'Temporary backend timeout' })
    f.service.warmProfiles('opencode'); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(2)
    expect(await f.service.readyProfiles('opencode')).toEqual([first])
    f.service.warmProfiles('opencode'); await f.settle()
    expect(f.handshake).toHaveBeenCalledTimes(2)
    f.advance(16_000)
    f.service.warmProfiles('opencode'); await f.settle()
    const [refreshed] = await f.service.readyProfiles('opencode')
    expect(Date.parse(refreshed!.expiresAt)).toBeGreaterThan(Date.parse(first!.expiresAt))
  })
})
