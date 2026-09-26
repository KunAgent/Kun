import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactStore, StoredArtifactMeta } from '../artifacts/artifact-store.js'
import { TaskWorkspaceSetupRunner } from './setup-runner.js'
import {
  createApprovedSetupResolver,
  userSharedPathsForRepo
} from './approved-setup.js'

const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function fakeArtifacts(): { store: ArtifactStore; contents: Map<string, string> } {
  const contents = new Map<string, string>()
  let n = 0
  const store = {
    put: async (input: { content: string }) => {
      const id = `art_${++n}`
      contents.set(id, input.content)
      return {
        meta: { id, byteSize: input.content.length, lineCount: 0, createdAt: '' } as StoredArtifactMeta,
        summary: {},
        deduped: false
      }
    },
    get: async (id: string) => contents.get(id) ?? null,
    readRange: async () => null,
    stat: async () => null
  } as unknown as ArtifactStore
  return { store, contents }
}

/** Minimal ChildProcess stand-in: emits 'close' on the next tick. */
function fakeChild(code = 0, out = ''): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  Object.assign(child, { stdout, stderr })
  setTimeout(() => {
    if (out) stdout.emit('data', Buffer.from(out))
    child.emit('close', code)
  }, 1)
  return child
}

describe('TaskWorkspaceSetupRunner', () => {
  it('runs approved steps and stores the log artifact', async () => {
    const artifacts = fakeArtifacts()
    const spawned: Array<{ command: string; env: NodeJS.ProcessEnv }> = []
    vi.stubEnv('KUN_API_TOKEN', 'kun-secret')
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    vi.stubEnv('DEEPSEEK_API_KEY', 'ds-test')
    const runner = new TaskWorkspaceSetupRunner({
      artifacts: artifacts.store,
      spawn: (async (command: string, _args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
        spawned.push({ command, env: options.env })
        return fakeChild(0, 'ok\n')
      }) as never
    })
    const result = await runner.run('tws_x1', '/tmp', [
      { name: 'install', command: 'bun', args: ['install'], timeoutMs: 5_000 }
    ], new AbortController().signal)
    expect(result.status).toBe('succeeded')
    expect(result.logArtifactId).toBeDefined()
    // The repo-declared command never sees Kun tokens or provider keys.
    const env = spawned[0]?.env ?? {}
    expect(env.KUN_API_TOKEN).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(artifacts.contents.get(result.logArtifactId ?? '')).toContain('$ bun install')
  })

  it('marks a nonzero exit as failed and keeps the log readable', async () => {
    const artifacts = fakeArtifacts()
    const runner = new TaskWorkspaceSetupRunner({
      artifacts: artifacts.store,
      spawn: (async () => fakeChild(7, 'boom\n')) as never,
      env: () => ({ PATH: '/usr/bin' })
    })
    const result = await runner.run('tws_x2', '/tmp', [
      { name: 'broken', command: 'false', args: [], timeoutMs: 5_000 }
    ], new AbortController().signal)
    expect(result.status).toBe('failed')
    const log = artifacts.contents.get(result.logArtifactId ?? '')
    expect(log).toContain('boom')
    expect(log).toContain('exited with code 7')
  })

  it('times out a hanging step and reports failed', async () => {
    const artifacts = fakeArtifacts()
    const hanging = new EventEmitter() as ChildProcess
    Object.assign(hanging, { stdout: new EventEmitter(), stderr: new EventEmitter() })
    const stop = vi.fn(async () => {
      setTimeout(() => hanging.emit('close', null), 1)
    })
    const runner = new TaskWorkspaceSetupRunner({
      artifacts: artifacts.store,
      spawn: (async () => hanging) as never,
      stop: stop as never,
      env: () => ({})
    })
    const result = await runner.run('tws_x3', '/tmp', [
      { name: 'hang', command: 'sleep', args: ['999'], timeoutMs: 20 }
    ], new AbortController().signal)
    expect(result.status).toBe('failed')
    expect(stop).toHaveBeenCalled()
    expect(artifacts.contents.get(result.logArtifactId ?? '')).toContain('timed out')
  })
})

describe('createApprovedSetupResolver', () => {
  const worktree = {
    sharedDirectories: [], copyFiles: [], setup: [], checks: [], branchPrefix: 'kun/'
  }
  const entry = {
    repoRoot: '/repo/a',
    digest: 'digest-1',
    worktree: {
      ...worktree,
      setup: [{ name: 'install', command: 'bun', args: ['install'], timeoutMs: 5_000 }]
    }
  }

  it('returns declared steps while the live digest still matches', async () => {
    const resolve = createApprovedSetupResolver({
      approvedEntries: () => [entry],
      loadConfig: async () => ({ status: 'valid', digest: 'digest-1' })
    })
    expect(await resolve('/repo/a')).toEqual(entry.worktree.setup)
  })

  it('treats a changed .kun/project.json as unapproved (whole-file digest)', async () => {
    const resolve = createApprovedSetupResolver({
      approvedEntries: () => [entry],
      loadConfig: async () => ({ status: 'valid', digest: 'digest-2' })
    })
    expect(await resolve('/repo/a')).toEqual([])
  })

  it('returns empty without an entry for the repo', async () => {
    const resolve = createApprovedSetupResolver({
      approvedEntries: () => [entry],
      loadConfig: async () => ({ status: 'valid', digest: 'digest-1' })
    })
    expect(await resolve('/repo/other')).toEqual([])
  })
})

describe('userSharedPathsForRepo', () => {
  it('matches repo roots with normalized separators', () => {
    const shared = {
      '/repo/a': [{ path: '.env', mode: 'copy' as const }],
      '/repo/b/': [{ path: 'deps', mode: 'symlink' as const }]
    }
    expect(userSharedPathsForRepo(shared, '/repo/a')).toEqual(shared['/repo/a'])
    expect(userSharedPathsForRepo(shared, '/repo/b')).toEqual(shared['/repo/b/'])
    expect(userSharedPathsForRepo(shared, '/repo/c')).toEqual([])
  })
})
