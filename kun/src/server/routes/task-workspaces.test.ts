import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { TaskWorkspaceStore } from '../../workspace-tasks/task-workspace-store.js'
import { TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'
import { createWorktreeLifecycle } from '../../workspace-tasks/worktree-lifecycle.js'
import {
  assertWorkspaceWriteFence,
  workspaceCommitGit,
  workspaceGit,
  withWorkspaceWriteCommit
} from '../../workspace-tasks/workspace-git.js'
import { registerTaskWorkspaceRoutes } from './register-task-workspace-routes.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const stores: TaskWorkspaceStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()))
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

async function harness() {
  const dataDir = await tempDir('kun-tws-route-data-')
  const worktreeRoot = await tempDir('kun-tws-route-wt-')
  const repo = join(await tempDir('kun-tws-route-repo-'), 'repo')
  await mkdir(repo, { recursive: true })
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'tw-route@example.test'])
  await git(repo, ['config', 'user.name', 'TW Route'])
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'base'])
  const store = new TaskWorkspaceStore({ dataDir, flushDelayMs: 1 })
  await store.load()
  stores.push(store)
  const service = new TaskWorkspaceService({
    store,
    lifecycle: createWorktreeLifecycle({
      git: workspaceGit,
      commitGit: workspaceCommitGit,
      fence: assertWorkspaceWriteFence,
      withCommit: withWorkspaceWriteCommit
    }),
    worktreeRoot
  })
  const router = new Router()
  registerTaskWorkspaceRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    taskWorkspaces: service
  } as unknown as ServerRuntime)
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    authorized = true
  ): Promise<JsonResponse> => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)!
    expect(route, `${method} ${path} should route`).toBeTruthy()
    return route.handler(
      new Request(`http://local.test${path}`, {
        method,
        headers: {
          ...(authorized ? { authorization: 'Bearer test-token' } : {}),
          'content-type': 'application/json'
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      }),
      { params: route.params }
    ) as Promise<JsonResponse>
  }
  return { service, request, repo }
}

async function waitTerminal(
  service: TaskWorkspaceService,
  id: string
): Promise<void> {
  await vi.waitFor(() => {
    const record = service.get(id)
    if (!record || record.state === 'creating' || record.state === 'setting-up') {
      throw new Error(`waiting; state=${record?.state}`)
    }
  }, { timeout: 15_000, interval: 10 })
}

describe('task workspace routes', () => {
  it('creates a workspace record and lists it by owner thread', async () => {
    const { service, request, repo } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'directory',
      startFrom: { kind: 'current-head' }
    })
    expect(created.status).toBe(201)
    const record = (JSON.parse(created.body)).record
    expect(record.workspaceId).toMatch(/^tws_/)
    await waitTerminal(service, record.workspaceId)
    const listed = await request('GET', '/v1/task-workspaces?ownerThreadId=thread-a')
    expect(listed.status).toBe(200)
    const body = JSON.parse(listed.body)
    expect(body.records).toHaveLength(1)
    expect(body.records[0].state).toBe('ready')
    const single = await request('GET', `/v1/task-workspaces/${record.workspaceId}`)
    expect((JSON.parse(single.body)).record.workspaceId).toBe(record.workspaceId)
  })

  it('rejects an invalid create body and missing auth', async () => {
    const { request } = await harness()
    const invalid = await request('POST', '/v1/task-workspaces', { sourceRoot: '/x' })
    expect(invalid.status).toBe(400)
    const unauthorized = await request('GET', '/v1/task-workspaces', undefined, false)
    expect(unauthorized.status).toBe(401)
  })

  it('returns 404 for an unknown id and 409 for retry on a non-failed record', async () => {
    const { service, request, repo } = await harness()
    expect((await request('GET', '/v1/task-workspaces/tws_missing00')).status).toBe(404)
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'directory'
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    const retry = await request('POST', `/v1/task-workspaces/${record.workspaceId}/retry`)
    expect(retry.status).toBe(409)
    const cancel = await request('POST', `/v1/task-workspaces/${record.workspaceId}/cancel`)
    expect(cancel.status).toBe(409)
  })

  it('retries a failed record back to ready', async () => {
    const { service, request } = await harness()
    const plain = await tempDir('kun-tws-route-plain-')
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: plain,
      isolation: 'worktree'
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    expect(service.get(record.workspaceId)?.state).toBe('failed')
    const retried = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/retry`
    )
    expect(retried.status).toBe(200)
    await waitTerminal(service, record.workspaceId)
    expect(service.get(record.workspaceId)?.state).toBe('failed')
    const ready = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/mark-ready`
    )
    expect(ready.status).toBe(200)
    expect((JSON.parse(ready.body)).record.state).toBe('ready')
  })

  it('captures, integrates and cleans up a workspace over HTTP', async () => {
    const { service, request, repo } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'worktree',
      startFrom: { kind: 'current-head' }
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    expect(service.get(record.workspaceId)?.state).toBe('ready')
    const worktree = service.get(record.workspaceId)!.path
    await writeFile(join(worktree, 'a.txt'), 'via worktree\n')
    const captured = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/capture`
    )
    expect(captured.status).toBe(200)
    expect((JSON.parse(captured.body)).record.state).toBe('captured')
    const integrated = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/integrate`, {}
    )
    expect(integrated.status).toBe(200)
    expect((JSON.parse(integrated.body)).outcome).toBe('applied')
    const cleaned = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/cleanup`
    )
    expect(cleaned.status).toBe(200)
    // Dirty-but-captured worktree cannot be non-force removed → preserved.
    expect((JSON.parse(cleaned.body)).record.state).toBe('preserved')
  })

  it('returns 409 with a damage preview for unconfirmed discard', async () => {
    const { service, request, repo } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'worktree',
      startFrom: { kind: 'current-head' }
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    const preview = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/discard`, {}
    )
    expect(preview.status).toBe(409)
    const body = JSON.parse(preview.body)
    expect(body.preview.uncommittedFiles).toBeGreaterThanOrEqual(0)
    const confirmed = await request(
      'POST', `/v1/task-workspaces/${record.workspaceId}/discard`, { confirm: true }
    )
    expect(confirmed.status).toBe(200)
    expect((JSON.parse(confirmed.body)).record.state).toBe('removed')
  })

  it('preserved-branches is not swallowed by the :workspaceId route', async () => {
    const { request, repo } = await harness()
    const listed = await request(
      'GET', `/v1/task-workspaces/preserved-branches?repo=${encodeURIComponent(repo)}`
    )
    expect(listed.status).toBe(200)
    expect((JSON.parse(listed.body)).branches).toEqual([])
    const missing = await request('GET', '/v1/task-workspaces/preserved-branches')
    expect(missing.status).toBe(400)
  })
})
