import type { JsonObject } from '@kun/extension-api'
import {
  GENERATION_LIMITS,
  normalizeGenerationRequest,
  type GenerationConsent,
  type GenerationReference,
  type GenerationRequest
} from '../engine/generation.js'
import { GenerationService } from './generation-service.js'

export interface GenerationReferenceResolver {
  resolve(projectId: string, assetIds: readonly string[]): Promise<GenerationReference[]>
}

/**
 * Bounded control plane intended for later registration as separate catalog,
 * request/status, and cancellation tools. Agent/Webview inputs name project
 * assets only; opaque media handles are resolved inside the Host.
 */
export class GenerationControlPlane {
  constructor(
    private readonly service: GenerationService,
    private readonly references: GenerationReferenceResolver
  ) {}

  /** Read-only and approval-free. */
  async catalog(): Promise<JsonObject> {
    const result = await this.service.catalog()
    return result as unknown as JsonObject
  }

  /** Read-only and approval-free. */
  async list(input: unknown): Promise<JsonObject> {
    const value = exact(input, ['projectId'], 'generation.list')
    return await this.service.list(identifier(value.projectId, 'projectId')) as unknown as JsonObject
  }

  /** Read-only and approval-free. */
  async status(input: unknown): Promise<JsonObject> {
    const value = exact(input, ['projectId', 'recordId'], 'generation.status')
    return await this.service.status(
      identifier(value.projectId, 'projectId'),
      opaque(value.recordId, 'recordId')
    ) as JsonObject
  }

  /**
   * Cost/provider/upload authority must be declared separately by the caller
   * when this method is registered as a tool or command.
   */
  async request(input: unknown): Promise<JsonObject> {
    const value = exact(input, [
      'task', 'projectId', 'projectRevision', 'providerId', 'modelId', 'prompt', 'negativePrompt',
      'referenceAssetIds', 'variants', 'seed', 'output', 'outputPolicy', 'idempotencyKey',
      'consent', 'retryRecordId'
    ], 'generation.request')
    const projectId = identifier(value.projectId, 'projectId')
    const referenceAssetIds = array(value.referenceAssetIds, 'referenceAssetIds', GENERATION_LIMITS.references)
      .map((assetId, index) => identifier(assetId, `referenceAssetIds[${index}]`))
    if (new Set(referenceAssetIds).size !== referenceAssetIds.length) {
      throw new Error('referenceAssetIds must not contain duplicates')
    }
    const retryRecordId = value.retryRecordId === undefined
      ? undefined
      : opaque(value.retryRecordId, 'retryRecordId')
    const requestWithoutReferences = normalizeGenerationRequest({
      task: value.task,
      projectId,
      projectRevision: value.projectRevision,
      providerId: value.providerId,
      modelId: value.modelId,
      prompt: value.prompt,
      ...(value.negativePrompt === undefined ? {} : { negativePrompt: value.negativePrompt }),
      references: [],
      variants: value.variants,
      ...(value.seed === undefined ? {} : { seed: value.seed }),
      output: value.output,
      outputPolicy: value.outputPolicy,
      idempotencyKey: value.idempotencyKey,
      consent: value.consent
    })
    const references = referenceAssetIds.length === 0
      ? []
      : await this.references.resolve(projectId, referenceAssetIds)
    if (
      references.length !== referenceAssetIds.length ||
      references.some((reference, index) => reference.assetId !== referenceAssetIds[index])
    ) {
      throw new Error('The Host reference resolver returned incomplete or reordered evidence')
    }
    const request: GenerationRequest = normalizeGenerationRequest({
      ...requestWithoutReferences,
      references,
    })
    return await this.service.request(request, retryRecordId ? { retryRecordId } : {}) as unknown as JsonObject
  }

  /** Fresh consent is required for every retry; the raw persisted prompt and
   * protected handles never round-trip through the View or Agent result. */
  async retry(input: unknown): Promise<JsonObject> {
    const value = exact(input, ['projectId', 'recordId', 'consent'], 'generation.retry')
    const consent = retryConsent(value.consent)
    const projectId = identifier(value.projectId, 'projectId')
    const recordId = opaque(value.recordId, 'recordId')
    const referenceAssetIds = await this.service.retryReferenceAssetIds(projectId, recordId)
    const references = referenceAssetIds.length === 0
      ? []
      : await this.references.resolve(projectId, referenceAssetIds)
    if (
      references.length !== referenceAssetIds.length ||
      references.some((reference, index) => reference.assetId !== referenceAssetIds[index])
    ) {
      throw new Error('The Host retry reference resolver returned incomplete or reordered evidence')
    }
    return await this.service.retry(
      projectId,
      recordId,
      consent,
      references
    ) as unknown as JsonObject
  }

  /** Cancellation is deliberately a separate authority-bearing operation. */
  async cancel(input: unknown): Promise<JsonObject> {
    const value = exact(input, ['projectId', 'recordId'], 'generation.cancel')
    return await this.service.cancel(
      identifier(value.projectId, 'projectId'),
      opaque(value.recordId, 'recordId')
    ) as JsonObject
  }
}

function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  const record = value as Record<string, unknown>
  const unsupported = Object.keys(record).filter((key) => !keys.includes(key))
  if (unsupported.length > 0) {
    throw new Error(`${path} contains unsupported fields: ${unsupported.slice(0, 4).join(', ')}`)
  }
  return record
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} must contain at most ${maximum} entries`)
  return value
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._~-]{0,255}$/u.test(value)) {
    throw new Error(`${path} must be a safe project-scoped identifier`)
  }
  return value
}

function opaque(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{8,256}$/u.test(value)) {
    throw new Error(`${path} must be an opaque identifier`)
  }
  return value
}

function retryConsent(value: unknown): GenerationConsent {
  const consent = exact(value, [
    'providerPermissionApproved', 'mediaUploadApproved', 'costApproved',
    'approvedMaximumMinor', 'currency', 'confirmedAt'
  ], 'generation.retry.consent')
  if (
    typeof consent.providerPermissionApproved !== 'boolean' ||
    typeof consent.mediaUploadApproved !== 'boolean' ||
    typeof consent.costApproved !== 'boolean' ||
    !Number.isSafeInteger(consent.approvedMaximumMinor) ||
    Number(consent.approvedMaximumMinor) < 0 ||
    typeof consent.currency !== 'string' ||
    !/^[A-Z]{3}$/u.test(consent.currency) ||
    typeof consent.confirmedAt !== 'string' ||
    !Number.isFinite(Date.parse(consent.confirmedAt))
  ) throw new Error('generation.retry.consent is invalid')
  return consent as unknown as GenerationConsent
}
