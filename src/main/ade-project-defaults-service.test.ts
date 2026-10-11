import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdeProjectDefaultsMutationSchema } from '../shared/ade-project-defaults'
import { JsonSettingsStore } from './settings-store'
import { canonicalAdeProjectIdentity } from './ade-project-identity'
import { createAdeProjectDefaultsService } from './ade-project-defaults-service'

const roots: string[] = []
const git = promisify(execFile)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-ade-project-'))
  roots.push(root)
  const store = new JsonSettingsStore(root)
  await store.load()
  let generation = 0
  const onCommitted = vi.fn(() => ++generation)
  const service = createAdeProjectDefaultsService({
    store, serializePersistence: (operation) => operation(), onCommitted
  })
  return { root, store, service, onCommitted }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('canonical ADE project defaults', () => {
  it('keeps same-name directories separate and symlinks at the same identity', async () => {
    const { root, service } = await fixture()
    const first = join(root, 'a', 'project')
    const second = join(root, 'b', 'project')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    const alias = join(root, 'alias')
    await symlink(first, alias)
    const firstSnapshot = await service.get({ projectPath: first })
    const secondSnapshot = await service.get({ projectPath: second })
    expect(firstSnapshot.project.key).not.toBe(secondSnapshot.project.key)
    await service.save({
      projectPath: first, expectedRevision: firstSnapshot.revision,
      set: { route: { harnessId: 'kun', model: 'm' }, collaborationEnabled: true }
    })
    expect((await service.get({ projectPath: alias })).value.collaborationEnabled).toBe(true)
    expect((await service.get({ projectPath: second })).value).toEqual({})
  })

  it('maps a linked git worktree to its source project', async () => {
    const { root } = await fixture()
    const repo = join(root, 'repo')
    const worktree = join(root, 'worktree')
    await mkdir(repo)
    const run = (...args: string[]) => git('git', ['-C', repo, ...args])
    await run('init', '--quiet')
    await run('config', 'user.email', 'test@example.com')
    await run('config', 'user.name', 'Test')
    await writeFile(join(repo, 'a.txt'), 'base\n')
    await run('add', 'a.txt')
    await run('commit', '--quiet', '-m', 'base')
    await run('worktree', 'add', '--quiet', '-b', 'work', worktree)
    expect(await canonicalAdeProjectIdentity(worktree)).toEqual(await canonicalAdeProjectIdentity(repo))
  })

  it('uses object CAS and preserves unrelated project/settings writes', async () => {
    const { root, service, store, onCommitted } = await fixture()
    const first = join(root, 'project-a')
    const second = join(root, 'project-b')
    await mkdir(first)
    await mkdir(second)
    const old = await service.get({ projectPath: first })
    const other = await service.get({ projectPath: second })
    const saved = await service.save({
      projectPath: first, expectedRevision: old.revision,
      set: { route: { harnessId: 'kun', model: 'm' }, collaborationEnabled: true }
    })
    expect(saved).toMatchObject({ ok: true, generation: 1 })
    const conflict = await service.save({
      projectPath: first, expectedRevision: old.revision,
      set: { isolation: 'worktree' }
    })
    expect(conflict).toMatchObject({ ok: false, kind: 'conflict' })
    await store.patch({ agents: { kun: { ade: { notifications: { waiting: false } } } } })
    const separate = await service.save({
      projectPath: second, expectedRevision: other.revision,
      set: { isolation: 'directory' }
    })
    expect(separate.ok).toBe(true)
    expect((await service.get({ projectPath: first })).value.route?.model).toBe('m')
    expect((await store.load()).agents.kun.ade.notifications.waiting).toBe(false)
    expect(onCommitted).toHaveBeenCalledTimes(2)
    const current = await service.get({ projectPath: first })
    await service.save({ projectPath: first, expectedRevision: current.revision,
      unset: ['route', 'collaborationEnabled'] })
    expect((await service.get({ projectPath: first })).value.route).toBeUndefined()
  })

  it('rejects credential fields, duplicate operations and incomplete routes', () => {
    const base = { projectPath: '/tmp/project', expectedRevision: 'rev' }
    expect(AdeProjectDefaultsMutationSchema.safeParse({
      ...base, set: { apiKey: 'secret' }
    }).success).toBe(false)
    expect(AdeProjectDefaultsMutationSchema.safeParse({
      ...base, set: { route: { harnessId: 'claude-code', model: 'm', credentialMode: 'provider' } }
    }).success).toBe(false)
    expect(AdeProjectDefaultsMutationSchema.safeParse({
      ...base, set: { collaborationEnabled: true }, unset: ['collaborationEnabled']
    }).success).toBe(false)
  })
})
