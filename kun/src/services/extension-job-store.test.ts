import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import { ExtensionJobStore } from './extension-job-store.js'
import { extensionJobCursor, type ExtensionJobSnapshot } from './extension-job-types.js'

const roots: string[] = []
const WORKSPACE_ROOT = '/private/workspaces/video-project'
const WORKSPACE_ID = extensionWorkspaceKey(WORKSPACE_ROOT)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ExtensionJobStore', () => {
  it('atomically persists creation, ownership, events, and idempotency across restart', async () => {
    const path = await jobStorePath()
    const now = new Date('2026-07-13T00:00:00.000Z')
    const store = new ExtensionJobStore({ path, now: () => now })
    const first = await store.create({
      snapshot: queuedSnapshot('job_one1', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: ['media.process', 'jobs.manage'],
      idempotency: { operation: 'media.startFfmpegJob', key: 'retry-one' }
    })
    const retried = await store.create({
      snapshot: queuedSnapshot('job_duplicate', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: ['jobs.manage'],
      idempotency: { operation: 'media.startFfmpegJob', key: 'retry-one' }
    })

    expect(first.created).toBe(true)
    expect(retried).toEqual({ snapshot: first.snapshot, created: false })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 1 })

    const restarted = new ExtensionJobStore({ path, now: () => now })
    expect(await restarted.get('job_one1')).toEqual(first.snapshot)
    expect(await restarted.getStored('job_one1')).toMatchObject({
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: [
      'jobs.manage',
      'media.process'
      ]
    })
    const publicSnapshot = await restarted.get('job_one1')
    const replay = await restarted.replay('job_one1')
    expect(replay?.events.map((event) => event.type)).toEqual(['created'])
    expect(JSON.stringify({ publicSnapshot, replay })).not.toContain(WORKSPACE_ROOT)
  })

  it('allocates monotonic cursors and reports an expired replay window', async () => {
    const path = await jobStorePath()
    const now = new Date('2026-07-13T00:00:00.000Z')
    const store = new ExtensionJobStore({ path, now: () => now, maxEventsPerJob: 2 })
    await store.create({
      snapshot: queuedSnapshot('job_events', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: []
    })
    for (let index = 0; index < 3; index += 1) {
      now.setSeconds(now.getSeconds() + 1)
      await store.mutate('job_events', (record) => ({
        snapshot: { ...record.snapshot, updatedAt: now.toISOString() },
        event: { type: 'progress' }
      }))
    }

    const replay = await store.replay('job_events', extensionJobCursor('job_events', 1))
    expect(replay).toMatchObject({ gap: true, events: [] })
    expect((await store.getStored('job_events'))?.events.map((event) => event.sequence)).toEqual([3, 4])
  })

  it('rejects persisted jobs whose private workspace root is unsafe or mismatched', async () => {
    const path = await jobStorePath()
    const now = new Date('2026-07-13T00:00:00.000Z')
    const store = new ExtensionJobStore({ path, now: () => now })
    await store.create({
      snapshot: queuedSnapshot('job_corrupt', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: []
    })
    const valid = JSON.parse(await readFile(path, 'utf8')) as {
      jobs: Record<string, { workspaceRoot: string }>
    }

    for (const workspaceRoot of [
      'relative/workspace',
      '/private/workspaces/wrong-project',
      '/private/workspaces/\u0000control',
      `/${'x'.repeat(4_097)}`
    ]) {
      const corrupted = structuredClone(valid)
      corrupted.jobs.job_corrupt!.workspaceRoot = workspaceRoot
      await writeFile(path, JSON.stringify(corrupted), 'utf8')
      await expect(new ExtensionJobStore({ path, now: () => now }).load())
        .rejects.toThrow(/workspace root/i)
    }
  })

  it('treats prototype-named job IDs as own persisted records', async () => {
    const path = await jobStorePath()
    const now = new Date('2026-07-13T00:00:00.000Z')
    const store = new ExtensionJobStore({ path, now: () => now })
    const created = await store.create({
      snapshot: queuedSnapshot('__proto__', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: []
    })

    expect(Object.hasOwn((await store.load()).jobs, '__proto__')).toBe(true)
    expect(await store.get('__proto__')).toEqual(created.snapshot)
    await store.mutate('__proto__', () => ({
      checkpoint: { schemaVersion: 1, data: { safe: true } },
      cancellationReason: 'user requested cancellation'
    }))

    expect(Object.hasOwn(Object.prototype, 'checkpoint')).toBe(false)
    expect(Object.hasOwn(Object.prototype, 'cancellationReason')).toBe(false)
    const restarted = new ExtensionJobStore({ path, now: () => now })
    expect(await restarted.getStored('__proto__')).toMatchObject({
      checkpoint: { schemaVersion: 1, data: { safe: true } },
      cancellationReason: 'user requested cancellation'
    })
  })

  it('expires only deterministic terminal records and preserves active jobs', async () => {
    const path = await jobStorePath()
    const now = new Date('2026-07-13T00:00:00.000Z')
    const store = new ExtensionJobStore({
      path,
      now: () => now,
      terminalRetentionMs: 1_000,
      maxTerminalRecords: 1
    })
    await store.create({
      snapshot: queuedSnapshot('job_terminal', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: []
    })
    await store.create({
      snapshot: queuedSnapshot('job_active', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: []
    })
    await store.mutate('job_terminal', (record) => ({
      snapshot: {
        ...record.snapshot,
        state: 'completed',
        terminalAt: now.toISOString(),
        updatedAt: now.toISOString(),
        result: { schemaVersion: 1, generatedArtifacts: [] }
      },
      event: { type: 'completed' }
    }))
    now.setSeconds(now.getSeconds() + 2)

    expect(await store.prune()).toBe(1)
    expect(await store.get('job_terminal')).toBeUndefined()
    expect(await store.get('job_active')).toMatchObject({ state: 'queued' })
  })

  it('applies terminal retention while loading at runtime startup', async () => {
    const path = await jobStorePath()
    const now = new Date('2026-07-13T00:00:00.000Z')
    const first = new ExtensionJobStore({ path, now: () => now, terminalRetentionMs: 1_000 })
    await first.create({
      snapshot: queuedSnapshot('job_startup', now),
      workspaceRoot: WORKSPACE_ROOT,
      permissionsSnapshot: []
    })
    await first.mutate('job_startup', (record) => ({
      snapshot: {
        ...record.snapshot,
        state: 'completed',
        terminalAt: now.toISOString(),
        updatedAt: now.toISOString(),
        result: { schemaVersion: 1, generatedArtifacts: [] }
      },
      event: { type: 'completed' }
    }))
    now.setSeconds(now.getSeconds() + 2)

    const restarted = new ExtensionJobStore({ path, now: () => now, terminalRetentionMs: 1_000 })
    expect((await restarted.load()).jobs).toEqual({})
    expect(await restarted.get('job_startup')).toBeUndefined()
  })
})

async function jobStorePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-jobs-'))
  roots.push(root)
  return join(root, 'jobs.json')
}

function queuedSnapshot(id: string, now: Date): Omit<ExtensionJobSnapshot, 'latestCursor'> {
  return {
    schemaVersion: 1,
    id,
    kind: 'media.ffmpeg',
    kindSchemaVersion: 1,
    ownerExtensionId: 'video.editor',
    ownerExtensionVersion: '1.1.0',
    workspaceId: WORKSPACE_ID,
    initiatingOperation: 'media.startFfmpegJob',
    state: 'queued',
    executionAttempt: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }
}
