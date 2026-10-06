import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessReadinessService, type HarnessReadinessDeps } from './harness-readiness.js'
import type { HarnessStatus } from '../contracts/harness.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function fixture(terminal = false, secretName?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-generic-readiness-')); dirs.push(dir)
  const command = join(dir, 'agent')
  await writeFile(command, '#!/bin/sh\nexit 0\n')
  const id = terminal ? 'terminal-test' : 'custom-test'
  const entry = { id, displayName: 'Fixture', command, args: [], ...(terminal ? {} : { env: {} }),
    ...(secretName ? { secretEnv: [{ name: secretName, secretRef: 'fixture-ref' }] } : {}) }
  const options = { harnesses: HarnessesConfigSchema.parse(terminal
    ? { terminalAgents: [entry] } : { custom: [entry] }) }
  const catalog = new HarnessCatalog({ custom: () => options.harnesses.custom,
    terminalAgents: () => options.harnesses.terminalAgents, enabledProfiles: () => options.harnesses.enabledProfiles })
  const detector = { status: vi.fn(async (): Promise<HarnessStatus> => ({
    harnessId: id, installed: 'yes', login: 'unknown', resolvedCommand: command, checkedAt: '2026-10-06T00:00:00.000Z'
  })) }
  const handshake = vi.fn<NonNullable<HarnessReadinessDeps['handshake']>>(async () => ({
    ok: true, supported: true, protocol: 'acp', authentication: 'unverified'
  }))
  const resolveSecretEnv = vi.fn(async () => 'fixture-secret')
  const service = new HarnessReadinessService({ options: () => options, catalog, detector, handshake, resolveSecretEnv })
  const route = { harnessId: id, credentialMode: 'native-login' as const, model: 'default' }
  return { id, options, catalog, detector, handshake, resolveSecretEnv, service, route }
}

describe('generic Agent readiness', () => {
  it.each(['KIMI_API_KEY', 'COPILOT_GITHUB_TOKEN', 'CUSTOM_TOKEN'])('accepts explicit %s without claiming authenticated login', async (name) => {
    const f = await fixture(false, name)
    const result = await f.service.test(f.catalog.get(f.id)!, { level: 'handshake', ...f.route })
    expect(result).toMatchObject({ ok: true, readiness: { authentication: 'unverified' } })
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    f.options.harnesses.enabledProfiles = [{ harnessId: f.id, credentialMode: 'native-login' }]
    await expect(f.service.assertReady(f.route)).resolves.toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not derive credential evidence from a successful custom ACP handshake', async () => {
    const f = await fixture()
    const result = await f.service.test(f.catalog.get(f.id)!, { level: 'handshake', ...f.route })
    expect(result).toMatchObject({ ok: false, readiness: { authentication: 'missing' } })
    expect(result.readiness?.checks.find((check) => check.id === 'credentials')?.ok).toBe(false)
  })

  it('rejects an unresolved explicit secret before protocol startup', async () => {
    const f = await fixture(false, 'CUSTOM_TOKEN')
    f.resolveSecretEnv.mockResolvedValue('')
    expect((await f.service.test(f.catalog.get(f.id)!, { level: 'handshake', ...f.route })).ok).toBe(false)
    expect(f.handshake).not.toHaveBeenCalled()
  })

  it('lets an authoritative native login rejection override configured credential evidence', async () => {
    const f = await fixture(false, 'CUSTOM_TOKEN')
    f.handshake.mockResolvedValue({ ok: false, supported: true, protocol: 'acp', authRequired: true, authentication: 'missing' })
    const result = await f.service.test(f.catalog.get(f.id)!, { level: 'handshake', ...f.route })
    expect(result).toMatchObject({ ok: false, readiness: { authentication: 'missing' } })
    expect(result.readiness?.checks.find((check) => check.id === 'credentials'))
      .toMatchObject({ ok: false, detail: expect.stringContaining('requires login') })
  })

  it('enables a resolved terminal command without protocol startup or account claims', async () => {
    const f = await fixture(true)
    f.detector.status.mockResolvedValue({ harnessId: f.id, installed: 'yes', login: 'signed-in',
      resolvedCommand: f.catalog.get(f.id)!.detect!.command, checkedAt: '2026-10-06T00:00:00.000Z' })
    const result = await f.service.test(f.catalog.get(f.id)!, { level: 'handshake', ...f.route })
    expect(result).toMatchObject({ ok: true, readiness: { authentication: 'unverified' } })
    expect(result.handshake).toBeUndefined()
    f.options.harnesses.enabledProfiles = [{ harnessId: f.id, credentialMode: 'native-login' }]
    await expect(f.service.assertReady(f.route)).resolves.toMatch(/^[a-f0-9]{64}$/)
    expect(f.handshake).not.toHaveBeenCalled()
  })

  it('rejects a terminal launch when detection did not resolve its executable', async () => {
    const f = await fixture(true)
    f.detector.status.mockResolvedValue({ harnessId: f.id, installed: 'yes', login: 'unknown', checkedAt: '2026-10-06T00:00:00.000Z' })
    expect((await f.service.test(f.catalog.get(f.id)!, { level: 'handshake', ...f.route })).ok).toBe(false)
    expect(f.handshake).not.toHaveBeenCalled()
  })
})
