import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildKunServeArgs,
  resolveKunExecutable,
  resolveKunRuntimeBuildId,
  type KunBinaryResolution
} from './resolve-kun-binary'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kun-resolver-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '', 'utf8')
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveKunExecutable', () => {
  it('resolves the built Kun entry from the app root', () => {
    const root = tempRoot()
    const entry = join(root, 'kun/dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveKunExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('does not fall back to TypeScript source files that Node cannot execute', () => {
    const root = tempRoot()
    touch(join(root, 'kun/src/cli/serve-entry.ts'))

    const resolution = resolveKunExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [join(root, 'kun/dist/cli/serve-entry.js')],
      dataDir: ''
    })
  })

  it('accepts a Kun package directory as a custom binary path', () => {
    const root = tempRoot()
    const entry = join(root, 'dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveKunExecutable('/app', root)

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('runs a non-JavaScript custom executable directly', () => {
    const resolution = resolveKunExecutable('/app', '/usr/local/bin/kun')

    expect(resolution).toEqual({
      kind: 'custom',
      command: '/usr/local/bin/kun',
      args: [],
      dataDir: ''
    })
  })
})

describe('resolveKunRuntimeBuildId', () => {
  it('reads the manifest adjacent to the resolved dist entry', async () => {
    const root = tempRoot()
    const entry = join(root, 'kun/dist/cli/serve-entry.js')
    const buildId = 'a'.repeat(64)
    touch(entry)
    writeFileSync(
      join(root, 'kun/dist/runtime-build.json'),
      `${JSON.stringify({ version: 1, buildId })}\n`,
      'utf8'
    )

    await expect(resolveKunRuntimeBuildId(
      resolveKunExecutable(root, '')
    )).resolves.toBe(buildId)
  })

  it('keeps custom native executables and missing manifests compatible', async () => {
    const root = tempRoot()
    const entry = join(root, 'kun/dist/cli/serve-entry.js')
    touch(entry)

    await expect(resolveKunRuntimeBuildId(
      resolveKunExecutable(root, '')
    )).resolves.toBeUndefined()
    await expect(resolveKunRuntimeBuildId(
      resolveKunExecutable('/app', '/usr/local/bin/kun')
    )).resolves.toBeUndefined()
  })
})

describe('buildKunServeArgs', () => {
  it('does not place runtime secrets on the child process argv', () => {
    const resolution: KunBinaryResolution = {
      kind: 'node-script',
      command: '/usr/bin/node',
      args: ['/app/kun/dist/cli/serve-entry.js'],
      dataDir: ''
    }

    const args = buildKunServeArgs({
      resolution,
      host: '127.0.0.1',
      port: 18899,
      dataDir: '/tmp/kun',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'user',
      tokenEconomyMode: false,
      insecure: false
    })

    expect(args).not.toContain('--api-key')
    expect(args).not.toContain('--runtime-token')
    expect(args).not.toContain('--base-url')
    expect(args).not.toContain('--model-proxy-url')
    expect(args).not.toContain('--endpoint-format')
    expect(args).not.toContain('--model')
    expect(args).toContain('serve')
    expect(args).toContain('--token-economy-mode')
    expect(args).toContain('false')
    expect(args).toContain('--approval-reviewer')
    expect(args).toContain('user')
  })

  it('caps the young generation only for Node-script launches, ahead of the entry', () => {
    const base = {
      host: '127.0.0.1', port: 0, dataDir: '/tmp/kun', approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write', approvalReviewer: 'user', tokenEconomyMode: false, insecure: false
    }
    const script = buildKunServeArgs({ ...base, resolution: {
      kind: 'node-script', command: '/usr/bin/node', args: ['/app/kun/dist/cli/serve-entry.js'], dataDir: ''
    } })
    expect(script.slice(0, 2)).toEqual(['--max-semi-space-size=8', '/app/kun/dist/cli/serve-entry.js'])
    const binary = buildKunServeArgs({ ...base, resolution: {
      kind: 'custom', command: '/usr/local/bin/kun', args: [], dataDir: ''
    } })
    expect(binary[0]).toBe('serve')
  })
})
