import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessReadinessService, type HarnessReadinessDeps } from './harness-readiness.js'
import type { ReadinessOptions } from './harness-readiness-profile.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('starts at most two Agent CLIs for background warm-ups and lets the rest queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-readiness-concurrency-')); dirs.push(dir)
  const command = join(dir, 'opencode'); await writeFile(command, '#!/bin/sh\nexit 0\n')
  const accounts = ['account-a', 'account-b', 'account-c', 'account-d', 'account-e']
  const options: ReadinessOptions = {
    model: 'model-a',
    providers: Object.fromEntries(accounts.map((id) => [id, { kind: 'http' as const, apiKey: `secret-${id}`,
      baseUrl: 'https://api.example.com', models: ['model-a'] }])),
    harnesses: HarnessesConfigSchema.parse({ binaryPaths: { opencode: command },
      defaults: { opencode: { credentialMode: 'kun-gateway', providerId: 'account-a', model: 'model-a' } },
      enabledProfiles: accounts.slice(0, 4).map((providerId) => ({ harnessId: 'opencode', credentialMode: 'kun-gateway', providerId })) })
  }
  const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses!.enabledProfiles })
  const detector = { status: vi.fn(async (): Promise<HarnessStatus> => ({ harnessId: 'opencode', installed: 'yes' as const,
    login: 'unknown' as const, ready: 'yes' as const, resolvedCommand: command, checkedAt: '2026-10-19T00:00:00.000Z' })) }
  let running = 0
  let peak = 0
  const releases: Array<() => void> = []
  const handshake = vi.fn<NonNullable<HarnessReadinessDeps['handshake']>>(async () => {
    running += 1; peak = Math.max(peak, running)
    await new Promise<void>((resolve) => { releases.push(resolve) })
    running -= 1
    return { ok: true, supported: true, protocol: 'acp' }
  })
  const service = new HarnessReadinessService({ options: () => options, catalog, detector, handshake, revision: () => 1 })

  service.warmProfiles('opencode')
  await vi.waitFor(() => expect(handshake).toHaveBeenCalledTimes(2))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(handshake).toHaveBeenCalledTimes(2)

  // A warm-up the user asked for (composer selection) does not wait in the queue.
  options.harnesses = HarnessesConfigSchema.parse({ ...options.harnesses,
    enabledProfiles: [...options.harnesses!.enabledProfiles, { harnessId: 'opencode', credentialMode: 'kun-gateway', providerId: 'account-e' }] })
  service.warmProfiles('opencode', { refreshStale: true })
  await vi.waitFor(() => expect(handshake).toHaveBeenCalledTimes(3))

  while (handshake.mock.calls.length < 5 || releases.length > 0) {
    releases.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await vi.waitFor(() => expect(service.checking('opencode')).toBe(false))
  expect(handshake).toHaveBeenCalledTimes(5)
  expect(peak).toBe(3)
  expect(await service.readyProfiles('opencode')).toHaveLength(5)
})
