import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GeminiCliOAuthSource } from '../adapters/model/gemini-cli-oauth.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import {
  OfficialProviderAuthService,
  OfficialProviderCliService,
  antigravityCliBinaryPath,
  installAntigravityCli,
  resolveGeminiCliCommand
} from './official-provider-cli.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('official provider CLI authentication', () => {
  it('does not return a bundled Gemini CLI command', () => {
    const command = resolveGeminiCliCommand({ PATH: '' })
    expect(command?.args ?? []).toEqual([])
    if (command) expect(command.command).not.toBe(process.execPath)
  })

  it('rejects an Antigravity download before extraction when its checksum is invalid', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-antigravity-checksum-'))
    roots.push(dataDir)
    await expect(installAntigravityCli({
      dataDir,
      fetchImpl: vi.fn(async () => new Response('not-the-official-archive', {
        status: 200,
        headers: { 'content-length': '24' }
      })) as unknown as typeof fetch
    })).rejects.toThrow('checksum mismatch')
    await expect(readFile(antigravityCliBinaryPath(dataDir))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('imports only a trusted fixed legacy binary and fails closed for a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-antigravity-legacy-'))
    roots.push(root)
    const dataDir = join(root, 'data')
    const legacyDir = join(root, 'legacy')
    const legacyBinary = join(legacyDir, 'agy')
    await mkdir(legacyDir)
    await writeFile(legacyBinary, 'trusted-binary')
    const service = new OfficialProviderCliService({ dataDir, legacyBinaryPaths: [legacyBinary] })

    await expect(service.status()).resolves.toMatchObject({
      installed: true,
      path: antigravityCliBinaryPath(dataDir)
    })
    await expect(readFile(antigravityCliBinaryPath(dataDir), 'utf8')).resolves.toBe('trusted-binary')

    const rejectedDataDir = join(root, 'rejected')
    const link = join(legacyDir, 'agy-link')
    await symlink(legacyBinary, link)
    const rejected = new OfficialProviderCliService({
      dataDir: rejectedDataDir,
      legacyBinaryPaths: [link]
    })
    await expect(rejected.status()).resolves.toMatchObject({ installed: false })
    await expect(readFile(antigravityCliBinaryPath(rejectedDataDir))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('coalesces concurrent install requests into one download', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-antigravity-singleton-'))
    roots.push(dataDir)
    let releaseResponse: ((value: Response) => void) | undefined
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      releaseResponse = resolve
    })) as unknown as typeof fetch
    const service = new OfficialProviderCliService({ dataDir, fetchImpl })

    const first = service.install()
    const second = service.install()
    expect(first).toBe(second)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    releaseResponse?.(new Response('invalid', { status: 200 }))
    await expect(first).resolves.toMatchObject({ status: 'error' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('verifies Gemini CLI login before creating and selecting the native route', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gemini-cli-auth-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'official-cli-test' })
    })
    await registry.initialize()
    const accessToken = vi.fn(async () => 'provider-owned-access-token')
    const service = new OfficialProviderAuthService({
      dataDir,
      registry,
      geminiOAuthSource: { accessToken } as unknown as GeminiCliOAuthSource
    })

    const snapshot = await service.complete({
      expectedRevision: 0,
      provider: 'gemini-cli',
      model: 'gemini-3.1-pro-preview',
      select: true
    })

    expect(accessToken).toHaveBeenCalledTimes(1)
    expect(snapshot).toMatchObject({
      defaultProviderId: 'gemini-cli-subscription',
      defaultModel: 'gemini-3.1-pro-preview'
    })
    expect(snapshot.providers[0]).toMatchObject({
      kind: 'gemini-cli-api',
      configured: true
    })
    expect(JSON.stringify(snapshot)).not.toContain('provider-owned-access-token')
  })

  it('leaves the registry unchanged when provider-owned login verification fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gemini-cli-auth-fail-'))
    roots.push(dataDir)
    const registry = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'official-cli-test' })
    })
    await registry.initialize()
    const service = new OfficialProviderAuthService({
      dataDir,
      registry,
      geminiOAuthSource: {
        accessToken: vi.fn(async () => { throw new Error('Google login cancelled') })
      } as unknown as GeminiCliOAuthSource
    })

    await expect(service.complete({
      expectedRevision: 0,
      provider: 'gemini-cli',
      select: true
    })).rejects.toThrow('Google login cancelled')
    expect(await registry.snapshot()).toMatchObject({
      revision: 0,
      providers: []
    })
  })

  it('reports an interactive CLI non-zero exit without exposing provider output', async () => {
    const child = Object.assign(new EventEmitter(), {})
    const spawnFn = vi.fn(() => child)
    const { runInteractiveProviderCli } = await import('../tui/operations.js')
    const pending = runInteractiveProviderCli({
      provider: 'gemini-cli',
      command: 'gemini',
      args: [],
      displayName: 'Gemini CLI'
    }, { spawnFn: spawnFn as never })
    child.emit('close', 1, null)

    await expect(pending).rejects.toThrow('Gemini CLI exited with code 1')
    expect(spawnFn).toHaveBeenCalledWith('gemini', [], expect.objectContaining({
      stdio: 'inherit'
    }))
  })
})
