import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, rename, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { projects } from './project-directory.js'
import { RemoteProjectFiles } from './projects.js'
import { registerRemoteRoutes } from '../routes.js'
async function fixture() {
  const f = await remoteFixture(), workspace = await realpath(await mkdtemp(join(tmpdir(), 'kun-project-read-')))
  await f.h.threads.create({ workspace, title: 'Project', model: 'fake', agentSurface: 'code', workspaceMode: 'code', mode: 'agent' })
  const project = (await projects(f.runtime)).find((p) => p.path === workspace)!
  const files = f.facade.projectFiles, scope = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant' }
  return { ...f, workspace, files, scope, projectId: project.id,
    cleanup: async () => { await f.close(); await rm(workspace, { recursive: true, force: true }) } }
}
describe('Scoped project browsing and protected export', () => {
  it('lists actual files, previews metadata, reads through verified fd, rejects another owner/device/grant and stale versions', async () => {
    const f = await fixture()
    try {
      await writeFile(join(f.workspace, 'hello.txt'), 'project contents')
      const listed = await f.files.page(f.scope, { projectId: f.projectId, limit: 50 })
      const entry = listed.entries.find((e) => e.name === 'hello.txt')!
      expect(entry).toMatchObject({ kind: 'file', available: true, size: 16 })
      const preview = await f.files.preview(f.scope, { projectId: f.projectId, fileRef: entry.fileRef, expectedRevision: entry.revision })
      expect(preview.export).toEqual({ projectId: f.projectId, fileRef: entry.fileRef, revision: entry.revision })
      expect(preview).not.toHaveProperty('data')
      const content = await f.files.read(f.scope, f.projectId, entry.fileRef, entry.revision)
      expect(content.data.toString()).toBe('project contents')
      for (const field of ['accountId', 'deviceId', 'authorizationId'])
        await expect(f.files.read({ ...f.scope, [field]: 'other' }, f.projectId, entry.fileRef, entry.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
      await writeFile(join(f.workspace, 'hello.txt'), 'new file version')
      await expect(f.files.read(f.scope, f.projectId, entry.fileRef, entry.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
      const freshProcess = new RemoteProjectFiles(f.runtime)
      await expect(freshProcess.read(f.scope, f.projectId, entry.fileRef, entry.revision)).rejects.toThrow('FILE_NOT_ALLOWED')
    } finally { await f.cleanup() }
  })
  it('denies symlink escapes, runtime private data/config, credential files and accepts normal nested source', async () => {
    const f = await fixture()
    try {
      await mkdir(join(f.workspace, 'src'))
      await writeFile(join(f.workspace, 'src', 'index.ts'), 'export const value = 1')
      await writeFile(join(f.workspace, '.env.local'), 'PRIVATE')
      await mkdir(join(f.workspace, '.ssh'))
      await writeFile(join(f.workspace, '.ssh', 'id_ed25519'), 'PRIVATE')
      await symlink(f.root, join(f.workspace, 'runtime-data'))
      await symlink(join(f.root, 'rooms.sqlite'), join(f.workspace, 'outside-file'))
      await writeFile(join(f.workspace, 'local-config.json'), '{}')
      f.runtime.remoteProtectedPaths = [join(f.workspace, 'local-config.json')]
      const page = await f.files.page(f.scope, { projectId: f.projectId, limit: 50 })
      expect(page.entries.map((e) => e.name)).toEqual(['src'])
      const dir = page.entries[0]
      const child = await f.files.page(f.scope, { projectId: f.projectId, parentRef: dir.fileRef, limit: 50 })
      expect(child.entries[0].name).toBe('index.ts')
      expect(child.entries[0].displayPath).toBe('src/index.ts')
      await expect(f.files.page(f.scope, { projectId: f.projectId, parentRef: '../src', limit: 50 })).rejects.toThrow()
      await rename(join(f.workspace, 'src'), join(f.workspace, 'previous'))
      await symlink(f.root, join(f.workspace, 'src'))
      await expect(f.files.read(f.scope, f.projectId, child.entries[0].fileRef, child.entries[0].revision)).rejects.toThrow()
    } finally { await f.cleanup() }
  })
  it('continues bounded content search beyond the first megabyte and returns opaque cursors without client paths', async () => {
    const f = await fixture()
    try {
      await writeFile(join(f.workspace, 'large.txt'), 'a'.repeat(1100000) + ' late-match-value')
      const p = { projectId: f.projectId, query: 'late-match-value', mode: 'content' as const, limit: 1 }
      const first = await f.files.page(f.scope, p)
      expect(first.entries).toEqual([])
      expect(first.hasMore).toBe(true)
      expect(first.nextCursor).toMatch(/^scan_[a-f0-9]+$/)
      expect(first.nextCursor).not.toContain(f.workspace)
      await expect(f.files.page({ ...f.scope, deviceId: 'other' }, { ...p, cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      let page = first
      const second = await f.files.page(f.scope, { ...p, cursor: first.nextCursor })
      expect(await f.files.page(f.scope, { ...p, cursor: first.nextCursor })).toEqual(second)
      page = second
      for (let i = 0; i < 5 && !page.entries.length; i++) page = await f.files.page(f.scope, { ...p, cursor: page.nextCursor })
      expect(page.entries[0].name).toBe('large.txt')
    } finally { await f.cleanup() }
  })
  it('requires runtime auth and matching scope headers on content route, and caps exported file bytes', async () => {
    const f = await fixture()
    try {
      await writeFile(join(f.workspace, 'visible.txt'), 'verified')
      await writeFile(join(f.workspace, 'too-large.bin'), Buffer.alloc(25 * 1024 * 1024 + 1))
      registerRemoteRoutes(f.router, f.runtime)
      const invoke = f.router.match('POST', '/v1/remote/invoke')!
      const body = f.envelope('project.files.list', { projectId: f.projectId })
      const reply = await invoke.handler(new Request('http://local/v1/remote/invoke', { method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: {} })
      const page = reply instanceof Response ? await reply.json() : JSON.parse(reply.body)
      const entry = page.entries.find((e: any) => e.name === 'visible.txt'), large = page.entries.find((e: any) => e.name === 'too-large.bin')
      expect(large.available).toBe(false)
      const path = '/v1/remote/project-files/' + f.projectId + '/' + entry.fileRef
      const route = f.router.match('GET', path)!, url = 'http://local' + path + '?revision=' + entry.revision
      const headers = { Authorization: 'Bearer token', 'X-Kun-Remote-Account': 'owner',
        'X-Kun-Remote-Device': 'phone', 'X-Kun-Remote-Authorization': 'connection' }
      expect((await route.handler(new Request(url), { params: route.params })).status).toBe(401)
      expect((await route.handler(new Request(url, { headers: { Authorization: 'Bearer token' } }), { params: route.params })).status).toBe(403)
      const content = await route.handler(new Request(url, { headers }), { params: route.params }) as Response
      expect(content.status).toBe(200)
      expect(await content.text()).toBe('verified')
    } finally { await f.cleanup() }
  })
})
