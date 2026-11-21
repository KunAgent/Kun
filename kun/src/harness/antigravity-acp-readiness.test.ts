import { expect, it, vi } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessDetector } from './harness-detector.js'
import { HarnessReadinessService } from './harness-readiness.js'

vi.mock('./antigravity-credentials.js', () => ({
  antigravityCredentialEvidence: async () => ({ configured: false, fingerprint: 'fixture' })
}))

function fixture(version: string, legacy = false) {
  const catalog = new HarnessCatalog({
    ...(legacy ? { transportOverrides: () => ({ antigravity: 'antigravity-cli' as const }) } : {})
  })
  const definition = catalog.get('antigravity')!
  const probeReady = vi.fn(async () => ({ ready: 'yes' as const }))
  const spawnCaptured = vi.fn(async () => ({ stdout: version, stderr: '', exitCode: 0, timedOut: false }))
  const detector = new HarnessDetector({
    definitions: () => [definition], overrides: () => ({}), resolveExecutable: async () => '/fixture/agy',
    spawnCaptured, probeReady, probeLogin: async () => 'unknown', nowMs: Date.now,
    nowIso: () => new Date().toISOString()
  })
  const handshake = vi.fn(async () => ({ ok: true, supported: true, protocol: definition.transport }))
  const readiness = new HarnessReadinessService({ options: () => ({}), catalog, detector, handshake })
  return { detector, probeReady, spawnCaptured, handshake,
    check: () => readiness.test(definition, { level: 'handshake', credentialMode: 'native-login' }) }
}

it.each(['1.1.13', '1.4.12'])('rejects agy %s before starting an unsupported ACP server', async (version) => {
  const f = fixture(version)
  const result = await f.check()
  expect(result).toMatchObject({ ok: false, detect: { status: {
    installed: 'yes', version, versionSupported: false, reasonCode: 'version_too_low'
  } }, readiness: { usable: false, checks: expect.arrayContaining([{
    id: 'installation', ok: false, detail: expect.stringMatching(/acp.*1\.5\.0 or later.*Update/)
  }]) } })
  expect(result.handshake).toBeUndefined()
  expect(f.probeReady).not.toHaveBeenCalled()
  expect(f.handshake).not.toHaveBeenCalled()
  expect(f.spawnCaptured.mock.calls).toHaveLength(1)
})

it.each(['1.5.0', '1.5.9'])('still verifies the ACP handshake for agy %s', async (version) => {
  const f = fixture(version)
  expect(await f.check()).toMatchObject({ ok: true, detect: { status: { versionSupported: true } } })
  expect(f.probeReady).toHaveBeenCalledOnce()
  expect(f.handshake).toHaveBeenCalledOnce()
})

it('keeps older CLI builds available for the explicit legacy transport', async () => {
  const f = fixture('1.1.13', true)
  expect(await f.check()).toMatchObject({ ok: true, transport: 'antigravity-cli' })
  expect(f.probeReady).not.toHaveBeenCalled()
  expect(f.handshake).toHaveBeenCalledOnce()
})
