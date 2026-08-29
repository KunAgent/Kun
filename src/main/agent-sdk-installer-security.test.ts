import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pack, type Header } from 'tar-stream'
import {
  AGENT_SDK_INTEGRITY_BY_PACKAGE,
  AGENT_SDK_VERSION,
  agentSdkStatus,
  claudeBinaryName,
  installClaudeBinary,
  platformBinaryPackage,
  resolveClaudeBinary
} from './agent-sdk-installer'
import {
  downloadArchive,
  extractExactBinary,
  fetchAllowlisted,
  parsePackageMetadata
} from './agent-sdk-installer-network'
import {
  agentSdkRoot,
  legacyAgentSdkBinaryPath,
  manifestRelativePath,
  resolveActiveAgentSdkInstall,
  serializeActivePointer,
  serializeManifest,
  type AgentSdkInstallManifest
} from './agent-sdk-installer-storage'

const temporary: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-agent-sdk-security-'))
  temporary.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function metadata(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    version: '0.3.220',
    dist: {
      tarball: 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/archive.tgz',
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      shasum: 'a'.repeat(40),
      unpackedSize: 250_000_000
    },
    ...overrides
  }
}

function expectedMetadata(value: unknown): void {
  parsePackageMetadata(value, '@anthropic-ai/claude-agent-sdk-darwin-arm64', '0.3.220')
}

describe('Agent SDK registry boundary', () => {
  it('requires exact metadata identity, sha512 SRI, and allowlisted HTTPS tarballs', () => {
    expect(() => expectedMetadata(metadata())).not.toThrow()
    expect(() => expectedMetadata(metadata({ version: '0.3.221' }))).toThrow(/identity/)
    expect(() => expectedMetadata(metadata({
      dist: { ...(metadata() as { dist: object }).dist, integrity: 'sha256-AAAA' }
    }))).toThrow(/sha512 SRI/)
    expect(() => expectedMetadata(metadata({
      dist: {
        ...(metadata() as { dist: object }).dist,
        tarball: 'https://evil.example/archive.tgz'
      }
    }))).toThrow(/allowlisted/)
  })

  it('rejects redirects outside the host allowlist', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/archive.tgz' }
    }))
    await expect(fetchAllowlisted(
      'https://registry.npmjs.org/package/0.3.220',
      '',
      fetcher
    )).rejects.toThrow(/allowlisted/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

async function writeArchive(path: string, entries: Array<Partial<Header> & Pick<Header, 'name'> & { body?: Buffer }>): Promise<void> {
  const archive = pack()
  for (const entry of entries) {
    archive.entry(entry, entry.body ?? Buffer.alloc(0))
  }
  archive.finalize()
  await pipeline(archive, createGzip(), createWriteStream(path))
}

describe('Agent SDK archive boundary', () => {
  it('extracts only the exact regular binary member', async () => {
    const dir = await tempDir()
    const archive = join(dir, 'package.tgz')
    const output = join(dir, 'claude')
    await writeArchive(archive, [
      { name: 'package/README.md', body: Buffer.from('ignored') },
      { name: 'package/claude', body: Buffer.from('trusted-binary') }
    ])
    await expect(extractExactBinary(archive, 'package/claude', output)).resolves.toBe(14)
    await expect(readFile(output, 'utf8')).resolves.toBe('trusted-binary')
  })

  it('rejects a downloaded archive whose bytes do not match SRI', async () => {
    const dir = await tempDir()
    const parsed = parsePackageMetadata(metadata(), '@anthropic-ai/claude-agent-sdk-darwin-arm64', '0.3.220')
    await expect(downloadArchive(
      new Response(Buffer.from('not-the-declared-archive'), { headers: { 'content-length': '24' } }),
      join(dir, 'package.tgz'),
      parsed
    )).rejects.toThrow(/SRI verification failed/)
  })

  it('rejects archives with excessive member counts', async () => {
    const dir = await tempDir()
    const archive = join(dir, 'package.tgz')
    const entries = Array.from({ length: 17 }, (_, index) => ({
      name: `package/file-${index}`,
      body: Buffer.from('x')
    }))
    await writeArchive(archive, entries)
    await expect(extractExactBinary(archive, 'package/claude', join(dir, 'claude')))
      .rejects.toThrow(/too many members/)
  })

  it('rejects special members even when they are not the requested member', async () => {
    const dir = await tempDir()
    const archive = join(dir, 'package.tgz')
    await writeArchive(archive, [
      { name: 'package/escape', type: 'symlink', linkname: '../../escape' },
      { name: 'package/claude', body: Buffer.from('binary') }
    ])
    await expect(extractExactBinary(archive, 'package/claude', join(dir, 'claude')))
      .rejects.toThrow(/link or special/)
  })
})

function installOptions(userDataDir: string): Parameters<typeof resolveActiveAgentSdkInstall>[0] {
  return {
    userDataDir,
    sdkVersion: '0.3.220',
    packageName: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    binaryName: 'claude'
  }
}

async function writeManagedInstall(userDataDir: string): Promise<{ binary: string; manifest: AgentSdkInstallManifest }> {
  const bytes = Buffer.from('authenticated-binary')
  const manifest: AgentSdkInstallManifest = {
    schemaVersion: 1,
    sdkVersion: '0.3.220',
    packageName: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    binaryName: 'claude',
    binarySize: bytes.length,
    binarySha256: createHash('sha256').update(bytes).digest('hex'),
    cliVersion: '2.1.247 (Claude Code)',
    helpProbe: 'Usage: claude [options]',
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
    installedAt: new Date().toISOString()
  }
  const root = agentSdkRoot(userDataDir)
  const manifestFile = join(root, manifestRelativePath(manifest))
  const manifestBytes = serializeManifest(manifest)
  mkdirSync(dirname(manifestFile), { recursive: true })
  writeFileSync(join(dirname(manifestFile), 'claude'), bytes)
  writeFileSync(manifestFile, manifestBytes)
  writeFileSync(join(root, 'active.json'), serializeActivePointer(manifest, manifestBytes))
  return { binary: join(dirname(manifestFile), 'claude'), manifest }
}

describe('Agent SDK manifest trust', () => {
  it('resolves an active binary only when pointer, manifest, and binary hash agree', async () => {
    const dir = await tempDir()
    const managed = await writeManagedInstall(dir)
    expect(resolveActiveAgentSdkInstall(installOptions(dir))?.binaryPath).toBe(managed.binary)
    await writeFile(managed.binary, 'tampered-binary')
    expect(resolveActiveAgentSdkInstall(installOptions(dir))).toBeUndefined()
  })

  it('reuses binary identity for repeated status checks and revalidates replacement files', async () => {
    const dir = await tempDir()
    const managed = await writeManagedInstall(dir)
    let reads = 0
    const options = {
      ...installOptions(dir),
      readBinaryHash: () => {
        reads += 1
        return managed.manifest.binarySha256
      }
    }
    expect(resolveActiveAgentSdkInstall(options)?.binaryPath).toBe(managed.binary)
    expect(resolveActiveAgentSdkInstall(options)?.binaryPath).toBe(managed.binary)
    expect(reads).toBe(1)
    await writeFile(managed.binary, 'replacement-binary')
    expect(resolveActiveAgentSdkInstall(options)).toBeUndefined()
  })

  it('keeps status and resolver consistent for a bundled SDK binary', async () => {
    const dir = await tempDir()
    const packageRoot = join(dir, 'node_modules', platformBinaryPackage()!)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: AGENT_SDK_VERSION }))
    writeFileSync(join(packageRoot, claudeBinaryName()), 'bundled-binary')
    expect(resolveClaudeBinary(join(dir, 'user-data'), [dir])).toBe(join(packageRoot, claudeBinaryName()))
    expect(agentSdkStatus(join(dir, 'user-data'), [dir])).toEqual({
      installed: true,
      path: join(packageRoot, claudeBinaryName())
    })
  })

  it('does not treat an unmanaged legacy file as an installed runtime', async () => {
    const dir = await tempDir()
    const legacy = legacyAgentSdkBinaryPath(dir, claudeBinaryName())
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'untrusted')
    expect(resolveActiveAgentSdkInstall(installOptions(dir))).toBeUndefined()
    expect(agentSdkStatus(dir, [])).toEqual({ installed: false })
  })

  it('refuses caller-selected SDK versions', async () => {
    const dir = await tempDir()
    await expect(installClaudeBinary({ userDataDir: dir, version: '0.3.221' })).resolves.toEqual({
      ok: false,
      message: 'refusing unpinned Agent SDK version: 0.3.221'
    })
  })
})

describe('Agent SDK version consistency', () => {
  it('pins installer, Kun dependency, and lockfile to one exact version', async () => {
    const root = resolve(import.meta.dirname, '../..')
    const source = await readFile(join(root, 'src/main/agent-sdk-installer.ts'), 'utf8')
    const sdkVersion = source.match(/AGENT_SDK_VERSION = '([^']+)'/)?.[1]
    const manifest = JSON.parse(await readFile(join(root, 'kun/package.json'), 'utf8'))
    const lock = JSON.parse(await readFile(join(root, 'kun/package-lock.json'), 'utf8'))
    expect(sdkVersion).toBe('0.3.220')
    expect(manifest.dependencies['@anthropic-ai/claude-agent-sdk']).toBe(sdkVersion)
    expect(lock.packages[''].dependencies['@anthropic-ai/claude-agent-sdk']).toBe(sdkVersion)
    expect(lock.packages['node_modules/@anthropic-ai/claude-agent-sdk'].version).toBe(sdkVersion)
    for (const [packageName, integrity] of Object.entries(AGENT_SDK_INTEGRITY_BY_PACKAGE)) {
      expect(lock.packages[`node_modules/${packageName}`].version).toBe(sdkVersion)
      expect(lock.packages[`node_modules/${packageName}`].integrity).toBe(integrity)
    }
  })
})
