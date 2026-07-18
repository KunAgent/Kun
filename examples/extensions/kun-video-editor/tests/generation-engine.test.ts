import { describe, expect, it } from 'vitest'
import {
  GenerationStore,
  MemoryGenerationPersistence,
  assessGenerationRequest,
  executionRequest,
  generationPublicProjection,
  generationRequestDigest,
  redactGenerationDiagnostic,
  validateGenerationCatalog,
  type GenerationCatalog,
  type GenerationAuthorizationReceipt,
  type GenerationOwner,
  type GenerationRequest
} from '../src/engine/generation.js'

describe('provider-neutral generation contracts', () => {
  it('advertises local, BYOK, and remote capabilities without credential or endpoint fields', () => {
    const catalog = validateGenerationCatalog(makeCatalog())

    expect(catalog.providers.map(({ kind }) => kind)).toEqual(['local', 'byok', 'remote'])
    expect(JSON.stringify(catalog)).not.toMatch(/api.?key|access.?token|password|https?:\/\//iu)
    expect(catalog.providers[1]!.models[0]!.permissions).toEqual({
      permissionIds: ['accounts.use:example-provider', 'network:api.example.test'],
      credential: 'host-account',
      mediaUpload: 'explicit'
    })

    const unsafe = structuredClone(makeCatalog()) as unknown as Record<string, unknown>
    const provider = (unsafe.providers as Array<Record<string, unknown>>)[0]!
    provider.apiKey = 'should-never-enter-a-catalog'
    expect(() => validateGenerationCatalog(unsafe)).toThrow(/unsupported fields|credential/iu)

    const unsafeLocator = structuredClone(makeCatalog())
    unsafeLocator.providers[2]!.status = 'unavailable'
    unsafeLocator.providers[2]!.unavailableReason = 'Configure https://provider.example/account'
    expect(() => validateGenerationCatalog(unsafeLocator)).toThrow(/raw location/iu)
  })

  it('requires separate provider, upload, and bounded-cost confirmations before work can start', () => {
    const request = makeRequest({
      providerId: 'remote-provider',
      modelId: 'remote-video',
      variants: 2,
      consent: {
        providerPermissionApproved: false,
        mediaUploadApproved: false,
        costApproved: false,
        approvedMaximumMinor: 0,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:00.000Z'
      }
    })

    const pending = assessGenerationRequest(makeCatalog(), request)
    expect(pending).toMatchObject({
      outcome: 'confirmation-required',
      missing: ['provider-permission', 'media-upload', 'cost'],
      quote: { currency: 'USD', minimumMinor: 20, maximumMinor: 50 }
    })

    const ready = assessGenerationRequest(makeCatalog(), {
      ...request,
      consent: {
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 50,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:01.000Z'
      }
    })
    expect(ready.outcome).toBe('ready')
  })

  it('reports unavailable capability without constructing a placeholder assessment', () => {
    const catalog = makeCatalog()
    catalog.providers[2]!.status = 'unavailable'
    catalog.providers[2]!.unavailableReason = 'Remote generation is not configured.'
    const result = assessGenerationRequest(catalog, makeRequest())

    expect(result).toEqual(expect.objectContaining({
      outcome: 'unavailable',
      code: 'provider-unavailable',
      message: 'Remote generation is not configured.'
    }))
    expect(result).not.toHaveProperty('placeholder')
  })

  it('rejects hidden secret fields, unsafe handles, and unsupported request fields', () => {
    const request = makeRequest() as unknown as Record<string, unknown>
    request.endpointUrl = 'https://evil.example/upload'
    expect(() => assessGenerationRequest(makeCatalog(), request)).toThrow(/unsupported fields/iu)

    const withSecret = makeRequest({ prompt: 'make a trailer api_key=super-secret' })
    expect(() => assessGenerationRequest(makeCatalog(), withSecret)).toThrow(/credential assignment/iu)

    const unsafeReference = makeRequest()
    unsafeReference.references[0]!.mediaHandleId = '/Users/person/private/movie.mp4'
    expect(() => assessGenerationRequest(makeCatalog(), unsafeReference)).toThrow(/opaque media handle/iu)
  })
})

describe('durable generation placeholder and job state', () => {
  it('persists a placeholder before admission, deduplicates requests, and resolves owned variants', async () => {
    const persistence = new MemoryGenerationPersistence()
    const clock = clockFrom('2026-07-14T01:00:00.000Z')
    const store = await GenerationStore.open(persistence, { now: clock })
    const assessment = readyAssessment()
    const created = await store.create(OWNER, assessment, authorization(assessment))

    expect(created.deduplicated).toBe(false)
    expect(created.record).toMatchObject({ state: 'placeholder', attempt: 1, placeholder: { state: 'pending' } })
    expect(persistence.snapshot?.records[0]?.state).toBe('placeholder')
    expect(executionRequest(created.record)).toMatchObject({
      owner: OWNER,
      providerId: 'remote-provider',
      modelId: 'remote-video',
      references: [{ assetId: 'asset-one', mediaHandleId: 'media_reference_00000001' }]
    })

    const duplicate = await store.create(OWNER, assessment, authorization(assessment))
    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.record.id).toBe(created.record.id)
    const conflictingAssessment = assessGenerationRequest(makeCatalog(), makeRequest({
      prompt: 'A different request reusing the same idempotency key',
      variants: 2,
      consent: {
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 50,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:02.000Z'
      }
    }))
    if (conflictingAssessment.outcome !== 'ready') throw new Error('Expected conflicting assessment to be ready')
    await expect(store.create(OWNER, conflictingAssessment, authorization(conflictingAssessment)))
      .rejects.toThrow(/different generation request/iu)

    const queued = await store.markQueued(created.record.id, 'job_generation_0001')
    const progressed = await store.reportProgress(queued.id, {
      completed: 1,
      total: 2,
      unit: 'variant',
      message: 'One variant ready at https://provider.example/output /Users/alice/private.mov token=secret-value',
      updatedAt: '2026-07-14T01:01:00.000Z'
    })
    expect(progressed.progress?.message).toContain('[REDACTED_URL]')
    expect(progressed.progress?.message).toContain('[REDACTED_PATH]')
    expect(progressed.progress?.message).toContain('[REDACTED_CREDENTIAL]')
    await expect(store.reportProgress(queued.id, {
      completed: 1,
      total: 2,
      unit: 'variant',
      message: 'Late stale update',
      updatedAt: '2026-07-14T01:00:59.000Z'
    })).rejects.toThrow(/timestamp.*backwards/iu)
    await expect(store.reportProgress(queued.id, {
      completed: 0,
      total: 2,
      unit: 'variant',
      updatedAt: '2026-07-14T01:01:01.000Z'
    })).rejects.toThrow(/backwards/iu)

    const ready = await store.complete(queued.id, [
      output('variant-primary', 'generated-primary', 'media_output_0000000001', true),
      output('variant-second', 'generated-second', 'media_output_0000000002', false)
    ], OWNER)
    expect(ready).toMatchObject({
      state: 'ready',
      placeholder: { state: 'resolved' },
      selectedOutputId: 'variant-primary'
    })
    expect(ready.outputs).toHaveLength(2)

    const reopened = await GenerationStore.open(persistence, { now: clock })
    expect((await reopened.get(ready.id))?.state).toBe('ready')
    const projection = generationPublicProjection(ready)
    const serializedProjection = JSON.stringify(projection)
    expect(serializedProjection).not.toContain('media_output_0000000001')
    expect(serializedProjection).not.toContain('completion-variant-primary')
    expect(serializedProjection).not.toContain('Create a calm interview intro')
    expect(serializedProjection).not.toContain('authorization-generation-0001')
    expect(serializedProjection).not.toContain('media_reference_00000001')
    expect(projection).toMatchObject({
      promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      referenceAssetIds: ['asset-one'],
      outputs: [{ assetId: 'generated-primary' }, { assetId: 'generated-second' }]
    })
  })

  it('fences ownership/output validity and supports cancellation plus safe explicit retry', async () => {
    const store = await GenerationStore.open(new MemoryGenerationPersistence(), {
      now: () => new Date('2026-07-14T01:00:00.000Z')
    })
    const assessment = readyAssessment()
    const created = await store.create(OWNER, assessment, authorization(assessment))
    await store.markQueued(created.record.id, 'job_generation_0002')
    await expect(store.complete(created.record.id, [
      output('variant-primary', 'generated-primary', 'media_output_0000000003', true)
    ], { ...OWNER, workspaceId: 'workspace-other' })).rejects.toThrow(/owner/iu)
    await expect(store.complete(created.record.id, [{
      ...output('variant-primary', 'generated-primary', 'media_output_0000000003', true),
      displayName: '../../secret.png'
    }], OWNER)).rejects.toThrow(/path/iu)
    await expect(store.complete(created.record.id, [{
      ...output('variant-primary', 'generated-primary', 'media_output_0000000003', true),
      width: 1_280
    }], OWNER)).rejects.toThrow(/approved request/iu)

    await store.requestCancellation(created.record.id)
    const cancelled = await store.cancel(created.record.id)
    expect(cancelled).toMatchObject({ state: 'cancelled', placeholder: { state: 'cancelled' } })
    const retried = await store.retry(created.record.id, assessment, authorization(assessment, {
      authorizationId: 'authorization-retry-0002',
      issuedAt: '2026-07-14T01:00:00.000Z',
      expiresAt: '2026-07-14T02:15:00.000Z'
    }))
    expect(retried).toMatchObject({ state: 'placeholder', attempt: 2, placeholder: { state: 'pending' } })
    expect(retried.executionId).not.toBe(created.record.executionId)
  })

  it('requires Host-verified stream metadata for editable generated audio', async () => {
    const catalog = makeCatalog()
    const model = catalog.providers[2]!.models[0]!
    model.tasks = [...model.tasks, 'audio']
    model.outputKinds = [...model.outputKinds, 'audio']
    const request = makeRequest({
      task: 'audio',
      output: { kind: 'audio', durationUs: 5_000_000 },
      variants: 1,
      idempotencyKey: 'generation-audio-request-0001',
      consent: {
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 25,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:00.000Z'
      }
    })
    const assessment = assessGenerationRequest(catalog, request)
    if (assessment.outcome !== 'ready') throw new Error(`Expected ready audio assessment, received ${assessment.outcome}`)
    const store = await GenerationStore.open(new MemoryGenerationPersistence(), {
      now: () => new Date('2026-07-14T01:00:00.000Z')
    })
    const created = await store.create(OWNER, assessment, authorization(assessment))
    await store.markQueued(created.record.id, 'job_generation_audio_0001')
    const audioOutput = {
      id: 'variant-audio-primary',
      assetId: 'generated-audio-primary',
      outputHandleId: 'media_output_audio_0000001',
      displayName: 'generated-audio.m4a',
      kind: 'audio',
      mimeType: 'audio/mp4',
      byteSize: 1_024,
      completionIdentity: 'completion-audio-primary',
      durationUs: 5_000_000,
      primary: true,
      createdAt: '2026-07-14T01:02:00.000Z'
    }
    await expect(store.complete(created.record.id, [audioOutput], OWNER))
      .rejects.toThrow(/sample rate and channel/iu)
    const ready = await store.complete(created.record.id, [{
      ...audioOutput,
      sampleRate: 48_000,
      channels: 2
    }], OWNER)
    expect(ready.outputs[0]).toMatchObject({ sampleRate: 48_000, channels: 2 })
  })

  it('requires a current Host authorization bound to the exact quote and consent', async () => {
    const store = await GenerationStore.open(new MemoryGenerationPersistence(), {
      now: () => new Date('2026-07-14T01:00:00.000Z')
    })
    const assessment = readyAssessment()
    await expect(store.create(OWNER, assessment, authorization(assessment, {
      approvedMaximumMinor: assessment.quote.maximumMinor + 1
    }))).rejects.toThrow(/exact approved quote/iu)
    await expect(store.create(OWNER, assessment, authorization(assessment, {
      expiresAt: '2026-07-14T00:59:59.000Z'
    }))).rejects.toThrow(/expired/iu)
    await expect(store.create(OWNER, assessment, authorization(assessment, {
      issuedAt: '2026-07-14T01:00:01.000Z'
    }))).rejects.toThrow(/future/iu)
    expect(await store.list()).toEqual([])
  })

  it('preserves unreadable persistence and redacts provider diagnostics', async () => {
    const persistence = {
      load: async () => ({ schemaVersion: 99, apiKey: 'secret-value' }),
      save: async () => { throw new Error('must not rewrite unreadable metadata during open') }
    }
    const store = await GenerationStore.open(persistence)
    expect(store.recoveryDiagnostics).toHaveLength(1)
    expect(await store.list()).toEqual([])
    expect(redactGenerationDiagnostic(
      'Bearer token-value api_key=abcdef https://api.example.test/v1 /Users/person/private/input.mp4'
    )).toBe('Bearer [REDACTED] [REDACTED_CREDENTIAL] [REDACTED_URL] [REDACTED_PATH]')
  })
})

const OWNER: GenerationOwner = {
  extensionId: 'kun-examples.kun-video-editor',
  extensionVersion: '0.4.0',
  workspaceId: 'workspace-one',
  projectId: 'demo-project'
}

function makeCatalog(): GenerationCatalog {
  return {
    schemaVersion: 1,
    revision: 'catalog-revision-1',
    generatedAt: '2026-07-14T00:00:00.000Z',
    providers: [
      {
        id: 'local-provider',
        displayName: 'Local engine',
        version: '1.0.0',
        kind: 'local',
        status: 'available',
        models: [{
          ...model('local-image'),
          tasks: ['image'],
          outputKinds: ['image'],
          referenceKinds: [],
          limits: { ...model('x').limits, minReferences: 0, maxReferences: 0 },
          permissions: { permissionIds: [], credential: 'none', mediaUpload: 'never' },
          privacy: { processing: 'device', promptRetention: 'none', mediaRetention: 'none' },
          cost: { currency: 'USD', minimumMinor: 0, maximumMinor: 0, estimateOnly: false }
        }]
      },
      {
        id: 'byok-provider',
        displayName: 'Account-backed provider',
        version: '1.0.0',
        kind: 'byok',
        status: 'available',
        models: [{
          ...model('byok-video'),
          permissions: {
            permissionIds: ['accounts.use:example-provider', 'network:api.example.test'],
            credential: 'host-account',
            mediaUpload: 'explicit'
          }
        }]
      },
      {
        id: 'remote-provider',
        displayName: 'Remote provider',
        version: '1.0.0',
        kind: 'remote',
        status: 'available',
        models: [model('remote-video')]
      }
    ]
  }
}

function model(id: string): GenerationCatalog['providers'][number]['models'][number] {
  return {
    id,
    displayName: id,
    version: '1.0.0',
    tasks: ['video', 'upscale'],
    outputKinds: ['video'],
    referenceKinds: ['video'],
    limits: {
      maxPromptCharacters: 2_000,
      minReferences: 1,
      maxReferences: 2,
      maxVariants: 4,
      maxWidth: 3_840,
      maxHeight: 2_160,
      maxDurationUs: 30_000_000
    },
    permissions: {
      permissionIds: ['network:api.example.test'],
      credential: 'none',
      mediaUpload: 'explicit'
    },
    privacy: {
      processing: 'provider',
      promptRetention: 'provider-policy',
      mediaRetention: 'provider-policy'
    },
    cost: { currency: 'USD', minimumMinor: 10, maximumMinor: 25, estimateOnly: true }
  }
}

function makeRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    task: 'video',
    projectId: 'demo-project',
    projectRevision: 4,
    providerId: 'remote-provider',
    modelId: 'remote-video',
    prompt: 'Create a calm interview intro',
    references: [{
      assetId: 'asset-one',
      mediaHandleId: 'media_reference_00000001',
      kind: 'video',
      sourceFingerprint: { algorithm: 'sha256', value: 'a'.repeat(64) }
    }],
    variants: 1,
    output: { kind: 'video', width: 1_920, height: 1_080, durationUs: 5_000_000 },
    outputPolicy: 'resolve-placeholder',
    idempotencyKey: 'generation-request-0001',
    consent: {
      providerPermissionApproved: true,
      mediaUploadApproved: true,
      costApproved: true,
      approvedMaximumMinor: 25,
      currency: 'USD',
      confirmedAt: '2026-07-14T00:00:00.000Z'
    },
    ...overrides
  }
}

function readyAssessment() {
  const assessment = assessGenerationRequest(makeCatalog(), makeRequest({
    variants: 2,
    consent: {
      providerPermissionApproved: true,
      mediaUploadApproved: true,
      costApproved: true,
      approvedMaximumMinor: 50,
      currency: 'USD',
      confirmedAt: '2026-07-14T00:00:00.000Z'
    }
  }))
  if (assessment.outcome !== 'ready') throw new Error(`Expected ready assessment, received ${assessment.outcome}`)
  return assessment
}

function authorization(
  assessment: ReturnType<typeof readyAssessment>,
  overrides: Partial<GenerationAuthorizationReceipt> = {}
): GenerationAuthorizationReceipt {
  return {
    schemaVersion: 1,
    authorizationId: 'authorization-generation-0001',
    owner: OWNER,
    requestDigest: generationRequestDigest(assessment.request),
    quoteId: assessment.quote.quoteId,
    providerId: assessment.provider.id,
    modelId: assessment.model.id,
    permissionIds: assessment.model.permissions.permissionIds,
    uploadAssetIds: assessment.request.references.map(({ assetId }) => assetId),
    currency: assessment.quote.currency,
    approvedMaximumMinor: assessment.quote.maximumMinor,
    issuedAt: '2026-07-14T00:00:00.000Z',
    expiresAt: '2026-07-15T00:00:00.000Z',
    ...overrides
  }
}

function output(
  id: string,
  assetId: string,
  outputHandleId: string,
  primary: boolean
): Record<string, unknown> {
  return {
    id,
    assetId,
    outputHandleId,
    displayName: `${id}.mp4`,
    kind: 'video',
    mimeType: 'video/mp4',
    byteSize: 1_024,
    completionIdentity: `completion-${id}`,
    width: 1_920,
    height: 1_080,
    durationUs: 5_000_000,
    primary,
    createdAt: '2026-07-14T01:02:00.000Z'
  }
}

function clockFrom(start: string): () => Date {
  let value = Date.parse(start)
  return () => new Date(value++)
}
