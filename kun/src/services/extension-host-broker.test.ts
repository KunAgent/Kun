import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ExtensionManifestSchema,
  MediaCreateCacheTargetResultSchema,
  type MediaAnalyzeVisualFramesRequest,
  type MediaEmbedVisualQueryRequest,
  type ModelProviderAdapter
} from '@kun/extension-api'
import type { ExtensionToolHandler } from '../adapters/tool/extension-tool-provider.js'
import type { ExtensionBrokerRequest, ExtensionPrincipal as HostPrincipal } from '../extensions/host-process.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import {
  ExtensionHostBroker,
  requiredExtensionBrokerPermission
} from './extension-host-broker.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'

const WORKSPACE_ROOT = '/tmp/workspace'
const WORKSPACE_ID = extensionWorkspaceKey(WORKSPACE_ROOT)

const manifest = ExtensionManifestSchema.parse({
  manifestVersion: 1,
  apiVersion: '1.0.0',
  name: 'broker',
  publisher: 'acme',
  version: '1.0.0',
  engines: { kun: '>=0.1.0' },
  main: 'dist/extension.js',
  activationEvents: [
    'onCommand:hello',
    'onTool:summarize',
    'onProvider:echo',
    'onAuthentication:echo-auth'
  ],
  contributes: {
    commands: [{
      id: 'hello',
      title: 'Hello',
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { invoked: { type: 'boolean' } },
        required: ['invoked'],
        additionalProperties: false
      }
    }],
    tools: [{
      id: 'summarize',
      description: 'Summarize input',
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false
      },
      sideEffects: 'external'
    }],
    modelProviders: [{
      id: 'echo',
      displayName: 'Echo',
      authenticationProviderId: 'echo-auth',
      credentialHosts: ['api.example.test'],
      models: [{
        id: 'echo-1',
        displayName: 'Echo 1',
        capabilities: { input: ['text'], output: ['text'] }
      }]
    }],
    authentication: [{
      id: 'echo-auth',
      displayName: 'Echo API key',
      type: 'api-key'
    }],
    settings: [{
      id: 'general',
      title: 'General',
      properties: { mode: { type: 'string', default: 'safe' } }
    }]
  },
  permissions: [
    'commands.register',
    'tools.register',
    'providers.register',
    'ui.actions',
    'network:api.example.test'
  ],
  stateSchemaVersion: 1
})

const principal: HostPrincipal = {
  extensionId: 'acme.broker',
  version: '1.0.0',
  apiVersion: '1.0.0',
  lifecycleNonce: 'de7c65b3-f455-4199-aa83-1722fdf8309d',
  grantedPermissions: manifest.permissions,
  workspaceRoots: [WORKSPACE_ROOT],
  development: true
}

function request(method: string, params: unknown): ExtensionBrokerRequest {
  return {
    principal,
    method,
    params: JSON.parse(JSON.stringify(params ?? null)),
    signal: new AbortController().signal,
    requestId: `request_${method}`
  }
}

describe('ExtensionHostBroker', () => {
  it('keeps main-composer context attachment behind the authenticated desktop View boundary', async () => {
    const broker = createBroker()
    await expect(broker.handle(request('ui.attachComposerContext', {
      schemaVersion: 1,
      id: 'selection',
      title: 'Selection',
      summary: 'One selected item',
      reference: { itemIds: ['item-1'] },
      revision: 1,
      generation: 1
    }))).rejects.toThrow(/authenticated desktop Extension View/i)
  })

  it('routes declared configuration through the host-owned service and reserves internal state keys', async () => {
    const configuration = {
      get: vi.fn(async () => 'safe'),
      update: vi.fn(async () => ({ schemaVersion: 1, revision: 1, values: {} })),
      keys: vi.fn(async () => ['mode'])
    }
    const broker = createBroker({ configuration })
    await expect(broker.handle(request('configuration.get', {
      sectionId: 'general',
      key: 'mode'
    }))).resolves.toEqual({ found: true, value: 'safe' })
    await expect(broker.handle(request('configuration.update', {
      sectionId: 'general',
      key: 'mode',
      value: 'fast'
    }))).resolves.toBeNull()
    await expect(broker.handle(request('configuration.keys', {
      sectionId: 'general'
    }))).resolves.toEqual(['mode'])
    await expect(broker.handle(request('storage.get', {
      scope: 'global',
      key: '__kun_configuration_document_v1'
    }))).rejects.toThrow(/Reserved/)
    await expect(broker.handle(request('storage.set', {
      scope: 'global',
      key: 'visible',
      value: true
    }))).resolves.toBeNull()
    await expect(broker.handle(request('storage.keys', {
      scope: 'global'
    }))).resolves.toEqual(['visible'])
  })

  it('validates generatedArtifacts against the connection-bound owner and invocation workspace', async () => {
    let toolHandler: ExtensionToolHandler | undefined
    const artifact = {
      schemaVersion: 1 as const,
      artifactId: 'artifact_1234567890',
      ownerExtensionId: 'acme.broker',
      ownerExtensionVersion: '1.0.0',
      workspaceId: WORKSPACE_ID,
      mediaHandleId: 'media_123456789012',
      displayName: 'final.mp4',
      mediaKind: 'video' as const,
      mimeType: 'video/mp4',
      byteSize: 100,
      completionIdentity: 'identity_1234567890',
      availability: 'available' as const,
      provenance: { invocationId: 'invocation_1', operation: 'video-render' }
    }
    const validateToolResult = vi.fn(async () => [artifact])
    const broker = createBroker({
      artifacts: { validateToolResult } as never,
      invokeExtension: vi.fn(async () => ({
        content: { summary: 'done' },
        generatedArtifacts: [artifact]
      })),
      tools: {
        register: vi.fn(async (_principal, _declaration, handler) => {
          toolHandler = handler
          return {
            canonicalToolId: 'extension:acme.broker/summarize',
            modelAlias: 'ext_summary',
            dispose() {}
          }
        })
      }
    })
    await broker.handle(request('tools.register', manifest.contributes.tools[0]))
    const result = await toolHandler!({
      invocationId: 'invocation_1',
      canonicalToolId: 'extension:acme.broker/summarize',
      modelAlias: 'ext_summary',
      arguments: { text: 'hello' },
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: WORKSPACE_ROOT,
      signal: new AbortController().signal,
      reportProgress: vi.fn(async () => undefined)
    })
    expect(validateToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.broker',
        extensionVersion: '1.0.0',
        workspaceRoots: [WORKSPACE_ROOT]
      }),
      WORKSPACE_ID,
      [artifact]
    )
    expect(result.output).toMatchObject({ generatedArtifacts: [artifact] })
    expect(JSON.stringify(result.output)).not.toContain(WORKSPACE_ROOT)
  })

  it('routes opaque media operations without exposing Host paths', async () => {
    const mediaPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: [
        'media.read', 'media.process', 'media.export',
        'workspace.read', 'workspace.write', 'jobs.manage'
      ],
      workspaceRoots: ['/tmp/workspace'],
      workspaceTrusted: true,
      viewSessionId: 'view-session-1',
      viewContributionId: 'editor'
    }
    const stat = vi.fn(async () => ({
      id: 'media_123456789012',
      displayName: 'clip.mp4',
      mode: 'read',
      source: 'picker',
      mimeType: 'video/mp4',
      byteSize: 123,
      completionIdentity: 'identity_1234567890',
      available: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    }))
    const touch = vi.fn(async () => ({
      ...(await stat()),
      lastAccessedAt: '2026-01-01T00:01:00.000Z'
    }))
    const probe = vi.fn(async () => ({
      schemaVersion: 1,
      handleId: 'media_123456789012',
      container: { formatNames: ['mov', 'mp4'], durationMicros: 1_000_000 },
      streams: []
    }))
    const start = vi.fn(async () => ({
      jobId: 'job_12345678',
      kind: 'media.ffmpeg',
      state: 'queued',
      cursor: 'cursor_12345678'
    }))
    const onUiRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'media.pickFiles') {
        return {
          outcome: 'selected',
          files: [{
            handleId: 'media_123456789012',
            mode: 'read',
            kind: 'video',
            displayName: 'clip.mp4',
            mimeType: 'video/mp4',
            revoked: false
          }]
        }
      }
      if (method === 'media.openViewResource') {
        return {
          leaseId: 'lease_123456789012',
          handleId: 'media_123456789012',
          url: 'kun-media://resource/opaque-token',
          mimeType: 'video/mp4',
          expiresAt: '2026-01-01T00:05:00.000Z'
        }
      }
      if (method === 'media.performArtifactAction') return { performed: true }
      return undefined
    })
    const capabilities = vi.fn(async () => ({
      probedAt: '2026-01-01T00:00:00.000Z',
      ffprobe: { name: 'ffprobe', available: true, source: 'configured', version: '8.0.1' },
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        source: 'configured',
        version: '8.0.1',
        features: ['libx264-encoder', 'aac-encoder']
      }
    }))
    const audioCapabilities = vi.fn(async () => ({
      schemaVersion: 1,
      probedAt: '2026-01-01T00:00:00.000Z',
      analyses: [
        {
          analysis: 'silence', available: true,
          algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        {
          analysis: 'beat-grid', available: false,
          code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
          remediation: 'No verified analyzer is installed.', retryable: false,
          local: true, networkUsed: false
        },
        {
          analysis: 'sync-features', available: true,
          algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        }
      ]
    }))
    const startAudioAnalysis = vi.fn(async () => ({
      outcome: 'started' as const,
      job: {
        jobId: 'job_audio_12345678',
        kind: 'media.audio-analysis',
        state: 'queued' as const,
        cursor: 'cursor_audio_12345678'
      }
    }))
    const startArchive = vi.fn(async () => ({
      outcome: 'started' as const,
      job: {
        jobId: 'job_archive_12345678',
        kind: 'media.archive',
        state: 'queued' as const,
        cursor: 'cursor_archive_12345678'
      }
    }))
    const visualDescriptor = {
      adapterId: 'kun.local.visual-features', adapterVersion: '1.0.0',
      modelId: 'kun-visual-features', modelVersion: '1.0.0',
      packageId: 'kun-bundled.visual-features-v1', manifestSha256: 'a'.repeat(64),
      files: [{ name: 'visual-features-v1.json', sha256: 'b'.repeat(64), byteSize: 10 }],
      embeddingDimensions: 2, execution: 'local' as const,
      querySemantics: 'bounded-visual-features-v1' as const
    }
    const visualReceipt = {
      broker: 'kun-model-broker' as const, packageSource: 'bundled' as const,
      packageId: visualDescriptor.packageId, modelId: visualDescriptor.modelId,
      modelVersion: visualDescriptor.modelVersion,
      manifestSha256: visualDescriptor.manifestSha256,
      files: visualDescriptor.files, downloadVerified: false, sourceVerified: true as const,
      installVerified: true as const, signatureVerified: true as const,
      installedAt: '2026-01-01T00:00:00.000Z'
    }
    const visualStatus = vi.fn(async () => ({
      schemaVersion: 1 as const, state: 'installed' as const,
      descriptor: visualDescriptor, receipt: visualReceipt, installSupported: true,
      checkedAt: '2026-01-01T00:00:00.000Z', remediation: 'Verified local adapter ready.',
      local: true as const, networkUsedForInference: false as const,
      rawPathsExposed: false as const, urlsAccepted: false as const
    }))
    const analyzeVisualFrames = vi.fn(async (
      _principal: unknown,
      request: MediaAnalyzeVisualFramesRequest
    ) => ({
      outcome: 'ready' as const,
      source: {
        handleId: request.inputHandleId,
        fingerprint: 'c'.repeat(64),
        fingerprintAlgorithm: 'sha256-file-identity-v1' as const
      },
      adapter: request.adapter,
      embeddings: request.samples.map(({ sampleId }) => ({ sampleId, vector: [1, 0] })),
      provenance: {
        algorithm: 'kun.rgb-edge-features' as const, algorithmVersion: '1.0.0' as const,
        decodedFrameWidth: 32 as const, decodedFrameHeight: 32 as const,
        local: true as const, networkUsed: false as const
      }
    }))
    const embedVisualQuery = vi.fn(async (
      _principal: unknown,
      request: MediaEmbedVisualQueryRequest
    ) => ({
      outcome: 'ready' as const, adapter: request.adapter, vector: [1, 0],
      matchedConcepts: ['red'], scoreSemantics: 'uncalibrated-cosine' as const,
      local: true as const, networkUsed: false as const
    }))
    const broker = createBroker({
      mediaHandles: { stat, touch, release: vi.fn(async () => true) } as never,
      mediaProcesses: { probe, capabilities } as never,
      mediaJobs: { start } as never,
      audioAnalysisJobs: {
        capabilities: audioCapabilities,
        start: startAudioAnalysis
      } as never,
      archiveJobs: { start: startArchive } as never,
      visualAnalysis: {
        status: visualStatus,
        install: visualStatus,
        analyzeFrames: analyzeVisualFrames,
        embedQuery: embedVisualQuery
      } as never,
      onUiRequest
    })
    const call = (method: string, params: unknown) => broker.handlePrincipal({
      principal: mediaPrincipal,
      method,
      params: params as never,
      signal: new AbortController().signal,
      requestId: `request-${method}`
    })
    await expect(call('media.pickFiles', {})).resolves.toMatchObject({
      outcome: 'selected', files: [{ handleId: 'media_123456789012' }]
    })
    await expect(call('media.stat', { handleId: 'media_123456789012' })).resolves.toEqual({
      handleId: 'media_123456789012',
      mode: 'read',
      kind: 'video',
      displayName: 'clip.mp4',
      mimeType: 'video/mp4',
      byteSize: 123,
      completionIdentity: 'identity_1234567890',
      revoked: false
    })
    await expect(call('media.probe', { handleId: 'media_123456789012' }))
      .resolves.toMatchObject({ handleId: 'media_123456789012' })
    await expect(call('media.getCapabilities', {})).resolves.toEqual({
      probedAt: '2026-01-01T00:00:00.000Z',
      ffprobe: { name: 'ffprobe', available: true, version: '8.0.1', features: [] },
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        version: '8.0.1',
        features: ['libx264-encoder', 'aac-encoder']
      }
    })
    expect(JSON.stringify(await call('media.getCapabilities', {}))).not.toContain('configured')
    await expect(call('media.getAudioAnalysisCapabilities', {})).resolves.toMatchObject({
      analyses: [
        { analysis: 'silence', available: true },
        { analysis: 'beat-grid', available: false, networkUsed: false },
        { analysis: 'sync-features', available: true }
      ]
    })
    const visual = await call('media.getVisualModelStatus', {})
    await expect(visual).toMatchObject({
      state: 'installed',
      receipt: { packageSource: 'bundled', downloadVerified: false, signatureVerified: true },
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false
    })
    expect(JSON.stringify(visual)).not.toMatch(/\/(?:Users|private|tmp)\//u)
    await expect(call('media.installVisualModel', {})).resolves.toMatchObject({ state: 'installed' })
    await expect(call('media.installVisualModel', { modelUrl: 'https://example.invalid/model.bin' }))
      .rejects.toThrow()
    const visualAdapter = {
      id: visualDescriptor.adapterId, version: visualDescriptor.adapterVersion,
      modelId: visualDescriptor.modelId, modelVersion: visualDescriptor.modelVersion,
      packageId: visualDescriptor.packageId, manifestSha256: visualDescriptor.manifestSha256,
      embeddingDimensions: visualDescriptor.embeddingDimensions, execution: 'local'
    }
    await expect(call('media.analyzeVisualFrames', {
      inputHandleId: 'media_123456789012',
      samples: [{
        sampleId: 'frame:asset-1:0', startMicros: 0, endMicros: 1_000_000,
        representativeMicros: 500_000
      }],
      adapter: visualAdapter
    })).resolves.toMatchObject({
      outcome: 'ready', embeddings: [{ sampleId: 'frame:asset-1:0', vector: [1, 0] }]
    })
    await expect(call('media.embedVisualQuery', {
      query: 'red', adapter: visualAdapter
    })).resolves.toMatchObject({ outcome: 'ready', matchedConcepts: ['red'] })
    await expect(call('media.openViewResource', { handleId: 'media_123456789012' }))
      .resolves.toMatchObject({ url: 'kun-media://resource/opaque-token' })
    expect(touch).toHaveBeenCalledWith(mediaPrincipal, 'media_123456789012')
    await expect(call('media.performArtifactAction', {
      artifactId: 'artifact_1234567890',
      action: 'reveal'
    })).resolves.toEqual({ performed: true })
    expect(onUiRequest).toHaveBeenCalledWith(expect.objectContaining({
      principal: mediaPrincipal,
      method: 'media.performArtifactAction',
      params: { artifactId: 'artifact_1234567890', action: 'reveal' }
    }))
    await expect(call('media.startFfmpegJob', {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: 'media_123456789012' },
      outputs: { video: 'media_abcdefghijkl' }
    })).resolves.toMatchObject({ job: { jobId: 'job_12345678' } })
    await expect(call('media.startAudioAnalysisJob', {
      analysis: 'sync-features',
      referenceHandleId: 'media_123456789012',
      targetHandleId: 'media_abcdefghijkl',
      seed: 42
    })).resolves.toMatchObject({
      outcome: 'started',
      job: { jobId: 'job_audio_12345678', kind: 'media.audio-analysis' }
    })
    expect(startAudioAnalysis).toHaveBeenCalledWith(
      mediaPrincipal,
      expect.objectContaining({
        analysis: 'sync-features',
        seed: 42,
        samplePeriodMicros: 100_000,
        maxFeaturePoints: 4_096
      })
    )
    await expect(call('media.startArchiveJob', {
      format: 'zip',
      outputHandleId: 'media_archive_output_123456',
      entries: [
        {
          kind: 'inline-text',
          archivePath: 'manifest/project.json',
          content: '{"schemaVersion":2}',
          mimeType: 'application/json'
        },
        {
          kind: 'media',
          inputHandleId: 'media_123456789012',
          archivePath: 'media/clip.mp4'
        }
      ],
      idempotencyKey: 'archive-project-revision-7'
    })).resolves.toMatchObject({
      outcome: 'started',
      job: { jobId: 'job_archive_12345678', kind: 'media.archive' }
    })
    expect(startArchive).toHaveBeenCalledWith(
      mediaPrincipal,
      expect.objectContaining({
        format: 'zip',
        outputHandleId: 'media_archive_output_123456',
        entries: expect.arrayContaining([
          expect.objectContaining({ archivePath: 'manifest/project.json' }),
          expect.objectContaining({ archivePath: 'media/clip.mp4' })
        ])
      })
    )
    expect(JSON.stringify(await call('media.stat', { handleId: 'media_123456789012' })))
      .not.toContain('/tmp/workspace')
  })

  it('allocates a Host-owned cache target without returning its workspace path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cache-target-'))
    const workspace = join(root, 'workspace')
    const dataDir = join(root, 'data')
    await mkdir(workspace)
    const principal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['media.process', 'workspace.write'],
      workspaceRoots: [workspace],
      workspaceTrusted: true
    }
    const mediaHandles = new ExtensionMediaHandleService({ dataDir })
    const broker = createBroker({ mediaHandles })
    try {
      const result = MediaCreateCacheTargetResultSchema.parse(await broker.handlePrincipal({
        principal,
        method: 'media.createCacheTarget',
        params: { format: 'png', purpose: 'derived-waveform-partial' },
        signal: new AbortController().signal,
        requestId: 'create-cache-target'
      }))
      expect(result).toEqual({
        target: {
          handleId: expect.stringMatching(/^media_[0-9a-f-]+$/u),
          mode: 'export',
          kind: 'image',
          displayName: expect.stringMatching(/^derived-waveform-partial-[a-f0-9-]+\.png$/u),
          mimeType: 'image/png',
          revoked: false
        }
      })
      const [stored] = await mediaHandles.list(principal, workspace)
      expect(stored).toMatchObject({
        id: result.target.handleId,
        mode: 'write',
        source: 'workspace',
        lifecycle: 'cache',
        mimeType: 'image/png'
      })
      expect(stored?.workspaceRelativePath).toMatch(
        /^\.kun\/extension-cache\/acme\.broker\/derived-waveform-partial\//u
      )
      expect(JSON.stringify(result)).not.toContain(workspace)
      expect(requiredExtensionBrokerPermission('media.createCacheTarget', {
        format: 'png', purpose: 'derived-waveform-partial'
      })).toBe('media.process')
      expect(requiredExtensionBrokerPermission('media.getAudioAnalysisCapabilities', {}))
        .toBe('media.process')
      for (const method of [
        'media.getVisualModelStatus',
        'media.installVisualModel',
        'media.analyzeVisualFrames',
        'media.embedVisualQuery'
      ]) expect(requiredExtensionBrokerPermission(method, {})).toBe('media.process')
      expect(requiredExtensionBrokerPermission('media.startAudioAnalysisJob', {
        analysis: 'silence', inputHandleId: 'media_123456789012'
      })).toBe('media.process')
      expect(requiredExtensionBrokerPermission('media.startArchiveJob', {
        format: 'zip', outputHandleId: 'media_archive_output_123456', entries: []
      })).toBe('media.export')
      await expect(broker.handlePrincipal({
        principal,
        method: 'media.release',
        params: { resource: 'handle', handleId: result.target.handleId },
        signal: new AbortController().signal,
        requestId: 'release-cache-target'
      })).resolves.toEqual({ released: true })
      await expect(mediaHandles.list(principal, workspace)).resolves.toEqual([
        expect.objectContaining({ id: result.target.handleId, available: false })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads bounded UTF-8 from an owned media handle and rejects invalid text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-media-text-'))
    const validPath = join(root, 'captions.srt')
    const invalidPath = join(root, 'invalid.srt')
    await writeFile(validPath, '1\n00:00:00,000 --> 00:00:01,000\n你好\n')
    await writeFile(invalidPath, Buffer.from([0xff, 0xfe, 0xfd]))
    const mediaPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['media.read', 'workspace.read'],
      workspaceRoots: [root],
      workspaceTrusted: true,
      viewSessionId: 'view-session-1',
      viewContributionId: 'editor'
    }
    const resolve = vi.fn(async (_principal, handleId: string) => ({
      id: handleId,
      displayName: handleId.includes('invalid') ? 'invalid.srt' : 'captions.srt',
      mode: 'read',
      source: 'picker',
      mimeType: 'application/x-subrip',
      byteSize: handleId.includes('invalid') ? 3 : undefined,
      available: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      absolutePath: handleId.includes('invalid') ? invalidPath : validPath,
      workspaceRoot: root,
      ownerExtensionId: 'acme.broker',
      ownerExtensionVersion: '1.0.0'
    }))
    const broker = createBroker({ mediaHandles: { resolve } as never })
    const call = (handleId: string, maxBytes: number) => broker.handlePrincipal({
      principal: mediaPrincipal,
      method: 'media.readText',
      params: { handleId, maxBytes },
      signal: new AbortController().signal,
      requestId: `request-${handleId}`
    })
    try {
      await expect(call('media_text_123456789', 1024)).resolves.toMatchObject({
        handleId: 'media_text_123456789',
        displayName: 'captions.srt',
        content: expect.stringContaining('你好')
      })
      await expect(call('media_text_123456789', 4)).rejects.toMatchObject({
        code: 'MEDIA_LIMIT_EXCEEDED'
      })
      await expect(call('media_invalid_123456', 1024)).rejects.toMatchObject({
        code: 'MEDIA_INVALID_ARGUMENT'
      })
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
        extensionId: 'acme.broker',
        workspaceRoots: [root]
      }), 'media_text_123456789', 'read')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns an explicit interaction-required error for headless picker calls', async () => {
    const broker = createBroker()
    await expect(broker.handle(request('media.pickFiles', {}))).rejects.toMatchObject({
      code: 'MEDIA_INTERACTION_REQUIRED',
      details: { operation: 'media.pickFiles' }
    })
    await expect(broker.handle(request('media.pickSaveTarget', {}))).rejects.toMatchObject({
      code: 'MEDIA_INTERACTION_REQUIRED',
      details: { operation: 'media.pickSaveTarget' }
    })
    await expect(broker.handle(request('media.performArtifactAction', {
      artifactId: 'artifact_1234567890',
      action: 'open'
    }))).rejects.toThrow(/authenticated View Session/)
  })

  it('routes owned job observation, replay subscriptions, and cancellation', async () => {
    const snapshot = {
      schemaVersion: 1 as const,
      id: 'job_12345678',
      kind: 'media.ffmpeg',
      kindSchemaVersion: 1,
      ownerExtensionId: 'acme.broker',
      ownerExtensionVersion: '1.0.0',
      workspaceId: WORKSPACE_ID,
      initiatingOperation: 'media.startFfmpegJob',
      state: 'completed' as const,
      executionAttempt: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      terminalAt: '2026-01-01T00:00:01.000Z',
      latestCursor: 'cursor_12345678',
      result: { schemaVersion: 1 as const, generatedArtifacts: [] }
    }
    const jobs = {
      getOwned: vi.fn(async () => snapshot),
      listOwned: vi.fn(async () => ({ items: [snapshot], page: { hasMore: false } })),
      cancel: vi.fn(async () => ({ accepted: false, snapshot })),
      subscribe: vi.fn(async () => ({
        subscriptionId: 'jobsub_12345678',
        snapshot,
        replay: [],
        cursor: snapshot.latestCursor,
        gap: false,
        complete: true,
        close: vi.fn(),
        async *[Symbol.asyncIterator]() {}
      })),
      unsubscribe: vi.fn(() => true)
    }
    const broker = createBroker({ jobs })
    const principal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['jobs.manage'],
      workspaceRoots: [WORKSPACE_ROOT],
      workspaceTrusted: true
    }
    const call = (method: string, params: unknown) => broker.handlePrincipal({
      principal,
      method,
      params: params as never,
      signal: new AbortController().signal,
      requestId: `request-${method}`
    })
    await expect(call('jobs.get', { jobId: snapshot.id })).resolves.toEqual(snapshot)
    await expect(call('jobs.list', {})).resolves.toMatchObject({ items: [snapshot] })
    await expect(call('jobs.subscribe', { jobId: snapshot.id })).resolves.toMatchObject({
      subscriptionId: 'jobsub_12345678', complete: true, gap: false
    })
    await expect(call('jobs.cancel', { jobId: snapshot.id })).resolves.toEqual({
      accepted: false, snapshot
    })
    const caller = { extensionId: 'acme.broker', workspaceIds: [WORKSPACE_ID] }
    expect(jobs.getOwned).toHaveBeenCalledWith(caller, snapshot.id)
    expect(jobs.listOwned).toHaveBeenCalledWith(caller, expect.any(Object))
    expect(jobs.subscribe).toHaveBeenCalledWith(caller, snapshot.id, undefined)
    expect(jobs.cancel).toHaveBeenCalledWith(caller, snapshot.id, undefined)
    expect(JSON.stringify(snapshot)).not.toContain(WORKSPACE_ROOT)
    await expect(broker.handlePrincipal({
      principal: { ...principal, permissions: [] },
      method: 'jobs.get',
      params: { jobId: snapshot.id },
      signal: new AbortController().signal,
      requestId: 'denied'
    })).rejects.toThrow(/jobs\.manage/)
  })

  it('routes commands and tools using only the connection-bound identity', async () => {
    let toolHandler: ExtensionToolHandler | undefined
    let broker!: ExtensionHostBroker
    const progress = vi.fn(async () => undefined)
    const invokeExtension = vi.fn(async (
      extensionId: string,
      _event: string,
      method: string,
      params: unknown
    ) => {
      expect(extensionId).toBe('acme.broker')
      if (method.startsWith('tools.invoke:')) {
        const invocationId = (params as { invocationId: string }).invocationId
        await broker.notification(principal, 'tools.progress', {
          invocationId,
          message: 'halfway',
          fraction: 0.5
        })
        return { content: { summary: 'done' } }
      }
      return { invoked: true }
    })
    broker = createBroker({
      invokeExtension,
      tools: {
        register: vi.fn(async (_principal, _declaration, handler) => {
          toolHandler = handler
          return { canonicalToolId: 'extension:acme.broker/summarize', modelAlias: 'ext_summary', dispose() {} }
        })
      }
    })

    const command = await broker.handle(request('commands.register', { id: 'hello' })) as { registrationId: string }
    await expect(broker.handle(request('commands.execute', {
      id: 'hello',
      args: { extensionId: 'forged.owner' }
    }))).resolves.toEqual({ invoked: true })
    expect(invokeExtension).toHaveBeenCalledWith(
      'acme.broker',
      'onCommand:hello',
      `commands.invoke:${command.registrationId}`,
      { extensionId: 'forged.owner' },
      expect.any(Object)
    )

    await broker.handle(request('tools.register', manifest.contributes.tools[0]))
    const result = await toolHandler!({
      invocationId: 'invocation_1',
      canonicalToolId: 'extension:acme.broker/summarize',
      modelAlias: 'ext_summary',
      arguments: { text: 'hello' },
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: '/tmp/workspace',
      signal: new AbortController().signal,
      reportProgress: progress
    })
    expect(result).toEqual({
      output: { content: { summary: 'done' } },
      declaredOutput: { summary: 'done' },
      isError: false
    })
    expect(progress).toHaveBeenCalledWith({
      output: { type: 'extension_tool_progress', message: 'halfway', fraction: 0.5 }
    })
  })

  it('enforces manifest command schemas and rejects runtime declaration drift', async () => {
    const invokeExtension = vi.fn(async (_extensionId, _event, method) => {
      if (method.startsWith('commands.invoke:')) return { invoked: 'not-a-boolean' }
      return null
    })
    const tools = { register: vi.fn() }
    const modelProviders = { register: vi.fn() }
    const providerAccounts = {
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn()
    }
    const broker = createBroker({ invokeExtension, tools, modelProviders, providerAccounts })

    await broker.handle(request('commands.register', { id: 'hello' }))
    await expect(broker.handle(request('commands.execute', {
      id: 'hello', args: 'invalid-command-input'
    }))).rejects.toThrow(/declared JSON Schema/)
    await expect(broker.handle(request('commands.execute', {
      id: 'hello', args: { valid: true }
    }))).rejects.toThrow(/command hello result does not match/)

    await expect(broker.handle(request('tools.register', {
      ...manifest.contributes.tools[0],
      sideEffects: 'none'
    }))).rejects.toThrow(/does not match its active manifest/)
    expect(tools.register).not.toHaveBeenCalled()

    await expect(broker.handle(request('modelProviders.register', {
      ...manifest.contributes.modelProviders[0],
      credentialHosts: []
    }))).rejects.toThrow(/does not match its active manifest/)
    expect(providerAccounts.registerProvider).not.toHaveBeenCalled()
    expect(modelProviders.register).not.toHaveBeenCalled()
  })

  it('disposes command-only extensions during broker shutdown', async () => {
    const broker = createBroker({
      invokeExtension: vi.fn(async () => ({ invoked: true }))
    })
    await broker.handle(request('commands.register', { id: 'hello' }))
    await expect(broker.handle(request('commands.execute', {
      id: 'hello', args: { valid: true }
    }))).resolves.toEqual({ invoked: true })

    await broker.dispose()

    await expect(broker.handle(request('commands.execute', {
      id: 'hello', args: { valid: true }
    }))).rejects.toThrow('command is not registered')
  })

  it('routes workspace commands to their owning Host and disposes one Host generation only', async () => {
    const workspaceA = '/tmp/workspace-a'
    const workspaceB = '/tmp/workspace-b'
    const principalA: HostPrincipal = {
      ...principal,
      lifecycleNonce: 'host-workspace-a',
      workspaceRoots: [workspaceA]
    }
    const principalB: HostPrincipal = {
      ...principal,
      lifecycleNonce: 'host-workspace-b',
      workspaceRoots: [workspaceB]
    }
    const disposeToolA = vi.fn()
    const disposeToolB = vi.fn()
    const invokeExtension = vi.fn(async (
      _extensionId: string,
      _event: string,
      _method: string,
      _params: unknown,
      options: { workspaceRoots?: string[] }
    ) => ({ invoked: options.workspaceRoots?.[0] === workspaceA }))
    const registerTool = vi.fn()
      .mockResolvedValueOnce({
        canonicalToolId: 'extension:acme.broker/summarize',
        modelAlias: 'ext_summary',
        dispose: disposeToolA
      })
      .mockResolvedValueOnce({
        canonicalToolId: 'extension:acme.broker/summarize',
        modelAlias: 'ext_summary',
        dispose: disposeToolB
      })
    const broker = createBroker({
      invokeExtension,
      tools: { register: registerTool }
    })
    const hostRequest = (owner: HostPrincipal, method: string, params: unknown) => broker.handle({
      principal: owner,
      method,
      params: JSON.parse(JSON.stringify(params)),
      signal: new AbortController().signal,
      requestId: `${owner.lifecycleNonce}-${method}`
    })
    await hostRequest(principalA, 'commands.register', { id: 'hello' })
    await hostRequest(principalB, 'commands.register', { id: 'hello' })
    await hostRequest(principalA, 'tools.register', manifest.contributes.tools[0])
    await hostRequest(principalB, 'tools.register', manifest.contributes.tools[0])

    const executeFromView = (workspace: string, sessionId: string) => broker.handlePrincipal({
      principal: {
        extensionId: principal.extensionId,
        extensionVersion: principal.version,
        permissions: principal.grantedPermissions,
        workspaceRoots: [workspace],
        workspaceTrusted: true,
        viewSessionId: sessionId
      },
      method: 'commands.execute',
      params: { id: 'hello', args: { valid: true } },
      signal: new AbortController().signal,
      requestId: `execute-${sessionId}`
    })

    await expect(executeFromView(workspaceA, 'view-a')).resolves.toEqual({ invoked: true })
    await expect(executeFromView(workspaceB, 'view-b')).resolves.toEqual({ invoked: false })
    expect(invokeExtension.mock.calls.at(-2)?.[4]).toMatchObject({ workspaceRoots: [workspaceA] })
    expect(invokeExtension.mock.calls.at(-1)?.[4]).toMatchObject({ workspaceRoots: [workspaceB] })

    await broker.disposeHost(principalA)

    expect(disposeToolA).toHaveBeenCalledTimes(1)
    expect(disposeToolB).not.toHaveBeenCalled()
    await expect(executeFromView(workspaceA, 'view-a-after-exit'))
      .rejects.toThrow('command is not registered')
    await expect(executeFromView(workspaceB, 'view-b-after-exit'))
      .resolves.toEqual({ invoked: false })
  })

  it('disposes broker registrations only in the revoked extension workspace', async () => {
    const workspaceA = '/tmp/workspace-a'
    const workspaceB = '/tmp/workspace-b'
    const invokeExtension = vi.fn(async (
      _extensionId: string,
      _event: string,
      _method: string,
      _params: unknown,
      options: { workspaceRoots?: string[] }
    ) => ({ invoked: options.workspaceRoots?.[0] === workspaceA }))
    const broker = createBroker({ invokeExtension })
    const register = (workspaceRoot: string, lifecycleNonce: string) => broker.handle({
      principal: { ...principal, lifecycleNonce, workspaceRoots: [workspaceRoot] },
      method: 'commands.register',
      params: { id: 'hello' },
      signal: new AbortController().signal,
      requestId: `register-${lifecycleNonce}`
    })
    await register(workspaceA, 'host-workspace-a')
    await register(workspaceB, 'host-workspace-b')
    const execute = (workspaceRoot: string) => broker.handlePrincipal({
      principal: {
        extensionId: principal.extensionId,
        extensionVersion: principal.version,
        permissions: principal.grantedPermissions,
        workspaceRoots: [workspaceRoot],
        workspaceTrusted: true,
        viewSessionId: `view-${workspaceRoot}`
      },
      method: 'commands.execute',
      params: { id: 'hello', args: { valid: true } },
      signal: new AbortController().signal,
      requestId: `execute-${workspaceRoot}`
    })

    await broker.disposeExtensionWorkspace(
      principal.extensionId,
      extensionWorkspaceKey(workspaceA)
    )

    await expect(execute(workspaceA)).rejects.toThrow('command is not registered')
    await expect(execute(workspaceB)).resolves.toEqual({ invoked: false })
  })

  it('preserves the manifest output schema and content value at the ToolHost boundary', async () => {
    let toolHandler: ExtensionToolHandler | undefined
    const register = vi.fn(async (_principal, _declaration, handler) => {
      toolHandler = handler
      return {
        canonicalToolId: 'extension:acme.broker/summarize',
        modelAlias: 'ext_summary',
        dispose() {}
      }
    })
    const broker = createBroker({
      invokeExtension: vi.fn(async () => ({ content: { summary: 42 } })),
      tools: { register }
    })
    await broker.handle(request('tools.register', manifest.contributes.tools[0]))
    expect(register).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ outputSchema: manifest.contributes.tools[0]!.outputSchema }),
      expect.any(Function)
    )

    await expect(toolHandler!({
      invocationId: 'invocation_invalid_output',
      canonicalToolId: 'extension:acme.broker/summarize',
      modelAlias: 'ext_summary',
      arguments: {},
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: '/tmp/workspace',
      signal: new AbortController().signal,
      reportProgress: async () => undefined
    })).resolves.toMatchObject({
      declaredOutput: { summary: 42 }
    })
  })

  it('keeps bounded legacy model-provider notifications compatible', async () => {
    let adapter: ModelProviderAdapter | undefined
    let broker!: ExtensionHostBroker
    const invokeExtension = vi.fn(async (
      _extensionId: string,
      _event: string,
      method: string,
      params: unknown
    ) => {
      if (method.startsWith('modelProviders.invoke:') && (params as { operation: string }).operation === 'stream') {
        const registrationId = method.slice('modelProviders.invoke:'.length)
        const modelRequest = (params as { request: { requestId: string } }).request
        await broker.notification(principal, 'modelProviders.streamEvent', {
          registrationId,
          event: { requestId: modelRequest.requestId, sequence: 0, type: 'textDelta', delta: 'hello' }
        })
        await broker.notification(principal, 'modelProviders.streamEvent', {
          registrationId,
          event: { requestId: modelRequest.requestId, sequence: 1, type: 'completed', finishReason: 'stop' }
        })
      }
      return { accepted: true }
    })
    broker = createBroker({
      invokeExtension,
      providerAccounts: {
        registerProvider: vi.fn(async () => ({ id: 'ext-provider-echo' })),
        unregisterProvider: vi.fn(async () => true)
      },
      modelProviders: {
        register: vi.fn(async (_principal, _declaration, registeredAdapter) => {
          adapter = registeredAdapter
          return { providerId: 'ext-provider-echo', async dispose() {} }
        })
      }
    })

    await broker.handle(request('modelProviders.register', manifest.contributes.modelProviders[0]))
    const events = []
    for await (const event of adapter!.stream({
      apiVersion: '1.0.0',
      requestId: 'model_request_1',
      binding: { providerId: 'ext-provider-echo', accountId: 'account_1', modelId: 'echo-1' },
      instructions: [],
      messages: [],
      tools: [],
      generation: {}
    }, cancellationContext())) events.push(event)
    expect(events.map((event) => event.type)).toEqual(['textDelta', 'completed'])
  })

  it('bridges acknowledgement-backed provider stream envelopes per model request', async () => {
    let adapter: ModelProviderAdapter | undefined
    let broker!: ExtensionHostBroker
    const invokeExtension = vi.fn(async (
      _extensionId: string,
      _event: string,
      method: string,
      params: unknown
    ) => {
      if (method.startsWith('modelProviders.invoke:') && (params as { operation: string }).operation === 'stream') {
        const registrationId = method.slice('modelProviders.invoke:'.length)
        const modelRequest = (params as { request: { requestId: string } }).request
        await broker.stream(principal, 'rpc_model_request_1', 1, {
          kind: 'event',
          registrationId,
          requestId: modelRequest.requestId,
          event: {
            requestId: modelRequest.requestId,
            sequence: 0,
            type: 'textDelta',
            delta: 'streamed'
          }
        }, false)
        await broker.stream(principal, 'rpc_model_request_1', 2, {
          kind: 'event',
          registrationId,
          requestId: modelRequest.requestId,
          event: {
            requestId: modelRequest.requestId,
            sequence: 1,
            type: 'completed',
            finishReason: 'stop'
          }
        }, true)
      }
      return { accepted: true }
    })
    broker = createBroker({
      invokeExtension,
      providerAccounts: {
        registerProvider: vi.fn(async () => ({ id: 'ext-provider-echo' })),
        unregisterProvider: vi.fn(async () => true)
      },
      modelProviders: {
        register: vi.fn(async (_principal, _declaration, registeredAdapter) => {
          adapter = registeredAdapter
          return { providerId: 'ext-provider-echo', async dispose() {} }
        })
      }
    })

    await broker.handle(request('modelProviders.register', manifest.contributes.modelProviders[0]))
    const events = []
    for await (const event of adapter!.stream({
      apiVersion: '1.0.0',
      requestId: 'model_request_stream',
      binding: { providerId: 'ext-provider-echo', accountId: 'account_1', modelId: 'echo-1' },
      instructions: [],
      messages: [],
      tools: [],
      generation: {}
    }, cancellationContext())) events.push(event)
    expect(events.map((event) => event.type)).toEqual(['textDelta', 'completed'])
  })

  it('fails only the overflowing legacy provider request instead of growing its queue', async () => {
    let adapter: ModelProviderAdapter | undefined
    let broker!: ExtensionHostBroker
    const invokeExtension = vi.fn(async (
      _extensionId: string,
      _event: string,
      method: string,
      params: unknown
    ) => {
      const registrationId = method.slice('modelProviders.invoke:'.length)
      const modelRequest = (params as { request: { requestId: string } }).request
      for (let sequence = 0; sequence < 3; sequence += 1) {
        void broker.notification(principal, 'modelProviders.streamEvent', {
          registrationId,
          event: {
            requestId: modelRequest.requestId,
            sequence,
            type: 'textDelta',
            delta: `event-${sequence}`
          }
        })
      }
      return { accepted: true }
    })
    broker = createBroker({
      invokeExtension,
      providerStreamQueueEvents: 1,
      providerAccounts: {
        registerProvider: vi.fn(async () => ({ id: 'ext-provider-echo' })),
        unregisterProvider: vi.fn(async () => true)
      },
      modelProviders: {
        register: vi.fn(async (_principal, _declaration, registeredAdapter) => {
          adapter = registeredAdapter
          return { providerId: 'ext-provider-echo', async dispose() {} }
        })
      }
    })

    await broker.handle(request('modelProviders.register', manifest.contributes.modelProviders[0]))
    const iterator = adapter!.stream({
      apiVersion: '1.0.0',
      requestId: 'model_request_overflow',
      binding: { providerId: 'ext-provider-echo', accountId: 'account_1', modelId: 'echo-1' },
      instructions: [],
      messages: [],
      tools: [],
      generation: {}
    }, cancellationContext())[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('queue limit exceeded')
  })

  it('returns fixed pre-gate permissions and leaves dynamic network scopes to broker validation', () => {
    expect(requiredExtensionBrokerPermission('storage.get', { scope: 'global', key: 'x' })).toBe('storage.global')
    expect(requiredExtensionBrokerPermission('agent.createRun', {})).toBe('agent.run')
    expect(requiredExtensionBrokerPermission('ui.attachComposerContext', {})).toBe('ui.actions')
    expect(requiredExtensionBrokerPermission('network.fetch', { url: 'https://api.example.test' })).toBeUndefined()
  })

  it('routes live Agent events to the sender-bound View while keeping Node subscriptions on Node IPC', async () => {
    const listeners: Array<(event: {
      seq: number
      timestamp: string
      type: 'assistant_text_delta' | 'turn_completed'
      runId: string
      threadId: string
      ownerExtensionId: string
      payload: Record<string, unknown>
    }) => Promise<void> | void> = []
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const agent = {
      subscribe: vi.fn(async (_principal, _input, listener) => {
        listeners.push(listener)
        const close = vi.fn()
        closes.push(close)
        return { lastDeliveredSeq: 0, closed: false, close }
      })
    }
    const notifyView = vi.fn(async () => undefined)
    const notifyExtension = vi.fn(async () => undefined)
    const broker = createBroker({ agent, notifyView, notifyExtension })
    const viewPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['agent.run'],
      workspaceRoots: ['/tmp/workspace'],
      workspaceTrusted: true,
      viewSessionId: 'view-session-one',
      viewContributionId: 'extension:acme.broker/panel'
    } as const

    const viewSubscription = await broker.handlePrincipal({
      principal: viewPrincipal,
      method: 'agent.subscribe',
      params: { runId: 'run-1', afterSequence: 0 },
      signal: new AbortController().signal,
      requestId: 'subscribe-from-view'
    }) as { subscriptionId: string }
    await listeners[0]!({
      seq: 1,
      timestamp: new Date().toISOString(),
      type: 'assistant_text_delta',
      runId: 'run-1',
      threadId: 'thread-1',
      ownerExtensionId: 'acme.broker',
      payload: { delta: 'hello' }
    })

    expect(notifyView).toHaveBeenCalledWith({
      principal: viewPrincipal,
      method: 'agent.event',
      params: expect.objectContaining({
        subscriptionId: viewSubscription.subscriptionId,
        event: expect.objectContaining({ type: 'message', sequence: 2 })
      })
    })
    expect(notifyExtension).not.toHaveBeenCalled()

    await broker.handlePrincipal({
      principal: { ...viewPrincipal, viewSessionId: 'view-session-two' },
      method: 'agent.unsubscribe',
      params: { subscriptionId: viewSubscription.subscriptionId },
      signal: new AbortController().signal,
      requestId: 'foreign-view-unsubscribe'
    })
    expect(closes[0]).not.toHaveBeenCalled()
    expect(broker.disposeViewSession('view-session-one')).toBe(1)
    expect(closes[0]).toHaveBeenCalledTimes(1)

    const failedViewSubscription = await broker.handlePrincipal({
      principal: viewPrincipal,
      method: 'agent.subscribe',
      params: { runId: 'run-failed-view', afterSequence: 0 },
      signal: new AbortController().signal,
      requestId: 'subscribe-from-failed-view'
    }) as { subscriptionId: string }
    notifyView.mockRejectedValueOnce(new Error('view session closed'))
    await expect(listeners[1]!({
      seq: 1,
      timestamp: new Date().toISOString(),
      type: 'assistant_text_delta',
      runId: 'run-failed-view',
      threadId: 'thread-failed-view',
      ownerExtensionId: 'acme.broker',
      payload: { delta: 'late' }
    })).rejects.toThrow('view session closed')
    expect(closes[1]).toHaveBeenCalledTimes(1)
    expect(broker.disposeViewSession('view-session-one')).toBe(0)
    expect(failedViewSubscription.subscriptionId).toMatch(/^agentsub_/)

    const nodeSubscription = await broker.handle(request('agent.subscribe', {
      runId: 'run-2',
      afterSequence: 0
    })) as { subscriptionId: string }
    await listeners[2]!({
      seq: 2,
      timestamp: new Date().toISOString(),
      type: 'turn_completed',
      runId: 'run-2',
      threadId: 'thread-2',
      ownerExtensionId: 'acme.broker',
      payload: {}
    })
    expect(notifyExtension).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.broker',
        hostLifecycleNonce: principal.lifecycleNonce,
        workspaceRoots: [WORKSPACE_ROOT]
      }),
      'agent.event',
      expect.objectContaining({ subscriptionId: nodeSubscription.subscriptionId })
    )
    expect(closes[2]).toHaveBeenCalledTimes(1)
  })

  it('bounds network responses, strips credential headers, and never auto-follows redirects', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.redirect).toBe('manual')
      let sent = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 2) {
            controller.close()
            return
          }
          sent += 1
          controller.enqueue(new Uint8Array(5 * 1024 * 1024).fill(97))
        }
      })
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'set-cookie': 'secret=value',
          authorization: 'Bearer response-secret',
          'x-request-id': 'safe-id'
        }
      })
    }) as unknown as typeof fetch
    const broker = createBroker({ fetch: fetchImpl })
    const result = await broker.handlePrincipal({
      principal: {
        extensionId: 'acme.broker',
        extensionVersion: '1.0.0',
        permissions: ['network:api.example.test'],
        workspaceRoots: [],
        workspaceTrusted: false
      },
      method: 'network.fetch',
      params: { url: 'https://api.example.test/large' },
      signal: new AbortController().signal,
      requestId: 'bounded-network-response'
    }) as { body: string; truncated: boolean; headers: Record<string, string> }
    expect(Buffer.byteLength(result.body)).toBe(8 * 1024 * 1024)
    expect(result.truncated).toBe(true)
    expect(result.headers['set-cookie']).toBeUndefined()
    expect(result.headers.authorization).toBeUndefined()
    expect(result.headers['x-request-id']).toBe('safe-id')
  })

  it('uses the production DNS/address policy when no test fetch is injected', async () => {
    const broker = createBroker()
    await expect(broker.handlePrincipal({
      principal: {
        extensionId: 'acme.broker',
        extensionVersion: '1.0.0',
        permissions: ['network:127.0.0.1'],
        workspaceRoots: [],
        workspaceTrusted: false
      },
      method: 'network.fetch',
      params: { url: 'https://127.0.0.1/metadata' },
      signal: new AbortController().signal,
      requestId: 'blocked-loopback-network'
    })).rejects.toThrow(/resolved to blocked loopback address 127\.0\.0\.1/)
  })

  it('persists global Webview state per contribution when no workspace is active', async () => {
    const broker = createBroker()
    const viewPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['ui.views'],
      workspaceRoots: [],
      workspaceTrusted: false,
      viewContributionId: 'extension:acme.broker/primary'
    } as const
    const signal = new AbortController().signal
    await broker.handlePrincipal({
      principal: viewPrincipal,
      method: 'ui.setViewState',
      params: { value: { selected: 'item-1' } },
      signal,
      requestId: 'set-view-state'
    })
    await expect(broker.handlePrincipal({
      principal: viewPrincipal,
      method: 'ui.getViewState',
      params: {},
      signal,
      requestId: 'get-view-state'
    })).resolves.toEqual({ found: true, value: { selected: 'item-1' } })
    await expect(broker.handlePrincipal({
      principal: { ...viewPrincipal, viewContributionId: 'extension:acme.broker/secondary' },
      method: 'ui.getViewState',
      params: {},
      signal,
      requestId: 'get-other-view-state'
    })).resolves.toEqual({ found: false })
  })

  it('completes PKCE only through the protected callback path and redacts session internals', async () => {
    const now = '2026-07-11T10:00:00.000Z'
    const completePkceAuthorization = vi.fn(async () => ({
      id: 'account_pkce',
      providerId: 'echo',
      ownerExtensionId: 'acme.broker',
      label: 'Echo account',
      authType: 'oauth-pkce' as const,
      status: 'connected' as const,
      metadata: {},
      createdAt: now,
      updatedAt: now
    }))
    const broker = createBroker({
      providerAccounts: {
        requireOwnedProvider: vi.fn(async () => ({
          id: 'echo', displayName: 'Echo', oauthPkce: {}
        }))
      },
      accounts: {
        beginPkceAuthorization: vi.fn(async () => ({
          transactionId: 'pkce_transaction',
          authorizationUrl: 'https://auth.example/authorize',
          expiresAt: '2099-07-11T10:10:00.000Z'
        })),
        completePkceAuthorization
      }
    })
    const accountPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['accounts.manage:echo'],
      workspaceRoots: [],
      workspaceTrusted: false
    }
    const session = await broker.handlePrincipal({
      principal: accountPrincipal,
      method: 'authentication.createSession',
      params: {
        providerId: 'echo', authenticationProviderId: 'echo-auth', label: 'Echo account'
      },
      signal: new AbortController().signal,
      requestId: 'create-pkce-session'
    }) as { id: string; transactionId?: string; providerId?: string }
    expect(session).toMatchObject({
      status: 'pending',
      message: expect.stringMatching(/Settings > Extensions/)
    })
    expect(session).not.toHaveProperty('verificationUrl')
    expect(session).not.toHaveProperty('transactionId')
    expect(session).not.toHaveProperty('providerId')

    await expect(broker.handleTrustedManagement({
      principal: accountPrincipal,
      method: 'authentication.getSession',
      params: { sessionId: session.id },
      signal: new AbortController().signal,
      requestId: 'protected-get-pkce-session'
    })).resolves.toMatchObject({
      status: 'pending',
      verificationUrl: 'https://auth.example/authorize'
    })

    const completed = await broker.completePkceAccountSession({
      principal: accountPrincipal,
      sessionId: session.id,
      callbackUrl: 'https://callback.example/?code=authorization-code&state=expected-state'
    })
    expect(completed).toMatchObject({
      status: 'completed',
      account: { id: 'account_pkce', protection: 'encrypted-fallback' }
    })
    expect(completePkceAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: 'pkce_transaction',
      code: 'authorization-code',
      state: 'expected-state',
      protectedCallback: true
    }))
  })

  it('rejects raw-secret requests outside Node and before prompting without permission', async () => {
    const authorizeSecretReveal = vi.fn(async () => true)
    const revealSecret = vi.fn(async () => ({ apiKey: 'must-not-be-returned' }))
    const broker = createBroker({
      providerAccounts: {
        getAccount: vi.fn(async () => ({
          id: 'account_secret',
          providerId: 'echo',
          ownerExtensionId: 'acme.broker'
        }))
      },
      accounts: { revealSecret },
      authorizeSecretReveal
    })
    const viewPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['accounts.secrets.read:echo'],
      workspaceRoots: ['/tmp/workspace'],
      workspaceTrusted: true,
      viewSessionId: 'view_secret',
      viewContributionId: 'secret'
    }

    await expect(broker.handlePrincipal({
      principal: viewPrincipal,
      method: 'authentication.revealSecret',
      params: { accountId: 'account_secret', operation: 'sign-request' },
      signal: new AbortController().signal,
      requestId: 'view-secret-request'
    })).rejects.toThrow(/Node Extension Host/)
    await expect(broker.handle(request('authentication.revealSecret', {
      accountId: 'account_secret', operation: 'sign-request'
    }))).rejects.toThrow(/Missing permission/)
    expect(authorizeSecretReveal).not.toHaveBeenCalled()
    expect(revealSecret).not.toHaveBeenCalled()
  })

  it('polls device authorization in the broker and projects completion through session polling', async () => {
    const now = '2026-07-11T10:00:00.000Z'
    let completeDevice!: (account: unknown) => void
    const completion = new Promise((resolve) => { completeDevice = resolve })
    const broker = createBroker({
      providerAccounts: {
        requireOwnedProvider: vi.fn(async () => ({
          id: 'echo', displayName: 'Echo', oauthDevice: {}
        }))
      },
      accounts: {
        beginDeviceAuthorization: vi.fn(async () => ({
          transactionId: 'device_transaction',
          verificationUri: 'https://auth.example/device',
          userCode: 'ABCD-EFGH',
          expiresAt: '2099-07-11T10:10:00.000Z'
        })),
        completeDeviceAuthorization: vi.fn(() => completion)
      }
    })
    const accountPrincipal = {
      extensionId: 'acme.broker',
      extensionVersion: '1.0.0',
      permissions: ['accounts.manage:echo'],
      workspaceRoots: [],
      workspaceTrusted: false
    }
    const session = await broker.handleTrustedManagement({
      principal: accountPrincipal,
      method: 'authentication.createSession',
      params: { providerId: 'echo', authenticationProviderId: 'echo-auth' },
      signal: new AbortController().signal,
      requestId: 'create-device-session'
    }) as { id: string }
    expect(session).toMatchObject({
      status: 'pending',
      verificationUrl: 'https://auth.example/device',
      userCode: 'ABCD-EFGH'
    })

    completeDevice({
      id: 'account_device',
      providerId: 'echo',
      ownerExtensionId: 'acme.broker',
      label: 'Echo',
      authType: 'oauth-device',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    })
    await vi.waitFor(async () => {
      await expect(broker.handlePrincipal({
        principal: accountPrincipal,
        method: 'authentication.getSession',
        params: { sessionId: session.id },
        signal: new AbortController().signal,
        requestId: 'poll-device-session'
      })).resolves.toMatchObject({ status: 'completed', account: { id: 'account_device' } })
    })
  })
})

function createBroker(overrides: Record<string, unknown> = {}): ExtensionHostBroker {
  const state = new Map<string, unknown>()
  return new ExtensionHostBroker({
    agent: {} as never,
    profiles: { register: () => () => undefined } as never,
    tools: { register: vi.fn() } as never,
    modelProviders: { register: vi.fn() } as never,
    providerAccounts: {
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      getAccount: vi.fn(),
      requireOwnedProvider: vi.fn(),
      validateBinding: vi.fn()
    } as never,
    accounts: {} as never,
    credentials: { protection: async () => ({ mode: 'encrypted-fallback' }) } as never,
    state: {
      read: async () => ({
        global: Object.fromEntries(state),
        workspaces: {}
      }),
      getGlobal: async (_id: string, key: string) => state.get(key),
      setGlobal: async (_id: string, key: string, value: unknown) => {
        if (value === undefined) state.delete(key)
        else state.set(key, value)
      }
    } as never,
    invokeExtension: vi.fn(async () => null),
    notifyExtension: vi.fn(async () => undefined),
    resolveManifest: async () => manifest,
    ...overrides
  } as never)
}

function cancellationContext() {
  return {
    cancellation: {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() {} })
    }
  }
}
