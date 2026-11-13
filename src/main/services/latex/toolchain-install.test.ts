import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LatexToolchainInstaller } from './toolchain-install'
import { tinyTexPlatform } from './toolchain-download'
import { readManagedLatexBin } from './toolchain-paths'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const payload = Buffer.from('verified official archive fixture')
const hash = createHash('sha256').update(payload).digest('hex')
async function fixture(platform = 'darwin') {
  const root = await mkdtemp(join(tmpdir(), 'kun-tex-install-')); roots.push(root)
  const name = `TinyTeX-1-${platform === 'win32' ? 'windows' : 'darwin'}-v2026.11.${platform === 'win32' ? 'exe' : 'tar.xz'}`
  const release = { tag_name: 'v2026.11', assets: [{ name, size: payload.length, digest: `sha256:${hash}` }] }
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.includes('api.github.com')
    ? Response.json(release) : new Response(payload))
  const run = vi.fn(async (command: string, _args: string[], options: { cwd: string; signal?: AbortSignal; onLog?: (text: string) => void }) => {
    if (command === 'tar' || command.endsWith('.exe') && command.includes('TinyTeX-1-')) {
      const bin = join(options.cwd, 'TinyTeX', 'bin', platform === 'win32' ? 'windows' : 'universal-darwin')
      await mkdir(bin, { recursive: true })
      for (const name of ['latexmk', 'pdflatex', 'xelatex', 'lualatex']) await writeFile(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    }
    options.onLog?.('tool output\n')
    return { code: 0, log: 'tool output', cancelled: false }
  })
  const states: string[] = []
  const installer = new LatexToolchainInstaller(root, { fetch: fetcher, platform, arch: 'x64', run, onState: (state) => states.push(state.phase) })
  return { root, release, fetcher, run, states, installer }
}

describe('managed TeX installation', () => {
  it('chooses official bundles for supported OS and architecture combinations', () => {
    expect(tinyTexPlatform('darwin', 'arm64')).toBe('darwin')
    expect(tinyTexPlatform('linux', 'arm64')).toBe('linux-arm64')
    expect(tinyTexPlatform('linux', 'x64', true)).toBe('linuxmusl-x86_64')
    expect(tinyTexPlatform('win32', 'x64')).toBe('windows')
    expect(tinyTexPlatform('linux', 'arm64', true)).toBeNull()
    expect(tinyTexPlatform('win32', 'ia32')).toBeNull()
  })
  it('coalesces installation requests, verifies tools and atomically publishes the managed path', async () => {
    const { installer, root, run, states, fetcher } = await fixture()
    const first = installer.install()
    expect(installer.install()).toBe(first)
    expect((await first).phase).toBe('ready')
    const bin = await readManagedLatexBin(root)
    expect(bin).toContain('universal-darwin')
    const status = await installer.status('xelatex')
    expect(status.tools.engine).toBe(join(bin!, 'xelatex'))
    expect(status.tools.latexmk).toBe(join(bin!, 'latexmk'))
    expect(states).toEqual(expect.arrayContaining(['resolving', 'downloading', 'verifying', 'extracting', 'configuring', 'ready']))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(run.mock.calls.filter(([, args]) => args.includes('--version'))).toHaveLength(4)
    expect((await readdir(root)).filter((name) => name.startsWith('work-'))).toEqual([])
  })
  it('rejects a corrupt download before extracting or replacing an existing installation', async () => {
    const { installer, root, fetcher, run } = await fixture()
    await writeFile(join(root, 'active.json'), '{"previous":true}')
    fetcher.mockImplementation(async (url) => url.includes('api.github.com')
      ? Response.json({ tag_name: 'v2026.11', assets: [{ name: 'TinyTeX-1-darwin-v2026.11.tar.xz', size: payload.length, digest: `sha256:${'0'.repeat(64)}` }] })
      : new Response(payload))
    const result = await installer.install()
    expect(result.phase).toBe('failed')
    expect(result.error).toMatch(/checksum/)
    expect(run.mock.calls.some(([command]) => command === 'tar')).toBe(false)
    expect(await readFile(join(root, 'active.json'), 'utf8')).toBe('{"previous":true}')
    expect(await readdir(root)).toEqual(['active.json'])
  })
  it('rejects missing checksums and allows retry after a failed release lookup', async () => {
    const { installer, release, fetcher } = await fixture()
    fetcher.mockResolvedValueOnce(Response.json({ ...release, assets: [{ ...release.assets[0], digest: null }] }))
    expect((await installer.install()).phase).toBe('failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await installer.install()).phase).toBe('ready')
  })
  it('cancels only the active job and cleans up without touching previous tools', async () => {
    const { installer, fetcher, root } = await fixture()
    let entered!: () => void
    const downloading = new Promise<void>((resolve) => { entered = resolve })
    fetcher.mockImplementation(async (url, init) => {
      if (url.includes('api.github.com')) return Response.json({ tag_name: 'v2026.11', assets: [{ name: 'TinyTeX-1-darwin-v2026.11.tar.xz', size: payload.length, digest: `sha256:${hash}` }] })
      entered()
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })
    await writeFile(join(root, 'active.json'), '{"previous":true}')
    const promise = installer.install()
    await downloading
    const state = (await installer.status('pdflatex')).state
    installer.cancel('another-job')
    expect((await installer.status('pdflatex')).state.phase).toBe('downloading')
    installer.cancel(state.jobId!)
    expect((await promise).phase).toBe('cancelled')
    expect(await readdir(root)).toEqual(['active.json'])
  })
  it('does not publish a path when engine verification fails', async () => {
    const { installer, run, root } = await fixture()
    const original = run.getMockImplementation()!
    run.mockImplementation(async (command, args, options) => command.endsWith('/xelatex')
      ? { code: 1, log: 'Engine cannot run', cancelled: false } : original(command, args, options))
    expect((await installer.install()).phase).toBe('failed')
    expect(await readdir(root)).toEqual([])
  })
  it('uses bundled Perl on Windows without executing a batch command', async () => {
    const { installer, run } = await fixture('win32')
    expect((await installer.install()).phase).toBe('ready')
    const manager = run.mock.calls.find(([command]) => command.endsWith('perl.exe'))
    expect(manager?.[1][0]).toMatch(/texmf-dist[/\\]scripts[/\\]texlive[/\\]tlmgr.pl$/)
    expect(manager?.[0]).toMatch(/tlpkg[/\\]tlperl[/\\]bin[/\\]perl.exe$/)
    expect(run.mock.calls.some(([command]) => /\.bat$/.test(command))).toBe(false)
  })
  it('rejects managed-path traversal in activation metadata', async () => {
    const { root } = await fixture()
    await writeFile(join(root, 'active.json'), JSON.stringify({ directory: '../outside', bin: 'bin/universal-darwin' }))
    expect(await readManagedLatexBin(root)).toBeNull()
  })
})
