import { createExtensionTestHarness, type ExtensionTestHarness } from '@kun/extension-test'
import type { JsonValue } from '@kun/extension-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GenerationCatalog,
  GenerationOwner,
  GenerationRequest
} from '../src/engine/generation.js'
import { GenerationControlPlane } from '../src/host/generation-control-plane.js'
import {
  GENERATION_PROGRESS_CHANNEL,
  GenerationService,
  type GenerationAuthorizationChallenge,
  type GenerationExecutionBroker
} from '../src/host/generation-service.js'

const harnesses: ExtensionTestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()))
})

describe('generation Host orchestration', () => {
  it('returns honest unavailable capability and creates no placeholder without a production broker', async () => {
    const harness = createHarness()
    const service = new GenerationService(harness.context)

    expect(await service.catalog()).toMatchObject({
      outcome: 'unavailable',
      catalog: { providers: [] }
    })
    expect(await service.request(makeRequest())).toMatchObject({
      outcome: 'unavailable',
      message: expect.stringContaining('No approved generation broker')
    })
    expect(await service.list('demo-project')).toEqual({ records: [], recoveryDiagnostics: [] })
    expect(harness.storage.workspace.has('generation:snapshot')).toBe(false)
    expect(harness.webview.messages).toEqual([])
  })

  it('persists the placeholder before broker admission, deduplicates, and resolves owned variants', async () => {
    const harness = createHarness()
    let statusState: 'running' | 'completed' = 'running'
    const prepare = vi.fn(async (request: Record<string, unknown>) => {
      const persisted = harness.storage.workspace.get('generation:snapshot') as Record<string, unknown> | undefined
      expect(persisted).toBeDefined()
      expect(JSON.stringify(persisted)).toContain('"state":"placeholder"')
      expect(JSON.stringify(request)).not.toMatch(/api.?key|access.?token|endpointUrl/iu)
      return snapshot(request, 'prepared')
    })
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare,
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'running', owner),
      status: async (_jobId, owner) => statusState === 'running'
        ? snapshot({ executionId: executionId(harness) }, 'running', owner)
        : snapshot({ executionId: executionId(harness) }, 'completed', owner, validOutputs()),
      cancel: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'cancelled', owner),
      verifyOutputs: async () => validOutputs()
    }
    const service = new GenerationService(harness.context, broker, fixedNow)
    const queued = await service.request(makeRequest())
    expect(queued).toMatchObject({
      outcome: 'queued',
      record: { state: 'running', placeholder: { state: 'pending' } }
    })
    expect(prepare).toHaveBeenCalledTimes(1)

    statusState = 'completed'
    const status = await service.status('demo-project', recordId(queued))
    expect(status).toMatchObject({
      state: 'ready',
      placeholder: { state: 'resolved' },
      outputs: [
        { assetId: 'generated-primary', primary: true },
        { assetId: 'generated-variant', primary: false }
      ]
    })
    expect(JSON.stringify(status)).not.toContain('media_output_0000000001')
    expect(JSON.stringify(status)).not.toContain('completion-primary')

    const duplicate = await service.request(makeRequest())
    expect(duplicate).toMatchObject({ outcome: 'ready', record: { id: recordId(queued) } })
    expect(prepare).toHaveBeenCalledTimes(1)

    const messages = progressMessages(harness)
    const sequences = messages.map(({ sequence }) => Number(sequence))
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right))
    expect(JSON.stringify(messages)).not.toMatch(/media_output_|completion-primary|\/Users\//u)
  })

  it('recovers running jobs after service restart and fences foreign or unsafe outputs', async () => {
    const harness = createHarness()
    let terminal: 'running' | 'completed' = 'running'
    let foreignOwner = false
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare: async (request) => snapshot(request, 'prepared'),
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'running', owner),
      status: async (_jobId, owner) => snapshot(
        { executionId: executionId(harness) },
        terminal,
        foreignOwner ? { ...owner, workspaceId: 'foreign-workspace' } : owner,
        terminal === 'completed' ? validOutputs() : undefined
      ),
      cancel: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'cancelled', owner),
      verifyOutputs: async () => validOutputs()
    }
    const first = new GenerationService(harness.context, broker, fixedNow)
    const queued = await first.request(makeRequest())
    terminal = 'completed'
    const afterRestart = new GenerationService(harness.context, broker, fixedNow)
    expect(await afterRestart.status('demo-project', recordId(queued))).toMatchObject({ state: 'ready' })

    const secondRequest = makeRequest({
      idempotencyKey: 'generation-request-0002',
      prompt: 'Create a second bounded clip'
    })
    terminal = 'running'
    const second = await afterRestart.request(secondRequest)
    terminal = 'completed'
    foreignOwner = true
    const fenced = await afterRestart.status('demo-project', recordId(second))
    expect(fenced).toMatchObject({
      state: 'interrupted',
      error: { message: expect.stringContaining('different owner') }
    })
  })

  it('redacts broker failures before persistence, progress messages, and status responses', async () => {
    const harness = createHarness()
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare: async () => {
        throw new Error('Bearer abc.def api_key=top-secret https://api.example.test/v1 /Users/alice/private/input.mov')
      },
      recover: async () => undefined,
      dispatch: async () => { throw new Error('not reached') },
      status: async () => { throw new Error('not reached') },
      cancel: async () => { throw new Error('not reached') },
      verifyOutputs: async () => { throw new Error('not reached') }
    }
    const service = new GenerationService(harness.context, broker, fixedNow)
    const result = await service.request(makeRequest())
    expect(result).toMatchObject({ outcome: 'interrupted', record: { state: 'interrupted' } })
    const serialized = JSON.stringify({
      result,
      persisted: harness.storage.workspace.get('generation:snapshot'),
      messages: harness.webview.messages
    })
    expect(serialized).not.toMatch(/abc\.def|top-secret|https?:\/\/api\.example\.test|\/Users\/alice/u)
    expect(serialized).toMatch(/REDACTED/u)
  })

  it('rejects an over-broad Host authorization before placeholder creation', async () => {
    const harness = createHarness()
    const prepare = vi.fn(async (request) => snapshot(request, 'prepared'))
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => ({
        ...authorization(challenge),
        approvedMaximumMinor: challenge.maximumMinor + 1
      }),
      prepare,
      recover: async () => undefined,
      dispatch: async () => { throw new Error('not reached') },
      status: async () => { throw new Error('not reached') },
      cancel: async () => { throw new Error('not reached') },
      verifyOutputs: async () => { throw new Error('not reached') }
    }
    const service = new GenerationService(harness.context, broker, fixedNow)
    expect(await service.request(makeRequest())).toMatchObject({
      outcome: 'unavailable',
      code: 'authorization-invalid',
      message: expect.stringContaining('exact approved quote')
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(harness.storage.workspace.has('generation:snapshot')).toBe(false)
  })

  it('recovers both prepare/bind and dispatch/state crash windows by execution identity', async () => {
    const harness = createHarness()
    let execution = ''
    let owner: GenerationOwner | undefined
    const recover = vi.fn(async () => snapshot({ executionId: execution }, 'prepared', owner!))
    const dispatch = vi.fn(async () => snapshot({ executionId: execution }, 'running', owner!))
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare: async (request) => {
        execution = request.executionId
        owner = request.owner
        return snapshot(request, 'prepared')
      },
      recover,
      dispatch,
      status: async () => snapshot({ executionId: execution }, 'running', owner!),
      cancel: async () => snapshot({ executionId: execution }, 'cancelled', owner!),
      verifyOutputs: async () => validOutputs()
    }
    const first = new GenerationService(harness.context, broker, fixedNow)
    const requested = await first.request(makeRequest())
    const id = recordId(requested)

    rewritePersistedRecord(harness, id, (record) => {
      record.state = 'placeholder'
      record.placeholder = { ...(record.placeholder as Record<string, unknown>), state: 'pending' }
      delete record.jobId
      delete record.progress
    })
    const afterPrepareCrash = new GenerationService(harness.context, broker, fixedNow)
    expect(await afterPrepareCrash.status('demo-project', id)).toMatchObject({ state: 'running' })
    expect(recover).toHaveBeenCalledWith(execution, owner)

    rewritePersistedRecord(harness, id, (record) => {
      record.state = 'placeholder'
      record.placeholder = { ...(record.placeholder as Record<string, unknown>), state: 'pending' }
      record.jobId = 'job_generation_0001'
      delete record.progress
    })
    const afterDispatchCrash = new GenerationService(harness.context, broker, fixedNow)
    expect(await afterDispatchCrash.status('demo-project', id)).toMatchObject({ state: 'running' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('interrupts completion when Host artifact verification returns an unsafe output', async () => {
    const harness = createHarness()
    let completed = false
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare: async (request) => snapshot(request, 'prepared'),
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'running', owner),
      status: async (_jobId, owner) => snapshot(
        { executionId: executionId(harness) },
        completed ? 'completed' : 'running',
        owner
      ),
      cancel: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'cancelled', owner),
      verifyOutputs: async () => [{
        ...validOutputs()[0],
        displayName: '../../provider-output.mp4'
      }]
    }
    const service = new GenerationService(harness.context, broker, fixedNow)
    const queued = await service.request(makeRequest())
    completed = true
    expect(await service.status('demo-project', recordId(queued))).toMatchObject({
      state: 'interrupted',
      placeholder: { state: 'interrupted' },
      error: { message: expect.stringContaining('path') }
    })
  })

  it('fails closed outside an active trusted workspace without contacting authorization or storage', async () => {
    const harness = createExtensionTestHarness({
      identity: {
        id: 'kun-examples.kun-video-editor',
        publisher: 'kun-examples',
        name: 'kun-video-editor',
        version: '0.4.0'
      },
      permissions: ['storage.workspace'],
      workspace: {
        id: 'workspace-generation',
        name: 'Generation',
        root: '/workspace/generation',
        trusted: false,
        active: true
      }
    })
    harnesses.push(harness)
    const authorize = vi.fn(async (challenge: GenerationAuthorizationChallenge) => authorization(challenge))
    const service = new GenerationService(harness.context, {
      catalog: async () => makeCatalog(),
      authorize,
      prepare: async () => { throw new Error('not reached') },
      recover: async () => undefined,
      dispatch: async () => { throw new Error('not reached') },
      status: async () => { throw new Error('not reached') },
      cancel: async () => { throw new Error('not reached') },
      verifyOutputs: async () => { throw new Error('not reached') }
    }, fixedNow)
    expect(await service.request(makeRequest())).toMatchObject({ outcome: 'unavailable' })
    expect(authorize).not.toHaveBeenCalled()
    expect(harness.storage.workspace.has('generation:snapshot')).toBe(false)
  })
})

describe('bounded generation control plane', () => {
  it('resolves asset IDs inside Host and keeps request/status/cancel authorities separate', async () => {
    const harness = createHarness()
    let currentState: 'running' | 'cancelled' = 'running'
    let referenceHandle = 'media_reference_00000001'
    const prepare = vi.fn(async (request: Record<string, unknown>) => snapshot(request, 'prepared'))
    const cancel = vi.fn(async (_jobId: string, owner: GenerationOwner) => {
      currentState = 'cancelled'
      return snapshot({ executionId: executionId(harness) }, 'cancelled', owner)
    })
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare,
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, 'running', owner),
      status: async (_jobId, owner) => snapshot({ executionId: executionId(harness) }, currentState, owner),
      cancel,
      verifyOutputs: async () => validOutputs()
    }
    const resolver = {
      resolve: vi.fn(async (_projectId: string, assetIds: readonly string[]) => assetIds.map((assetId) => ({
        assetId,
        mediaHandleId: referenceHandle,
        kind: 'video' as const,
        sourceFingerprint: { algorithm: 'sha256' as const, value: 'a'.repeat(64) }
      })))
    }
    const control = new GenerationControlPlane(
      new GenerationService(harness.context, broker, fixedNow),
      resolver
    )
    const input = toolRequest()
    const queued = await control.request(input)
    expect(queued).toMatchObject({ outcome: 'queued' })
    const publicResponse = JSON.stringify(queued)
    expect(publicResponse).not.toContain('Create a calm interview intro')
    expect(publicResponse).not.toContain('media_reference_00000001')
    expect(publicResponse).not.toMatch(/authorization_[a-f0-9]+/u)
    expect(resolver.resolve).toHaveBeenCalledWith('demo-project', ['asset-one'])
    expect(await control.list({ projectId: 'demo-project' })).toMatchObject({ records: [{ state: 'running' }] })
    const id = recordId(queued)
    expect(await control.status({ projectId: 'demo-project', recordId: id })).toMatchObject({ id, state: 'running' })
    expect(await control.cancel({ projectId: 'demo-project', recordId: id })).toMatchObject({ state: 'cancelled' })
    expect(cancel).toHaveBeenCalledTimes(1)
    referenceHandle = 'media_reference_00000002'
    currentState = 'running'
    const retried = await control.retry({
      projectId: 'demo-project',
      recordId: id,
      consent: makeRequest().consent
    })
    expect(retried).toMatchObject({ outcome: 'queued', record: { id, attempt: 2, state: 'running' } })
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(prepare.mock.calls.at(-1)?.[0])).toContain(referenceHandle)
    expect(JSON.stringify(retried)).not.toContain(referenceHandle)
  })

  it('rejects URL/path/secret injection and incomplete Host reference resolution before broker start', async () => {
    const harness = createHarness()
    const prepare = vi.fn(async (request) => snapshot(request, 'prepared'))
    const broker: GenerationExecutionBroker = {
      catalog: async () => makeCatalog(),
      authorize: async (challenge) => authorization(challenge),
      prepare,
      recover: async () => undefined,
      dispatch: async () => { throw new Error('not reached') },
      status: async () => { throw new Error('not reached') },
      cancel: async () => { throw new Error('not reached') },
      verifyOutputs: async () => { throw new Error('not reached') }
    }
    const service = new GenerationService(harness.context, broker, fixedNow)
    const resolve = vi.fn(async () => [])
    const badResolver = { resolve }
    const control = new GenerationControlPlane(service, badResolver)

    await expect(control.request({ ...toolRequest(), endpointUrl: 'https://evil.example/upload' }))
      .rejects.toThrow(/unsupported fields/iu)
    await expect(control.request({ ...toolRequest(), prompt: 'token=very-secret' }))
      .rejects.toThrow(/credential assignment/iu)
    await expect(control.request({ ...toolRequest(), referenceAssetIds: ['/Users/alice/movie.mp4'] }))
      .rejects.toThrow(/identifier/iu)
    await expect(control.request({
      ...toolRequest(),
      output: { kind: 'video', endpointUrl: 'https://evil.example/upload' }
    })).rejects.toThrow(/unsupported fields/iu)
    expect(resolve).not.toHaveBeenCalled()
    await expect(control.request(toolRequest())).rejects.toThrow(/incomplete or reordered/iu)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(prepare).not.toHaveBeenCalled()
    expect(harness.storage.workspace.has('generation:snapshot')).toBe(false)
  })

  it('does not create a placeholder while explicit confirmations are missing', async () => {
    const harness = createHarness()
    const prepare = vi.fn(async (request) => snapshot(request, 'prepared'))
    const control = new GenerationControlPlane(
      new GenerationService(harness.context, {
        catalog: async () => makeCatalog(),
        authorize: async (challenge) => authorization(challenge),
        prepare,
        recover: async () => undefined,
        dispatch: async () => { throw new Error('not reached') },
        status: async () => { throw new Error('not reached') },
        cancel: async () => { throw new Error('not reached') },
        verifyOutputs: async () => { throw new Error('not reached') }
      }, fixedNow),
      {
        resolve: async () => [{
          assetId: 'asset-one',
          mediaHandleId: 'media_reference_00000001',
          kind: 'video',
          sourceFingerprint: { algorithm: 'sha256', value: 'a'.repeat(64) }
        }]
      }
    )
    const request = toolRequest()
    request.consent = {
      providerPermissionApproved: false,
      mediaUploadApproved: false,
      costApproved: false,
      approvedMaximumMinor: 0,
      currency: 'USD',
      confirmedAt: '2026-07-14T00:00:00.000Z'
    }
    expect(await control.request(request)).toMatchObject({
      outcome: 'confirmation-required',
      missing: ['provider-permission', 'media-upload', 'cost']
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(harness.storage.workspace.has('generation:snapshot')).toBe(false)
  })
})

function createHarness(): ExtensionTestHarness {
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.4.0'
    },
    permissions: ['storage.workspace'],
    workspace: {
      id: 'workspace-generation',
      name: 'Generation',
      root: '/workspace/generation',
      trusted: true,
      active: true
    }
  })
  harnesses.push(harness)
  return harness
}

function makeCatalog(): GenerationCatalog {
  return {
    schemaVersion: 1,
    revision: 'catalog-revision-1',
    generatedAt: '2026-07-14T00:00:00.000Z',
    providers: [{
      id: 'remote-provider',
      displayName: 'Remote provider',
      version: '1.0.0',
      kind: 'remote',
      status: 'available',
      models: [{
        id: 'remote-video',
        displayName: 'Remote video',
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
          credential: 'host-account',
          mediaUpload: 'explicit'
        },
        privacy: {
          processing: 'provider',
          promptRetention: 'provider-policy',
          mediaRetention: 'provider-policy'
        },
        cost: { currency: 'USD', minimumMinor: 10, maximumMinor: 25, estimateOnly: true }
      }]
    }]
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
    variants: 2,
    output: { kind: 'video', width: 1_920, height: 1_080, durationUs: 5_000_000 },
    outputPolicy: 'resolve-placeholder',
    idempotencyKey: 'generation-request-0001',
    consent: {
      providerPermissionApproved: true,
      mediaUploadApproved: true,
      costApproved: true,
      approvedMaximumMinor: 50,
      currency: 'USD',
      confirmedAt: '2026-07-14T00:00:00.000Z'
    },
    ...overrides
  }
}

function toolRequest(): Record<string, unknown> {
  const { references: _references, ...request } = makeRequest()
  return { ...request, referenceAssetIds: ['asset-one'] }
}

function authorization(challenge: GenerationAuthorizationChallenge): Record<string, unknown> {
  return {
    schemaVersion: 1,
    authorizationId: `authorization_${challenge.requestDigest.slice(0, 16)}`,
    owner: challenge.owner,
    requestDigest: challenge.requestDigest,
    quoteId: challenge.quoteId,
    providerId: challenge.providerId,
    modelId: challenge.modelId,
    permissionIds: challenge.permissionIds,
    uploadAssetIds: challenge.uploadAssetIds,
    currency: challenge.currency,
    approvedMaximumMinor: challenge.maximumMinor,
    issuedAt: '2026-07-14T00:00:00.000Z',
    expiresAt: '2026-07-14T01:00:00.000Z'
  }
}

function snapshot(
  request: Record<string, unknown>,
  state: 'prepared' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted',
  owner: GenerationOwner = ownerFrom(request),
  outputs?: unknown
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    jobId: 'job_generation_0001',
    executionId: String(request.executionId),
    owner,
    state,
    ...(state === 'running' ? {
      progress: {
        completed: 1,
        total: 2,
        unit: 'variant',
        message: 'Generating variants',
        updatedAt: '2026-07-14T00:01:00.000Z'
      }
    } : {}),
    ...(outputs === undefined ? {} : { outputs })
  }
}

function ownerFrom(request: Record<string, unknown>): GenerationOwner {
  return request.owner as GenerationOwner
}

function validOutputs(): Array<Record<string, unknown>> {
  return [
    output('variant-primary', 'generated-primary', 'media_output_0000000001', true),
    output('variant-second', 'generated-variant', 'media_output_0000000002', false)
  ]
}

function output(id: string, assetId: string, handle: string, primary: boolean): Record<string, unknown> {
  return {
    id,
    assetId,
    outputHandleId: handle,
    displayName: `${id}.mp4`,
    kind: 'video',
    mimeType: 'video/mp4',
    byteSize: 1_024,
    completionIdentity: primary ? 'completion-primary' : 'completion-secondary',
    width: 1_920,
    height: 1_080,
    durationUs: 5_000_000,
    primary,
    createdAt: '2026-07-14T00:02:00.000Z'
  }
}

function progressMessages(harness: ExtensionTestHarness): Array<Record<string, unknown>> {
  return harness.webview.messages.filter((message) =>
    isRecord(message) && message.channel === GENERATION_PROGRESS_CHANNEL
  ) as Array<Record<string, unknown>>
}

function recordId(result: unknown): string {
  if (!isRecord(result) || !isRecord(result.record) || typeof result.record.id !== 'string') {
    throw new Error('Expected generation record projection')
  }
  return result.record.id
}

function executionId(harness: ExtensionTestHarness): string {
  const snapshotValue = harness.storage.workspace.get('generation:snapshot') as Record<string, unknown>
  const records = snapshotValue.records as Array<Record<string, unknown>>
  return String(records.at(-1)?.executionId)
}

function rewritePersistedRecord(
  harness: ExtensionTestHarness,
  id: string,
  rewrite: (record: Record<string, unknown>) => void
): void {
  const snapshotValue = structuredClone(
    harness.storage.workspace.get('generation:snapshot')
  ) as Record<string, unknown>
  const records = snapshotValue.records as Array<Record<string, unknown>>
  const record = records.find((candidate) => candidate.id === id)
  if (!record) throw new Error(`Missing persisted generation record ${id}`)
  rewrite(record)
  harness.storage.workspace.set('generation:snapshot', snapshotValue as unknown as JsonValue)
}

function fixedNow(): Date {
  return new Date('2026-07-14T00:00:00.000Z')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
