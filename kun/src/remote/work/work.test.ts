import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasOperation } from '@kun/remote-protocol'
import { remoteFixture } from '../testing/runtime.test-support.js'

async function fixture() {
  const f = await remoteFixture(), root = await realpath(await mkdtemp(join(tmpdir(), 'kun-work-space-')))
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'kun-work-outside-')))
  await mkdir(join(root, 'docs')); await writeFile(join(root, 'docs', 'a.md'), '# A'); await writeFile(join(root, 'chart.png'), 'png')
  await writeFile(join(root, '.env'), 'SECRET=1'); await writeFile(join(outside, 'private.md'), 'private')
  await symlink(join(outside, 'private.md'), join(root, 'leak.md'))
  return { ...f, root, cleanup: async () => { await f.close(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) } }
}
const workThread = (f: Awaited<ReturnType<typeof fixture>>, title = 'Draft') =>
  f.h.threads.create({ workspace: f.root, title, model: 'fake', agentSurface: 'write', mode: 'agent' })

describe('Work spaces and sessions on the phone', () => {
  it('lists only Work sessions of the space, leaves Code home alone and hides the local path', async () => {
    const f = await fixture()
    try {
      const work = await workThread(f), code = await f.code()
      const { spaces } = await f.call('work.spaces.list', {}), space = spaces.find((row: any) => row.name === f.root.split('/').pop())
      expect(space).toMatchObject({ sessionCount: 1 })
      expect(space).not.toHaveProperty('path')
      const page = await f.call('work.sessions.list', { spaceId: space.id })
      expect(page.threads.map((row: any) => row.id)).toEqual([work.id])
      expect((await f.call('code.search', {})).threads.map((row: any) => row.id)).toEqual([code.id])
      expect((await f.call('catalog.get', {})).projects.some((row: any) => row.id === space.id)).toBe(false)
      expect(hasOperation(await f.call('catalog.get', {}), 'work.sessions.list')).toBe(true)
      await expect(f.call('work.sessions.list', { spaceId: 'missing' })).rejects.toThrow()
    } finally { await f.cleanup() }
  })
  it('opens a Work session through the existing history route and creates one on the Work surface', async () => {
    const f = await fixture()
    try {
      const work = await workThread(f)
      const space = (await f.call('work.spaces.list', {})).spaces[0]
      expect((await f.call('code.history', { threadId: work.id })).items ?? []).toBeDefined()
      const created = await f.call('code.create', { projectId: space.id, title: 'From phone', surface: 'work' }, 'create_work')
      expect(created.thread ?? created.receipt?.result?.thread).toMatchObject({ workspace: f.root, agentSurface: 'write' })
    } finally { await f.cleanup() }
  })
  it('reads a space through project files; a relative path resolves only inside and never to protected files', async () => {
    const f = await fixture()
    try {
      await workThread(f)
      const projectId = (await f.call('work.spaces.list', {})).spaces[0].id
      const root = await f.call('project.files.list', { projectId })
      expect(root.entries.map((row: any) => row.name)).toContain('docs')
      const doc = (await f.call('project.files.resolve', { projectId, relativePath: 'docs/a.md' })).file
      expect(doc).toMatchObject({ name: 'a.md', displayPath: 'docs/a.md', kind: 'file' })
      expect(doc.modifiedAt).toBeGreaterThan(0)
      expect((await f.call('project.files.resolve', { projectId, relativePath: '../chart.png', baseRef: doc.fileRef })).file.name).toBe('chart.png')
      for (const relativePath of ['../../etc/passwd', '.env', 'leak.md'])
        await expect(f.call('project.files.resolve', { projectId, relativePath })).rejects.toThrow()
      await expect(f.call('project.files.resolve', { projectId, relativePath: 'nope.md' })).rejects.toThrow()
    } finally { await f.cleanup() }
  })
  it('names a session after the document line the phone sends and survives an unnamed thread', async () => {
    const f = await fixture()
    try {
      const work = await workThread(f, 'Write Assistant')
      const projectId = (await f.call('work.spaces.list', {})).spaces[0].id
      expect((await f.call('work.sessions.list', { spaceId: projectId })).threads[0]).toMatchObject({ id: work.id, title: '' })
    } finally { await f.cleanup() }
  })
})
describe('Work session anchors', () => {
  it('reads the file from composer references and from the first line a phone sends, staying inside the space', async () => {
    const f = await fixture()
    try {
      const { workSessionAnchor } = await import('./anchor.js')
      const items = [{ kind: 'user_message', text: '当前文档：docs/a.md\n\n总结一下' }]
      const runtime = { sessionStore: { loadItemPage: async () => ({ items, hasMore: false }) } } as never
      expect(await workSessionAnchor(runtime, { id: 't1', updatedAt: '1' }, f.root)).toBe('docs/a.md')
      items.push({ kind: 'user_message', text: 'x', composerContexts: [{ reference: { kind: 'work-reference-resource', locator: join(f.root, 'chart.png') } }] } as never)
      expect(await workSessionAnchor(runtime, { id: 't1', updatedAt: '2' }, f.root)).toBe('chart.png')
      const outside = [{ kind: 'user_message', text: '> Current document: ../../etc/passwd' }]
      const other = { sessionStore: { loadItemPage: async () => ({ items: outside, hasMore: false }) } } as never
      expect(await workSessionAnchor(other, { id: 't2', updatedAt: '1' }, f.root)).toBeUndefined()
    } finally { await f.cleanup() }
  })
})
