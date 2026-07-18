import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { GeneratedArtifactSchema, type GeneratedArtifact } from '@kun/extension-api'
import { z } from 'zod'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'

const StoredArtifactSchema = z.strictObject({
  artifact: GeneratedArtifactSchema,
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional()
})
const ArtifactDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  artifacts: z.record(z.string(), StoredArtifactSchema)
})

type StoredArtifact = z.infer<typeof StoredArtifactSchema>

export type CreateGeneratedArtifactInput = {
  workspaceId: string
  mediaHandleId: string
  displayName?: string
  mediaKind?: GeneratedArtifact['mediaKind']
  mimeType?: string
  width?: number
  height?: number
  durationMicros?: number
  provenance: GeneratedArtifact['provenance']
}

export class ExtensionArtifactError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'invalid_artifact'
      | 'workspace_denied'
      | 'media_unavailable'
      | 'artifact_limit',
    message: string
  ) {
    super(message)
  }
}

const emptyDocument = () => ({ schemaVersion: 1 as const, revision: 0, artifacts: {} })

/** Durable generated-output registry, separate from ephemeral View URLs. */
export class ExtensionArtifactService {
  private readonly store: AtomicJsonFile<z.infer<typeof ArtifactDocumentSchema>>
  private readonly now: () => Date
  private readonly maxArtifactsPerExtension: number

  constructor(private readonly options: {
    dataDir: string
    handleService: ExtensionMediaHandleService
    now?: () => Date
    maxArtifactsPerExtension?: number
  }) {
    this.store = new AtomicJsonFile(
      join(options.dataDir, 'extensions', 'media-artifacts.json'),
      (value) => ArtifactDocumentSchema.parse(value)
    )
    this.now = options.now ?? (() => new Date())
    this.maxArtifactsPerExtension = boundedInteger(options.maxArtifactsPerExtension, 2048, 1, 100_000)
  }

  async create(
    principal: ExtensionPrincipal,
    input: CreateGeneratedArtifactInput
  ): Promise<GeneratedArtifact> {
    return (await this.createMany(principal, [input]))[0]!
  }

  /**
   * Publish a completed output set in one artifact-store revision. All media,
   * workspace, type, and quota checks finish before the store is mutated, so a
   * failed multi-output render cannot leave a partially published artifact set.
   */
  async createMany(
    principal: ExtensionPrincipal,
    inputs: readonly CreateGeneratedArtifactInput[]
  ): Promise<GeneratedArtifact[]> {
    if (inputs.length < 1 || inputs.length > 64) {
      throw new ExtensionArtifactError('artifact_limit', 'Generated artifact batch size is invalid')
    }
    if (new Set(inputs.map(({ mediaHandleId }) => mediaHandleId)).size !== inputs.length) {
      throw new ExtensionArtifactError('invalid_artifact', 'Generated artifact media handles must be distinct')
    }
    const prepared = await Promise.all(inputs.map(async (input) => {
      validateWorkspaceId(input.workspaceId)
      assertAuthorizedWorkspaceId(principal, input.workspaceId)
      const media = await this.options.handleService.resolve(principal, input.mediaHandleId, 'read')
      if (media.source !== 'generated' || !media.identity || !media.completionIdentity) {
        throw new ExtensionArtifactError('invalid_artifact', 'Artifact media is not a completed generated output')
      }
      const mediaKind = mediaKindForMime(media.mimeType)
      if (input.mimeType !== undefined && input.mimeType !== media.mimeType) {
        throw new ExtensionArtifactError('invalid_artifact', 'Artifact MIME type does not match completed media')
      }
      if (input.mediaKind !== undefined && input.mediaKind !== mediaKind) {
        throw new ExtensionArtifactError('invalid_artifact', 'Artifact media kind does not match completed media')
      }
      return GeneratedArtifactSchema.parse({
        schemaVersion: 1,
        artifactId: `artifact_${randomUUID()}`,
        ownerExtensionId: principal.extensionId,
        ownerExtensionVersion: principal.extensionVersion,
        workspaceId: input.workspaceId,
        mediaHandleId: media.id,
        displayName: input.displayName?.trim() || media.displayName,
        mediaKind,
        mimeType: media.mimeType,
        byteSize: media.identity.size,
        completionIdentity: media.completionIdentity,
        availability: 'available',
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.durationMicros !== undefined ? { durationMicros: input.durationMicros } : {}),
        provenance: input.provenance
      })
    }))
    const createdAt = this.now().toISOString()
    await this.store.update(emptyDocument, (document) => {
      const owned = Object.values(document.artifacts).filter((entry) =>
        entry.artifact.ownerExtensionId === principal.extensionId && !entry.revokedAt).length
      if (owned + prepared.length > this.maxArtifactsPerExtension) {
        throw new ExtensionArtifactError('artifact_limit', 'Generated artifact limit reached')
      }
      const artifacts = { ...document.artifacts }
      for (const artifact of prepared) {
        if (artifacts[artifact.artifactId] !== undefined) {
          throw new ExtensionArtifactError('invalid_artifact', 'Generated artifact identity collided')
        }
        artifacts[artifact.artifactId] = { artifact, createdAt }
      }
      return {
        ...document,
        revision: document.revision + 1,
        artifacts
      }
    })
    return prepared
  }

  /**
   * Hard-delete artifact records created by a job result that lost the durable
   * terminal fence. Filesystem and media-handle rollback remains owned by the
   * media transaction so artifact persistence never guesses at local paths.
   */
  async discardUncommittedJobArtifacts(
    principal: ExtensionPrincipal,
    jobId: string,
    artifacts: readonly GeneratedArtifact[]
  ): Promise<number> {
    if (!jobId || jobId.length > 512 || artifacts.length > 64) {
      throw new ExtensionArtifactError('invalid_artifact', 'Uncommitted artifact set is invalid')
    }
    if (artifacts.length === 0) return 0
    const requested = artifacts.map((artifact) => GeneratedArtifactSchema.parse(artifact))
    if (new Set(requested.map(({ artifactId }) => artifactId)).size !== requested.length) {
      throw new ExtensionArtifactError('invalid_artifact', 'Uncommitted artifact identities must be distinct')
    }
    let discarded = 0
    await this.store.update(emptyDocument, (document) => {
      for (const artifact of requested) {
        const record = document.artifacts[artifact.artifactId]
        if (!record) continue
        if (
          record.artifact.ownerExtensionId !== principal.extensionId ||
          record.artifact.ownerExtensionVersion !== principal.extensionVersion ||
          record.artifact.provenance.jobId !== jobId ||
          JSON.stringify(record.artifact) !== JSON.stringify(artifact)
        ) {
          throw new ExtensionArtifactError(
            'invalid_artifact',
            'Uncommitted artifact does not belong to this job attempt'
          )
        }
      }
      const next = { ...document.artifacts }
      for (const artifact of requested) {
        if (next[artifact.artifactId] === undefined) continue
        delete next[artifact.artifactId]
        discarded += 1
      }
      return {
        ...document,
        revision: document.revision + 1,
        artifacts: next
      }
    })
    return discarded
  }

  /** Core-only restart cleanup for artifacts from a non-completed job. */
  async discardUncommittedJobArtifactsByJob(
    principal: ExtensionPrincipal,
    jobId: string
  ): Promise<number> {
    if (!jobId || jobId.length > 512) {
      throw new ExtensionArtifactError('invalid_artifact', 'Uncommitted artifact job is invalid')
    }
    let discarded = 0
    await this.store.update(emptyDocument, (document) => {
      const artifacts = { ...document.artifacts }
      for (const [artifactId, record] of Object.entries(artifacts)) {
        if (record.artifact.ownerExtensionId !== principal.extensionId ||
          record.artifact.ownerExtensionVersion !== principal.extensionVersion ||
          record.artifact.provenance.jobId !== jobId) continue
        delete artifacts[artifactId]
        discarded += 1
      }
      if (discarded === 0) return document
      return {
        ...document,
        revision: document.revision + 1,
        artifacts
      }
    })
    return discarded
  }

  async getOwned(principal: ExtensionPrincipal, artifactId: string): Promise<GeneratedArtifact> {
    const record = await this.requireOwned(principal, artifactId)
    return await this.refreshAvailability(principal, record)
  }

  async listOwned(
    principal: ExtensionPrincipal,
    workspaceId?: string
  ): Promise<GeneratedArtifact[]> {
    const document = await this.store.read(emptyDocument)
    const records = Object.values(document.artifacts)
      .filter((entry) => entry.artifact.ownerExtensionId === principal.extensionId)
      .filter((entry) => entry.artifact.ownerExtensionVersion === principal.extensionVersion)
      .filter((entry) => !workspaceId || entry.artifact.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 2048)
    return await Promise.all(records.map((record) => this.refreshAvailability(principal, record)))
  }

  async validateToolResult(
    principal: ExtensionPrincipal,
    workspaceId: string,
    artifacts: readonly GeneratedArtifact[]
  ): Promise<GeneratedArtifact[]> {
    if (artifacts.length > 64) {
      throw new ExtensionArtifactError('artifact_limit', 'Tool result contains too many artifacts')
    }
    const validated: GeneratedArtifact[] = []
    for (const raw of artifacts) {
      const requested = GeneratedArtifactSchema.parse(raw)
      const current = await this.getOwned(principal, requested.artifactId)
      if (current.workspaceId !== workspaceId || current.availability !== 'available' ||
        JSON.stringify(current) !== JSON.stringify(requested)) {
        throw new ExtensionArtifactError('invalid_artifact', 'Tool result artifact is unavailable or does not match its durable record')
      }
      validated.push(current)
    }
    return validated
  }

  async release(principal: ExtensionPrincipal, artifactId: string): Promise<boolean> {
    let released = false
    await this.store.update(emptyDocument, (document) => {
      const record = document.artifacts[artifactId]
      if (!record || record.revokedAt || record.artifact.ownerExtensionId !== principal.extensionId ||
        record.artifact.ownerExtensionVersion !== principal.extensionVersion) return document
      released = true
      return {
        ...document,
        revision: document.revision + 1,
        artifacts: {
          ...document.artifacts,
          [artifactId]: { ...record, revokedAt: this.now().toISOString() }
        }
      }
    })
    return released
  }

  private async requireOwned(
    principal: ExtensionPrincipal,
    artifactId: string
  ): Promise<StoredArtifact> {
    const record = (await this.store.read(emptyDocument)).artifacts[artifactId]
    if (!record || record.artifact.ownerExtensionId !== principal.extensionId ||
      record.artifact.ownerExtensionVersion !== principal.extensionVersion) {
      throw new ExtensionArtifactError('not_found', 'Generated artifact was not found')
    }
    return record
  }

  private async refreshAvailability(
    principal: ExtensionPrincipal,
    record: StoredArtifact
  ): Promise<GeneratedArtifact> {
    if (record.revokedAt) return { ...record.artifact, availability: 'unavailable' }
    try {
      const media = await this.options.handleService.resolve(
        principal,
        record.artifact.mediaHandleId,
        'read'
      )
      const available = media.source === 'generated' &&
        media.completionIdentity === record.artifact.completionIdentity &&
        media.identity?.size === record.artifact.byteSize
      return { ...record.artifact, availability: available ? 'available' : 'unavailable' }
    } catch {
      return { ...record.artifact, availability: 'unavailable' }
    }
  }
}

function assertAuthorizedWorkspaceId(principal: ExtensionPrincipal, workspaceId: string): void {
  const authorized = principal.workspaceRoots.some((workspaceRoot) => {
    try {
      return extensionWorkspaceKey(workspaceRoot) === workspaceId
    } catch {
      return false
    }
  })
  if (authorized) return
  throw new ExtensionArtifactError('workspace_denied', 'Generated media belongs to another workspace')
}

function validateWorkspaceId(workspaceId: string): void {
  if (!workspaceId || workspaceId.length > 256 || containsAsciiControl(workspaceId)) {
    throw new ExtensionArtifactError('workspace_denied', 'Workspace is invalid')
  }
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function mediaKindForMime(mimeType: string): GeneratedArtifact['mediaKind'] {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'text/vtt' || mimeType === 'application/x-subrip') return 'subtitle'
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf' ||
    mimeType === 'application/x-otio+json') return 'document'
  if (mimeType === 'application/json' || mimeType === 'application/octet-stream') return 'data'
  return 'other'
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value!)))
}
