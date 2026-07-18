import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  MutationReceiptSchema,
  VideoProjectSchema,
  validateProjectRoundTrip,
  type MediaAsset,
  type MutationReceipt,
  type VideoProject
} from './schema.js'
import { containsNullOrLineBreak, replaceNullOrLineBreaks } from '../text-safety.js'

export const PROJECT_PACKAGE_SCHEMA_VERSION = 1 as const

export const PROJECT_PACKAGE_LIMITS = Object.freeze({
  mediaAssets: 512,
  mediaObjectBytes: 512 * 1024 * 1024,
  totalMediaBytes: 2 * 1024 * 1024 * 1024,
  packageBytes: 3 * 1024 * 1024 * 1024,
  receipts: 2_000,
  chatProvenance: 10_000,
  generationLineage: 2_000,
  missingMedia: 512,
  string: 1_024,
  id: 192
})

export type ProjectPackageMissingMediaPolicy = 'fail' | 'record-incomplete'

export type ProjectPackageChatProvenance = {
  threadId: string
  messageId: string
  role: 'user' | 'assistant' | 'tool'
  createdAt: string
  contentDigest: string
}

export type ProjectPackageGenerationLineage = {
  assetId: string
  jobId: string
  providerId: string
  modelId: string
  promptDigest: string
  referenceAssetIds: string[]
  parentAssetId?: string
}

export type ProjectPackageBuildOptions = {
  includeMedia: 'all' | string[]
  missingMediaPolicy: ProjectPackageMissingMediaPolicy
  receipts?: MutationReceipt[]
  chatProvenance?: ProjectPackageChatProvenance[]
  generationLineage?: ProjectPackageGenerationLineage[]
}

export type ProjectPackageMediaRequest = {
  assetId: string
  logicalName: string
  expectedIdentity?: { algorithm: 'sha256'; value: string; sizeBytes?: number }
}

export type ProjectPackageMediaResolution =
  | {
      status: 'available'
      bytes: Uint8Array
      logicalName?: string
      mime?: string
    }
  | {
      status: 'missing'
      reason: 'offline' | 'revoked' | 'changed' | 'unavailable'
    }

export type ProjectPackageMediaResolver = (
  request: ProjectPackageMediaRequest,
  signal: AbortSignal
) => Promise<ProjectPackageMediaResolution>

export type ProjectPackageMediaManifestEntry = {
  assetId: string
  logicalName: string
  kind: MediaAsset['kind']
  selection: 'embedded' | 'not-selected'
  status: 'embedded' | 'external' | 'missing'
  objectId?: string
  sha256?: string
  bytes?: number
  mime?: string
  missingReason?: 'offline' | 'revoked' | 'changed' | 'unavailable' | 'identity-mismatch'
}

export type ProjectPackageObject = {
  id: string
  sha256: string
  bytes: number
  mime: string
  dataBase64: string
}

export type SelfContainedProjectPackageBody = {
  schemaVersion: typeof PROJECT_PACKAGE_SCHEMA_VERSION
  packageId: string
  createdAt: string
  complete: boolean
  project: {
    id: string
    schemaVersion: number
    revision: number
    activeSequenceId: string
    sequenceIds: string[]
    snapshotDigest: string
    snapshot: VideoProject
  }
  mediaManifest: ProjectPackageMediaManifestEntry[]
  objects: ProjectPackageObject[]
  provenance: {
    receiptsIncluded: boolean
    chatIncluded: boolean
    receipts: MutationReceipt[]
    chat: ProjectPackageChatProvenance[]
    generationLineage: ProjectPackageGenerationLineage[]
    redactedPathValues: number
  }
  missingMedia: Array<{
    assetId: string
    reason: NonNullable<ProjectPackageMediaManifestEntry['missingReason']>
  }>
}

export type SelfContainedProjectPackage = SelfContainedProjectPackageBody & {
  integrity: {
    algorithm: 'sha256'
    value: string
  }
}

export type BuiltProjectPackage = {
  package: SelfContainedProjectPackage
  bytes: Uint8Array
  digest: string
  complete: boolean
  embeddedAssetCount: number
  uniqueObjectCount: number
  deduplicatedAssetCount: number
  missingAssetIds: string[]
}

export type ProjectPackageJobOwner = {
  extensionId: string
  extensionVersion: string
  workspaceId: string
  projectId: string
  sequenceId: string
  revision: number
  idempotencyKey: string
  targetHandle: string
}

export type ProjectPackageJobState =
  | 'queued'
  | 'building'
  | 'staged'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'failed'

export type ProjectPackageJobRecord = ProjectPackageJobOwner & {
  jobId: string
  attempt: number
  generation: number
  state: ProjectPackageJobState
  progress: number
  packageDigest?: string
  stagingId?: string
  completedDigest?: string
  errorCode?: string
}

export type AtomicPackageTransaction = {
  stagingId: string
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>
  commit(signal: AbortSignal): Promise<void>
  rollback(reason: string): Promise<void>
}

export type AtomicPackageSink = {
  begin(request: {
    targetHandle: string
    jobId: string
    attempt: number
    idempotencyKey: string
    packageDigest: string
    bytes: number
  }): Promise<AtomicPackageTransaction>
  rollbackStaging(stagingId: string, reason: string): Promise<void>
  committedDigest?(request: {
    targetHandle: string
    jobId: string
    idempotencyKey: string
  }): Promise<string | undefined>
}

export type StagedProjectPackageExport = {
  record: ProjectPackageJobRecord
  transaction: AtomicPackageTransaction
  built: BuiltProjectPackage
}

export async function buildSelfContainedProjectPackage(
  project: VideoProject,
  options: ProjectPackageBuildOptions,
  resolveMedia: ProjectPackageMediaResolver,
  signal: AbortSignal = new AbortController().signal
): Promise<BuiltProjectPackage> {
  assertNotCancelled(signal)
  const validated = validateProjectRoundTrip(project)
  validateBuildOptions(validated, options)
  const sanitized = sanitizeProject(validated)
  const selected = options.includeMedia === 'all'
    ? new Set(validated.assets.map(({ id }) => id))
    : new Set(options.includeMedia)
  const objectsByDigest = new Map<string, ProjectPackageObject>()
  const mediaManifest: ProjectPackageMediaManifestEntry[] = []
  const missingMedia: SelfContainedProjectPackageBody['missingMedia'] = []
  let totalMediaBytes = 0
  for (const asset of validated.assets.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    assertNotCancelled(signal)
    const logicalName = safeLogicalName(asset.name, asset.id)
    if (!selected.has(asset.id)) {
      mediaManifest.push({
        assetId: asset.id,
        logicalName,
        kind: asset.kind,
        selection: 'not-selected',
        status: 'external'
      })
      continue
    }
    const resolution = await resolveMedia({
      assetId: asset.id,
      logicalName,
      ...(asset.sourceIdentity ? {
        expectedIdentity: {
          algorithm: 'sha256',
          value: asset.sourceIdentity.value,
          ...(asset.sourceIdentity.sizeBytes === undefined ? {} : { sizeBytes: asset.sourceIdentity.sizeBytes })
        }
      } : {})
    }, signal)
    assertNotCancelled(signal)
    if (resolution.status === 'missing') {
      handleMissing(asset, logicalName, resolution.reason, options.missingMediaPolicy, mediaManifest, missingMedia)
      continue
    }
    const bytes = Buffer.from(resolution.bytes)
    if (bytes.byteLength <= 0 || bytes.byteLength > PROJECT_PACKAGE_LIMITS.mediaObjectBytes) {
      invalid(`Media ${asset.id} has an empty or oversized package payload`)
    }
    totalMediaBytes += bytes.byteLength
    if (totalMediaBytes > PROJECT_PACKAGE_LIMITS.totalMediaBytes) invalid('Selected media exceeds the project-package byte limit')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (
      asset.sourceIdentity?.algorithm === 'sha256' &&
      asset.sourceIdentity.value.toLowerCase() !== sha256
    ) {
      handleMissing(asset, logicalName, 'identity-mismatch', options.missingMediaPolicy, mediaManifest, missingMedia)
      continue
    }
    const objectId = `sha256-${sha256}`
    const mime = safeMime(resolution.mime, asset.kind)
    if (!objectsByDigest.has(sha256)) {
      objectsByDigest.set(sha256, {
        id: objectId,
        sha256,
        bytes: bytes.byteLength,
        mime,
        dataBase64: bytes.toString('base64')
      })
    }
    mediaManifest.push({
      assetId: asset.id,
      logicalName: safeLogicalName(resolution.logicalName ?? logicalName, asset.id),
      kind: asset.kind,
      selection: 'embedded',
      status: 'embedded',
      objectId,
      sha256,
      bytes: bytes.byteLength,
      mime
    })
  }
  const parsedReceipts = (options.receipts ?? [])
    .map((receipt) => MutationReceiptSchema.parse(receipt))
  const sanitizedReceipts = sanitizeMetadata(parsedReceipts)
  const receipts = (sanitizedReceipts.value as MutationReceipt[])
    .sort((left, right) => left.newRevision - right.newRevision || left.transactionId.localeCompare(right.transactionId))
  const chat = (options.chatProvenance ?? [])
    .map(validateChatProvenance)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId))
  const lineage = (options.generationLineage ?? [])
    .map(validateGenerationLineage)
    .sort((left, right) => left.assetId.localeCompare(right.assetId) || left.jobId.localeCompare(right.jobId))
  const sanitizedProject = sanitizeMetadata(sanitized)
  const projectSnapshot = validateProjectRoundTrip(VideoProjectSchema.parse(sanitizedProject.value))
  const snapshotDigest = canonicalDigest(projectSnapshot)
  const objects = [...objectsByDigest.values()].sort((left, right) => left.sha256.localeCompare(right.sha256))
  const complete = missingMedia.length === 0
  const bodyWithoutId = {
    schemaVersion: PROJECT_PACKAGE_SCHEMA_VERSION,
    createdAt: validated.updatedAt,
    complete,
    project: {
      id: validated.id,
      schemaVersion: validated.schemaVersion,
      revision: validated.currentRevision,
      activeSequenceId: validated.activeSequenceId,
      sequenceIds: validated.sequences.map(({ id }) => id).sort(),
      snapshotDigest,
      snapshot: projectSnapshot
    },
    mediaManifest,
    objects,
    provenance: {
      receiptsIncluded: options.receipts !== undefined,
      chatIncluded: options.chatProvenance !== undefined,
      receipts,
      chat,
      generationLineage: lineage,
      redactedPathValues: sanitizedReceipts.redacted + sanitizedProject.redacted
    },
    missingMedia
  }
  const packageId = `pkg-${canonicalDigest(bodyWithoutId).slice(0, 32)}`
  const body: SelfContainedProjectPackageBody = { ...bodyWithoutId, packageId }
  assertPackageMetadataSafe(body)
  const integrityValue = canonicalDigest(body)
  const packageValue: SelfContainedProjectPackage = {
    ...body,
    integrity: { algorithm: 'sha256', value: integrityValue }
  }
  const bytes = Buffer.from(`${stableStringify(packageValue)}\n`, 'utf8')
  if (bytes.byteLength > PROJECT_PACKAGE_LIMITS.packageBytes) invalid('Project package exceeds its byte limit')
  return {
    package: packageValue,
    bytes,
    digest: integrityValue,
    complete,
    embeddedAssetCount: mediaManifest.filter(({ status }) => status === 'embedded').length,
    uniqueObjectCount: objects.length,
    deduplicatedAssetCount: mediaManifest.filter(({ status }) => status === 'embedded').length - objects.length,
    missingAssetIds: missingMedia.map(({ assetId }) => assetId)
  }
}

export function parseSelfContainedProjectPackage(value: Uint8Array | string | unknown): SelfContainedProjectPackage {
  const parsed = value instanceof Uint8Array || typeof value === 'string'
    ? JSON.parse(Buffer.from(value).toString('utf8')) as unknown
    : structuredClone(value)
  const packageValue = record(parsed, 'project package') as SelfContainedProjectPackage
  if (packageValue.schemaVersion !== PROJECT_PACKAGE_SCHEMA_VERSION) invalid('Unsupported project-package schema version')
  const integrity = record(packageValue.integrity, 'project package integrity')
  if (integrity.algorithm !== 'sha256' || typeof integrity.value !== 'string') invalid('Project-package integrity is invalid')
  const { integrity: _integrity, ...body } = packageValue
  if (canonicalDigest(body) !== integrity.value) invalid('Project-package integrity check failed')
  if (packageValue.project.snapshotDigest !== canonicalDigest(packageValue.project.snapshot)) {
    invalid('Project-package snapshot digest check failed')
  }
  validateProjectRoundTrip(VideoProjectSchema.parse(packageValue.project.snapshot))
  if (!Array.isArray(packageValue.objects) || !Array.isArray(packageValue.mediaManifest)) invalid('Project-package manifests are invalid')
  const objectIds = new Set<string>()
  for (const objectValue of packageValue.objects) {
    const bytes = Buffer.from(objectValue.dataBase64, 'base64')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== objectValue.sha256 || bytes.byteLength !== objectValue.bytes || objectValue.id !== `sha256-${sha256}`) {
      invalid(`Project-package media object ${objectValue.id} failed integrity validation`)
    }
    if (objectIds.has(objectValue.id)) invalid(`Duplicate project-package media object ${objectValue.id}`)
    objectIds.add(objectValue.id)
  }
  for (const entry of packageValue.mediaManifest) {
    if (entry.status === 'embedded' && (!entry.objectId || !objectIds.has(entry.objectId))) {
      invalid(`Project-package media ${entry.assetId} refers to a missing object`)
    }
  }
  assertPackageMetadataSafe(body as SelfContainedProjectPackageBody)
  return packageValue
}

export function createProjectPackageJob(owner: ProjectPackageJobOwner): ProjectPackageJobRecord {
  validateOwner(owner)
  const jobId = `package-${canonicalDigest(owner).slice(0, 32)}`
  return { ...structuredClone(owner), jobId, attempt: 1, generation: 0, state: 'queued', progress: 0 }
}

export async function stageProjectPackageExport(
  record: ProjectPackageJobRecord,
  built: BuiltProjectPackage,
  sink: AtomicPackageSink,
  signal: AbortSignal
): Promise<StagedProjectPackageExport> {
  assertJobState(record, ['queued', 'interrupted'])
  assertNotCancelled(signal)
  const transaction = await sink.begin({
    targetHandle: record.targetHandle,
    jobId: record.jobId,
    attempt: record.attempt,
    idempotencyKey: record.idempotencyKey,
    packageDigest: built.digest,
    bytes: built.bytes.byteLength
  })
  try {
    await transaction.write(built.bytes, signal)
    assertNotCancelled(signal)
  } catch (error) {
    await transaction.rollback(isCancellation(error, signal) ? 'cancelled' : 'stage-failed')
    throw error
  }
  return {
    record: {
      ...record,
      generation: record.generation + 1,
      state: 'staged',
      progress: 0.9,
      packageDigest: built.digest,
      stagingId: transaction.stagingId,
      errorCode: undefined
    },
    transaction,
    built
  }
}

export async function commitStagedProjectPackageExport(
  staged: StagedProjectPackageExport,
  signal: AbortSignal
): Promise<ProjectPackageJobRecord> {
  assertJobState(staged.record, ['staged'])
  try {
    assertNotCancelled(signal)
    await staged.transaction.commit(signal)
    assertNotCancelled(signal)
    return {
      ...staged.record,
      generation: staged.record.generation + 1,
      state: 'completed',
      progress: 1,
      completedDigest: staged.built.digest,
      stagingId: undefined,
      errorCode: undefined
    }
  } catch (error) {
    const cancelled = isCancellation(error, signal)
    await staged.transaction.rollback(cancelled ? 'cancelled' : 'commit-failed')
    return {
      ...staged.record,
      generation: staged.record.generation + 1,
      state: cancelled ? 'cancelled' : 'failed',
      progress: 0,
      stagingId: undefined,
      errorCode: cancelled ? 'cancelled' : 'commit-failed'
    }
  }
}

export async function reconcileInterruptedProjectPackageJob(
  record: ProjectPackageJobRecord,
  sink: AtomicPackageSink
): Promise<ProjectPackageJobRecord> {
  if (record.state === 'completed' || record.state === 'cancelled' || record.state === 'failed') return structuredClone(record)
  const committedDigest = await sink.committedDigest?.({
    targetHandle: record.targetHandle,
    jobId: record.jobId,
    idempotencyKey: record.idempotencyKey
  })
  if (committedDigest && record.packageDigest === committedDigest) {
    return {
      ...record,
      generation: record.generation + 1,
      state: 'completed',
      progress: 1,
      completedDigest: committedDigest,
      stagingId: undefined,
      errorCode: undefined
    }
  }
  if (record.stagingId) await sink.rollbackStaging(record.stagingId, 'process-restart')
  return {
    ...record,
    generation: record.generation + 1,
    state: 'interrupted',
    progress: 0,
    stagingId: undefined,
    errorCode: 'process-interrupted-by-restart'
  }
}

export function retryInterruptedProjectPackageJob(record: ProjectPackageJobRecord): ProjectPackageJobRecord {
  assertJobState(record, ['interrupted', 'failed', 'cancelled'])
  return {
    ...record,
    attempt: record.attempt + 1,
    generation: record.generation + 1,
    state: 'queued',
    progress: 0,
    packageDigest: undefined,
    stagingId: undefined,
    completedDigest: undefined,
    errorCode: undefined
  }
}

function sanitizeProject(project: VideoProject): VideoProject {
  const result = structuredClone(project)
  result.assets = result.assets.map((asset) => {
    const safe = { ...asset }
    delete safe.workspaceRelativePath
    // The package manifest resolves this namespaced offline placeholder during
    // import. It is not a reusable Host media grant and contains no source path.
    safe.mediaHandleId = `package_offline_${asset.id}`
    safe.availability = 'offline'
    safe.recovery = safe.recovery
      ? { reason: safe.recovery.reason, lastVerifiedAt: safe.recovery.lastVerifiedAt }
      : undefined
    return safe
  })
  return validateProjectRoundTrip(result)
}

function handleMissing(
  asset: MediaAsset,
  logicalName: string,
  reason: NonNullable<ProjectPackageMediaManifestEntry['missingReason']>,
  policy: ProjectPackageMissingMediaPolicy,
  manifest: ProjectPackageMediaManifestEntry[],
  missing: SelfContainedProjectPackageBody['missingMedia']
): void {
  if (policy === 'fail') {
    throw engineError(
      'render_unsupported',
      `Self-contained package cannot include media ${asset.id}: ${reason}`,
      { assetId: asset.id, reason }
    )
  }
  if (missing.length >= PROJECT_PACKAGE_LIMITS.missingMedia) invalid('Missing-media manifest exceeds its limit')
  manifest.push({
    assetId: asset.id,
    logicalName,
    kind: asset.kind,
    selection: 'embedded',
    status: 'missing',
    missingReason: reason
  })
  missing.push({ assetId: asset.id, reason })
}

function validateBuildOptions(project: VideoProject, options: ProjectPackageBuildOptions): void {
  if (options.missingMediaPolicy !== 'fail' && options.missingMediaPolicy !== 'record-incomplete') {
    invalid('Project-package missing-media policy is invalid')
  }
  if (options.includeMedia !== 'all') {
    if (!Array.isArray(options.includeMedia) || options.includeMedia.length > PROJECT_PACKAGE_LIMITS.mediaAssets) {
      invalid('Project-package media selection exceeds its limit')
    }
    const available = new Set(project.assets.map(({ id }) => id))
    const selected = new Set<string>()
    for (const assetId of options.includeMedia) {
      boundedId(assetId, 'includeMedia assetId')
      if (!available.has(assetId)) invalid(`Project-package media selection contains unknown asset ${assetId}`)
      if (selected.has(assetId)) invalid(`Project-package media selection duplicates asset ${assetId}`)
      selected.add(assetId)
    }
  }
  if ((options.receipts?.length ?? 0) > PROJECT_PACKAGE_LIMITS.receipts) invalid('Project-package receipt limit exceeded')
  if ((options.chatProvenance?.length ?? 0) > PROJECT_PACKAGE_LIMITS.chatProvenance) invalid('Project-package chat provenance limit exceeded')
  if ((options.generationLineage?.length ?? 0) > PROJECT_PACKAGE_LIMITS.generationLineage) invalid('Project-package generation lineage limit exceeded')
}

function validateChatProvenance(value: ProjectPackageChatProvenance): ProjectPackageChatProvenance {
  boundedId(value.threadId, 'chat.threadId')
  boundedId(value.messageId, 'chat.messageId')
  if (!['user', 'assistant', 'tool'].includes(value.role)) invalid('Chat provenance role is invalid')
  isoTimestamp(value.createdAt, 'chat.createdAt')
  sha256(value.contentDigest, 'chat.contentDigest')
  return structuredClone(value)
}

function validateGenerationLineage(value: ProjectPackageGenerationLineage): ProjectPackageGenerationLineage {
  boundedId(value.assetId, 'lineage.assetId')
  boundedId(value.jobId, 'lineage.jobId')
  boundedId(value.providerId, 'lineage.providerId')
  boundedId(value.modelId, 'lineage.modelId')
  sha256(value.promptDigest, 'lineage.promptDigest')
  if (!Array.isArray(value.referenceAssetIds) || value.referenceAssetIds.length > 64) invalid('Lineage references exceed their limit')
  value.referenceAssetIds.forEach((id) => boundedId(id, 'lineage.referenceAssetId'))
  if (value.parentAssetId !== undefined) boundedId(value.parentAssetId, 'lineage.parentAssetId')
  return { ...structuredClone(value), referenceAssetIds: [...new Set(value.referenceAssetIds)].sort() }
}

function validateOwner(owner: ProjectPackageJobOwner): void {
  boundedId(owner.extensionId, 'owner.extensionId')
  boundedString(owner.extensionVersion, 'owner.extensionVersion', 64)
  boundedId(owner.workspaceId, 'owner.workspaceId')
  boundedId(owner.projectId, 'owner.projectId')
  boundedId(owner.sequenceId, 'owner.sequenceId')
  if (!Number.isSafeInteger(owner.revision) || owner.revision < 0) invalid('owner.revision must be a non-negative integer')
  boundedString(owner.idempotencyKey, 'owner.idempotencyKey', 256)
  opaqueHandle(owner.targetHandle, 'owner.targetHandle')
}

function assertJobState(record: ProjectPackageJobRecord, expected: readonly ProjectPackageJobState[]): void {
  if (!expected.includes(record.state)) invalid(`Project-package job state ${record.state} cannot perform this operation`)
}

function assertPackageMetadataSafe(body: SelfContainedProjectPackageBody): void {
  for (const asset of body.project.snapshot.assets) {
    if (
      asset.workspaceRelativePath !== undefined ||
      asset.recovery?.previousMediaHandleId !== undefined ||
      !asset.mediaHandleId?.startsWith('package_offline_')
    ) {
      invalid(`Project-package snapshot leaks a reusable media reference for ${asset.id}`)
    }
  }
  const inspect = {
    ...body,
    objects: body.objects.map(({ dataBase64: _dataBase64, ...metadata }) => metadata)
  }
  visitStrings(inspect, (value) => {
    if (looksLikePath(value)) invalid('Project-package metadata contains a filesystem path')
  })
}

function sanitizeMetadata<T>(value: T): { value: T; redacted: number } {
  let redacted = 0
  const walk = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      const next = redactPaths(entry)
      if (next !== entry) redacted += 1
      return next
    }
    if (Array.isArray(entry)) return entry.map(walk)
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .map(([key, child]) => [key, walk(child)]))
    }
    return entry
  }
  return { value: walk(structuredClone(value)) as T, redacted }
}

function redactPaths(value: string): string {
  return value
    .replace(/file:\/\/[^\s]+/giu, '[redacted-path]')
    .replace(/[A-Za-z]:[\\/][^\s]+/gu, '[redacted-path]')
    .replace(/(^|\s)\/(?:Users|home|private|var|tmp|Volumes|mnt|opt|etc)\/[^\s]+/gu, '$1[redacted-path]')
}

function looksLikePath(value: string): boolean {
  return /file:\/\//iu.test(value) || /[A-Za-z]:[\\/]/u.test(value) ||
    /(^|\s)\/(?:Users|home|private|var|tmp|Volumes|mnt|opt|etc)\//u.test(value)
}

function safeLogicalName(value: string, fallback: string): string {
  const leaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? fallback
  const safe = replaceNullOrLineBreaks(leaf, '').trim().slice(0, 255)
  return safe || fallback
}

function safeMime(value: string | undefined, kind: MediaAsset['kind']): string {
  if (value === undefined) return kind === 'video' ? 'video/octet-stream' : 'audio/octet-stream'
  if (!/^(?:video|audio|application)\/[A-Za-z0-9.+-]{1,64}$/u.test(value)) invalid('Resolved media MIME type is invalid')
  return value
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw engineError('render_unsupported', 'Project-package work was cancelled', { code: 'cancelled' })
  }
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && /cancel/iu.test(error.message))
}

function opaqueHandle(value: unknown, label: string): asserts value is string {
  boundedString(value, label, 256)
  if (/^(?:[A-Za-z]:[\\/]|\/|\\\\|file:|https?:)/iu.test(value)) invalid(`${label} must be an opaque handle`)
}

function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]))
  }
  return value
}

function visitStrings(value: unknown, callback: (value: string) => void): void {
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string') callback(current)
    else if (Array.isArray(current)) stack.push(...current)
    else if (current && typeof current === 'object') stack.push(...Object.values(current as Record<string, unknown>))
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function boundedId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u.test(value)) {
    invalid(`${label} must be a bounded identifier`)
  }
}

function boundedString(value: unknown, label: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || containsNullOrLineBreak(value)) {
    invalid(`${label} must be a bounded string`)
  }
}

function sha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/iu.test(value)) invalid(`${label} must be a SHA-256 digest`)
}

function isoTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(`${label} must be an ISO timestamp`)
}

function invalid(message: string): never {
  throw engineError('render_unsupported', message)
}
