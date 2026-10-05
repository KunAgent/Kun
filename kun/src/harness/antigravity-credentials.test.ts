import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { antigravityCredentialEvidence } from './antigravity-credentials.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function home() { const dir = await mkdtemp(join(tmpdir(), 'agy-credentials-')); dirs.push(dir); return dir }
const attributes = '"svce"<blob>="gemini"\n"acct"<blob>="antigravity"\n"mdat"<timedate>="one"'
describe('Antigravity native credential evidence', () => {
  it('checks the exact macOS keyring entry attributes without retrieving the secret', async () => {
    const root = await home()
    const spawn = vi.fn(async () => ({ exitCode: 0, timedOut: false, stdout: attributes, stderr: '' }))
    const deps = { platform: 'darwin' as const, home: root, spawn }
    const first = await antigravityCredentialEvidence({ HOME: root }, deps)
    expect(first.configured).toBe(true)
    expect(spawn).toHaveBeenCalledWith('/usr/bin/security', ['find-generic-password', '-s', 'gemini', '-a', 'antigravity'],
      expect.objectContaining({ timeoutMs: 3000, env: { HOME: root } }))
    expect(JSON.stringify(first)).not.toContain(attributes)
    spawn.mockResolvedValueOnce({ exitCode: 0, timedOut: false, stdout: attributes.replace('one', 'two'), stderr: '' })
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).fingerprint).not.toBe(first.fingerprint)
    spawn.mockResolvedValueOnce({ exitCode: 44, timedOut: false, stdout: '', stderr: '' })
    expect((await antigravityCredentialEvidence({ HOME: root }, deps)).configured).toBe(false)
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
