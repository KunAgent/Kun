import {
  MediaArchiveJobResultSchema,
  MediaStartArchiveJobRequestSchema,
  MediaStartArchiveJobResultSchema,
  type JobReference,
  type MediaStartArchiveJobRequest,
  type MediaStartArchiveJobResult,
  type ParsedMediaStartArchiveJobRequest
} from '@kun/extension-api'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { JsonValue } from '../extensions/types.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionJobService,
  type ExtensionJobCoreExecutor
} from './extension-job-service.js'
import type { ExtensionJobSnapshot } from './extension-job-types.js'
import {
  ExtensionMediaArchiveService,
  type ExtensionMediaArchiveOutputTransaction
} from './extension-media-archive-service.js'

const MEDIA_ARCHIVE_JOB_KIND = 'media.archive'
const REQUIRED_PERMISSIONS = [
  'jobs.manage',
  'media.read',
  'media.export',
  'workspace.read',
  'workspace.write'
] as const

export class ExtensionMediaArchiveJobError extends Error {
  constructor(
    readonly code: 'invalid_checkpoint' | 'invalid_output',
    message: string
  ) {
    super(message)
  }
}

/**
 * Durable adapter for the core-owned archive writer. The persisted checkpoint
 * contains only opaque handles and virtual archive paths; filesystem paths and
 * the reversible output transaction remain private to the Host.
 */
export class ExtensionMediaArchiveJobService {
  private readonly unregisterExecutor: () => void
  private readonly pendingOutputs = new Map<string, ExtensionMediaArchiveOutputTransaction>()

  constructor(private readonly options: {
    jobs: ExtensionJobService
    archive: ExtensionMediaArchiveService
  }) {
    const executor: ExtensionJobCoreExecutor = {
      kind: MEDIA_ARCHIVE_JOB_KIND,
      execute: async (snapshot, context) => {
        const request = parseCheckpoint(context.checkpoint?.data)
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        let transaction: ExtensionMediaArchiveOutputTransaction | undefined
        try {
          transaction = await this.options.archive.executeTransaction(
            principal,
            request,
            snapshot.id,
            {
              signal: context.signal,
              report: async (completed, total, message) => {
                await context.reportProgress({
                  phase: completed >= total ? 'finalizing' : 'archiving',
                  completed,
                  total,
                  unit: 'steps',
                  percentage: total === 0 ? 0 : Math.min(100, (completed / total) * 100),
                  message
                })
              }
            }
          )
          const result = MediaArchiveJobResultSchema.parse(transaction.result)
          context.signal.throwIfAborted()
          if (this.pendingOutputs.has(snapshot.id)) {
            throw new ExtensionMediaArchiveJobError(
              'invalid_output',
              'Archive output transaction is already pending for this job'
            )
          }
          this.pendingOutputs.set(snapshot.id, transaction)
          return {
            schemaVersion: 1,
            data: result as JsonValue,
            generatedArtifacts: []
          }
        } catch (error) {
          if (transaction !== undefined && this.pendingOutputs.get(snapshot.id) !== transaction) {
            try {
              await transaction.rollback()
            } catch {
              throw new ExtensionMediaArchiveJobError(
                'invalid_output',
                'Archive output validation failed and rollback did not finish safely'
              )
            }
          }
          throw error
        }
      },
      commitResult: async (snapshot, result) => {
        MediaArchiveJobResultSchema.parse(result.data)
        const transaction = this.pendingOutputs.get(snapshot.id)
        if (transaction === undefined) return
        await transaction.commit()
        this.pendingOutputs.delete(snapshot.id)
      },
      discardResult: async (snapshot) => {
        const transaction = this.pendingOutputs.get(snapshot.id)
        if (transaction === undefined) return
        try {
          await transaction.rollback()
        } finally {
          this.pendingOutputs.delete(snapshot.id)
        }
      },
      cancel: async (snapshot, context) => {
        // Active attempts are aborted and awaited by ExtensionJobService. A
        // checkpoint here identifies an orphaned attempt from another runtime.
        if (context.checkpoint === undefined) return
        const request = parseCheckpoint(context.checkpoint.data)
        await this.options.archive.rollbackInterruptedTransaction(
          executionPrincipal(snapshot, context.workspaceRoot),
          request,
          snapshot.id
        )
      },
      recover: async (snapshot, checkpoint, context) => {
        const request = parseCheckpoint(checkpoint?.data)
        await this.options.archive.rollbackInterruptedTransaction(
          executionPrincipal(snapshot, context.workspaceRoot),
          request,
          snapshot.id
        )
        return 'interrupt' as const
      },
      recoverTerminal: async (snapshot, checkpoint, context) => {
        const request = parseCheckpoint(checkpoint?.data)
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        if (snapshot.state === 'completed') {
          MediaArchiveJobResultSchema.parse(snapshot.result?.data)
          await this.options.archive.commitRecoveredTransaction(
            principal,
            request,
            snapshot.id
          )
          return
        }
        await this.options.archive.rollbackInterruptedTransaction(
          principal,
          request,
          snapshot.id
        )
      }
    }
    this.unregisterExecutor = options.jobs.registerCoreExecutor(executor)
  }

  async start(
    principal: ExtensionPrincipal,
    rawRequest: MediaStartArchiveJobRequest
  ): Promise<MediaStartArchiveJobResult> {
    const request = MediaStartArchiveJobRequestSchema.parse(rawRequest)
    // The archive service owns the complete authority, one-workspace, handle,
    // alias, and output-MIME preflight. No durable record is admitted first.
    await this.options.archive.preflight(principal, request)
    const workspaceRoot = principal.workspaceRoots[0]!
    const created = await this.options.jobs.createAndDispatch({
      owner: {
        extensionId: principal.extensionId,
        extensionVersion: principal.extensionVersion,
        workspaceId: extensionWorkspaceKey(workspaceRoot)
      },
      workspaceRoot,
      kind: MEDIA_ARCHIVE_JOB_KIND,
      kindSchemaVersion: 1,
      initiatingOperation: 'media.startArchiveJob',
      permissionsSnapshot: [...principal.permissions],
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      checkpoint: { schemaVersion: 1, data: request as JsonValue }
    })
    return MediaStartArchiveJobResultSchema.parse({
      outcome: 'started',
      job: reference(created.snapshot)
    })
  }

  dispose(): void {
    this.unregisterExecutor()
    for (const transaction of this.pendingOutputs.values()) {
      void transaction.rollback().catch(() => undefined)
    }
    this.pendingOutputs.clear()
  }
}

function parseCheckpoint(value: JsonValue | undefined): ParsedMediaStartArchiveJobRequest {
  const parsed = MediaStartArchiveJobRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw new ExtensionMediaArchiveJobError(
      'invalid_checkpoint',
      'Archive job checkpoint is invalid'
    )
  }
  return parsed.data
}

function executionPrincipal(
  snapshot: ExtensionJobSnapshot,
  workspaceRoot: string
): ExtensionPrincipal {
  return {
    extensionId: snapshot.ownerExtensionId,
    extensionVersion: snapshot.ownerExtensionVersion,
    permissions: [...REQUIRED_PERMISSIONS],
    workspaceRoots: [workspaceRoot],
    workspaceTrusted: true
  }
}

function reference(snapshot: ExtensionJobSnapshot): JobReference {
  return {
    jobId: snapshot.id,
    kind: snapshot.kind,
    state: snapshot.state,
    cursor: snapshot.latestCursor
  }
}
