import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  MediaArchiveJobResult,
  ParsedMediaStartArchiveJobRequest
} from '@kun/extension-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionJobService } from './extension-job-service.js'
import { ExtensionJobStore } from './extension-job-store.js'
import { ExtensionMediaArchiveJobService } from './extension-media-archive-job-service.js'
import type {
  ExtensionMediaArchiveOutputTransaction,
  ExtensionMediaArchiveService
} from './extension-media-archive-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const request: ParsedMediaStartArchiveJobRequest = {
  format: 'zip',
  outputHandleId: 'media_output_123456789',
  entries: [
    {
      kind: 'inline-text',
      archivePath: 'project/project.json',
      content: '{"schemaVersion":1}',
      mimeType: 'application/json'
    },
    {
      kind: 'media',
      inputHandleId: 'media_source_123456789',
      archivePath: 'media/source.mov'
    }
  ],
  idempotencyKey: 'package-project-1-revision-7'
}

const archiveResult: MediaArchiveJobResult = {
  schemaVersion: 1,
  format: 'zip',
  entryCount: 2,
  inputBytes: 42,
  archiveBytes: 128,
  sha256: 'a'.repeat(64),
  generatedMedia: {
    handleId: 'media_generated_123456',
    mode: 'read',
    kind: 'data',
    displayName: 'project.kunx.zip',
    mimeType: 'application/zip',
    byteSize: 128,
    completionIdentity: 'archive-completion-identity',
    revoked: false
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-media-archive-job-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const store = new ExtensionJobStore({ path: join(root, 'jobs.json') })
  const jobs = new ExtensionJobService({ store, progressIntervalMs: 0 })
  const transactions: ExtensionMediaArchiveOutputTransaction[] = []
  const makeTransaction = (result: MediaArchiveJobResult = archiveResult) => {
    const transaction: ExtensionMediaArchiveOutputTransaction = {
      result,
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    }
    transactions.push(transaction)
    return transaction
  }
  const archive = {
    preflight: vi.fn(async (principal: ExtensionPrincipal) => {
      const required = [
        'jobs.manage',
        'media.read',
        'media.export',
        'workspace.read',
        'workspace.write'
      ]
      if (!principal.workspaceTrusted || principal.workspaceRoots.length !== 1 ||
        required.some((permission) => !principal.permissions.includes(permission))) {
        throw Object.assign(new Error('Archive authority denied'), { code: 'permission_denied' })
      }
    }),
    executeTransaction: vi.fn(async (
      _principal: ExtensionPrincipal,
      _request: ParsedMediaStartArchiveJobRequest,
      _operationId: string,
      options: {
        signal?: AbortSignal
        report?(completed: number, total: number, message: string): Promise<void>
      }
    ) => {
      await options.report?.(1, 4, 'Writing package')
      await options.report?.(4, 4, 'Package ready')
      return makeTransaction()
    }),
    rollbackInterruptedTransaction: vi.fn(async () => undefined),
    commitRecoveredTransaction: vi.fn(async () => undefined)
  }
  const adapter = new ExtensionMediaArchiveJobService({
    jobs,
    archive: archive as unknown as ExtensionMediaArchiveService
  })
  const principal: ExtensionPrincipal = {
    extensionId: 'kun.video-editor',
    extensionVersion: '1.1.0',
    permissions: [
      'jobs.manage',
      'media.read',
      'media.export',
      'workspace.read',
      'workspace.write'
    ],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  return {
    root,
    workspace,
    workspaceId: extensionWorkspaceKey(workspace),
    store,
    jobs,
    archive,
    adapter,
    principal,
    transactions,
    makeTransaction
  }
}

describe('ExtensionMediaArchiveJobService', () => {
  it('preflights then atomically admits a durable archive job and commits its output', async () => {
    const test = await fixture()
    const started = await test.adapter.start(test.principal, request)
    expect(started).toMatchObject({
      outcome: 'started',
      job: { kind: 'media.archive' }
    })
    await test.jobs.waitForIdle(started.job.jobId)

    const snapshot = await test.store.get(started.job.jobId)
    expect(snapshot).toMatchObject({
      kind: 'media.archive',
      initiatingOperation: 'media.startArchiveJob',
      workspaceId: test.workspaceId,
      state: 'completed',
      progress: {
        phase: 'finalizing',
        completed: 4,
        total: 4,
        percentage: 100
      },
      result: {
        data: {
          format: 'zip',
          entryCount: 2,
          sha256: 'a'.repeat(64),
          generatedMedia: {
            handleId: 'media_generated_123456',
            displayName: 'project.kunx.zip'
          }
        },
        generatedArtifacts: []
      }
    })
    expect(test.archive.preflight).toHaveBeenCalledWith(test.principal, request)
    expect(test.archive.executeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: test.principal.extensionId,
        permissions: [
          'jobs.manage',
          'media.read',
          'media.export',
          'workspace.read',
          'workspace.write'
        ],
        workspaceRoots: [test.workspace]
      }),
      request,
      started.job.jobId,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(test.transactions[0]?.commit).toHaveBeenCalledTimes(1)
    expect(test.transactions[0]?.rollback).not.toHaveBeenCalled()

    const publicState = {
      snapshot,
      replay: await test.store.replay(started.job.jobId)
    }
    expect(JSON.stringify(publicState)).not.toContain(test.workspace)
    expect(JSON.stringify(publicState)).not.toContain(test.root)
    test.adapter.dispose()
  })

  it('deduplicates execution by owner-scoped idempotency key', async () => {
    const test = await fixture()
    const first = await test.adapter.start(test.principal, request)
    await test.jobs.waitForIdle(first.job.jobId)
    const second = await test.adapter.start(test.principal, request)

    expect(second.job.jobId).toBe(first.job.jobId)
    expect(test.archive.executeTransaction).toHaveBeenCalledTimes(1)
    expect(test.transactions).toHaveLength(1)
    test.adapter.dispose()
  })

  it('does not create a durable record when low-level authority preflight fails', async () => {
    const test = await fixture()
    await expect(test.adapter.start({ ...test.principal, permissions: [] }, request))
      .rejects.toMatchObject({ code: 'permission_denied' })
    await expect(test.adapter.start({ ...test.principal, workspaceRoots: [] }, request))
      .rejects.toMatchObject({ code: 'permission_denied' })
    await expect(test.adapter.start({ ...test.principal, workspaceTrusted: false }, request))
      .rejects.toMatchObject({ code: 'permission_denied' })
    expect(await test.store.list()).toHaveLength(0)
    test.adapter.dispose()
  })

  it('rolls back a validated transaction when cancellation fences completion', async () => {
    const test = await fixture()
    const executionStarted = deferred<void>()
    const releaseExecution = deferred<void>()
    const transaction = test.makeTransaction()
    test.archive.executeTransaction.mockImplementationOnce(async () => {
      executionStarted.resolve()
      await releaseExecution.promise
      return transaction
    })
    const started = await test.adapter.start(test.principal, {
      ...request,
      idempotencyKey: 'cancel-package-revision-7'
    })
    await executionStarted.promise
    const cancellation = test.jobs.cancel({
      extensionId: test.principal.extensionId,
      workspaceIds: [test.workspaceId]
    }, started.job.jobId)
    await expect.poll(async () => Boolean(
      (await test.store.get(started.job.jobId))?.cancelRequestedAt
    )).toBe(true)
    releaseExecution.resolve()

    await expect(cancellation).resolves.toMatchObject({
      accepted: true,
      snapshot: { state: 'cancelled' }
    })
    expect(transaction.rollback).toHaveBeenCalledTimes(1)
    expect(transaction.commit).not.toHaveBeenCalled()
    test.adapter.dispose()
  })

  it('rejects an invalid archive result and rolls back before publication', async () => {
    const test = await fixture()
    const transaction = test.makeTransaction()
    transaction.result = {
      ...archiveResult,
      sha256: 'not-a-digest'
    } as MediaArchiveJobResult
    test.archive.executeTransaction.mockResolvedValueOnce(transaction)
    const started = await test.adapter.start(test.principal, {
      ...request,
      idempotencyKey: 'invalid-result-package'
    })
    await test.jobs.waitForIdle(started.job.jobId)

    expect(await test.store.get(started.job.jobId)).toMatchObject({ state: 'failed' })
    expect(transaction.rollback).toHaveBeenCalledTimes(1)
    expect(transaction.commit).not.toHaveBeenCalled()
    test.adapter.dispose()
  })

  it('rolls back an interrupted attempt before fencing unsafe restart recovery', async () => {
    const test = await fixture()
    const created = await createStoredJob(test, 'running')
    test.adapter.dispose()

    const recoveredJobs = new ExtensionJobService({ store: test.store })
    const recoveredAdapter = new ExtensionMediaArchiveJobService({
      jobs: recoveredJobs,
      archive: test.archive as unknown as ExtensionMediaArchiveService
    })
    await expect(recoveredJobs.initialize()).resolves.toMatchObject({ interrupted: 1 })
    expect(test.archive.rollbackInterruptedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoots: [test.workspace] }),
      request,
      created.snapshot.id
    )
    expect(await test.store.get(created.snapshot.id)).toMatchObject({
      state: 'interrupted',
      error: { code: 'JOB_RECOVERY_UNSAFE' }
    })
    recoveredAdapter.dispose()
  })

  it('reconciles completed and non-completed terminal archive transactions idempotently', async () => {
    const test = await fixture()
    const completed = await createStoredJob(test, 'completed')
    const interrupted = await createStoredJob(test, 'interrupted')
    test.adapter.dispose()

    const recoveredJobs = new ExtensionJobService({ store: test.store })
    const recoveredAdapter = new ExtensionMediaArchiveJobService({
      jobs: recoveredJobs,
      archive: test.archive as unknown as ExtensionMediaArchiveService
    })
    await expect(recoveredJobs.initialize()).resolves.toEqual({
      queued: 0,
      deferred: 0,
      resumed: 0,
      cancelled: 0,
      interrupted: 0
    })
    expect(test.archive.commitRecoveredTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      request,
      completed.snapshot.id
    )
    expect(test.archive.rollbackInterruptedTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      request,
      interrupted.snapshot.id
    )

    await recoveredJobs.initialize()
    expect(test.archive.commitRecoveredTransaction).toHaveBeenCalledTimes(1)
    expect(test.archive.rollbackInterruptedTransaction).toHaveBeenCalledTimes(1)
    recoveredAdapter.dispose()
  })
})

async function createStoredJob(
  test: Awaited<ReturnType<typeof fixture>>,
  state: 'running' | 'completed' | 'interrupted'
) {
  const created = await test.jobs.createJob({
    owner: {
      extensionId: test.principal.extensionId,
      extensionVersion: test.principal.extensionVersion,
      workspaceId: test.workspaceId
    },
    workspaceRoot: test.workspace,
    kind: 'media.archive',
    kindSchemaVersion: 1,
    initiatingOperation: 'media.startArchiveJob',
    permissionsSnapshot: [...test.principal.permissions],
    checkpoint: { schemaVersion: 1, data: request }
  })
  const timestamp = new Date().toISOString()
  const result = {
    schemaVersion: 1 as const,
    data: archiveResult,
    generatedArtifacts: []
  }
  const error = {
    code: 'TEST_INTERRUPTED',
    message: 'Simulated previous runtime interruption',
    retryable: true,
    category: 'internal' as const
  }
  await test.store.mutate(created.snapshot.id, (record) => ({
    snapshot: {
      ...record.snapshot,
      state,
      executionAttempt: 1,
      startedAt: timestamp,
      updatedAt: timestamp,
      ...(state === 'completed' ? { result, terminalAt: timestamp } : {}),
      ...(state === 'interrupted' ? { error, terminalAt: timestamp } : {})
    },
    event: state === 'completed'
      ? { type: 'completed', result }
      : state === 'interrupted'
        ? { type: 'interrupted', error }
        : { type: 'state' }
  }))
  return created
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}
