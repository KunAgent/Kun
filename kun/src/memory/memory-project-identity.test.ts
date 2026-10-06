import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryRecord } from '../contracts/memory.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { HybridMemoryStore } from '../adapters/hybrid/hybrid-memory-store.js'
import { canonicalProjectIdentity } from '../shared/project-identity.js'
import { FileMemoryStore, type MemoryStore } from './memory-store.js'
import { buildMemoryReadTools } from '../adapters/tool/memory-read-tools.js'
import { memoryInScope } from './memory-ranking.js'
import { resolveMemoryProjectAccess } from './memory-project-identity.js'
import { resolveMemoryTurnContext } from './memory-turn-context.js'

const execFileAsync = promisify(execFile)
const policy: MemoryCapabilityConfig = {
  enabled: true, scopes: ['user', 'workspace', 'project'], maxInjectedRecords: 20,
  distillation: { enabled: false }, directives: { enabled: true, maxRecords: 20, maxCharacters: 4_000 }
}
const timestamp = '2026-08-28T00:00:00.000Z'
const stores: MemoryStore[] = []
let root: string
let source: string
let worktree: string
let alias: string
let unrelated: string

async function git(path: string, ...args: string[]) {
  return execFileAsync('git', ['-C', path, ...args], { timeout: 10_000 })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-memory-project-'))
  source = join(root, 'source')
  worktree = join(root, 'worktree')
  alias = join(root, 'alias')
  unrelated = join(root, 'unrelated')
  await Promise.all([mkdir(source), mkdir(unrelated)])
  await git(source, 'init')
  await git(source, '-c', 'user.name=Memory Test', '-c', 'user.email=memory@example.invalid',
    'commit', '--allow-empty', '-m', 'initial')
  await git(source, 'worktree', 'add', '-b', 'memory-test', worktree)
  await git(unrelated, 'init')
  // Even equal remotes do not make independently initialized repositories one project.
  await git(source, 'remote', 'add', 'origin', 'https://example.invalid/shared-repo.git')
  await git(unrelated, 'remote', 'add', 'origin', 'https://example.invalid/shared-repo.git')
  await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
})

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.shutdown?.()))
  await rm(root, { recursive: true, force: true })
})

function makeStore(mode: 'file' | 'fts' | 'fallback') {
  const dataDir = join(root, mode)
  const store: MemoryStore = mode === 'file'
    ? new FileMemoryStore({ rootDir: join(dataDir, 'memory'), config: policy, nowIso: () => timestamp })
    : new HybridMemoryStore({ dataDir, config: policy, nowIso: () => timestamp,
      ...(mode === 'fallback' ? { databaseFactory: () => { throw new Error('intentional SQLite failure') } } : {}) })
  stores.push(store)
  return { store, dataDir }
}

describe('approved project memory identity', () => {
  for (const mode of ['file', 'fts', 'fallback'] as const) {
    it(`blocks forgotten project recapture across symlink/worktree identities in ${mode}`, async () => {
      const { store } = makeStore(mode)
      const saved = await store.createWithId!('mem_forgotten_project', {
        content: 'canonical project confidential rule', scope: 'project', workspace: alias
      })
      await store.delete(saved.id, { workspace: worktree })
      await expect(store.createWithId!('mem_recaptured_project', {
        content: saved.content, scope: 'project', workspace: worktree
      })).rejects.toThrow('forgotten')
      expect(await store.retrieve({ query: 'confidential rule', workspace: source, limit: 20 })).toEqual([])
    })

    it(`uses the same binary keyset order for mixed-case timestamp ties in ${mode}`, async () => {
      const { store } = makeStore(mode)
      const ids = ['mem_a', 'mem_A', 'mem_Z', 'mem_z', 'mem_a_b', 'mem_a-b', 'mem_a0']
      for (const id of ids) await store.createWithId!(id, { content: id, scope: 'user' })
      const list = buildMemoryReadTools(store).find((tool) => tool.name === 'memory_list')!
      const received: string[] = []
      let cursor: string | undefined
      do {
        const result = await list.execute({ limit: 1, ...(cursor ? { cursor } : {}) }, {
          threadId: 'thread', turnId: 'turn', workspace: source,
          memoryPolicy: { enabled: true }, approvalPolicy: 'auto',
          awaitApproval: async () => 'allow', abortSignal: new AbortController().signal
        })
        const page = result.output as { memories: Array<{ id: string }>; nextCursor?: string }
        received.push(...page.memories.map((record) => record.id))
        cursor = page.nextCursor
        expect(received.length).toBeLessThanOrEqual(ids.length)
      } while (cursor)
      expect(received).toEqual([...ids].sort())
    })

    it(`shares approved project knowledge across symlinks and worktrees in ${mode}, keeping branch facts narrow`, async () => {
      const { store } = makeStore(mode)
      const approved = await store.createWithId!('mem_project', {
        content: 'project convention stable naming', scope: 'project', workspace: alias,
        provenance: { kind: 'user' }
      })
      const expected = await canonicalProjectIdentity(source)
      expect(approved.projectIdentity).toBe(expected.key)
      expect((await canonicalProjectIdentity(worktree)).key).toBe(expected.key)
      await store.createWithId!('mem_branch', {
        content: 'project convention branch result', scope: 'workspace', workspace: worktree
      })
      await store.createWithId!('mem_observed', {
        content: 'project convention transient build', scope: 'project', workspace: worktree,
        provenance: { kind: 'tool' }
      })
      if (store instanceof HybridMemoryStore) await store.waitForBackfill()

      for (const path of [source, alias, worktree]) {
        const records = await store.list({ workspace: path })
        expect(records.map((record) => record.id)).toContain('mem_project')
        expect((await store.getById!('mem_project', { workspace: path })).id).toBe('mem_project')
        const selected = await store.retrieve({ query: 'stable naming', workspace: path, limit: 20 })
        expect(selected.map((record) => record.id)).toContain('mem_project')
      }
      expect((await store.list({ workspace: source })).map((record) => record.id)).toEqual(['mem_project'])
      expect((await store.list({ workspace: worktree })).map((record) => record.id)).toEqual([
        'mem_branch', 'mem_observed', 'mem_project'
      ])
      expect(await store.list({ workspace: unrelated })).toEqual([])
      expect(await store.retrieve({ query: 'project convention', workspace: unrelated, limit: 20 })).toEqual([])
      await expect(store.getById!('mem_project', { workspace: unrelated })).rejects.toThrow('memory not found')
      // Forged resolved keys cannot widen an unrelated access path at the store boundary.
      expect(await store.list({ workspace: unrelated, projectIdentity: expected.key })).toEqual([])
      const turn = await resolveMemoryTurnContext(store as Parameters<typeof resolveMemoryTurnContext>[0], {
        query: 'stable naming', workspace: worktree
      })
      expect(turn.memories.map((record) => record.id)).toContain('mem_project')
      if (mode === 'fts') expect((await store.diagnostics()).lastRetrieval?.mode).toBe('sqlite-fts5')
      if (mode === 'fallback') expect((await store.diagnostics()).lastRetrieval?.mode).toBe('filesystem-fallback')
    })

    it(`does not broaden legacy projects on read, reindex, correction or supersession in ${mode}`, async () => {
      const { store, dataDir } = makeStore(mode)
      await store.ready?.()
      // Simulate a canonical record written before project identities existed.
      const legacy = MemoryRecord.parse({
        id: 'mem_legacy', content: 'legacy project naming convention', scope: 'project',
        workspace: source, project: source, createdAt: timestamp, updatedAt: timestamp
      })
      await mkdir(join(dataDir, 'memory'), { recursive: true })
      await writeFile(join(dataDir, 'memory', 'mem_legacy.json'), JSON.stringify(legacy))
      if (store instanceof HybridMemoryStore) {
        await store.shutdown()
        stores.splice(stores.indexOf(store), 1)
      }
      const restarted = mode === 'file' ? store : makeStore(mode).store
      if (restarted instanceof HybridMemoryStore) await restarted.waitForBackfill()
      expect((await restarted.list({ workspace: source })).map((record) => record.id)).toEqual(['mem_legacy'])
      expect(await restarted.list({ workspace: worktree })).toEqual([])
      expect(await restarted.list({ workspace: alias })).toEqual([])
      await expect(restarted.getById!('mem_legacy', { workspace: worktree })).rejects.toThrow('memory not found')
      const before = JSON.parse(await readFile(join(dataDir, 'memory', 'mem_legacy.json'), 'utf8'))
      expect(before.projectIdentity).toBeUndefined()
      const revised = await restarted.update('mem_legacy', { content: 'corrected legacy convention' }, { workspace: source })
      expect(revised.projectIdentity).toBeUndefined()
      const superseding = await restarted.createWithId!('mem_new_version', {
        content: 'superseding legacy convention', scope: 'project', workspace: source,
        supersedes: 'mem_legacy', provenance: { kind: 'user' }
      })
      expect(superseding.projectIdentity).toBeUndefined()
      expect(await restarted.retrieve({ query: 'legacy convention', workspace: worktree, limit: 20 })).toEqual([])
    })
  }

  it('uses the same identity for approved tool creation and later retrieval from another worktree', async () => {
    const { store } = makeStore('file')
    const create = buildMemoryToolProviders(store)[0].tools.find((tool) => tool.name === 'memory_create')!
    const result = await create.execute({ content: 'project API naming policy', scope: 'project' }, {
      threadId: 'thread', turnId: 'turn', workspace: worktree,
      memoryPolicy: { enabled: true }, approvalPolicy: 'on-request',
      awaitApproval: async () => 'allow', abortSignal: new AbortController().signal
    })
    expect(result.output).toMatchObject({ memory: { projectIdentity: (await canonicalProjectIdentity(source)).key } })
    expect((await store.retrieve({ query: 'API naming policy', workspace: alias, limit: 20 })).length).toBe(1)
  })

  it('retains exact-path behavior for missing paths and rejects synthesized identities without access paths', async () => {
    const { store } = makeStore('file')
    const path = join(root, 'missing')
    const memory = await store.createWithId!('mem_missing', { content: 'missing project', scope: 'project', workspace: path })
    expect(memory.projectIdentity).toBeUndefined()
    expect((await store.list({ workspace: path })).map((record) => record.id)).toEqual(['mem_missing'])
    const access = await resolveMemoryProjectAccess({ projectIdentity: source })
    expect(access.projectIdentity).toBeUndefined()
    expect(memoryInScope({ ...memory, projectIdentity: source }, access)).toBe(false)
  })

  it('never grants repository-wide identity merely by reimporting legacy project evidence', async () => {
    const { store } = makeStore('file')
    for (const [index, sourceEvidence] of [
      { kind: 'imported', trust: 'imported' }, { kind: 'legacy', trust: 'legacy' },
      { kind: 'file', trust: 'legacy' }, { kind: 'user', trust: 'imported' }
    ].entries()) {
      const imported = await store.createWithId!(`mem_imported_${index}`, {
        content: 'legacy imported project convention', scope: 'project', workspace: source,
        sources: [sourceEvidence as { kind: 'imported'; trust: 'imported' }]
      })
      expect(imported.projectIdentity).toBeUndefined()
    }
    expect(await store.list({ workspace: worktree })).toEqual([])
    expect(await store.list({ workspace: alias })).toEqual([])
    expect((await store.list({ workspace: source })).length).toBe(4)
  })
})
