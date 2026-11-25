import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessReadinessService } from './harness-readiness.js'
import { antigravityCredentialEvidence } from './antigravity-credentials.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function home() { const dir = await mkdtemp(join(tmpdir(), 'agy-credentials-')); dirs.push(dir); return dir }
const attributes = [
  'keychain: "/Users/test/Library/Keychains/login.keychain-db"',
  'class: "genp"',
  'attributes:',
  '    "acct"<blob>="antigravity"',
  '    "cdat"<timedate>=0x32303236313132353130303030305A00  "20261125100000Z\\000"',
  '    "mdat"<timedate>=0x32303236313132353130303030305A00  "20261125100000Z\\000"',
  '    "svce"<blob>="gemini"'
].join('\n')
describe('Antigravity native credential evidence', () => {
  it('checks macOS keyring attributes without retrieving the secret and ignores hourly mdat refreshes', async () => {
    const root = await home()
    const spawn = vi.fn(async () => ({ exitCode: 0, timedOut: false, stdout: attributes, stderr: '' }))
    const deps = { platform: 'darwin' as const, home: root, spawn }
    const first = await antigravityCredentialEvidence({ HOME: root }, deps)
    expect(first.configured).toBe(true)
    expect(spawn).toHaveBeenCalledWith('/usr/bin/security', ['find-generic-password', '-s', 'gemini', '-a', 'antigravity'],
      expect.objectContaining({ timeoutMs: 3000, env: { HOME: root } }))
    expect(JSON.stringify(first)).not.toContain('antigravity')
    // In-place OAuth access_token refresh updates mdat while preserving cdat.
    spawn.mockResolvedValueOnce({
      exitCode: 0,
      timedOut: false,
      stdout: attributes.replace('"mdat"<timedate>=0x32303236313132353130303030305A00  "20261125100000Z\\000"',
        '"mdat"<timedate>=0x32303236313132353131313030305A00  "20261125111000Z\\000"'),
      stderr: ''
    })
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).fingerprint).toBe(first.fingerprint)
    // Entry deletion and recreation updates cdat and invalidates prior evidence.
    spawn.mockResolvedValueOnce({
      exitCode: 0,
      timedOut: false,
      stdout: attributes.replace('"cdat"<timedate>=0x32303236313132353130303030305A00  "20261125100000Z\\000"',
        '"cdat"<timedate>=0x32303236313132353132303030305A00  "20261125120000Z\\000"'),
      stderr: ''
    })
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).fingerprint).not.toBe(first.fingerprint)
    spawn.mockResolvedValueOnce({ exitCode: 44, timedOut: false, stdout: '', stderr: '' })
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).configured).toBe(false)
  })
  it('keeps an admitted Antigravity turn valid when agy refreshes Keychain mdat during session setup', async () => {
    const root = await home()
    const command = join(root, 'agy')
    await writeFile(command, '#!/bin/sh\nexit 0\n')
    let stdout = attributes
    const options = {
      harnesses: HarnessesConfigSchema.parse({
        binaryPaths: { antigravity: command },
        enabledProfiles: [{ harnessId: 'antigravity', credentialMode: 'native-login' }]
      })
    }
    const baseCatalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses.enabledProfiles })
    const service = new HarnessReadinessService({
      options: () => options,
      catalog: baseCatalog,
      detector: {
        status: async () => ({
          harnessId: 'antigravity',
          installed: 'yes',
          version: '1.5.9',
          versionSupported: true,
          login: 'unknown',
          ready: 'yes',
          resolvedCommand: command,
          checkedAt: '2026-11-25T00:00:00.000Z'
        })
      },
      handshake: async () => ({ ok: true, supported: true, protocol: 'acp' })
    })
    const evidenceSpy = vi.spyOn(await import('./providers/registry.js'), 'providerModule')
    const realModule = (await import('./providers/antigravity.js')).ANTIGRAVITY_MODULE
    evidenceSpy.mockImplementation((id) => id === 'antigravity'
      ? {
          ...realModule,
          credentials: {
            ...realModule.credentials,
            snapshotEvidence: () => antigravityCredentialEvidence({ HOME: root }, {
              platform: 'darwin',
              home: root,
              spawn: async () => ({ exitCode: 0, timedOut: false, stdout, stderr: '' })
            })
          }
        }
      : undefined)
    try {
      const route = { harnessId: 'antigravity', credentialMode: 'native-login' as const, model: 'gemini-4-carbon' }
      const signal = new AbortController().signal
      await service.prepareTurn('thread-1', 'turn-1', route, service.configurationSignature(route), signal)
      // Simulate `agy acp` refreshing its OAuth access_token in Keychain during `session/new`.
      stdout = attributes.replace(
        '"mdat"<timedate>=0x32303236313132353130303030305A00  "20261125100000Z\\000"',
        '"mdat"<timedate>=0x32303236313132353131313030305A00  "20261125111000Z\\000"'
      )
      await expect(service.validateTurn('thread-1', 'turn-1', signal, route)).resolves.toMatch(/^[a-f0-9]{64}$/)
      expect(await service.readyProfiles('antigravity')).toHaveLength(1)
      // Recreating the Keychain item (new cdat) still invalidates launch validation.
      stdout = stdout.replace(
        '"cdat"<timedate>=0x32303236313132353130303030305A00  "20261125100000Z\\000"',
        '"cdat"<timedate>=0x32303236313132353132303030305A00  "20261125120000Z\\000"'
      )
      await expect(service.validateTurn('thread-1', 'turn-1', signal, route)).rejects.toThrow('Agent profile changed before launch')
    } finally {
      evidenceSpy.mockRestore()
    }
  })
  it('does not borrow keyring evidence for another HOME or use unrelated Gemini OAuth', async () => {
    const root = await home(), spawn = vi.fn()
    await mkdir(join(root, '.gemini'), { recursive: true })
    await writeFile(join(root, '.gemini', 'oauth_creds.json'), JSON.stringify({ refresh_token: 'wrong-agent' }))
    expect((await antigravityCredentialEvidence({ HOME: root }, { platform: 'darwin', home: '/another', spawn })).configured).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })
  it('recognizes only bounded native token files and invalidates rotation', async () => {
    const root = await home(), dir = join(root, '.gemini', 'antigravity-cli')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'antigravity-oauth-token'), deps = { platform: 'linux' as const }
    await writeFile(path, JSON.stringify({ refresh_token: 'first-private' }))
    const first = await antigravityCredentialEvidence({ HOME: root }, deps)
    expect(first.configured).toBe(true)
    expect(JSON.stringify(first)).not.toContain('private')
    await writeFile(path, JSON.stringify({ refresh_token: 'first-private', access_token: 'hourly-token', expiry_date: 2 }))
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).fingerprint).toBe(first.fingerprint)
    await writeFile(path, JSON.stringify({ token: { refreshToken: 'first-private', accessToken: 'rotated-hourly' } }))
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).fingerprint).toBe(first.fingerprint)
    await writeFile(path, JSON.stringify({ refresh_token: 'second-private' }))
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).fingerprint).not.toBe(first.fingerprint)
    await rm(path); await symlink(join(root, 'missing'), path)
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).configured).toBe(false)
  })
  it('does not turn a cancelled keyring lookup into configured evidence', async () => {
    const root = await home(), controller = new AbortController()
    const spawn = vi.fn(async () => { controller.abort(); return { exitCode: 0, timedOut: false, stdout: attributes, stderr: '' } })
    await expect(antigravityCredentialEvidence({ HOME: root }, { platform: 'darwin', home: root, spawn, signal: controller.signal })).rejects.toThrow()
  })
})
