import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitChanges } from './git.js'
import { permittedProjectChange } from '../files/project-file-permissions.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-changes-')); roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  await writeFile(join(root, 'sample.txt'), 'before\n'); git('add', '.'); git('commit', '-m', 'baseline')
  return { root, git, changes: new GitChanges(root, async () => true) }
}
describe('workspace changes', () => {
  it('reads staged, unstaged and untracked files with real patches and rejects stale revisions', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'sample.txt'), 'after\n'); f.git('add', 'sample.txt')
    await writeFile(join(f.root, 'new.txt'), 'new file\n')
    const snapshot = await f.changes.list()
    expect(snapshot.files.map(file => file.path)).toEqual(['sample.txt', 'new.txt'])
    expect((await f.changes.get('sample.txt', snapshot.revision)).patch).toContain('+after')
    expect((await f.changes.get('new.txt', snapshot.revision)).patch).toContain('+new file')
    await writeFile(join(f.root, 'sample.txt'), 'later\n')
    await expect(f.changes.get('sample.txt', snapshot.revision)).rejects.toThrow('CHANGES_REVISION_CONFLICT')
  }, 20000)
  it('never reads paths outside the authorized workspace or an untracked symlink target', async () => {
    const f = await fixture()
    await symlink('/etc/passwd', join(f.root, 'linked.txt'))
    const snapshot = await f.changes.list()
    await expect(f.changes.get('../private', snapshot.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
    await expect(f.changes.get('.git/config', snapshot.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
    await expect(f.changes.get('linked.txt', snapshot.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
  }, 20000)
  it('reports a non-git workspace honestly and handles binary and large untracked files', async () => {
    const f = await fixture()
    await mkdir(join(f.root, 'plain')); const plain = await mkdtemp(join(tmpdir(), 'kun-plain-')); roots.push(plain)
    expect((await new GitChanges(plain, async () => true).list()).repository).toBe(false)
    await writeFile(join(f.root, 'binary.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(f.root, 'large.txt'), 'hello\n'.repeat(40000))
    const snapshot = await f.changes.list()
    expect((await f.changes.get('binary.bin', snapshot.revision)).binary).toBe(true)
    const large = await f.changes.get('large.txt', snapshot.revision)
    expect(large.truncated).toBe(true); expect(large.patch.length).toBeLessThanOrEqual(131072)
  }, 20000)
  it('keeps credential and runtime paths private, including deleted files and aliases', async () => {
    const f = await fixture()
    await writeFile(join(f.root, '.env.local'), 'PRIVATE_TOKEN=fixture')
    f.git('add', '-f', '.env.local'); f.git('commit', '-m', 'credential fixture')
    await mkdir(join(f.root, 'runtime-private'))
    await writeFile(join(f.root, 'runtime-private', 'state.ts'), 'private state')
    await symlink(join(f.root, '.env.local'), join(f.root, 'public-alias.ts'))
    await rm(join(f.root, '.env.local')); await rm(join(f.root, 'sample.txt'))
    const runtime = { rooms: { deps: { dataDir: join(f.root, 'runtime-private') } } } as unknown as ServerRuntime
    const changes = new GitChanges(f.root, (root, path) => permittedProjectChange(runtime, root, path))
    const snapshot = await changes.list()
    expect(snapshot.files.map(file => file.path)).toEqual(['sample.txt'])
    expect((await changes.get('sample.txt', snapshot.revision)).patch).toContain('-before')
    await expect(changes.get('.env.local', snapshot.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
    await expect(changes.get('runtime-private/state.ts', snapshot.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
  }, 20000)
})
