import { describe, expect, it } from 'vitest'
import { ExtensionApiError } from '@kun/extension-api'
import { createExtensionTestHarness, createGeneratedArtifactFixture } from '../src/index.js'

const permissions = [
  'commands.register',
  'storage.global',
  'storage.workspace',
  'agent.run',
  'agent.threads.readOwn',
  'tools.register',
  'providers.register',
  'accounts.read',
  'workspace.read',
  'workspace.write',
  'ui.notifications',
  'network:api.example.com'
]

const mediaPermissions = [
  'media.read',
  'media.process',
  'media.export',
  'jobs.manage',
  'workspace.read',
  'workspace.write'
]

describe('ExtensionTestHarness', () => {
  it('runs commands, storage, Agent events, and tools deterministically', async () => {
    const harness = createExtensionTestHarness({ permissions })
    const command = await harness.client.commands.registerCommand('hello', async (args) => ({ args }))
    expect(await harness.client.commands.executeCommand('hello', 'world')).toEqual({ args: 'world' })

    await harness.client.storage.global.set('answer', 42)
    expect(await harness.client.storage.global.get('answer')).toBe(42)

    harness.webview.respondToNextNotification('retry')
    expect(await harness.client.ui.showNotification({
      id: 'provider-warning',
      title: 'Provider unavailable',
      message: 'Reconnect and retry.',
      actions: [{ id: 'retry', title: 'Retry' }]
    })).toBe('retry')
    expect(harness.webview.notifications).toEqual([expect.objectContaining({
      id: 'provider-warning',
      severity: 'info',
      actions: [{ id: 'retry', title: 'Retry' }]
    })])

    const { run } = await harness.client.agent.createRun({ input: 'hello' })
    const subscription = await harness.client.agent.subscribe({ runId: run.id })
    const events: string[] = []
    subscription.onEvent((event) => events.push(event.type))
    harness.agent.emit(run.id, 'progress', { message: 'working' })
    expect(events).toEqual(['state', 'progress'])

    const tool = await harness.client.tools.registerTool(
      { id: 'echo', description: 'Echo input', inputSchema: { type: 'object' }, sideEffects: 'none', idempotent: true },
      async (input) => ({ content: input })
    )
    expect(await harness.tools.invoke('tool-1', { value: 'ok' })).toEqual({ content: { value: 'ok' } })

    await tool.dispose()
    await subscription.dispose()
    await command.dispose()
    await harness.dispose()
  })

  it('returns the public permission error shape', async () => {
    const harness = createExtensionTestHarness({ permissions: [] })
    await expect(harness.client.network.fetch({ url: 'https://api.example.com' })).rejects.toMatchObject<
      Partial<ExtensionApiError>
    >({ code: 'PERMISSION_DENIED', operation: 'network.fetch' })
    await harness.dispose()
  })

  it('captures bounded composer context with Host-owned provenance', async () => {
    const harness = createExtensionTestHarness({ permissions: ['ui.actions'] })
    const attached = await harness.client.ui.attachComposerContext({
      schemaVersion: 1,
      id: 'video-selection',
      title: 'Interview selection',
      summary: 'Revision 4 with two selected clips',
      reference: { projectId: 'project-1', selectedItemIds: ['clip-1', 'clip-2'] },
      revision: 4,
      generation: 7
    })
    expect(attached).toMatchObject({
      attachmentId: expect.stringMatching(/^extension-context:[a-f0-9]{64}$/),
      provenance: {
        extensionId: 'test.extension',
        extensionVersion: '1.0.0',
        viewContributionId: 'extension:test.extension/test-view'
      }
    })
    expect(harness.webview.composerContexts).toEqual([attached])
    expect(JSON.stringify(attached)).not.toContain('/private/')
    await harness.dispose()
  })

  it('contains malformed Host notifications as public protocol errors', async () => {
    const harness = createExtensionTestHarness()
    const errors: ExtensionApiError[] = []
    harness.client.onDidError((error) => errors.push(error))
    harness.transport.emit('ui.themeChanged', { kind: 'invalid' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'PROTOCOL_ERROR', operation: 'ui.themeChanged' })
    await harness.dispose()
  })

  it('scripts accounts and normalized provider streams without credentials or model calls', async () => {
    const harness = createExtensionTestHarness({
      permissions: [
        'providers.register',
        'accounts.read',
        'accounts.secrets.read:fake-provider'
      ]
    })
    harness.accounts.addAccount(
      {
        id: 'account-1',
        providerId: 'fake-provider',
        label: 'Test account',
        authenticationType: 'api-key',
        status: 'connected',
        metadata: {}
      },
      'not-a-real-secret'
    )
    expect(await harness.client.authentication.listAccounts({ providerId: 'fake-provider' })).toHaveLength(1)
    expect(
      await harness.client.authentication.revealSecret({
        accountId: 'account-1',
        operation: 'test-signing'
      })
    ).toBe('not-a-real-secret')

    await harness.client.modelProviders.registerProvider(
      {
        id: 'fake-provider',
        displayName: 'Fake Provider',
        adapterApiVersion: '1.0.0',
        models: []
      },
      {
        async probe() {
          return { ok: true }
        },
        async listModels() {
          return [
            {
              id: 'fake-model',
              displayName: 'Fake Model',
              capabilities: {
                input: ['text'],
                output: ['text'],
                reasoning: false,
                tools: false,
                parallelTools: false,
                streaming: true
              }
            }
          ]
        },
        async *stream(request) {
          yield { requestId: request.requestId, sequence: 0, type: 'textDelta', delta: 'hello' }
          yield {
            requestId: request.requestId,
            sequence: 1,
            type: 'completed',
            finishReason: 'stop',
            usage: { outputTokens: 1 }
          }
        },
        async cancel() {}
      }
    )
    const binding = { providerId: 'fake-provider', accountId: 'account-1', modelId: 'fake-model' }
    expect(
      await harness.providers.invoke('provider-1', { operation: 'listModels', binding })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fake-model' })]))
    await harness.providers.invoke('provider-1', {
      operation: 'stream',
      request: {
        apiVersion: '1.0.0',
        requestId: 'request-1',
        binding,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
      }
    })
    expect(harness.transport.sentNotifications).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'modelProviders.streamEvent' })])
    )
    expect(harness.transport.sentStreams).toEqual([
      expect.objectContaining({ requestId: 'fake_request_2', terminal: false }),
      expect.objectContaining({ requestId: 'fake_request_2', terminal: true })
    ])
    expect(harness.providers.takeStreamEvents('provider-1').map((event) => event.type)).toEqual([
      'textDelta',
      'completed'
    ])
    await harness.dispose()
  })

  it('fakes protected media selection, probe, leases, FFmpeg jobs, and artifacts', async () => {
    const harness = createExtensionTestHarness({ permissions: mediaPermissions })
    const inputHandle = 'fake_media_input_0001'
    const outputHandle = 'fake_media_output_0001'
    const textHandle = 'fake_media_text_000001'
    harness.media.queueFileSelection({
      handleId: inputHandle,
      mode: 'read',
      kind: 'video',
      displayName: 'interview.mp4',
      mimeType: 'video/mp4',
      byteSize: 2048
    })
    harness.media.queueSaveTarget({
      handleId: outputHandle,
      mode: 'export',
      kind: 'video',
      displayName: 'export.mp4',
      mimeType: 'video/mp4'
    })
    harness.media.addHandle({
      handleId: textHandle,
      mode: 'read',
      kind: 'data',
      displayName: 'timeline.otio',
      mimeType: 'application/x-otio+json',
      byteSize: 0
    })
    harness.media.setText(textHandle, '{"OTIO_SCHEMA":"SerializableCollection.1"}')
    harness.media.setProbe(inputHandle, {
      schemaVersion: 1,
      handleId: inputHandle,
      container: { formatNames: ['mp4'], durationMicros: 1_000_000 },
      streams: [{
        index: 0,
        kind: 'video',
        codecName: 'h264',
        frameRate: { numerator: 30_000, denominator: 1001 },
        width: 1920,
        height: 1080,
        disposition: { default: true }
      }]
    })

    const selection = await harness.client.media.pickFiles()
    expect(selection).toMatchObject({ outcome: 'selected', files: [{ handleId: inputHandle }] })
    expect(await harness.client.media.probe({ handleId: inputHandle })).toMatchObject({
      handleId: inputHandle,
      streams: [{ codecName: 'h264' }]
    })
    expect(await harness.client.media.openViewResource({ handleId: inputHandle }))
      .toMatchObject({ handleId: inputHandle, mimeType: 'video/mp4' })
    expect(await harness.client.media.pickSaveTarget()).toMatchObject({
      outcome: 'selected',
      target: { handleId: outputHandle }
    })
    expect(await harness.client.media.readText({ handleId: textHandle, maxBytes: 1024 }))
      .toMatchObject({
        handleId: textHandle,
        displayName: 'timeline.otio',
        mimeType: 'application/x-otio+json',
        content: '{"OTIO_SCHEMA":"SerializableCollection.1"}'
      })
    await expect(harness.client.media.readText({ handleId: textHandle, maxBytes: 8 }))
      .rejects.toMatchObject({ code: 'RESOURCE_LIMIT', operation: 'media.readText' })
    expect(await harness.client.media.createCacheTarget({
      format: 'png',
      purpose: 'derived-waveform-partial'
    })).toMatchObject({
      target: {
        handleId: expect.stringMatching(/^fake_cache_target_/u),
        mode: 'export',
        kind: 'image',
        mimeType: 'image/png'
      }
    })

    const started = await harness.client.media.startFfmpegJob({
      arguments: ['-i', '{{input:source}}', '{{output:export}}'],
      inputs: { source: inputHandle },
      outputs: { export: outputHandle },
      scheduling: { priority: 'interactive', maxAttempts: 3, retryBaseDelayMs: 250 }
    })
    expect(harness.transport.requests.filter(({ method }) => method === 'media.startFfmpegJob').at(-1)?.params)
      .toMatchObject({
        scheduling: { priority: 'interactive', maxAttempts: 3, retryBaseDelayMs: 250 }
      })
    const subscription = await harness.client.jobs.subscribe({ jobId: started.job.jobId })
    const states: string[] = []
    subscription.onEvent((event) => states.push(event.state))
    harness.jobs.start(started.job.jobId)
    harness.jobs.reportProgress(started.job.jobId, { completed: 1, total: 2, percentage: 50 })
    const artifact = createGeneratedArtifactFixture({
      ownerExtensionVersion: harness.identity.version,
      mediaHandleId: outputHandle,
      provenance: { jobId: started.job.jobId, operation: 'media.ffmpeg' }
    })
    harness.jobs.complete(started.job.jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })
    expect(states).toEqual(['queued', 'running', 'running', 'completed'])
    expect(subscription.complete).toBe(true)
    expect(subscription.snapshot.result?.generatedArtifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ])
    await subscription.dispose()

    const archiveOutput = 'fake_archive_output_0001'
    harness.media.addHandle({
      handleId: archiveOutput,
      mode: 'export',
      kind: 'data',
      displayName: 'project-package.zip',
      mimeType: 'application/zip'
    })
    await expect(harness.client.media.startArchiveJob({
      format: 'zip',
      outputHandleId: archiveOutput,
      entries: [
        {
          kind: 'inline-text',
          archivePath: 'manifest/project.json',
          content: '{"schemaVersion":2}',
          mimeType: 'application/json'
        },
        {
          kind: 'media',
          inputHandleId: inputHandle,
          archivePath: 'media/interview.mp4'
        }
      ]
    })).resolves.toMatchObject({
      outcome: 'started',
      job: { kind: 'media.archive', state: 'queued' }
    })
    await harness.dispose()
  })

  it('returns deterministic and configurable public media capabilities', async () => {
    const harness = createExtensionTestHarness({ permissions: mediaPermissions })
    expect(await harness.client.media.getCapabilities()).toMatchObject({
      ffprobe: { name: 'ffprobe', available: true },
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        features: expect.arrayContaining(['libx264-encoder', 'aac-encoder', 'drawtext-filter'])
      }
    })

    harness.media.setCapabilities({
      probedAt: '2026-01-02T00:00:00.000Z',
      ffprobe: { name: 'ffprobe', available: false, features: [] },
      ffmpeg: { name: 'ffmpeg', available: true, features: ['libx264-encoder'] }
    })
    expect(await harness.client.media.getCapabilities()).toEqual({
      probedAt: '2026-01-02T00:00:00.000Z',
      ffprobe: { name: 'ffprobe', available: false, features: [] },
      ffmpeg: { name: 'ffmpeg', available: true, features: ['libx264-encoder'] }
    })

    harness.media.executablesAvailable = false
    expect(await harness.client.media.getCapabilities()).toMatchObject({
      ffprobe: { available: false },
      ffmpeg: { available: false, features: [] }
    })
    await harness.dispose()
  })

  it('scripts path-opaque local audio-analysis capability and job outcomes', async () => {
    const harness = createExtensionTestHarness({ permissions: mediaPermissions })
    const reference = 'fake_audio_reference_0001'
    const target = 'fake_audio_target_000001'
    for (const handleId of [reference, target]) {
      harness.media.addHandle({
        handleId,
        mode: 'read',
        kind: 'audio',
        displayName: `${handleId}.wav`,
        mimeType: 'audio/wav'
      })
    }
    expect(await harness.client.media.getAudioAnalysisCapabilities()).toMatchObject({
      analyses: [
        { analysis: 'silence', available: true },
        { analysis: 'beat-grid', available: false, networkUsed: false },
        { analysis: 'sync-features', available: true }
      ]
    })
    expect(await harness.client.media.startAudioAnalysisJob({
      analysis: 'beat-grid', inputHandleId: reference
    })).toMatchObject({
      outcome: 'unavailable',
      code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
      networkUsed: false
    })
    const started = await harness.client.media.startAudioAnalysisJob({
      analysis: 'sync-features',
      referenceHandleId: reference,
      targetHandleId: target,
      seed: 42
    })
    expect(started).toMatchObject({
      outcome: 'started',
      job: { kind: 'media.audio-analysis', state: 'queued' }
    })
    expect(JSON.stringify(harness.transport.requests)).not.toMatch(/\/(?:Users|private|tmp)\//u)
    await harness.dispose()
  })

  it('fakes permission denial, picker cancellation, executable absence, cancellation races, and restart', async () => {
    const denied = createExtensionTestHarness({ permissions: [] })
    await expect(denied.client.media.pickFiles()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      operation: 'media.pickFiles'
    })
    await denied.dispose()

    const harness = createExtensionTestHarness({ permissions: mediaPermissions })
    harness.media.queuePickerCancellation()
    expect(await harness.client.media.pickFiles()).toEqual({ outcome: 'cancelled', files: [] })
    harness.media.executablesAvailable = false
    harness.media.addHandle({
      handleId: 'fake_media_input_0002',
      mode: 'read',
      kind: 'video',
      displayName: 'missing-tool.mp4'
    })
    await expect(harness.client.media.probe({ handleId: 'fake_media_input_0002' })).rejects.toMatchObject({
      code: 'HOST_UNAVAILABLE',
      operation: 'media.probe'
    })

    const cancelling = harness.jobs.create('media.ffmpeg', 'media.startFfmpegJob')
    harness.jobs.start(cancelling.id)
    harness.jobs.cancellationMode = 'pending'
    const cancellation = await harness.client.jobs.cancel({ jobId: cancelling.id, reason: 'test' })
    expect(cancellation).toMatchObject({ accepted: true, snapshot: { state: 'running' } })
    expect(harness.jobs.complete(cancelling.id).state).toBe('running')
    expect(harness.jobs.settleCancellation(cancelling.id).state).toBe('cancelled')

    const interrupted = harness.jobs.create('media.ffmpeg', 'media.startFfmpegJob')
    harness.jobs.start(interrupted.id)
    harness.jobs.simulateRestart()
    expect((await harness.client.jobs.get(interrupted.id)).state).toBe('interrupted')
    expect((await harness.client.jobs.list({ filter: { states: ['interrupted'] } })).items)
      .toEqual([expect.objectContaining({ id: interrupted.id })])
    await harness.dispose()
  })
})
