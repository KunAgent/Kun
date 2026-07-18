import type { ExtensionContext, JsonValue } from '@kun/extension-api'
import {
  GenerationStore,
  assessGenerationRequest,
  executionRequest,
  generationPromptDigest,
  generationPublicProjection,
  generationRequestDigest,
  redactGenerationDiagnostic,
  validateGenerationCatalog,
  type GenerationAssessment,
  type GenerationCatalog,
  type GenerationConsent,
  type GenerationOwner,
  type GenerationOutput,
  type GenerationPersistence,
  type GenerationRecord,
  type GenerationReference,
  type GenerationRequest,
  type GenerationSnapshot
} from '../engine/generation.js'

const GENERATION_SNAPSHOT_KEY = 'generation:snapshot'
export const GENERATION_PROGRESS_CHANNEL = 'kun-video-editor.generation-progress'

export interface GenerationExecutionBroker {
  /** Returns a provider-neutral catalog. It must not contain credentials or endpoint URLs. */
  catalog(owner: Omit<GenerationOwner, 'projectId'>): Promise<unknown>
  /** Issues Host authority bound to the exact request, uploads, permissions, quote, and expiry. */
  authorize(challenge: GenerationAuthorizationChallenge): Promise<unknown>
  /** Creates an idempotent durable job without dispatching provider work. */
  prepare(request: ReturnType<typeof executionRequest>): Promise<unknown>
  /** Recovers a prepared/dispatched job by its persisted execution identity after a crash window. */
  recover(executionId: string, owner: GenerationOwner): Promise<unknown | undefined>
  /** Dispatches a previously prepared job after its identity is persisted with the placeholder. */
  dispatch(jobId: string, owner: GenerationOwner): Promise<unknown>
  status(jobId: string, owner: GenerationOwner): Promise<unknown>
  cancel(jobId: string, owner: GenerationOwner): Promise<unknown>
  /** Re-derives and validates owned Host artifacts; provider-declared URLs/MIME are not trusted. */
  verifyOutputs(jobId: string, owner: GenerationOwner): Promise<unknown>
}

export type GenerationAuthorizationChallenge = {
  schemaVersion: 1
  owner: GenerationOwner
  requestDigest: string
  quoteId: string
  providerId: string
  modelId: string
  permissionIds: string[]
  uploadAssetIds: string[]
  currency: string
  maximumMinor: number
  consentIntent: GenerationRequest['consent']
}

export type GenerationServiceResult =
  | {
    outcome: 'queued' | 'deduplicated' | 'ready' | 'interrupted'
    record: Record<string, unknown>
  }
  | {
    outcome: 'unavailable'
    code: string
    message: string
  }
  | {
    outcome: 'confirmation-required'
    missing: Array<'provider-permission' | 'media-upload' | 'cost'>
    quote: Record<string, unknown>
  }

export type GenerationMaterialization = {
  recordId: string
  jobId: string
  projectRevision: number
  providerId: string
  modelId: string
  promptDigest: string
  referenceAssetIds: string[]
  placeholderAssetId: string
  primaryAssetId: string
  outputPolicy: GenerationRequest['outputPolicy']
  output: GenerationOutput
}

type BrokerSnapshot = {
  schemaVersion: 1
  jobId: string
  executionId: string
  owner: GenerationOwner
  state: 'prepared' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  progress?: {
    completed: number
    total: number
    unit: string
    message?: string
    updatedAt: string
  }
  outputs?: unknown
  error?: { code: string; message: unknown; retryable: boolean }
}

class WorkspaceGenerationPersistence implements GenerationPersistence {
  constructor(private readonly context: ExtensionContext) {}

  async load(): Promise<unknown | undefined> {
    return await this.context.storage.workspace.get<JsonValue>(GENERATION_SNAPSHOT_KEY)
  }

  async save(snapshot: GenerationSnapshot): Promise<void> {
    await this.context.storage.workspace.set(GENERATION_SNAPSHOT_KEY, snapshot as unknown as JsonValue)
  }
}

/**
 * Durable Host-side generation orchestration. Provider networking, account
 * sessions, and credentials stay behind an injected generic broker. With no
 * production broker the service is explicitly unavailable and creates no
 * placeholder or fake output.
 */
export class GenerationService {
  private storePromise?: Promise<GenerationStore>
  private catalogPromise?: Promise<GenerationCatalog>

  constructor(
    private readonly context: ExtensionContext,
    private readonly broker?: GenerationExecutionBroker,
    private readonly now: () => Date = () => new Date()
  ) {}

  async catalog(): Promise<{
    outcome: 'available' | 'unavailable'
    catalog: GenerationCatalog
    message?: string
  }> {
    if (!this.broker) {
      return {
        outcome: 'unavailable',
        catalog: emptyCatalog(this.now()),
        message: 'No approved generation broker is connected. Editing and export remain available.'
      }
    }
    try {
      const catalog = await this.loadCatalog()
      const available = catalog.providers.some(({ status, models }) => status === 'available' && models.length > 0)
      return available
        ? { outcome: 'available', catalog }
        : { outcome: 'unavailable', catalog, message: 'No permitted generation model is currently available.' }
    } catch (error) {
      this.catalogPromise = undefined
      return {
        outcome: 'unavailable',
        catalog: emptyCatalog(this.now()),
        message: redactGenerationDiagnostic(error)
      }
    }
  }

  async request(
    request: GenerationRequest,
    options: { retryRecordId?: string } = {}
  ): Promise<GenerationServiceResult> {
    const catalogResult = await this.catalog()
    const assessment = assessGenerationRequest(catalogResult.catalog, request)
    if (assessment.outcome === 'unavailable') {
      return {
        outcome: 'unavailable',
        code: assessment.code,
        message: catalogResult.outcome === 'unavailable' && catalogResult.message
          ? catalogResult.message
          : assessment.message
      }
    }
    if (assessment.outcome === 'confirmation-required') {
      return {
        outcome: 'confirmation-required',
        missing: assessment.missing,
        quote: assessment.quote as unknown as Record<string, unknown>
      }
    }
    if (!this.broker) {
      return {
        outcome: 'unavailable',
        code: 'broker-unavailable',
        message: 'No approved generation broker is connected. No placeholder was created.'
      }
    }

    const store = await this.store()
    const owner = this.owner(request.projectId)
    const requestDigest = generationRequestDigest(assessment.request)
    const existing = await store.findByIdempotency(owner, assessment.request.idempotencyKey)
    if (existing && existing.requestDigest !== requestDigest) {
      throw new Error('Idempotency key is already bound to a different generation request.')
    }
    if (existing && !options.retryRecordId) {
      return {
        outcome: existing.state === 'ready' ? 'ready' : 'deduplicated',
        record: generationPublicProjection(existing)
      }
    }
    if (options.retryRecordId && (!existing || existing.id !== options.retryRecordId)) {
      return { outcome: 'unavailable', code: 'retry-mismatch', message: 'Retry record does not match this idempotent request.' }
    }
    if (existing && !['failed', 'cancelled', 'interrupted'].includes(existing.state)) {
      return { outcome: existing.state === 'ready' ? 'ready' : 'deduplicated', record: generationPublicProjection(existing) }
    }

    let authorization: unknown
    try {
      authorization = await this.broker.authorize(authorizationChallenge(owner, assessment))
    } catch (error) {
      return {
        outcome: 'unavailable',
        code: 'authorization-denied',
        message: redactGenerationDiagnostic(error)
      }
    }
    let created: { record: GenerationRecord; deduplicated: boolean }
    try {
      created = existing
        ? { record: await store.retry(existing.id, assessment, authorization), deduplicated: false }
        : await store.create(owner, assessment, authorization)
    } catch (error) {
      return {
        outcome: 'unavailable',
        code: 'authorization-invalid',
        message: redactGenerationDiagnostic(error)
      }
    }

    await this.publish(created.record, 'placeholder-created')
    try {
      const prepared = validateBrokerSnapshot(await this.broker.prepare(executionRequest(created.record)))
      assertBrokerIdentity(prepared, created.record)
      if (prepared.state !== 'prepared') {
        throw new Error('Generation broker preparation must not dispatch provider work')
      }
      const bound = await store.bindPreparedJob(created.record.id, prepared.jobId)
      await this.publish(bound, 'job-prepared')
      const started = validateBrokerSnapshot(await this.broker.dispatch(prepared.jobId, bound.owner))
      assertBrokerIdentity(started, bound)
      if (started.state !== 'queued' && started.state !== 'running') {
        throw new Error('Generation broker dispatch returned an invalid state')
      }
      let queued = await store.markDispatched(bound.id, started.jobId, started.state)
      if (started.progress) queued = await store.reportProgress(queued.id, started.progress)
      await this.publish(queued, 'job-started')
      return { outcome: 'queued', record: generationPublicProjection(queued) }
    } catch (error) {
      const interrupted = await store.interrupt(created.record.id, error)
      await this.publish(interrupted, 'admission-interrupted')
      return { outcome: 'interrupted', record: generationPublicProjection(interrupted) }
    }
  }

  async list(projectId: string): Promise<{
    records: Array<Record<string, unknown>>
    recoveryDiagnostics: string[]
  }> {
    await this.reconcile(projectId)
    const store = await this.store()
    const records = await store.list(this.owner(projectId))
    return {
      records: records.slice(0, 200).map(generationPublicProjection),
      recoveryDiagnostics: store.recoveryDiagnostics.slice(0, 32)
    }
  }

  async status(projectId: string, recordId: string): Promise<Record<string, unknown>> {
    await this.reconcile(projectId, recordId)
    return generationPublicProjection(await this.scopedRecord(projectId, recordId))
  }

  /**
   * Requotes a persisted failed/cancelled/interrupted request without exposing
   * its raw prompt or protected reference handles to the View. The caller must
   * provide a fresh explicit consent intent; Host authorization is still bound
   * to the exact stored request and new quote before a retry is persisted.
   */
  async retry(
    projectId: string,
    recordId: string,
    consent: GenerationConsent,
    refreshedReferences?: GenerationReference[]
  ): Promise<GenerationServiceResult> {
    const record = await this.scopedRecord(projectId, recordId)
    if (!['failed', 'cancelled', 'interrupted'].includes(record.state)) {
      return {
        outcome: record.state === 'ready' ? 'ready' : 'deduplicated',
        record: generationPublicProjection(record)
      }
    }
    const referenceAssetIds = record.request.references.map(({ assetId }) => assetId)
    if (
      refreshedReferences && (
        refreshedReferences.length !== referenceAssetIds.length ||
        refreshedReferences.some(({ assetId }, index) => assetId !== referenceAssetIds[index])
      )
    ) {
      throw new Error('Refreshed retry references do not match the persisted generation request.')
    }
    return await this.request({
      ...record.request,
      ...(refreshedReferences ? { references: structuredClone(refreshedReferences) } : {}),
      consent: structuredClone(consent)
    }, { retryRecordId: record.id })
  }

  /** Host-only reference identities used to reacquire current media grants for retry. */
  async retryReferenceAssetIds(projectId: string, recordId: string): Promise<string[]> {
    const record = await this.scopedRecord(projectId, recordId)
    return record.request.references.map(({ assetId }) => assetId)
  }

  /**
   * Host-internal materialization data. This intentionally includes the opaque
   * output handle needed to add verified media to the project, and therefore
   * must never be returned directly from a command, tool, event, or View state.
   */
  async materialization(
    projectId: string,
    recordId: string,
    outputId: string
  ): Promise<GenerationMaterialization> {
    const materializations = await this.materializations(projectId, recordId)
    const materialization = materializations.find(({ output }) => output.id === outputId)
    if (!materialization) throw new Error('Generation output does not belong to this record.')
    return materialization
  }

  /**
   * Host-internal, ownership-checked materialization data for every verified
   * output. Returning the full set lets the project layer resolve a primary
   * placeholder and add all variants in one revision-fenced transaction.
   */
  async materializations(
    projectId: string,
    recordId: string
  ): Promise<GenerationMaterialization[]> {
    await this.reconcile(projectId, recordId)
    const record = await this.scopedRecord(projectId, recordId)
    if (record.state !== 'ready' || !record.jobId) {
      throw new Error('Generation output is not ready for project insertion.')
    }
    const primary = record.outputs.find(({ primary }) => primary)
    if (!primary) throw new Error('Generation record is missing its verified primary output.')
    const primaryAssetId = record.request.outputPolicy === 'resolve-placeholder'
      ? record.placeholder.assetId
      : primary.assetId
    return record.outputs.map((output) => ({
      recordId: record.id,
      jobId: record.jobId!,
      projectRevision: record.request.projectRevision,
      providerId: record.request.providerId,
      modelId: record.request.modelId,
      promptDigest: generationPromptDigest(record.request.prompt),
      referenceAssetIds: record.request.references.map(({ assetId }) => assetId),
      placeholderAssetId: record.placeholder.assetId,
      primaryAssetId,
      outputPolicy: record.request.outputPolicy,
      output: structuredClone(output)
    }))
  }

  async cancel(projectId: string, recordId: string): Promise<Record<string, unknown>> {
    const store = await this.store()
    const record = await this.scopedRecord(projectId, recordId)
    if (!['placeholder', 'queued', 'running', 'cancelling'].includes(record.state)) {
      return generationPublicProjection(record)
    }
    let cancelling = await store.requestCancellation(record.id)
    await this.publish(cancelling, 'cancellation-requested')
    if (this.broker && cancelling.jobId) {
      try {
        const snapshot = validateBrokerSnapshot(await this.broker.cancel(cancelling.jobId, cancelling.owner))
        assertBrokerIdentity(snapshot, cancelling)
        if (snapshot.state !== 'cancelled') {
          cancelling = await store.interrupt(cancelling.id, 'Generation cancellation was not acknowledged by the broker.')
          await this.publish(cancelling, 'cancellation-interrupted')
          return generationPublicProjection(cancelling)
        }
      } catch (error) {
        cancelling = await store.interrupt(cancelling.id, error)
        await this.publish(cancelling, 'cancellation-interrupted')
        return generationPublicProjection(cancelling)
      }
    }
    const cancelled = await store.cancel(cancelling.id)
    await this.publish(cancelled, 'cancelled')
    return generationPublicProjection(cancelled)
  }

  async reconcile(projectId: string, recordId?: string): Promise<void> {
    const store = await this.store()
    const records = recordId
      ? [await this.scopedRecord(projectId, recordId)]
      : await store.list(this.owner(projectId))
    for (const record of records) {
      if (!['placeholder', 'queued', 'running', 'cancelling'].includes(record.state)) continue
      if (!this.broker) {
        const interrupted = await store.interrupt(record.id, 'The generation broker is unavailable after restart.')
        await this.publish(interrupted, 'broker-unavailable')
        continue
      }
      try {
        if (record.state === 'cancelling') {
          if (!record.jobId) {
            const cancelled = await store.cancel(record.id)
            await this.publish(cancelled, 'recovered-cancelled')
            continue
          }
          const cancellation = validateBrokerSnapshot(await this.broker.cancel(record.jobId, record.owner))
          assertBrokerIdentity(cancellation, record)
          if (cancellation.state !== 'cancelled') {
            throw new Error('Generation cancellation could not be recovered safely.')
          }
          const cancelled = await store.cancel(record.id)
          await this.publish(cancelled, 'recovered-cancelled')
          continue
        }

        let current = record
        let snapshot: BrokerSnapshot
        if (!record.jobId) {
          if (record.state !== 'placeholder') {
            throw new Error('Generation metadata is missing its durable job identity.')
          }
          const recovered = await this.broker.recover(record.executionId, record.owner)
          if (recovered === undefined) {
            throw new Error('Generation admission was interrupted before a durable job could be recovered.')
          }
          snapshot = validateBrokerSnapshot(recovered)
          assertBrokerIdentity(snapshot, record)
          current = await store.bindPreparedJob(record.id, snapshot.jobId)
          await this.publish(current, 'recovered-job-identity')
        } else {
          snapshot = validateBrokerSnapshot(await this.broker.status(record.jobId, record.owner))
          assertBrokerIdentity(snapshot, record)
        }

        if (snapshot.state === 'prepared') {
          if (current.state !== 'placeholder') throw new Error('Only a placeholder may resume a prepared generation job.')
          const dispatched = validateBrokerSnapshot(await this.broker.dispatch(snapshot.jobId, current.owner))
          assertBrokerIdentity(dispatched, current)
          if (dispatched.state !== 'queued' && dispatched.state !== 'running') {
            throw new Error('Prepared generation job could not be dispatched safely.')
          }
          let queued = await store.markDispatched(current.id, dispatched.jobId, dispatched.state)
          if (dispatched.progress) queued = await store.reportProgress(current.id, dispatched.progress)
          await this.publish(queued, 'recovered-dispatched')
        } else if (snapshot.state === 'queued' || snapshot.state === 'running') {
          if (current.state === 'placeholder' || (current.state === 'queued' && snapshot.state === 'running')) {
            current = await store.markDispatched(current.id, snapshot.jobId, snapshot.state)
            await this.publish(current, 'recovered-dispatch-state')
          }
          if (snapshot.progress && !sameProgress(current, snapshot.progress)) {
            const progressed = await store.reportProgress(current.id, snapshot.progress)
            await this.publish(progressed, 'progress')
          }
        } else if (snapshot.state === 'completed') {
          if (current.state === 'placeholder') {
            current = await store.markDispatched(current.id, snapshot.jobId, 'running')
            await this.publish(current, 'recovered-dispatch-state')
          }
          const verifiedOutputs = await this.broker.verifyOutputs(snapshot.jobId, current.owner)
          const ready = await store.complete(current.id, verifiedOutputs, snapshot.owner)
          await this.publish(ready, 'completed')
        } else if (snapshot.state === 'cancelled') {
          const cancelled = await store.cancel(current.id)
          await this.publish(cancelled, 'cancelled')
        } else if (snapshot.state === 'failed') {
          const failed = await store.fail(current.id, snapshot.error ?? {
            code: 'provider_failed', message: 'Generation provider reported failure.', retryable: true
          })
          await this.publish(failed, 'failed')
        } else {
          const interrupted = await store.interrupt(current.id, snapshot.error?.message ?? 'Generation job was interrupted.')
          await this.publish(interrupted, 'interrupted')
        }
      } catch (error) {
        const interrupted = await store.interrupt(record.id, error)
        await this.publish(interrupted, 'recovery-interrupted')
      }
    }
  }

  private async scopedRecord(projectId: string, recordId: string): Promise<GenerationRecord> {
    const record = await (await this.store()).get(recordId)
    if (!record || !sameOwner(record.owner, this.owner(projectId))) {
      throw new Error(`Generation record ${recordId} is not owned by this project.`)
    }
    return record
  }

  private owner(projectId: string): GenerationOwner {
    const workspace = this.workspaceOwner()
    return {
      extensionId: this.context.extension.id,
      extensionVersion: this.context.extension.version,
      workspaceId: workspace.workspaceId,
      projectId
    }
  }

  private workspaceOwner(): Omit<GenerationOwner, 'projectId'> {
    const workspace = this.context.workspaceContext
    if (!workspace?.trusted || !workspace.active) {
      throw new Error('Generation requires an active trusted workspace; no fallback workspace scope is used.')
    }
    return {
      extensionId: this.context.extension.id,
      extensionVersion: this.context.extension.version,
      workspaceId: workspace.id
    }
  }

  private async store(): Promise<GenerationStore> {
    this.storePromise ??= GenerationStore.open(new WorkspaceGenerationPersistence(this.context), { now: this.now })
    return await this.storePromise
  }

  private async loadCatalog(): Promise<GenerationCatalog> {
    if (!this.broker) return emptyCatalog(this.now())
    this.catalogPromise ??= this.broker.catalog(this.workspaceOwner()).then(validateGenerationCatalog)
    return await this.catalogPromise
  }

  private async publish(record: GenerationRecord, reason: string): Promise<void> {
    await this.context.ui.postMessage({
      channel: GENERATION_PROGRESS_CHANNEL,
      sequence: record.generation,
      payload: {
        reason,
        record: generationPublicProjection(record)
      } as unknown as JsonValue
    })
  }
}

function emptyCatalog(now: Date): GenerationCatalog {
  return {
    schemaVersion: 1,
    revision: 'generation-unavailable',
    generatedAt: now.toISOString(),
    providers: []
  }
}

function authorizationChallenge(
  owner: GenerationOwner,
  assessment: Extract<GenerationAssessment, { outcome: 'ready' }>
): GenerationAuthorizationChallenge {
  return {
    schemaVersion: 1,
    owner: structuredClone(owner),
    requestDigest: generationRequestDigest(assessment.request),
    quoteId: assessment.quote.quoteId,
    providerId: assessment.provider.id,
    modelId: assessment.model.id,
    permissionIds: structuredClone(assessment.model.permissions.permissionIds),
    uploadAssetIds: assessment.model.permissions.mediaUpload === 'explicit'
      ? assessment.request.references.map(({ assetId }) => assetId)
      : [],
    currency: assessment.quote.currency,
    maximumMinor: assessment.quote.maximumMinor,
    consentIntent: structuredClone(assessment.request.consent)
  }
}

function validateBrokerSnapshot(value: unknown): BrokerSnapshot {
  const snapshot = objectValue(value, 'generation broker snapshot')
  const allowed = new Set(['schemaVersion', 'jobId', 'executionId', 'owner', 'state', 'progress', 'outputs', 'error'])
  const unknown = Object.keys(snapshot).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`Generation broker snapshot contains unsupported fields: ${unknown.slice(0, 4).join(', ')}`)
  if (snapshot.schemaVersion !== 1) throw new Error('Generation broker snapshot schemaVersion must be 1')
  const owner = generationOwner(snapshot.owner)
  const state = enumValue(snapshot.state, ['prepared', 'queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'] as const, 'snapshot.state')
  const progress = snapshot.progress === undefined ? undefined : progressValue(snapshot.progress)
  const error = snapshot.error === undefined ? undefined : errorValue(snapshot.error)
  return {
    schemaVersion: 1,
    jobId: opaque(snapshot.jobId, 'snapshot.jobId'),
    executionId: opaque(snapshot.executionId, 'snapshot.executionId'),
    owner,
    state,
    ...(progress ? { progress } : {}),
    ...(snapshot.outputs === undefined ? {} : { outputs: snapshot.outputs }),
    ...(error ? { error } : {})
  }
}

function assertBrokerIdentity(snapshot: BrokerSnapshot, record: GenerationRecord): void {
  if (!sameOwner(snapshot.owner, record.owner)) throw new Error('Generation broker returned a job for a different owner.')
  if (snapshot.executionId !== record.executionId) throw new Error('Generation broker returned a stale or foreign execution identity.')
  if (record.jobId && snapshot.jobId !== record.jobId) throw new Error('Generation broker returned a different job identity.')
}

function sameOwner(left: GenerationOwner, right: GenerationOwner): boolean {
  return left.extensionId === right.extensionId &&
    left.extensionVersion === right.extensionVersion &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId
}

function sameProgress(record: GenerationRecord, progress: NonNullable<BrokerSnapshot['progress']>): boolean {
  return record.progress?.completed === progress.completed &&
    record.progress.total === progress.total &&
    record.progress.unit === progress.unit &&
    record.progress.message === progress.message
}

function generationOwner(value: unknown): GenerationOwner {
  const owner = objectValue(value, 'snapshot.owner')
  return {
    extensionId: text(owner.extensionId, 'snapshot.owner.extensionId', 3, 129),
    extensionVersion: text(owner.extensionVersion, 'snapshot.owner.extensionVersion', 1, 128),
    workspaceId: safeIdentifier(owner.workspaceId, 'snapshot.owner.workspaceId'),
    projectId: safeIdentifier(owner.projectId, 'snapshot.owner.projectId')
  }
}

function progressValue(value: unknown): NonNullable<BrokerSnapshot['progress']> {
  const progress = objectValue(value, 'snapshot.progress')
  const completed = integer(progress.completed, 'snapshot.progress.completed', 0)
  const total = integer(progress.total, 'snapshot.progress.total', 1)
  if (completed > total) throw new Error('snapshot.progress completed exceeds total')
  return {
    completed,
    total,
    unit: text(progress.unit, 'snapshot.progress.unit', 1, 64),
    ...(progress.message === undefined ? {} : { message: text(progress.message, 'snapshot.progress.message', 1, 512) }),
    updatedAt: isoTime(progress.updatedAt, 'snapshot.progress.updatedAt')
  }
}

function errorValue(value: unknown): NonNullable<BrokerSnapshot['error']> {
  const error = objectValue(value, 'snapshot.error')
  return {
    code: text(error.code, 'snapshot.error.code', 1, 64),
    message: error.message,
    retryable: booleanValue(error.retryable, 'snapshot.error.retryable')
  }
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) throw new Error(`${path} is invalid`)
  return value
}

function safeIdentifier(value: unknown, path: string): string {
  const result = text(value, path, 1, 256)
  if (!/^[A-Za-z][A-Za-z0-9._~-]{0,255}$/u.test(result)) throw new Error(`${path} must be a safe identifier`)
  return result
}

function opaque(value: unknown, path: string): string {
  const result = text(value, path, 8, 256)
  if (!/^[A-Za-z0-9._~-]{8,256}$/u.test(result)) throw new Error(`${path} must be opaque`)
  return result
}

function integer(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${path} must be a safe integer`)
  return Number(value)
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function isoTime(value: unknown, path: string): string {
  const result = text(value, path, 20, 64)
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${path} must be an ISO timestamp`)
  return result
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${path} is invalid`)
  return value as T[number]
}

export function generationAssessmentProjection(
  assessment: Exclude<GenerationAssessment, { outcome: 'ready' }>
): Record<string, unknown> {
  return assessment.outcome === 'confirmation-required'
    ? { outcome: assessment.outcome, missing: assessment.missing, quote: assessment.quote }
    : { outcome: assessment.outcome, code: assessment.code, message: assessment.message }
}
