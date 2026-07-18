import { createHash } from 'node:crypto'
import type {
  ExtensionContext,
  JobReference,
  MediaMetadata,
  ToolInvocationContext
} from '@kun/extension-api'
import {
  buildProjectPackageArchivePlan,
  type MutationReceipt,
  type ProjectPackageArchiveMediaObservation,
  type ProjectPackageArchiveMissingPolicy,
  type ProjectPackageArchivePlan,
  type ProjectPackageChatProvenance,
  type VideoProject
} from '../engine/index.js'

export type ProjectPackageExportPreparation = {
  plan: ProjectPackageArchivePlan
  observedAt: string
}

export async function prepareProjectPackageArchiveExport(input: {
  context: ExtensionContext
  project: VideoProject
  includeMedia: 'all' | string[]
  missingMediaPolicy: ProjectPackageArchiveMissingPolicy
  receipts?: MutationReceipt[]
  includeChatProvenance: boolean
  invocation?: ToolInvocationContext
}): Promise<ProjectPackageExportPreparation> {
  const selected = input.includeMedia === 'all'
    ? input.project.assets
    : input.project.assets.filter(({ id }) => input.includeMedia.includes(id))
  const observations: ProjectPackageArchiveMediaObservation[] = []
  for (let offset = 0; offset < selected.length; offset += 16) {
    const page = await Promise.all(selected.slice(offset, offset + 16).map(async (asset) => {
      if (!asset.mediaHandleId || asset.availability === 'offline') {
        return { assetId: asset.id, status: 'missing', reason: 'offline' } as const
      }
      if (asset.availability === 'revoked') {
        return { assetId: asset.id, status: 'missing', reason: 'revoked' } as const
      }
      if (asset.availability === 'changed') {
        return { assetId: asset.id, status: 'missing', reason: 'changed' } as const
      }
      try {
        const metadata = await input.context.media.stat({ handleId: asset.mediaHandleId })
        return observationFromMetadata(asset.id, metadata)
      } catch {
        return { assetId: asset.id, status: 'missing', reason: 'unavailable' } as const
      }
    }))
    observations.push(...page)
  }
  const chatProvenance = input.includeChatProvenance
    ? invocationProvenance(input.project, input.invocation, input.includeMedia, input.missingMediaPolicy)
    : []
  return {
    plan: buildProjectPackageArchivePlan(input.project, observations, {
      includeMedia: input.includeMedia,
      missingMediaPolicy: input.missingMediaPolicy,
      ...(input.receipts === undefined ? {} : { receipts: input.receipts }),
      chatProvenance
    }),
    observedAt: new Date().toISOString()
  }
}

export async function startProjectPackageArchiveExport(input: {
  context: ExtensionContext
  plan: ProjectPackageArchivePlan
  outputHandleId: string
}): Promise<JobReference> {
  const started = await input.context.media.startArchiveJob({
    format: 'zip',
    outputHandleId: input.outputHandleId,
    entries: input.plan.entries,
    idempotencyKey: `project-package:${createHash('sha256')
      .update(input.plan.idempotencyKey, 'utf8')
      .update('\0', 'utf8')
      .update(input.outputHandleId, 'utf8')
      .digest('hex')}`
  })
  return started.job
}

function observationFromMetadata(
  assetId: string,
  metadata: MediaMetadata
): ProjectPackageArchiveMediaObservation {
  if (metadata.revoked) return { assetId, status: 'missing', reason: 'revoked' }
  if (metadata.mode !== 'read') return { assetId, status: 'missing', reason: 'unavailable' }
  return {
    assetId,
    status: 'available',
    handleId: metadata.handleId,
    displayName: metadata.displayName,
    ...(metadata.mimeType === undefined ? {} : { mimeType: metadata.mimeType }),
    ...(metadata.byteSize === undefined ? {} : { byteSize: metadata.byteSize }),
    ...(metadata.completionIdentity === undefined
      ? {}
      : { completionIdentity: metadata.completionIdentity })
  }
}

function invocationProvenance(
  project: VideoProject,
  invocation: ToolInvocationContext | undefined,
  includeMedia: 'all' | string[],
  missingMediaPolicy: ProjectPackageArchiveMissingPolicy
): ProjectPackageChatProvenance[] {
  const threadId = invocation?.invocation.threadId
  if (!threadId) return []
  const contentDigest = createHash('sha256').update(JSON.stringify({
    operation: 'video-project-package',
    projectId: project.id,
    revision: project.currentRevision,
    includeMedia: includeMedia === 'all' ? 'all' : [...includeMedia].sort(),
    missingMediaPolicy
  })).digest('hex')
  return [{
    threadId,
    messageId: invocation.invocation.invocationId,
    role: 'tool',
    createdAt: project.updatedAt,
    contentDigest
  }]
}
