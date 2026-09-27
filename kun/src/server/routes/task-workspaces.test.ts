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
import { AttributionLedger, lineHashesFor } from '../../ade/attribution-ledger.js'

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
  const artifactContents = new Map<string, string>()
  let artifactSeq = 0
  const artifacts = {
    put: async (input: { content: string }) => {
      artifactSeq += 1
      const id = `art-${artifactSeq}`
      artifactContents.set(id, input.content)
      return { meta: { id } }
    },
    get: async (id: string) => artifactContents.get(id) ?? null
  }
  const service = new TaskWorkspaceService({
    store,
    lifecycle: createWorktreeLifecycle({
      git: workspaceGit,
      commitGit: workspaceCommitGit,
      fence: assertWorkspaceWriteFence,
      withCommit: withWorkspaceWriteCommit
    }),
    worktreeRoot,
    artifacts
  })
  const attribution = new AttributionLedger(dataDir, () => '2026-01-01T00:00:00Z')
  const router = new Router()
  registerTaskWorkspaceRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    taskWorkspaces: service,
    attribution,
    ade: {
      stores: {
        teams: {
          list: async () => [{
            teamId: 'team_1',
            workers: [{ workerId: 'thr_w1', label: 'Worker A' }]
          }]
        }
      }
    },
    graph: { artifacts }
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
  return { service, request, repo, attribution }
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
    const bound = await request('GET', '/v1/task-workspaces?boundThreadId=thread-a')
    expect(JSON.parse(bound.body).records).toHaveLength(1)
    const unbound = await request('GET', '/v1/task-workspaces?boundThreadId=other')
    expect(JSON.parse(unbound.body).records).toHaveLength(0)
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

  it('serves a read-only integrate preview with block reasons', async () => {
    const { service, request, repo } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'worktree',
      startFrom: { kind: 'current-head' }
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    const missing = await request(
      'GET', '/v1/task-workspaces/tws_missing0/integrate-preview'
    )
    expect(missing.status).toBe(404)
    const clean = await request(
      'GET', `/v1/task-workspaces/${record.workspaceId}/integrate-preview`
    )
    expect(clean.status).toBe(200)
    const cleanPreview = (JSON.parse(clean.body)).preview
    expect(cleanPreview.canMergeBranch).toBe(true)
    expect(cleanPreview.hasUncommitted).toBe(false)
    // A clean worktree has nothing to apply.
    expect(cleanPreview.canApplyPatch).toBe(false)
    expect(cleanPreview.applyBlockReason).toMatch(/nothing to integrate/)
    const worktree = service.get(record.workspaceId)!.path
    await writeFile(join(worktree, 'a.txt'), 'changed\n')
    // Move the source HEAD: apply-patch must block, merge stays open.
    await writeFile(join(repo, 'a.txt'), 'moved\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'moved'])
    const moved = await request(
      'GET', `/v1/task-workspaces/${record.workspaceId}/integrate-preview`
    )
    const movedPreview = (JSON.parse(moved.body)).preview
    expect(movedPreview.canApplyPatch).toBe(false)
    expect(movedPreview.applyBlockReason).toMatch(/HEAD changed/)
    expect(movedPreview.canMergeBranch).toBe(true)
    expect(movedPreview.hasUncommitted).toBe(true)
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

  it('serves the captured diff file list and per-file texts', async () => {
    const { service, request, repo } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'worktree',
      startFrom: { kind: 'current-head' }
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    const worktree = service.get(record.workspaceId)!.path
    await writeFile(join(worktree, 'a.txt'), 'changed\nextra\n')
    await writeFile(join(worktree, 'b.ts'), 'export const b = 1\n')
    const diff = await request('GET', `/v1/task-workspaces/${record.workspaceId}/diff`)
    expect(diff.status).toBe(200)
    const body = JSON.parse(diff.body)
    expect(body.headRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(body.files).toHaveLength(2)
    const a = body.files.find((f: { path: string }) => f.path === 'a.txt')
    const b = body.files.find((f: { path: string }) => f.path === 'b.ts')
    expect(a).toMatchObject({ status: 'modified', insertions: 2, deletions: 1, binary: false })
    expect(b).toMatchObject({ status: 'added', insertions: 1, deletions: 0 })
    const file = await request(
      'GET',
      `/v1/task-workspaces/${record.workspaceId}/diff/file?path=${encodeURIComponent('a.txt')}`
    )
    expect(file.status).toBe(200)
    const detail = JSON.parse(file.body)
    expect(detail.patch).toContain('diff --git a/a.txt b/a.txt')
    expect(detail.oldText).toBe('a\n')
    expect(detail.newText).toBe('changed\nextra\n')
    const added = await request(
      'GET',
      `/v1/task-workspaces/${record.workspaceId}/diff/file?path=b.ts`
    )
    const addedBody = JSON.parse(added.body)
    expect(addedBody.newText).toBe('export const b = 1\n')
    expect(addedBody.oldText).toBeUndefined()
  })

  it('diff/file validates the path and 404s for unknown files', async () => {
    const { service, request, repo } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'worktree',
      startFrom: { kind: 'current-head' }
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    const worktree = service.get(record.workspaceId)!.path
    await writeFile(join(worktree, 'a.txt'), 'changed\n')
    const missing = await request(
      'GET', `/v1/task-workspaces/${record.workspaceId}/diff/file`
    )
    expect(missing.status).toBe(400)
    const unknown = await request(
      'GET', `/v1/task-workspaces/${record.workspaceId}/diff/file?path=nope.ts`
    )
    expect(unknown.status).toBe(404)
  })

  it('serves per-line attribution for workspace files', async () => {
    const { service, request, repo, attribution } = await harness()
    const created = await request('POST', '/v1/task-workspaces', {
      ownerThreadId: 'thread-a',
      sourceRoot: repo,
      isolation: 'worktree',
      startFrom: { kind: 'current-head' }
    })
    const record = (JSON.parse(created.body)).record
    await waitTerminal(service, record.workspaceId)
    const worktree = service.get(record.workspaceId)!.path
    await writeFile(join(worktree, 'a.txt'), 'changed\nextra\nhuman\n')
    await attribution.record(record.workspaceId, {
      path: 'a.txt',
      lineHashes: lineHashesFor('changed\nextra'),
      unitId: 'thr_w1',
      harnessId: 'codex',
      dispatchId: 'dsp_1',
      at: '2026-01-01T00:00:00Z'
    })
    const res = await request(
      'GET',
      `/v1/task-workspaces/${record.workspaceId}/attribution?path=a.txt`
    )
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.path).toBe('a.txt')
    expect(body.lines).toEqual([
      { line: 1, unitId: 'thr_w1', harnessId: 'codex', dispatchId: 'dsp_1', label: 'Worker A' },
      { line: 2, unitId: 'thr_w1', harnessId: 'codex', dispatchId: 'dsp_1', label: 'Worker A' }
    ])
    const missing = await request(
      'GET', `/v1/task-workspaces/${record.workspaceId}/attribution`
    )
    expect(missing.status).toBe(400)
    const escaping = await request(
      'GET',
      `/v1/task-workspaces/${record.workspaceId}/attribution?path=${encodeURIComponent('../a.txt')}`
    )
    expect(escaping.status).toBe(400)
    const unknown = await request(
      'GET', `/v1/task-workspaces/${record.workspaceId}/attribution?path=nope.txt`
    )
    expect(unknown.status).toBe(404)
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
