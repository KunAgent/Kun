import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { googleWorkspaceBundleRoot, resolveGoogleWorkspaceBinary } from './binary.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(packaged = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gws-binary-test-'))); roots.push(root)
  const content = 'verified fake binary'
  const sha256 = createHash('sha256').update(content).digest('hex')
  const asset = { name: 'gws-test-asset', size: Buffer.byteLength(content), sha256 }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, version: '0.22.5', releaseTag: 'v0.22.5', assets: { 'linux-x64': asset } }))
  const dir = packaged ? root : join(root, 'current'); await mkdir(dir, { recursive: true })
  const selected = { schemaVersion: 1, version: '0.22.5', releaseTag: 'v0.22.5', asset: 'gws-test-asset', platform: 'linux', arch: 'x64', ...asset }
  await writeFile(join(dir, 'selected.json'), JSON.stringify(selected))
  await writeFile(join(dir, 'gws'), content)
  return { root, dir, selected }
}
describe('pinned bundled gws resolution', () => {
  it('derives dev and packaged paths without environment or PATH', () => {
    expect(googleWorkspaceBundleRoot('file:///repo/kun/dist/google-workspace/binary.js')).toBe('/repo/resources/google-workspace')
    expect(googleWorkspaceBundleRoot('file:///app/resources/app.asar.unpacked/kun/dist/google-workspace/binary.js')).toBe('/app/resources/google-workspace')
  })
  it('checks original binary hash and platform selection', async () => {
    const f = await fixture()
    expect(await resolveGoogleWorkspaceBinary(f.root, 'linux', 'x64', false)).toMatchObject({ version: '0.22.5', path: join(f.dir, 'gws') })
    await writeFile(join(f.dir, 'gws'), 'tampered')
    await expect(resolveGoogleWorkspaceBinary(f.root, 'linux', 'x64', false)).rejects.toThrow(/checksum/)
    await expect(resolveGoogleWorkspaceBinary(f.root, 'linux', 'arm64', false)).rejects.toThrow(/platform/)
  })
  it('rejects symlinked executable even when bytes match', async () => {
    const f = await fixture()
    await rm(join(f.dir, 'gws'))
    await writeFile(join(f.root, 'outside'), 'verified fake binary')
    await symlink(join(f.root, 'outside'), join(f.dir, 'gws'))
    await expect(resolveGoogleWorkspaceBinary(f.root, 'linux', 'x64', false)).rejects.toThrow(/Unsafe/)
  })
  it('accepts post-sign attestation only with pinned original provenance and matching signed size/hash', async () => {
    const f = await fixture(true)
    const signed = 'signed fake binary'
    await writeFile(join(f.dir, 'gws'), signed)
    await writeFile(join(f.dir, 'selected.json'), JSON.stringify({ ...f.selected, packagedSize: Buffer.byteLength(signed), packagedSha256: createHash('sha256').update(signed).digest('hex') }))
    expect(await resolveGoogleWorkspaceBinary(f.root, 'linux', 'x64', true)).toMatchObject({ version: '0.22.5' })
    await writeFile(join(f.dir, 'selected.json'), JSON.stringify({ ...f.selected, sha256: '0'.repeat(64) }))
    await expect(resolveGoogleWorkspaceBinary(f.root, 'linux', 'x64', true)).rejects.toThrow(/selection/)
  })
})
