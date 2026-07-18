import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  MutationReceiptSchema,
  VideoProjectSchema,
  validateProjectRoundTrip,
  type MediaAsset,
  type MutationReceipt,
  type Revision,
  type VideoProject
} from './schema.js'
import {
  PROJECT_PACKAGE_LIMITS,
  type ProjectPackageChatProvenance,
  type ProjectPackageGenerationLineage
} from './project-package.js'
import { containsNullOrLineBreak, replaceNullOrLineBreaks } from '../text-safety.js'

export const PROJECT_PACKAGE_ARCHIVE_SCHEMA_VERSION = 1 as const
export const PROJECT_PACKAGE_ARCHIVE_INLINE_ENTRIES = 6
export const PROJECT_PACKAGE_ARCHIVE_MAX_UNIQUE_MEDIA =
  512 - PROJECT_PACKAGE_ARCHIVE_INLINE_ENTRIES

export type ProjectPackageArchiveMissingPolicy = 'fail' | 'omit'

export type ProjectPackageArchiveMediaObservation = {
  assetId: string
  status: 'available' | 'missing'
  handleId?: string
  displayName?: string
  mimeType?: string
  byteSize?: number
  completionIdentity?: string
  reason?: 'offline' | 'revoked' | 'changed' | 'unavailable'
}

export type ProjectPackageArchiveOptions = {
  includeMedia: 'all' | string[]
  missingMediaPolicy: ProjectPackageArchiveMissingPolicy
  receipts?: MutationReceipt[]
  chatProvenance?: ProjectPackageChatProvenance[]
}

export type ProjectPackageArchiveEntry =
  | {
      kind: 'media'
      inputHandleId: string
      archivePath: string
    }
  | {
      kind: 'inline-text'
      archivePath: string
      content: string
      mimeType: 'application/json'
    }

export type ProjectPackageArchivePlan = {
  schemaVersion: typeof PROJECT_PACKAGE_ARCHIVE_SCHEMA_VERSION
  packageId: string
  projectId: string
  projectRevision: number
  complete: boolean
  selectedAssetCount: number
  embeddedAssetCount: number
  uniqueMediaCount: number
  deduplicatedAssetCount: number
  missingAssetIds: string[]
  omittedAssetIds: string[]
  knownInputBytes: number
  manifestDigest: string
  idempotencyKey: string
  entries: ProjectPackageArchiveEntry[]
  manifest: ProjectPackageArchiveManifest
}

export type ProjectPackageArchiveManifest = {
  schemaVersion: typeof PROJECT_PACKAGE_ARCHIVE_SCHEMA_VERSION
  packageId: string
  createdAt: string
  complete: boolean
  missingMediaPolicy: ProjectPackageArchiveMissingPolicy
  project: {
    id: string
    schemaVersion: number
    revision: number
    activeSequenceId: string
    sequenceIds: string[]
    snapshotPath: 'project/project.json'
    snapshotDigest: string
  }
  media: Array<{
    assetId: string
    logicalName: string
    kind: MediaAsset['kind']
    status: 'embedded' | 'external' | 'omitted'
    objectPath?: string
    identity?: { algorithm: 'sha256'; value: string; sizeBytes?: number }
    observedBytes?: number
    mimeType?: string
    dedupeBasis?: 'source-sha256' | 'completion-identity' | 'asset'
    missingReason?: 'offline' | 'revoked' | 'changed' | 'unavailable'
  }>
  provenance: {
    receiptsPath: 'provenance/receipts.json'
    revisionLedgerPath: 'provenance/revision-ledger.json'
    chatPath: 'provenance/chat.json'
    generationLineagePath: 'provenance/generation-lineage.json'
    receiptCount: number
    revisionCount: number
    chatCount: number
    generationLineageCount: number
    chatScope: 'bounded-invocation-references' | 'not-requested'
  }
  deduplication: {
    embeddedAssetCount: number
    uniqueMediaCount: number
    deduplicatedAssetCount: number
  }
  missing: Array<{
    assetId: string
    reason: 'offline' | 'revoked' | 'changed' | 'unavailable'
    policy: ProjectPackageArchiveMissingPolicy
  }>
  contentDigests: Record<string, string>
}

/**
 * Builds a deterministic ZIP entry plan without reading binary bytes into the
 * extension. Media remains represented by opaque Host grants until the core
 * archive executor streams it into the atomic output transaction.
 */
export function buildProjectPackageArchivePlan(
  projectValue: VideoProject,
  observationsValue: ProjectPackageArchiveMediaObservation[],
  options: ProjectPackageArchiveOptions
): ProjectPackageArchivePlan {
  const project = validateProjectRoundTrip(projectValue)
  validateOptions(project, options)
  const observationByAsset = new Map(observationsValue.map((observation) => [
    boundedId(observation.assetId, 'media observation assetId'),
    validateObservation(observation)
  ]))
  if (observationByAsset.size !== observationsValue.length) invalid('Duplicate media observations are not allowed')
  const selectedIds = options.includeMedia === 'all'
    ? new Set(project.assets.map(({ id }) => id))
    : new Set(options.includeMedia)
  const sanitizedProject = sanitizeProjectSnapshot(project)
  const snapshotContent = stableJson(sanitizedProject)
  const snapshotDigest = sha256(snapshotContent)
  const receipts = [...(options.receipts ?? [])]
    .map((receipt) => MutationReceiptSchema.parse(receipt))
    .sort((left, right) => left.newRevision - right.newRevision ||
      left.transactionId.localeCompare(right.transactionId))
  const receiptContent = stableJson({ schemaVersion: 1, receipts: sanitizeMetadata(receipts) })
  const revisionLedger = revisionProvenance(project.revisions)
  const revisionContent = stableJson({ schemaVersion: 1, revisions: revisionLedger })
  const chat = [...(options.chatProvenance ?? [])]
    .map(validateChat)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) ||
      left.messageId.localeCompare(right.messageId))
  const chatContent = stableJson({
    schemaVersion: 1,
    scope: chat.length > 0 ? 'bounded-invocation-references' : 'not-requested',
    entries: chat
  })
  const generationLineage = generationProvenance(project.assets)
  const generationContent = stableJson({ schemaVersion: 1, entries: generationLineage })
  const mediaEntries: Extract<ProjectPackageArchiveEntry, { kind: 'media' }>[] = []
  const mediaManifest: ProjectPackageArchiveManifest['media'] = []
  const missing: ProjectPackageArchiveManifest['missing'] = []
  const objectByDedupeKey = new Map<string, { path: string; handleId: string }>()
  let embeddedAssetCount = 0
  let knownInputBytes = 0

  for (const asset of [...project.assets].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!selectedIds.has(asset.id)) {
      mediaManifest.push({
        assetId: asset.id,
        logicalName: safeLeaf(asset.name, asset.id),
        kind: asset.kind,
        status: 'external'
      })
      continue
    }
    const observation = observationByAsset.get(asset.id)
    const missingReason = mediaMissingReason(asset, observation)
    if (missingReason) {
      if (options.missingMediaPolicy === 'fail') {
        invalid(`Project package media ${asset.id} is ${missingReason}`)
      }
      missing.push({ assetId: asset.id, reason: missingReason, policy: 'omit' })
      mediaManifest.push({
        assetId: asset.id,
        logicalName: safeLeaf(asset.name, asset.id),
        kind: asset.kind,
        status: 'omitted',
        missingReason
      })
      continue
    }
    const available = observation!
    const identity = asset.sourceIdentity?.algorithm === 'sha256'
      ? {
          algorithm: 'sha256' as const,
          value: asset.sourceIdentity.value.toLowerCase(),
          ...(asset.sourceIdentity.sizeBytes === undefined
            ? {}
            : { sizeBytes: asset.sourceIdentity.sizeBytes })
        }
      : undefined
    if (identity?.sizeBytes !== undefined && available.byteSize !== undefined &&
      identity.sizeBytes !== available.byteSize) {
      if (options.missingMediaPolicy === 'fail') {
        invalid(`Project package media ${asset.id} changed after its source identity was recorded`)
      }
      missing.push({ assetId: asset.id, reason: 'changed', policy: 'omit' })
      mediaManifest.push({
        assetId: asset.id,
        logicalName: safeLeaf(asset.name, asset.id),
        kind: asset.kind,
        status: 'omitted',
        missingReason: 'changed'
      })
      continue
    }
    const dedupe = mediaDedupeIdentity(asset, available)
    let object = objectByDedupeKey.get(dedupe.key)
    if (!object) {
      if (objectByDedupeKey.size >= PROJECT_PACKAGE_ARCHIVE_MAX_UNIQUE_MEDIA) {
        invalid(`Project package exceeds ${PROJECT_PACKAGE_ARCHIVE_MAX_UNIQUE_MEDIA} unique media objects`)
      }
      const extension = safeExtension(available.displayName ?? asset.name)
      const objectPath = `media/${dedupe.objectId}${extension}`
      object = { path: objectPath, handleId: available.handleId! }
      objectByDedupeKey.set(dedupe.key, object)
      mediaEntries.push({ kind: 'media', inputHandleId: object.handleId, archivePath: object.path })
      knownInputBytes += available.byteSize ?? 0
    }
    embeddedAssetCount += 1
    mediaManifest.push({
      assetId: asset.id,
      logicalName: safeLeaf(available.displayName ?? asset.name, asset.id),
      kind: asset.kind,
      status: 'embedded',
      objectPath: object.path,
      ...(identity ? { identity } : {}),
      ...(available.byteSize === undefined ? {} : { observedBytes: available.byteSize }),
      ...(available.mimeType === undefined ? {} : { mimeType: safeMime(available.mimeType) }),
      dedupeBasis: dedupe.basis
    })
  }

  const contentDigests = {
    'project/project.json': snapshotDigest,
    'provenance/receipts.json': sha256(receiptContent),
    'provenance/revision-ledger.json': sha256(revisionContent),
    'provenance/chat.json': sha256(chatContent),
    'provenance/generation-lineage.json': sha256(generationContent)
  }
  const manifestSeed = {
    schemaVersion: PROJECT_PACKAGE_ARCHIVE_SCHEMA_VERSION,
    createdAt: project.updatedAt,
    complete: missing.length === 0,
    missingMediaPolicy: options.missingMediaPolicy,
    project: {
      id: project.id,
      schemaVersion: project.schemaVersion,
      revision: project.currentRevision,
      activeSequenceId: project.activeSequenceId,
      sequenceIds: project.sequences.map(({ id }) => id).sort(),
      snapshotPath: 'project/project.json' as const,
      snapshotDigest
    },
    media: mediaManifest,
    provenance: {
      receiptsPath: 'provenance/receipts.json' as const,
      revisionLedgerPath: 'provenance/revision-ledger.json' as const,
      chatPath: 'provenance/chat.json' as const,
      generationLineagePath: 'provenance/generation-lineage.json' as const,
      receiptCount: receipts.length,
      revisionCount: revisionLedger.length,
      chatCount: chat.length,
      generationLineageCount: generationLineage.length,
      chatScope: chat.length > 0
        ? 'bounded-invocation-references' as const
        : 'not-requested' as const
    },
    deduplication: {
      embeddedAssetCount,
      uniqueMediaCount: objectByDedupeKey.size,
      deduplicatedAssetCount: embeddedAssetCount - objectByDedupeKey.size
    },
    missing,
    contentDigests
  }
  const packageId = `pkg-${sha256(stableStringify(manifestSeed)).slice(0, 32)}`
  const manifest: ProjectPackageArchiveManifest = { ...manifestSeed, packageId }
  assertManifestSafe(manifest)
  const manifestContent = stableJson(manifest)
  const inlineEntries: ProjectPackageArchiveEntry[] = [
    inline('manifest/package.json', manifestContent),
    inline('project/project.json', snapshotContent),
    inline('provenance/receipts.json', receiptContent),
    inline('provenance/revision-ledger.json', revisionContent),
    inline('provenance/chat.json', chatContent),
    inline('provenance/generation-lineage.json', generationContent)
  ]
  const entries = [...inlineEntries, ...mediaEntries]
    .sort((left, right) => left.archivePath.localeCompare(right.archivePath))
  const manifestDigest = sha256(manifestContent)
  return {
    schemaVersion: PROJECT_PACKAGE_ARCHIVE_SCHEMA_VERSION,
    packageId,
    projectId: project.id,
    projectRevision: project.currentRevision,
    complete: missing.length === 0,
    selectedAssetCount: selectedIds.size,
    embeddedAssetCount,
    uniqueMediaCount: objectByDedupeKey.size,
    deduplicatedAssetCount: embeddedAssetCount - objectByDedupeKey.size,
    missingAssetIds: missing.map(({ assetId }) => assetId),
    omittedAssetIds: missing.map(({ assetId }) => assetId),
    knownInputBytes,
    manifestDigest,
    idempotencyKey: `project-package:${sha256(
      `${project.id}\0${project.currentRevision}\0${manifestDigest}`
    )}`,
    entries,
    manifest
  }
}

function validateOptions(project: VideoProject, options: ProjectPackageArchiveOptions): void {
  if (options.missingMediaPolicy !== 'fail' && options.missingMediaPolicy !== 'omit') {
    invalid('Project package missing-media policy must be fail or omit')
  }
  if (options.includeMedia !== 'all') {
    if (!Array.isArray(options.includeMedia) || options.includeMedia.length > PROJECT_PACKAGE_LIMITS.mediaAssets) {
      invalid('Project package media selection exceeds its limit')
    }
    const known = new Set(project.assets.map(({ id }) => id))
    const unique = new Set(options.includeMedia)
    if (unique.size !== options.includeMedia.length) invalid('Project package media selection contains duplicates')
    for (const id of unique) {
      boundedId(id, 'selected assetId')
      if (!known.has(id)) invalid(`Project package media selection contains unknown asset ${id}`)
    }
  }
  if ((options.receipts?.length ?? 0) > PROJECT_PACKAGE_LIMITS.receipts) {
    invalid('Project package receipt limit exceeded')
  }
  if ((options.chatProvenance?.length ?? 0) > PROJECT_PACKAGE_LIMITS.chatProvenance) {
    invalid('Project package chat provenance limit exceeded')
  }
}

function validateObservation(value: ProjectPackageArchiveMediaObservation): ProjectPackageArchiveMediaObservation {
  if (value.status === 'missing') {
    if (!value.reason || !['offline', 'revoked', 'changed', 'unavailable'].includes(value.reason)) {
      invalid(`Missing media observation ${value.assetId} requires a bounded reason`)
    }
    return structuredClone(value)
  }
  opaque(value.handleId, `media observation ${value.assetId} handleId`)
  if (value.byteSize !== undefined && (!Number.isSafeInteger(value.byteSize) || value.byteSize < 0)) {
    invalid(`Media observation ${value.assetId} byteSize is invalid`)
  }
  if (value.completionIdentity !== undefined) {
    boundedString(value.completionIdentity, `media observation ${value.assetId} completionIdentity`, 512)
  }
  return structuredClone(value)
}

function mediaMissingReason(
  asset: MediaAsset,
  observation: ProjectPackageArchiveMediaObservation | undefined
): 'offline' | 'revoked' | 'changed' | 'unavailable' | undefined {
  if (asset.availability === 'offline' || !asset.mediaHandleId) return 'offline'
  if (asset.availability === 'revoked') return 'revoked'
  if (asset.availability === 'changed') return 'changed'
  if (!observation || observation.status === 'missing') return observation?.reason ?? 'unavailable'
  if (observation.handleId !== asset.mediaHandleId) return 'changed'
  return undefined
}

function mediaDedupeIdentity(
  asset: MediaAsset,
  observation: ProjectPackageArchiveMediaObservation
): { key: string; objectId: string; basis: 'source-sha256' | 'completion-identity' | 'asset' } {
  if (asset.sourceIdentity?.algorithm === 'sha256') {
    const digest = asset.sourceIdentity.value.toLowerCase()
    if (!/^[a-f0-9]{64}$/u.test(digest)) invalid(`Asset ${asset.id} source identity is invalid`)
    return { key: `sha256:${digest}`, objectId: `sha256-${digest}`, basis: 'source-sha256' }
  }
  if (observation.completionIdentity) {
    const digest = sha256(`completion\0${observation.completionIdentity}`)
    return { key: `completion:${digest}`, objectId: `grant-${digest}`, basis: 'completion-identity' }
  }
  const digest = sha256(`asset\0${asset.id}`)
  return { key: `asset:${asset.id}`, objectId: `asset-${digest}`, basis: 'asset' }
}

function sanitizeProjectSnapshot(project: VideoProject): VideoProject {
  const snapshot = structuredClone(project)
  snapshot.assets = snapshot.assets.map((asset) => {
    const next = { ...asset }
    delete next.workspaceRelativePath
    next.mediaHandleId = `package_offline_${asset.id}`
    next.availability = 'offline'
    if (next.generatedLineage) {
      next.generatedLineage = { ...next.generatedLineage, prompt: undefined }
    }
    next.recovery = next.recovery
      ? { reason: next.recovery.reason, lastVerifiedAt: next.recovery.lastVerifiedAt }
      : undefined
    return next
  })
  return validateProjectRoundTrip(VideoProjectSchema.parse(sanitizeMetadata(snapshot)))
}

function revisionProvenance(revisions: Revision[]) {
  return revisions.slice(-PROJECT_PACKAGE_LIMITS.receipts).map((revision) => ({
    revision: revision.revision,
    parentRevision: revision.parentRevision,
    author: revision.author,
    ...(revision.actorId ? { actorId: revision.actorId } : {}),
    ...(revision.transactionId ? { transactionId: revision.transactionId } : {}),
    sourceOperation: revision.sourceOperation,
    timestamp: revision.timestamp,
    summary: sanitizeString(revision.summary),
    operationCount: revision.operations.length,
    ...(revision.restoredFromRevision === undefined
      ? {}
      : { restoredFromRevision: revision.restoredFromRevision })
  }))
}

function generationProvenance(assets: MediaAsset[]): ProjectPackageGenerationLineage[] {
  return assets.flatMap((asset) => asset.generatedLineage ? [{
    assetId: asset.id,
    jobId: asset.generatedLineage.jobId,
    providerId: asset.generatedLineage.providerId,
    modelId: asset.generatedLineage.modelId,
    promptDigest: asset.generatedLineage.promptDigest ?? sha256(asset.generatedLineage.prompt ?? ''),
    referenceAssetIds: [...new Set(asset.generatedLineage.referenceAssetIds)].sort(),
    ...(asset.generatedLineage.variantOfAssetId
      ? { parentAssetId: asset.generatedLineage.variantOfAssetId }
      : {})
  }] : []).sort((left, right) => left.assetId.localeCompare(right.assetId))
}

function validateChat(value: ProjectPackageChatProvenance): ProjectPackageChatProvenance {
  boundedId(value.threadId, 'chat threadId')
  boundedId(value.messageId, 'chat messageId')
  if (!['user', 'assistant', 'tool'].includes(value.role)) invalid('Chat provenance role is invalid')
  if (!Number.isFinite(Date.parse(value.createdAt))) invalid('Chat provenance timestamp is invalid')
  if (!/^[a-f0-9]{64}$/iu.test(value.contentDigest)) invalid('Chat provenance digest is invalid')
  return structuredClone(value)
}

function inline(archivePath: string, content: string): ProjectPackageArchiveEntry {
  return { kind: 'inline-text', archivePath, content, mimeType: 'application/json' }
}

function assertManifestSafe(manifest: ProjectPackageArchiveManifest): void {
  visitStrings(manifest, (value) => {
    if (/file:\/\//iu.test(value) || /[A-Za-z]:[\\/]/u.test(value) ||
      /(^|\s)\/(?:Users|home|private|var|tmp|Volumes|mnt|opt|etc)\//u.test(value) ||
      /^media_[A-Za-z0-9_-]+$/u.test(value)) {
      invalid('Project package manifest contains a filesystem path or reusable media handle')
    }
  })
}

function safeLeaf(value: string, fallback: string): string {
  const leaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? fallback
  return replaceNullOrLineBreaks(leaf, '').trim().slice(0, 255) || fallback
}

function safeExtension(value: string): string {
  const leaf = safeLeaf(value, '')
  const matched = /\.([A-Za-z0-9]{1,16})$/u.exec(leaf)
  return matched ? `.${matched[1]!.toLowerCase()}` : '.bin'
}

function safeMime(value: string): string {
  const normalized = value.toLowerCase()
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(normalized)) {
    invalid('Project package media MIME type is invalid')
  }
  return normalized
}

function sanitizeMetadata<T>(value: T): T {
  const walk = (entry: unknown): unknown => {
    if (typeof entry === 'string') return sanitizeString(entry)
    if (Array.isArray(entry)) return entry.map(walk)
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .map(([key, child]) => [key, walk(child)]))
    }
    return entry
  }
  return walk(structuredClone(value)) as T
}

function sanitizeString(value: string): string {
  return value
    .replace(/file:\/\/[^\s]+/giu, '[redacted-path]')
    .replace(/[A-Za-z]:[\\/][^\s]+/gu, '[redacted-path]')
    .replace(/(^|\s)\/(?:Users|home|private|var|tmp|Volumes|mnt|opt|etc)\/[^\s]+/gu, '$1[redacted-path]')
}

function stableJson(value: unknown): string {
  return `${stableStringify(value)}\n`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function visitStrings(value: unknown, callback: (value: string) => void): void {
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string') callback(current)
    else if (Array.isArray(current)) stack.push(...current)
    else if (current && typeof current === 'object') {
      stack.push(...Object.values(current as Record<string, unknown>))
    }
  }
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u.test(value)) {
    invalid(`${label} must be a bounded identifier`)
  }
  return value
}

function boundedString(value: unknown, label: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || containsNullOrLineBreak(value)) {
    invalid(`${label} must be a bounded string`)
  }
}

function opaque(value: unknown, label: string): asserts value is string {
  boundedString(value, label, 512)
  if (/^(?:[A-Za-z]:[\\/]|\/|\\\\|file:|https?:)/iu.test(value)) invalid(`${label} must be opaque`)
}

function invalid(message: string): never {
  throw engineError('render_unsupported', message)
}
