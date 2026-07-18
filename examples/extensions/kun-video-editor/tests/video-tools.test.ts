import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ExtensionApiError,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaEmbedVisualQueryRequestSchema,
  parseExtensionManifest,
  type ExtensionManifest,
  type JsonObject,
  type ToolResult
} from '@kun/extension-api'
import {
  createExtensionTestHarness,
  createGeneratedArtifactFixture,
  type ExtensionTestHarness
} from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import { activate, VIDEO_TOOL_DECLARATIONS, VIDEO_TOOL_IDS } from '../src/host/extension.js'
import { DerivedMediaService } from '../src/host/derived-media-service.js'
import { VideoEditorTools } from '../src/host/video-tools.js'
import type {
  GenerationAuthorizationChallenge,
  GenerationExecutionBroker
} from '../src/host/generation-service.js'

const roots: string[] = []
const permissions = [
  'commands.register',
  'ui.views',
  'ui.actions',
  'webview',
  'agent.run',
  'tools.register',
  'storage.workspace',
  'workspace.read',
  'workspace.write',
  'media.read',
  'media.process',
  'media.export',
  'jobs.manage'
]

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('video editor manifest and Agent catalog', () => {
  it('declares one private profile, stable tools, complete activation, and least privilege', async () => {
    const manifest = await loadManifest()
    expect(manifest.apiVersion).toBe('1.2.0')
    expect(manifest.version).toBe('0.4.4')
    expect(manifest.contributes['views.rightSidebar']).toEqual([
      expect.objectContaining({
        id: 'editor',
        entry: 'dist/webview/index.html',
        icon: 'assets/video-editor.svg'
      })
    ])
    expect(manifest.contributes['views.fullPage']).toEqual([])
    expect(manifest.contributes['actions.composer']).toEqual([])
    const editorCommand = manifest.contributes.commands.find(({ id }) => id === 'editor-request')
    const properties = editorCommand?.inputSchema?.properties
    const actionProperty = properties && typeof properties === 'object' && !Array.isArray(properties)
      ? properties.action
      : undefined
    expect(actionProperty && typeof actionProperty === 'object' && !Array.isArray(actionProperty)
      ? actionProperty.enum
      : undefined).toEqual([
      'project.list', 'project.active', 'project.get', 'project.select', 'project.create',
      'project.update', 'context.update', 'context.attach-selection', 'project.undo', 'project.redo',
      'sequence.decompose', 'script.read', 'script.apply', 'media.list', 'media.import',
      'media.import-batch', 'media.reauthorize',
      'media.folder.create', 'media.folder.update', 'media.folder.delete', 'media.organize',
      'transcript.import', 'caption.generate', 'preview.list', 'preview.add', 'preview.select',
      'preview.compare', 'preview.replace', 'export-capabilities', 'otio-export-preview',
      'otio-import-preview', 'interchange.export', 'interchange.status', 'interchange.cancel',
      'interchange.import-preview', 'interchange.import', 'project-package-preflight', 'project-package.export',
      'project-package.status', 'project-package.cancel', 'render.list', 'render.start', 'render.status',
      'render.cancel', 'derived.list', 'derived.start', 'derived.retry', 'derived.cancel',
      'derived.cleanup', 'analysis.capabilities', 'analysis.visual-opt-in', 'analysis.visual-install',
      'analysis.visual-index', 'analysis.visual-search', 'analysis.list', 'analysis.evidence',
      'analysis.vad', 'analysis.vad-apply', 'analysis.speaker-import', 'analysis.speaker-preview',
      'analysis.speaker-apply', 'analysis.beats', 'analysis.denoise-metadata', 'analysis.sync-preview',
      'analysis.sync-apply', 'analysis.status', 'analysis.cancel',
      'generation.catalog', 'generation.list', 'generation.request', 'generation.retry',
      'generation.status', 'generation.cancel', 'generation.insert', 'multicam.inspect',
      'multicam.create', 'multicam.labels', 'multicam.sync-confirm', 'multicam.layout-upsert',
      'multicam.delete', 'multicam.switch', 'multicam.layout', 'multicam.merge'
    ])
    expect(manifest.contributes.agentProfiles).toHaveLength(1)
    const profile = manifest.contributes.agentProfiles[0]!
    expect(profile).toMatchObject({ id: 'video-editor', visibility: 'private' })
    expect(profile.allowedTools).toEqual(VIDEO_TOOL_IDS)
    expect(profile.instructions).toContain('video-inspect with action context')
    expect(profile.instructions).toContain('video-project with action select')
    expect(profile.instructions).toContain('video-render-cancel')
    expect(profile.instructions).toContain('video-analysis-status capabilities')
    expect(profile.instructions).toContain('never invent markers')
    expect(profile.instructions).toContain('Reviewed speaker evidence can only be imported')
    expect(profile.instructions).toContain('must remain explicitly unlabelled')
    expect(profile.instructions).toContain('not arbitrary visual-scene understanding')
    expect(profile.instructions).toContain('interaction-required')
    expect(manifest.contributes.tools).toEqual(VIDEO_TOOL_DECLARATIONS)
    expect(manifest.activationEvents).toEqual(expect.arrayContaining([
      'onView:editor',
      'onView:render-preview',
      'onCommand:editor-request',
      'onAgentProfile:video-editor',
      ...VIDEO_TOOL_IDS.map((id) => `onTool:${id}`)
    ]))
    expect(new Set(manifest.permissions)).toEqual(new Set(permissions))
    expect(manifest.permissions.some((permission) => permission.startsWith('network:'))).toBe(false)
  })

  it('keeps read/write/destructive approval classes truthful and cache-stable', () => {
    expect(Object.fromEntries(VIDEO_TOOL_DECLARATIONS.map((tool) => [tool.id, tool.sideEffects])))
      .toEqual({
        'video-project': 'write',
        'video-inspect': 'read',
        'video-probe': 'write',
        'video-transcribe': 'write',
        'video-read-script': 'read',
        'video-apply-script': 'destructive',
        'video-update-timeline': 'write',
        'video-analyze-visual': 'write',
        'video-analyze-audio': 'write',
        'video-analysis-status': 'read',
        'video-analysis-cancel': 'destructive',
        'video-interchange': 'write',
        'video-interchange-status': 'read',
        'video-interchange-cancel': 'destructive',
        'video-generation-catalog': 'read',
        'video-generation-request': 'external',
        'video-generation-status': 'read',
        'video-generation-cancel': 'destructive',
        'video-project-package': 'write',
        'video-project-package-status': 'read',
        'video-project-package-cancel': 'destructive',
        'video-render': 'write',
        'video-render-status': 'read',
        'video-render-cancel': 'destructive',
        'video-undo': 'destructive'
      })
    const fingerprint = JSON.stringify(VIDEO_TOOL_DECLARATIONS)
    expect(JSON.stringify(VIDEO_TOOL_DECLARATIONS)).toBe(fingerprint)
    expect(VIDEO_TOOL_DECLARATIONS).toHaveLength(25)
  })

  it('keeps the manifest and Host command catalog aligned without artifact shell commands', async () => {
    const manifest = await loadManifest()
    const harness = await activatedHarness()
    const declared = manifest.contributes.commands.map(({ id }) => id).sort()
    const registered = harness.transport.requests
      .filter(({ method }) => method === 'commands.register')
      .map(({ params }) => String((params as JsonObject).id))
      .sort()
    expect(declared).toEqual(['editor-request'])
    expect(registered).toEqual(declared)
    expect(registered).not.toContain('reveal-artifact')
    await harness.dispose()
  })
})

describe('video editor Agent tools', () => {
  it('reports generation honestly unavailable by default without disturbing ordinary editing', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'generation-unavailable', name: 'Generation unavailable'
    })

    const catalog = await invoke(harness, 'video-generation-catalog', {})
    expect(catalog.content).toMatchObject({
      outcome: 'unavailable',
      catalog: { schemaVersion: 1, providers: [] },
      message: expect.stringContaining('No approved generation broker')
    })
    const request = await invoke(harness, 'video-generation-request', {
      task: 'video',
      projectId: 'generation-unavailable',
      projectRevision: 0,
      providerId: 'unconfigured-provider',
      modelId: 'unconfigured-video',
      prompt: 'A bounded test clip',
      referenceAssetIds: [],
      variants: 1,
      output: { kind: 'video' },
      outputPolicy: 'resolve-placeholder',
      idempotencyKey: 'generation-unavailable-request',
      consent: {
        providerPermissionApproved: false,
        mediaUploadApproved: false,
        costApproved: false,
        approvedMaximumMinor: 0,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:00.000Z'
      }
    })
    expect(request.content).toMatchObject({ outcome: 'unavailable' })
    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'generation-unavailable', expectedRevision: 0
    })
    expect(loaded.content).toMatchObject({
      outcome: 'loaded',
      project: { currentRevision: 0, counts: { assets: 0, items: 0 } }
    })
    await harness.dispose()
  })

  it('persists an authorized generated variant and inserts it into the revision-fenced timeline', async () => {
    let completed = false
    let currentGenerationExecutionId = ''
    const broker: GenerationExecutionBroker = {
      catalog: async () => generationCatalogFixture(),
      authorize: async (challenge) => generationAuthorization(challenge),
      prepare: async (request) => {
        currentGenerationExecutionId = String(request.executionId)
        return generationBrokerSnapshot(request, 'prepared')
      },
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, 'running'),
      status: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, completed ? 'completed' : 'running', completed ? generationOutputFixture() : undefined),
      cancel: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, 'cancelled'),
      verifyOutputs: async () => generationOutputFixture()
    }
    const { harness, tools } = await generationHarness(broker)
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'generation-demo', name: 'Generation Demo'
    })
    const sourceHandle = 'generation_reference_0001'
    harness.media.addHandle(mediaHandle(sourceHandle, 'read', 'reference.mp4', 'video'))
    harness.media.setProbe(sourceHandle, videoProbe(sourceHandle))
    await invoke(harness, 'video-probe', {
      projectId: 'generation-demo',
      expectedRevision: 0,
      mediaHandleId: sourceHandle,
      assetId: 'reference'
    })

    const requested = contentObject(await invoke(harness, 'video-generation-request', {
      task: 'video',
      projectId: 'generation-demo',
      projectRevision: 1,
      providerId: 'remote-provider',
      modelId: 'remote-video',
      prompt: 'Create a calm five-second intro',
      referenceAssetIds: ['reference'],
      variants: 1,
      output: { kind: 'video', width: 1_920, height: 1_080, durationUs: 5_000_000 },
      outputPolicy: 'resolve-placeholder',
      idempotencyKey: 'generation-timeline-request',
      consent: {
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 25,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:00.000Z'
      }
    }))
    expect(requested).toMatchObject({ outcome: 'queued', record: { state: 'running' } })
    const record = requested.record as JsonObject
    completed = true

    const status = contentObject(await invoke(harness, 'video-generation-status', {
      action: 'status',
      projectId: 'generation-demo',
      recordId: String(record.id)
    }))
    expect(status).toMatchObject({
      outcome: 'status',
      state: 'ready',
      outputs: [{ id: 'variant-primary', primary: true }]
    })
    expect(JSON.stringify(status)).not.toMatch(/Create a calm|generation_output_handle|completion-primary|authorization_/u)

    const inserted = await tools.editorRequest({
      action: 'generation.insert',
      payload: {
        projectId: 'generation-demo',
        expectedRevision: 1,
        recordId: String(record.id),
        outputId: 'variant-primary',
        addToTimeline: true,
        timelineStartFrame: 150,
        stillDurationFrames: 150
      }
    }) as ToolResult
    expect(inserted.content).toMatchObject({
      outcome: 'inserted',
      previousRevision: 1,
      currentRevision: 2,
      asset: {
        kind: 'video',
        generatedLineage: {
          providerId: 'remote-provider',
          modelId: 'remote-video',
          promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          referenceAssetIds: ['reference']
        }
      }
    })
    const insertedJson = JSON.stringify(inserted)
    expect(insertedJson).not.toMatch(/Create a calm|generation_output_handle|completion-primary|authorization_|https?:\/\//u)

    const loaded = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'generation-demo', expectedRevision: 2
    }))
    expect(loaded).toMatchObject({
      project: {
        currentRevision: 2,
        counts: { assets: 2, items: 2 },
        assets: expect.arrayContaining([expect.objectContaining({
          generatedLineage: expect.objectContaining({ promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) })
        })])
      }
    })
    await harness.dispose()
  })

  it('atomically materializes every owned multi-output variant and stays idempotent', async () => {
    let completed = false
    let currentGenerationExecutionId = ''
    const outputs = multiGenerationOutputFixture()
    const broker: GenerationExecutionBroker = {
      catalog: async () => generationCatalogFixture(),
      authorize: async (challenge) => generationAuthorization(challenge),
      prepare: async (request) => {
        currentGenerationExecutionId = String(request.executionId)
        return generationBrokerSnapshot(request, 'prepared')
      },
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, 'running'),
      status: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, completed ? 'completed' : 'running', completed ? outputs : undefined),
      cancel: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, 'cancelled'),
      verifyOutputs: async () => outputs
    }
    const { harness } = await generationHarness(broker)
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'generation-variants', name: 'Generation Variants'
    })
    const sourceHandle = 'generation_variants_reference_0001'
    harness.media.addHandle(mediaHandle(sourceHandle, 'read', 'reference.mp4', 'video'))
    harness.media.setProbe(sourceHandle, videoProbe(sourceHandle))
    await invoke(harness, 'video-probe', {
      projectId: 'generation-variants',
      expectedRevision: 0,
      mediaHandleId: sourceHandle,
      assetId: 'reference'
    })
    const requested = contentObject(await invoke(harness, 'video-generation-request', {
      task: 'video',
      projectId: 'generation-variants',
      projectRevision: 1,
      providerId: 'remote-provider',
      modelId: 'remote-video',
      prompt: 'Generate two private review variants',
      referenceAssetIds: ['reference'],
      variants: 2,
      output: { kind: 'video', width: 1_920, height: 1_080, durationUs: 5_000_000 },
      outputPolicy: 'add-variants',
      idempotencyKey: 'generation-multi-output-request',
      consent: {
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 50,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:00.000Z'
      }
    }))
    const record = requested.record as JsonObject

    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'generation-other-project', name: 'Other Project'
    })
    await expect(invoke(harness, 'video-generation-status', {
      action: 'status',
      projectId: 'generation-other-project',
      recordId: String(record.id)
    })).rejects.toThrow(/not owned by this project/u)

    completed = true
    const status = contentObject(await invoke(harness, 'video-generation-status', {
      action: 'status',
      projectId: 'generation-variants',
      recordId: String(record.id)
    }))
    expect(status).toMatchObject({
      outcome: 'status',
      state: 'ready',
      outputPolicy: 'add-variants',
      outputs: [
        expect.objectContaining({ id: 'variant-primary', primary: true }),
        expect.objectContaining({ id: 'variant-secondary', primary: false })
      ]
    })
    const materialized = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'generation-variants', expectedRevision: 2
    }))
    expect(materialized).toMatchObject({
      project: {
        currentRevision: 2,
        counts: { assets: 3, items: 1 },
        assets: expect.arrayContaining([
          expect.objectContaining({
            id: 'generated-primary',
            generatedLineage: expect.objectContaining({
              providerId: 'remote-provider',
              modelId: 'remote-video',
              jobId: 'job_generation_tools_0001',
              promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
              referenceAssetIds: ['reference'],
              variantOfAssetId: null
            })
          }),
          expect.objectContaining({
            id: 'generated-secondary',
            generatedLineage: expect.objectContaining({
              jobId: 'job_generation_tools_0001',
              variantOfAssetId: 'generated-primary'
            })
          })
        ])
      }
    })
    const safeProjection = JSON.stringify(status)
    expect(safeProjection).not.toMatch(
      /Generate two private|generation_output_handle|completion-(?:primary|secondary)|host-account|https?:\/\/|\/Users\//u
    )
    expect(JSON.stringify(materialized)).not.toMatch(/Generate two private|completion-(?:primary|secondary)|host-account|https?:\/\/|\/Users\//u)

    await invoke(harness, 'video-generation-status', {
      action: 'status',
      projectId: 'generation-variants',
      recordId: String(record.id)
    })
    const repeated = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'generation-variants', expectedRevision: 2
    }))
    expect(repeated).toMatchObject({ project: { currentRevision: 2, counts: { assets: 3, items: 1 } } })
    await harness.dispose()
  })

  it('fences automatic multi-output materialization and bulk-inserts variants explicitly', async () => {
    let completed = false
    let currentGenerationExecutionId = ''
    const outputs = multiGenerationOutputFixture()
    const broker: GenerationExecutionBroker = {
      catalog: async () => generationCatalogFixture(),
      authorize: async (challenge) => generationAuthorization(challenge),
      prepare: async (request) => {
        currentGenerationExecutionId = String(request.executionId)
        return generationBrokerSnapshot(request, 'prepared')
      },
      recover: async () => undefined,
      dispatch: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, 'running'),
      status: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, completed ? 'completed' : 'running', completed ? outputs : undefined),
      cancel: async (_jobId, owner) => generationBrokerSnapshot({
        executionId: currentGenerationExecutionId,
        owner
      }, 'cancelled'),
      verifyOutputs: async () => outputs
    }
    const { harness, tools } = await generationHarness(broker)
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'generation-fenced', name: 'Generation Fenced'
    })
    const firstHandle = 'generation_fenced_reference_0001'
    harness.media.addHandle(mediaHandle(firstHandle, 'read', 'reference.mp4', 'video'))
    harness.media.setProbe(firstHandle, videoProbe(firstHandle))
    await invoke(harness, 'video-probe', {
      projectId: 'generation-fenced', expectedRevision: 0,
      mediaHandleId: firstHandle, assetId: 'reference'
    })
    const requested = contentObject(await invoke(harness, 'video-generation-request', {
      task: 'video',
      projectId: 'generation-fenced',
      projectRevision: 1,
      providerId: 'remote-provider',
      modelId: 'remote-video',
      prompt: 'Generate two fenced variants',
      referenceAssetIds: ['reference'],
      variants: 2,
      output: { kind: 'video', width: 1_920, height: 1_080, durationUs: 5_000_000 },
      outputPolicy: 'resolve-placeholder',
      idempotencyKey: 'generation-fenced-multi-output',
      consent: {
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 50,
        currency: 'USD',
        confirmedAt: '2026-07-14T00:00:00.000Z'
      }
    }))
    const record = requested.record as JsonObject
    const placeholder = record.placeholder as JsonObject

    const interveningHandle = 'generation_fenced_intervening_01'
    harness.media.addHandle(mediaHandle(interveningHandle, 'read', 'intervening.mp4', 'video'))
    harness.media.setProbe(interveningHandle, videoProbe(interveningHandle))
    await invoke(harness, 'video-probe', {
      projectId: 'generation-fenced', expectedRevision: 1,
      mediaHandleId: interveningHandle, assetId: 'intervening'
    })
    completed = true
    await invoke(harness, 'video-generation-status', {
      action: 'status', projectId: 'generation-fenced', recordId: String(record.id)
    })
    const fenced = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'generation-fenced', expectedRevision: 2
    }))
    expect(fenced).toMatchObject({ project: { currentRevision: 2, counts: { assets: 2, items: 2 } } })

    const inserted = await tools.editorRequest({
      action: 'generation.insert',
      payload: {
        projectId: 'generation-fenced',
        expectedRevision: 2,
        recordId: String(record.id),
        outputId: 'variant-secondary',
        addToTimeline: false
      }
    }) as ToolResult
    expect(inserted.content).toMatchObject({
      outcome: 'inserted',
      previousRevision: 2,
      currentRevision: 3,
      materializedVariantCount: 2,
      addedToTimeline: false
    })
    const loaded = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'generation-fenced', expectedRevision: 3
    }))
    expect(loaded).toMatchObject({
      project: {
        currentRevision: 3,
        counts: { assets: 4, items: 2 },
        assets: expect.arrayContaining([
          expect.objectContaining({ id: String(placeholder.assetId) }),
          expect.objectContaining({
            id: 'generated-secondary',
            generatedLineage: expect.objectContaining({ variantOfAssetId: String(placeholder.assetId) })
          })
        ])
      }
    })
    const repeated = await tools.editorRequest({
      action: 'generation.insert',
      payload: {
        projectId: 'generation-fenced',
        expectedRevision: 3,
        recordId: String(record.id),
        outputId: 'variant-secondary',
        addToTimeline: false
      }
    }) as ToolResult
    expect(repeated.content).toMatchObject({
      outcome: 'already-in-project',
      currentRevision: 3,
      materializedVariantCount: 2
    })
    expect(JSON.stringify({ inserted, repeated })).not.toMatch(
      /Generate two fenced|generation_output_handle|completion-(?:primary|secondary)|host-account|https?:\/\/|\/Users\//u
    )
    expect(JSON.stringify(loaded)).not.toMatch(/Generate two fenced|completion-(?:primary|secondary)|host-account|https?:\/\/|\/Users\//u)
    await harness.dispose()
  })

  it('creates and reads bounded projects, imports media, and publishes derived-media jobs', async () => {
    const harness = await activatedHarness()
    const created = await invoke(harness, 'video-project', {
      action: 'create', projectId: 'agent-demo', name: 'Agent Demo'
    })
    expect(created.content).toMatchObject({
      outcome: 'created',
      project: {
        id: 'agent-demo',
        currentRevision: 0,
        canUndo: false,
        canRedo: false
      },
      truncated: false
    })
    const active = await invoke(harness, 'video-project', { action: 'active' })
    expect(active.content).toMatchObject({
      outcome: 'active',
      project: { id: 'agent-demo', currentRevision: 0 }
    })

    const sourceHandle = 'fake_media_source_0001'
    const thumbnailHandle = 'fake_media_thumb_0001'
    const waveformHandle = 'fake_media_wave_00001'
    harness.media.queueFileSelection(mediaHandle(sourceHandle, 'read', 'interview.mp4', 'video'))
    harness.media.addHandle(mediaHandle(thumbnailHandle, 'export', 'thumb.png', 'image'))
    harness.media.addHandle(mediaHandle(waveformHandle, 'export', 'wave.png', 'image'))
    harness.media.setProbe(sourceHandle, videoProbe(sourceHandle))
    const imported = await invoke(harness, 'video-probe', {
      projectId: 'agent-demo',
      expectedRevision: 0,
      assetId: 'interview',
      thumbnailOutputHandleId: thumbnailHandle,
      waveformOutputHandleId: waveformHandle
    })
    expect(imported.content).toMatchObject({
      outcome: 'imported',
      projectId: 'agent-demo',
      currentRevision: 1,
      asset: { id: 'interview', mediaHandleId: sourceHandle },
      jobs: [{ purpose: 'thumbnail' }, { purpose: 'waveform' }]
    })
    expect(JSON.stringify(imported)).not.toContain(harness.context.workspaceContext!.root)

    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo', expectedRevision: 1
    })
    expect(loaded.content).toMatchObject({
      outcome: 'loaded',
      project: {
        counts: { assets: 1, items: 1 },
        currentRevision: 1,
        playback: {
          mode: 'source-fast-path',
          sourceAssetId: 'interview',
          irDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
        }
      }
    })
    await harness.dispose()
  })

  it('runs revision-fenced local VAD, exposes cached evidence, applies only qualified silence, and reports beats unavailable', async () => {
    const harness = await projectWithTwoAudioAssets()
    const capabilities = await invoke(harness, 'video-analysis-status', {
      action: 'capabilities', projectId: 'audio-demo', expectedRevision: 2
    })
    expect(capabilities.content).toMatchObject({
      outcome: 'capabilities',
      denoiseMetadata: {
        outcome: 'unavailable',
        code: 'denoise_metadata_algorithm_unavailable',
        local: true,
        networkUsed: false
      },
      capabilities: {
        analyses: expect.arrayContaining([
          expect.objectContaining({ analysis: 'silence', available: true, networkUsed: false }),
          expect.objectContaining({ analysis: 'beat-grid', available: false, networkUsed: false })
        ])
      }
    })

    const pending = invoke(harness, 'video-analyze-audio', {
      action: 'vad', projectId: 'audio-demo', expectedRevision: 2, assetId: 'reference'
    })
    const jobId = await nextAudioAnalysisJob(harness)
    harness.jobs.start(jobId)
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      data: silenceAnalysisResult('fake_audio_reference_0001', 'a'.repeat(64)),
      generatedArtifacts: []
    })
    const analyzed = contentObject(await pending)
    expect(analyzed).toMatchObject({
      outcome: 'ready', currentRevision: 2,
      record: { kind: 'vad', silenceCount: 1, safeSuggestionCount: 1, immutable: true },
      evidence: {
        kind: 'vad', total: 1,
        evidence: [{ startUs: 200_000, endUs: 600_000, confidence: 1, disposition: 'safe-to-suggest' }]
      }
    })
    const analysisId = String((analyzed.record as JsonObject).id)
    const listed = await invoke(harness, 'video-analysis-status', {
      action: 'list', projectId: 'audio-demo', expectedRevision: 2
    })
    expect(listed.content).toMatchObject({
      records: [expect.objectContaining({ id: analysisId, kind: 'vad', currentGrant: true })]
    })

    const applied = await invoke(harness, 'video-analyze-audio', {
      action: 'vad-apply', projectId: 'audio-demo', expectedRevision: 2, analysisId
    })
    expect(applied.content).toMatchObject({
      outcome: 'applied', previousRevision: 2, currentRevision: 3, appliedRangeCount: 1,
      receipt: { attribution: { sourceOperation: 'audio-analysis.vad-apply' } }
    })
    await expect(invoke(harness, 'video-analyze-audio', {
      action: 'vad-apply', projectId: 'audio-demo', expectedRevision: 2, analysisId
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    const beat = await invoke(harness, 'video-analyze-audio', {
      action: 'beat-grid', projectId: 'audio-demo', expectedRevision: 3, assetId: 'reference'
    })
    expect(beat.content).toMatchObject({
      outcome: 'unavailable',
      code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
      local: true,
      networkUsed: false
    })
    const denoise = await invoke(harness, 'video-analyze-audio', {
      action: 'denoise-metadata', projectId: 'audio-demo', expectedRevision: 3,
      assetId: 'reference', confidenceThreshold: 0.7
    })
    expect(denoise.content).toMatchObject({
      outcome: 'unavailable',
      code: 'denoise_metadata_algorithm_unavailable',
      local: true,
      networkUsed: false
    })
    await expect(invoke(harness, 'video-analyze-audio', {
      action: 'denoise-metadata', projectId: 'audio-demo', expectedRevision: 3,
      assetId: 'reference', confidenceThreshold: 1.1
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect((await invoke(harness, 'video-project', {
      action: 'get', projectId: 'audio-demo', expectedRevision: 3
    })).content).toMatchObject({ project: { currentRevision: 3 } })
    expect(JSON.stringify({ analyzed, listed, applied, beat, denoise })).not.toContain(harness.context.workspaceContext!.root)
    await harness.dispose()
  })

  it('projects verified local beat/downbeat evidence as bounded path-opaque timeline snap targets', async () => {
    const harness = await projectWithTwoAudioAssets()
    harness.media.setAudioAnalysisCapabilities({
      schemaVersion: 1,
      probedAt: '2026-01-01T00:00:00.000Z',
      analyses: [
        {
          analysis: 'silence', available: true,
          algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        {
          analysis: 'beat-grid', available: true,
          algorithm: 'kun.pcm-onset-autocorrelation', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        {
          analysis: 'sync-features', available: true,
          algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        }
      ]
    })
    const pending = invoke(harness, 'video-analyze-audio', {
      action: 'beat-grid', projectId: 'audio-demo', expectedRevision: 2, assetId: 'reference'
    })
    const jobId = await nextAudioAnalysisJob(harness)
    harness.jobs.start(jobId)
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      data: beatAnalysisResult('fake_audio_reference_0001', 'b'.repeat(64)),
      generatedArtifacts: []
    })
    const analyzed = contentObject(await pending)
    expect(analyzed).toMatchObject({
      outcome: 'ready',
      record: {
        kind: 'beat-grid',
        markerCount: 2,
        tempoBpm: 120,
        snapTargets: [
          expect.objectContaining({ frame: 15, kind: 'downbeat', confidence: 0.91 }),
          expect.objectContaining({ frame: 30, kind: 'beat', confidence: 0.86 })
        ],
        snapTargetsTruncated: false,
        immutable: true
      }
    })
    const targets = (analyzed.record as JsonObject).snapTargets as JsonObject[]
    expect(targets.every(({ id }) => /^beat-[a-f0-9]{32}$/u.test(String(id)))).toBe(true)
    expect(JSON.stringify(analyzed)).not.toMatch(/(?:\/Users\/|\/private\/|\/tmp\/|mediaHandleId)/u)

    const listed = contentObject(await invoke(harness, 'video-analysis-status', {
      action: 'list', projectId: 'audio-demo', expectedRevision: 2
    }))
    expect(listed).toMatchObject({
      records: [expect.objectContaining({
        kind: 'beat-grid', currentGrant: true,
        snapTargets: expect.arrayContaining([expect.objectContaining({ frame: 15, kind: 'downbeat' })])
      })]
    })
    await harness.dispose()
  })

  it('keeps visual indexing explicitly opt-in and reports a missing verified Host package without accepting locations', async () => {
    const harness = await projectWithMedia()
    const initial = await invoke(harness, 'video-analysis-status', {
      action: 'capabilities', projectId: 'agent-demo', expectedRevision: 1
    })
    expect(initial.content).toMatchObject({
      outcome: 'capabilities',
      visual: {
        optIn: false,
        state: 'disabled',
        code: 'visual_model_disabled',
        local: true,
        networkUsedForInference: false,
        rawPathsExposed: false,
        urlsAccepted: false
      }
    })
    const disabled = await invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview'
    })
    expect(disabled.content).toMatchObject({
      outcome: 'unavailable',
      capability: { code: 'visual_model_disabled', state: 'disabled' }
    })
    await expect(invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview',
      modelUrl: 'https://example.invalid/model.bin'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    const optedIn = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.visual-opt-in',
      payload: { projectId: 'agent-demo', expectedRevision: 1, enabled: true }
    })
    expect(optedIn.content).toMatchObject({
      outcome: 'enabled',
      capability: {
        optIn: true,
        state: 'missing',
        code: 'visual_model_missing',
        installSupported: false,
        rawPathsExposed: false,
        urlsAccepted: false
      }
    })
    const install = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.visual-install',
      payload: { projectId: 'agent-demo', expectedRevision: 1 }
    })
    expect(install.content).toMatchObject({
      outcome: 'unavailable',
      capability: { state: 'missing', code: 'visual_model_missing' }
    })
    const unavailable = await invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview',
      intervalUs: 2_000_000, maxFrames: 240, allowPartial: false
    })
    expect(unavailable.content).toMatchObject({
      outcome: 'unavailable',
      capability: {
        state: 'missing',
        code: 'visual_model_missing',
        local: true,
        networkUsedForInference: false
      }
    })
    expect(JSON.stringify({ initial, disabled, optedIn, install, unavailable }))
      .not.toMatch(/(?:https?:\/\/|file:\/\/|\/(?:Users|private|tmp)\/)/u)
    await harness.dispose()
  })

  it('lets the Agent index and search measured local visual evidence only after a manual opt-in and verified install', async () => {
    const harness = await projectWithMedia()
    const missing = visualModelStatus('missing')
    const installed = visualModelStatus('installed')
    harness.media.setVisualModelStatus(missing)
    harness.transport.handle('media.installVisualModel', () => {
      harness.media.setVisualModelStatus(installed)
      return installed
    })
    harness.transport.handle('media.analyzeVisualFrames', (params) => {
      const request = MediaAnalyzeVisualFramesRequestSchema.parse(params)
      return {
        outcome: 'ready',
        source: {
          handleId: request.inputHandleId,
          fingerprint: 'c'.repeat(64),
          fingerprintAlgorithm: 'sha256-file-identity-v1'
        },
        adapter: request.adapter,
        embeddings: request.samples.map((sample, index) => ({
          sampleId: sample.sampleId,
          vector: index === 0
            ? [1, ...Array.from({ length: 23 }, () => 0)]
            : [0, 1, ...Array.from({ length: 22 }, () => 0)]
        })),
        provenance: {
          algorithm: 'kun.rgb-edge-features', algorithmVersion: '1.0.0',
          decodedFrameWidth: 32, decodedFrameHeight: 32,
          local: true, networkUsed: false
        }
      }
    })
    harness.transport.handle('media.embedVisualQuery', (params) => {
      const request = MediaEmbedVisualQueryRequestSchema.parse(params)
      if (request.query !== 'red') {
        return {
          outcome: 'unavailable', code: 'VISUAL_QUERY_UNSUPPORTED',
          remediation: 'Use supported measured color, brightness, contrast, or edge concepts.',
          retryable: false, local: true, networkUsed: false
        }
      }
      return {
        outcome: 'ready', adapter: request.adapter,
        vector: [1, ...Array.from({ length: 23 }, () => 0)],
        matchedConcepts: ['red'], scoreSemantics: 'uncalibrated-cosine',
        local: true, networkUsed: false
      }
    })

    const beforeOptIn = await invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview', maxFrames: 2
    })
    expect(beforeOptIn.content).toMatchObject({
      outcome: 'unavailable', capability: { code: 'visual_model_disabled' }
    })
    await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.visual-opt-in',
      payload: { projectId: 'agent-demo', expectedRevision: 1, enabled: true }
    })
    const installedResult = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.visual-install',
      payload: { projectId: 'agent-demo', expectedRevision: 1 }
    })
    expect(installedResult.content).toMatchObject({
      outcome: 'ready',
      capability: {
        state: 'ready', packageSource: 'bundled', local: true, networkUsedForInference: false,
        verification: {
          brokerAttested: true, downloadVerified: false,
          sourceVerified: true,
          installVerified: true, signatureVerified: true, manifestVerified: true
        }
      }
    })

    const indexed = await invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview',
      intervalUs: 1_500_000, maxFrames: 2, allowPartial: false
    })
    expect(indexed.content).toMatchObject({
      outcome: 'ready', deduplicated: false,
      record: {
        kind: 'visual-index', immutable: true,
        indexedSampleCount: 2, plannedSampleCount: 2,
        adapterId: 'kun.local.visual-features', modelId: 'kun-visual-features'
      }
    })
    const indexId = String(contentObject(indexed).record &&
      (contentObject(indexed).record as JsonObject).id)
    expect(indexId).toMatch(/^visual-index:/u)

    const searched = await invoke(harness, 'video-analysis-status', {
      action: 'visual-search', projectId: 'agent-demo', expectedRevision: 1,
      analysisId: indexId, query: 'red', pageSize: 20
    })
    expect(searched.content).toMatchObject({
      outcome: 'ready',
      page: {
        completeness: 'complete',
        ranking: { semantics: 'uncalibrated-cosine', calibratedConfidence: false, local: true, networkUsed: false }
      }
    })
    const searchedPage = contentObject(searched).page as JsonObject
    expect(searchedPage.results).toEqual(expect.arrayContaining([expect.objectContaining({
      assetId: 'interview', indexId,
      sourceRange: expect.objectContaining({ assetId: 'interview' })
    })]))
    const unsupported = await invoke(harness, 'video-analysis-status', {
      action: 'visual-search', projectId: 'agent-demo', expectedRevision: 1,
      analysisId: indexId, query: 'person smiling'
    })
    expect(unsupported.content).toMatchObject({
      outcome: 'unavailable', code: 'visual_query_unsupported',
      local: true, networkUsed: false
    })

    const repeated = await invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview',
      intervalUs: 1_500_000, maxFrames: 2, allowPartial: false
    })
    expect(repeated.content).toMatchObject({
      outcome: 'ready', deduplicated: true,
      record: { id: indexId, immutable: true }
    })
    const progress = harness.webview.messages
      .filter(isJsonObject)
      .filter((message) => message.channel === 'kun-video-editor.media-intelligence-progress')
      .map((message) => message.payload as JsonObject)
      .filter((message) => message.kind === 'visual-index')
    expect(progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'running', completed: 0, total: 2 }),
      expect.objectContaining({ status: 'ready', completed: 2, total: 2 })
    ]))
    expect(JSON.stringify({ installedResult, indexed, searched, unsupported, repeated, progress }))
      .not.toMatch(/(?:https?:\/\/|file:\/\/|\/(?:Users|private|tmp)\/|mediaHandleId)/u)
    await harness.dispose()
  })

  it('cancels an Agent visual-index operation without publishing a partial immutable record', async () => {
    const harness = await projectWithMedia()
    harness.media.setVisualModelStatus(visualModelStatus('installed'))
    await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.visual-opt-in',
      payload: { projectId: 'agent-demo', expectedRevision: 1, enabled: true }
    })
    harness.transport.handle('media.analyzeVisualFrames', async (params, options) => {
      MediaAnalyzeVisualFramesRequestSchema.parse(params)
      await new Promise<never>((_resolve, reject) => {
        const abort = (): void => reject(new ExtensionApiError({
          code: 'CANCELLED', message: 'Measured frame analysis cancelled',
          operation: 'media.analyzeVisualFrames', retryable: false
        }))
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    })
    const pending = invoke(harness, 'video-analyze-visual', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview', maxFrames: 2
    })
    const operationId = await waitForVisualOperation(harness)
    const cancelled = await invoke(harness, 'video-analysis-cancel', {
      projectId: 'agent-demo', expectedRevision: 1, operationId
    })
    expect(cancelled.content).toMatchObject({ outcome: 'cancelled', operationId, accepted: true })
    expect((await pending).content).toMatchObject({ outcome: 'cancelled', operationId })
    const listed = await invoke(harness, 'video-analysis-status', {
      action: 'list', projectId: 'agent-demo', expectedRevision: 1
    })
    expect(listed.content).toMatchObject({ outcome: 'listed', records: [] })
    const terminal = harness.webview.messages
      .filter(isJsonObject)
      .filter((message) => message.channel === 'kun-video-editor.media-intelligence-progress')
      .map((message) => message.payload as JsonObject)
      .filter((message) => message.operationId === operationId)
      .at(-1)
    expect(terminal).toMatchObject({ status: 'cancelled' })
    await harness.dispose()
  })

  it('imports reviewed speaker evidence in the sidebar and lets the Agent preview/apply safe attribution', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-transcribe', {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview',
      transcriptId: 'transcript-speakers', mode: 'import', format: 'json', language: 'en',
      segments: [
        { id: 'segment-alice', startUs: 0, endUs: 1_000_000, text: 'Welcome' },
        { id: 'segment-unknown', startUs: 1_000_000, endUs: 2_000_000, text: 'Hello' }
      ]
    })
    const local = await invoke(harness, 'video-analyze-audio', {
      action: 'speaker', projectId: 'agent-demo', expectedRevision: 2, assetId: 'interview'
    })
    expect(local.content).toMatchObject({
      outcome: 'unavailable',
      importAvailable: true,
      local: true,
      networkUsed: false
    })
    expect(JSON.stringify(local)).not.toMatch(/speakerId.*(?:Alice|Bob)/u)

    const document: JsonObject = {
      schemaVersion: 1,
      adapterId: 'kun.imported-speaker-labels',
      identities: [{ id: 'speaker-alice', label: 'Alice', aliases: ['Host'], sourceEvidenceIds: ['review-alice'] }],
      turns: [
        { id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified', speakerId: 'speaker-alice', confidence: 0.98 },
        { id: 'turn-unknown', startUs: 1_000_000, endUs: 2_000_000, status: 'unknown', confidence: 0.9 }
      ],
      confidenceThreshold: 0.7,
      completeness: 'complete'
    }
    await expect(harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.speaker-import',
      payload: {
        projectId: 'agent-demo', expectedRevision: 2, assetId: 'interview',
        document: { ...document, sourcePath: '/private/tmp/do-not-read.wav' }
      }
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const imported = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'analysis.speaker-import',
      payload: { projectId: 'agent-demo', expectedRevision: 2, assetId: 'interview', document }
    })
    expect(imported.content).toMatchObject({
      outcome: 'ready',
      record: { kind: 'speaker-diarization', turnCount: 2, identifiedTurnCount: 1, uncertainTurnCount: 1 },
      identities: [expect.objectContaining({ id: 'speaker-alice', label: 'Alice' })],
      evidence: {
        kind: 'speaker-diarization',
        evidence: [
          expect.objectContaining({ speakerId: 'speaker-alice', speakerLabel: 'Alice', uncertain: false }),
          expect.objectContaining({ uncertain: true, reason: 'unknown-speaker' })
        ]
      }
    })
    const analysisId = String((contentObject(imported).record as JsonObject).id)
    const listed = await invoke(harness, 'video-analysis-status', {
      action: 'list', projectId: 'agent-demo', expectedRevision: 2
    })
    expect(listed.content).toMatchObject({
      records: [expect.objectContaining({ id: analysisId, kind: 'speaker-diarization', currentGrant: true })]
    })
    const preview = await invoke(harness, 'video-analyze-audio', {
      action: 'speaker-attribution-preview', projectId: 'agent-demo', expectedRevision: 2, analysisId
    })
    expect(preview.content).toMatchObject({
      outcome: 'preview',
      plan: { analysisId, transcriptSegmentCount: 2, identifiedCount: 1, uncertainCount: 1 },
      transcriptSegments: [
        expect.objectContaining({ segmentId: 'segment-alice', status: 'identified', speakerLabel: 'Alice' }),
        expect.objectContaining({ segmentId: 'segment-unknown', status: 'unknown' })
      ]
    })
    const applied = await invoke(harness, 'video-analyze-audio', {
      action: 'speaker-attribution-apply', projectId: 'agent-demo', expectedRevision: 2, analysisId
    })
    expect(applied.content).toMatchObject({
      outcome: 'applied', currentRevision: 3,
      applied: { transcriptSegments: 2, identified: 1, uncertain: 1 },
      receipt: { attribution: { sourceOperation: 'audio-analysis.speaker-attribution-apply' } }
    })
    const loaded = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo', expectedRevision: 3
    }))
    const transcripts = (loaded.project as JsonObject).transcripts as JsonObject[]
    expect((transcripts[0]!.segments as JsonObject[])).toEqual([
      expect.objectContaining({ speakerAttribution: expect.objectContaining({ status: 'identified', speakerLabel: 'Alice' }) }),
      expect.objectContaining({ speakerAttribution: expect.objectContaining({ status: 'unknown' }) })
    ])
    expect(JSON.stringify(loaded)).not.toContain(harness.context.workspaceContext!.root)

    await expect(invoke(harness, 'video-analyze-audio', {
      action: 'speaker-import', projectId: 'agent-demo', expectedRevision: 3,
      assetId: 'interview', document
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await harness.dispose()
  })

  it('previews seeded audio sync, commits one qualified move, and refuses uncertain evidence without mutation', async () => {
    const harness = await projectWithTwoAudioAssets()
    const referenceFeatures = [0.2, 0.8, 0.1, 0.5, 0.9, 0.3, 0.7, 0.05, 0.6, 0.4, 0.85, 0.15, 0.55, 0.25, 0.95, 0.35]
    const pending = invoke(harness, 'video-analyze-audio', {
      action: 'sync-preview', projectId: 'audio-demo', expectedRevision: 2,
      referenceAssetId: 'reference', targetAssetId: 'target',
      referenceItemId: 'item-reference', targetItemId: 'item-target',
      seed: 42, maximumOffsetUs: 500_000, threshold: 0.9, minimumSeparation: 0.01
    })
    const jobId = await nextAudioAnalysisJob(harness)
    harness.jobs.start(jobId)
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      data: syncAnalysisResult(
        'fake_audio_reference_0001',
        'fake_audio_target_0000001',
        42,
        referenceFeatures,
        [0, 0, ...referenceFeatures]
      ),
      generatedArtifacts: []
    })
    const previewed = contentObject(await pending)
    expect(previewed).toMatchObject({
      outcome: 'ready', currentRevision: 2,
      preview: { outcome: 'ready', targetFrameBefore: 90, targetFrameAfter: 84, deltaFrames: -6 }
    })
    const analysisId = String((previewed.record as JsonObject).id)
    const applied = await invoke(harness, 'video-analyze-audio', {
      action: 'sync-apply', projectId: 'audio-demo', expectedRevision: 2,
      analysisId, referenceItemId: 'item-reference', targetItemId: 'item-target'
    })
    expect(applied.content).toMatchObject({ outcome: 'applied', currentRevision: 3 })
    const moved = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'audio-demo', expectedRevision: 3
    }))
    expect(((moved.project as JsonObject).items as JsonObject[])
      .find(({ id }) => id === 'item-target')).toMatchObject({ timelineStartFrame: 84 })

    const uncertainPending = invoke(harness, 'video-analyze-audio', {
      action: 'sync-preview', projectId: 'audio-demo', expectedRevision: 3,
      referenceAssetId: 'reference', targetAssetId: 'target',
      referenceItemId: 'item-reference', targetItemId: 'item-target',
      seed: 43, maximumOffsetUs: 500_000, threshold: 0.9, minimumSeparation: 0.03
    })
    const uncertainJobId = await nextAudioAnalysisJob(harness, new Set([jobId]))
    harness.jobs.start(uncertainJobId)
    harness.jobs.complete(uncertainJobId, {
      schemaVersion: 1,
      data: syncAnalysisResult(
        'fake_audio_reference_0001',
        'fake_audio_target_0000001',
        43,
        Array(16).fill(1),
        Array(18).fill(1)
      ),
      generatedArtifacts: []
    })
    const uncertain = contentObject(await uncertainPending)
    expect(uncertain).toMatchObject({
      outcome: 'uncertain',
      preview: { outcome: 'uncertain', refusalReason: 'ambiguous-correlation' }
    })
    const refused = await invoke(harness, 'video-analyze-audio', {
      action: 'sync-apply', projectId: 'audio-demo', expectedRevision: 3,
      analysisId: String((uncertain.record as JsonObject).id),
      referenceItemId: 'item-reference', targetItemId: 'item-target'
    })
    expect(refused.content).toMatchObject({ outcome: 'refused', code: 'AUDIO_SYNC_UNCERTAIN', currentRevision: 3 })
    const unchanged = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'audio-demo', expectedRevision: 3
    }))
    expect(((unchanged.project as JsonObject).items as JsonObject[])
      .find(({ id }) => id === 'item-target')).toMatchObject({ timelineStartFrame: 84 })
    await harness.dispose()
  })

  it('runs, reconciles, reports, and cleans sidebar-derived media without exposing paths', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_derived_waveform_0001'
    harness.media.addHandle(mediaHandle(outputHandle, 'export', 'waveform.png', 'image'))
    const started = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 1,
        assetId: 'interview',
        kind: 'waveform',
        outputHandleId: outputHandle,
        priority: 'interactive',
        parameters: { width: 1200, height: 240 }
      }
    })
    expect(started.content).toMatchObject({
      outcome: 'queued',
      projectId: 'agent-demo',
      currentRevision: 1,
      record: {
        kind: 'waveform',
        status: 'running',
        generation: expect.any(Number),
        statusGeneration: expect.any(Number)
      },
      jobId: expect.any(String)
    })
    const startedContent = contentObject(started)
    const record = startedContent.record as JsonObject
    const jobId = String(startedContent.jobId)
    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    const partialOutputHandle = String((request.outputs as JsonObject).derived)
    expect(request).toMatchObject({
      inputs: { source: 'fake_media_source_0001' },
      outputs: { derived: expect.stringMatching(/^fake_cache_target_/u) },
      metadata: {
        derivedId: record.id,
        dedupeKey: expect.any(String),
        derivedKind: 'waveform',
        priority: 'interactive',
        derivedPhase: 'partial',
        derivedPhaseIndex: 0,
        derivedPhaseCount: 2
      }
    })
    expect(request.arguments).toEqual(expect.arrayContaining(['{{input:source}}', '{{output:derived}}']))
    expect(JSON.stringify(request)).not.toContain(harness.context.workspaceContext!.root)

    harness.jobs.start(jobId)
    const partialArtifactHandle = 'fake_derived_wave_partial_01'
    harness.media.addHandle({
      ...mediaHandle(partialArtifactHandle, 'read', 'waveform-partial.png', 'image'),
      byteSize: 1024,
      completionIdentity: 'derived-waveform-partial'
    })
    const partialArtifact = createGeneratedArtifactFixture({
      artifactId: `artifact_derived_${createSafeSuffix(jobId)}`,
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: partialArtifactHandle,
      displayName: 'waveform-partial.png',
      mediaKind: 'image',
      mimeType: 'image/png',
      byteSize: 1024,
      completionIdentity: 'derived-waveform-partial',
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: request.metadata as JsonObject
      }
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [partialArtifact] })
    const competingExport = harness.jobs.create('media.ffmpeg', 'media.startFfmpegJob')
    harness.jobs.start(competingExport.id)

    const partialListed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list',
      payload: { projectId: 'agent-demo' }
    })
    expect(partialListed.content).toMatchObject({
      outcome: 'listed',
      records: [{
        id: record.id,
        kind: 'waveform',
        status: 'partial',
        artifactHandleId: partialArtifactHandle,
        progress: { completed: 1, total: 2, unit: 'phase' },
        jobId: null
      }]
    })
    expect(harness.transport.requests.filter(({ method }) => method === 'media.startFfmpegJob'))
      .toHaveLength(1)

    harness.jobs.complete(competingExport.id)
    const resumed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list',
      payload: { projectId: 'agent-demo' }
    })
    expect(resumed.content).toMatchObject({
      records: [{
        id: record.id,
        status: 'partial',
        artifactHandleId: partialArtifactHandle,
        jobId: expect.any(String)
      }]
    })
    const finalRequest = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    expect(finalRequest).toMatchObject({
      outputs: { derived: outputHandle },
      metadata: {
        derivedId: record.id,
        derivedPhase: 'final',
        derivedPhaseIndex: 1,
        derivedPhaseCount: 2
      }
    })
    const finalJobId = String((contentObject(resumed).records as JsonObject[])[0]!.jobId)
    harness.jobs.start(finalJobId)
    harness.media.addHandle({
      ...mediaHandle(outputHandle, 'read', 'waveform.png', 'image'),
      byteSize: 4096,
      completionIdentity: 'derived-waveform-complete'
    })
    const artifact = createGeneratedArtifactFixture({
      artifactId: `artifact_derived_${createSafeSuffix(finalJobId)}`,
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: outputHandle,
      displayName: 'waveform.png',
      mediaKind: 'image',
      mimeType: 'image/png',
      byteSize: 4096,
      completionIdentity: 'derived-waveform-complete',
      provenance: {
        jobId: finalJobId,
        operation: 'media.startFfmpegJob',
        metadata: finalRequest.metadata as JsonObject
      }
    })
    harness.jobs.complete(finalJobId, { schemaVersion: 1, generatedArtifacts: [artifact] })

    const listed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list',
      payload: { projectId: 'agent-demo' }
    })
    expect(listed.content).toMatchObject({
      outcome: 'listed',
      records: [{
        id: record.id,
        kind: 'waveform',
        status: 'ready',
        artifactHandleId: outputHandle,
        bytes: 4096,
        generation: expect.any(Number),
        statusGeneration: expect.any(Number)
      }],
      usage: { usedBytes: 4096, readyBytes: 4096, recordCount: 1 }
    })
    const ready = (contentObject(listed).records as JsonObject[])[0]!
    expect(ready.artifactHandleId).toBe(outputHandle)
    expect(JSON.stringify(ready)).not.toContain(harness.context.workspaceContext!.root)
    expect(Number(ready.generation)).toBeGreaterThan(Number(record.generation))
    expect(ready.statusGeneration).toBe(ready.generation)
    expect(harness.webview.messages).toContainEqual({
      channel: 'kun-video-editor.derived-changed',
      payload: expect.objectContaining({
        projectId: 'agent-demo',
        generation: ready.generation,
        statusGeneration: ready.statusGeneration,
        reason: 'ready'
      })
    })

    const cleaned = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.cleanup',
      payload: { projectId: 'agent-demo', includeReady: true }
    })
    expect(cleaned.content).toMatchObject({
      outcome: 'cleaned',
      removedIds: [record.id],
      usage: { usedBytes: 0, recordCount: 0 }
    })
    expect(harness.media.handles.get(outputHandle)?.revoked).toBe(true)
    await harness.dispose()
  })

  it('yields derived work to active exports, deduplicates it, resumes it, and cancels durably', async () => {
    const harness = await projectWithMedia()
    const exportJob = harness.jobs.create('media.ffmpeg', 'media.startFfmpegJob')
    harness.jobs.start(exportJob.id)
    const requestCount = () => harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob').length
    const startCount = requestCount()
    const payload = {
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetId: 'interview',
      kind: 'filmstrip',
      priority: 'background',
      parameters: { width: 960, filmstripIntervalUs: 1_000_000 }
    }
    const queued = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start', payload
    })
    const queuedRecord = contentObject(queued).record as JsonObject
    expect(queued.content).toMatchObject({
      outcome: 'queued',
      jobId: null,
      record: { kind: 'filmstrip', status: 'queued', jobId: null }
    })
    expect(requestCount()).toBe(startCount)

    const duplicate = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start', payload
    })
    expect(duplicate.content).toMatchObject({
      outcome: 'deduplicated',
      jobId: null,
      record: { id: queuedRecord.id, status: 'queued' }
    })
    expect(requestCount()).toBe(startCount)

    harness.jobs.complete(exportJob.id)
    const resumed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list', payload: { projectId: 'agent-demo' }
    })
    const resumedRecord = (contentObject(resumed).records as JsonObject[])[0]!
    expect(resumedRecord).toMatchObject({
      id: queuedRecord.id,
      status: 'running',
      jobId: expect.any(String)
    })
    expect(requestCount()).toBe(startCount + 1)

    const cancelled = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.cancel',
      payload: { projectId: 'agent-demo', recordId: queuedRecord.id }
    })
    expect(cancelled.content).toMatchObject({
      outcome: 'cancelled',
      record: { id: queuedRecord.id, status: 'cancelled', artifactHandleId: null }
    })
    expect(harness.jobs.get(String(resumedRecord.jobId)).state).toBe('cancelled')
    const cacheTargets = [...harness.media.handles.values()]
      .filter(({ handleId }) => handleId.startsWith('fake_cache_target_'))
    expect(cacheTargets).toHaveLength(2)
    expect(cacheTargets.every(({ revoked }) => revoked)).toBe(true)
    expect(harness.storage.workspace.has(`derived-media:output:${String(queuedRecord.id)}`)).toBe(false)
    await harness.dispose()
  })

  it('reconciles an in-flight Host cache job after service restart and publishes the final artifact', async () => {
    const harness = await projectWithMedia()
    const started = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start',
      payload: {
        projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview', kind: 'thumbnail'
      }
    })
    const startedContent = contentObject(started)
    const record = startedContent.record as JsonObject
    const jobId = String(startedContent.jobId)
    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    const outputHandle = String((request.outputs as JsonObject).derived)
    expect(outputHandle).toMatch(/^fake_cache_target_/u)

    const restarted = new DerivedMediaService(harness.context)
    await expect(restarted.list('agent-demo')).resolves.toMatchObject({
      records: [{ id: record.id, status: 'running', jobId }]
    })

    harness.jobs.start(jobId)
    const artifact = imageDerivedArtifact(harness, {
      jobId,
      handleId: outputHandle,
      displayName: 'thumbnail.png',
      byteSize: 2048,
      metadata: request.metadata as JsonObject
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })
    const listed = await restarted.list('agent-demo')
    expect(listed).toMatchObject({
      records: [{
        id: record.id,
        kind: 'thumbnail',
        status: 'ready',
        artifactHandleId: outputHandle,
        bytes: 2048
      }]
    })
    expect(harness.storage.workspace.has(`derived-media:output:${String(record.id)}`)).toBe(false)
    await restarted.cleanup('agent-demo', true)
    expect(harness.media.handles.get(outputHandle)?.revoked).toBe(true)
    await harness.dispose()
  })

  it('rejects a mismatched derived phase and applies bounded retry backoff without reallocating cache', async () => {
    const harness = await projectWithMedia()
    const payload = {
      projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview', kind: 'thumbnail'
    }
    const started = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start', payload
    })
    const startedContent = contentObject(started)
    const record = startedContent.record as JsonObject
    const jobId = String(startedContent.jobId)
    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    const outputHandle = String((request.outputs as JsonObject).derived)
    harness.jobs.start(jobId)
    const artifact = imageDerivedArtifact(harness, {
      jobId,
      handleId: outputHandle,
      displayName: 'thumbnail.png',
      byteSize: 1024,
      metadata: { ...(request.metadata as JsonObject), derivedPhase: 'partial' }
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })

    const failed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list', payload: { projectId: 'agent-demo' }
    })
    expect(failed.content).toMatchObject({
      records: [{
        id: record.id,
        status: 'failed',
        error: { code: 'invalid_output', retryable: true },
        retryAfter: expect.any(String),
        artifactHandleId: null
      }]
    })
    expect(harness.media.handles.get(outputHandle)?.revoked).toBe(true)
    expect(harness.storage.workspace.has(`derived-media:output:${String(record.id)}`)).toBe(false)
    const cacheAllocations = harness.transport.requests
      .filter(({ method }) => method === 'media.createCacheTarget').length
    const jobStarts = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob').length

    const backedOff = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start', payload
    })
    expect(backedOff.content).toMatchObject({
      outcome: 'backoff',
      jobId: jobId,
      record: { id: record.id, status: 'failed', retryAfter: expect.any(String) }
    })
    expect(harness.transport.requests.filter(({ method }) => method === 'media.createCacheTarget'))
      .toHaveLength(cacheAllocations)
    expect(harness.transport.requests.filter(({ method }) => method === 'media.startFfmpegJob'))
      .toHaveLength(jobStarts)
    await harness.dispose()
  })

  it('fails oversized derived results at the cache quota and releases their Host cache grant', async () => {
    const harness = await projectWithMedia()
    const started = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start',
      payload: {
        projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview', kind: 'thumbnail',
        parameters: { seekUs: 1_000_000 }
      }
    })
    const startedContent = contentObject(started)
    const record = startedContent.record as JsonObject
    const jobId = String(startedContent.jobId)
    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    const outputHandle = String((request.outputs as JsonObject).derived)
    harness.jobs.start(jobId)
    const artifact = imageDerivedArtifact(harness, {
      jobId,
      handleId: outputHandle,
      displayName: 'oversized-thumbnail.png',
      byteSize: 2 * 1024 * 1024 * 1024 + 1,
      metadata: request.metadata as JsonObject
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })

    const listed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list', payload: { projectId: 'agent-demo' }
    })
    expect(listed.content).toMatchObject({
      records: [{
        id: record.id,
        status: 'failed',
        bytes: 0,
        error: { code: 'cache_quota', retryable: false },
        artifactHandleId: null
      }],
      usage: { usedBytes: 0, readyBytes: 0 }
    })
    expect(harness.media.handles.get(outputHandle)?.revoked).toBe(true)
    expect(harness.storage.workspace.has(`derived-media:output:${String(record.id)}`)).toBe(false)
    await harness.dispose()
  })

  it('returns an actionable ffprobe-unavailable outcome before selecting media or mutating a project', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'agent-demo', name: 'Agent Demo'
    })
    harness.media.setCapabilities({
      probedAt: new Date().toISOString(),
      ffprobe: { name: 'ffprobe', available: false, features: [] },
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        features: ['libx264-encoder', 'aac-encoder', 'drawtext-filter']
      }
    })

    const unavailable = await invoke(harness, 'video-probe', {
      projectId: 'agent-demo', expectedRevision: 0
    })
    expect(unavailable.content).toMatchObject({
      outcome: 'unavailable',
      code: 'FFPROBE_UNAVAILABLE',
      projectId: 'agent-demo',
      currentRevision: 0,
      changedIds: [],
      retryable: true
    })
    expect(String(contentObject(unavailable).message)).toContain('Install or configure ffprobe')
    expect(JSON.stringify(unavailable)).not.toContain(harness.context.workspaceContext!.root)

    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo'
    })
    expect(loaded.content).toMatchObject({
      project: { currentRevision: 0, counts: { assets: 0, items: 0 } }
    })
    const mediaRequests = harness.transport.requests.map(({ method }) => method)
    expect(mediaRequests.filter((method) => method === 'media.getCapabilities')).toHaveLength(1)
    expect(mediaRequests).not.toContain('media.pickFiles')
    expect(mediaRequests).not.toContain('media.probe')
    await harness.dispose()
  })

  it('keeps project.get pure and makes create/select the explicit active-project transitions', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'project-one', name: 'Project One'
    })
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'project-two', name: 'Project Two'
    })

    const beforeRead = await invoke(harness, 'video-project', { action: 'active' })
    expect(beforeRead.content).toMatchObject({ project: { id: 'project-two' } })
    const read = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'project-one'
    })
    expect(read.content).toMatchObject({ outcome: 'loaded', project: { id: 'project-one' } })
    const afterRead = await invoke(harness, 'video-project', { action: 'active' })
    expect(afterRead.content).toMatchObject({ project: { id: 'project-two' } })

    const selected = await invoke(harness, 'video-project', {
      action: 'select', projectId: 'project-one', expectedRevision: 0
    })
    expect(selected.content).toMatchObject({ outcome: 'selected', project: { id: 'project-one' } })
    const afterSelect = await invoke(harness, 'video-project', { action: 'active' })
    expect(afterSelect.content).toMatchObject({ project: { id: 'project-one' } })
    expect(harness.webview.messages).toContainEqual({
      channel: 'kun-video-editor.project-changed',
      payload: expect.objectContaining({
        projectId: 'project-one',
        activeProjectId: 'project-one',
        previousProjectId: 'project-two',
        revision: 0,
        reason: 'active-project-changed',
        transition: 'selected',
        source: 'agent'
      })
    })
    const manuallySelected = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'project.select',
      payload: { projectId: 'project-two' }
    })
    expect(manuallySelected.content).toMatchObject({
      outcome: 'selected', project: { id: 'project-two' }
    })
    expect(harness.webview.messages).toContainEqual({
      channel: 'kun-video-editor.project-changed',
      payload: expect.objectContaining({
        projectId: 'project-two',
        previousProjectId: 'project-one',
        reason: 'active-project-changed',
        transition: 'selected',
        source: 'manual'
      })
    })
    await harness.dispose()
  })

  it('returns explicit empty and stale active-project outcomes without guessing', async () => {
    const harness = await activatedHarness()
    const empty = await invoke(harness, 'video-project', { action: 'active' })
    expect(empty.content).toMatchObject({ outcome: 'no-active-project' })

    harness.storage.workspace.set('active-project', {
      schemaVersion: 1,
      projectId: 'missing-project'
    })
    const stale = await invoke(harness, 'video-project', { action: 'active' })
    expect(stale.content).toMatchObject({
      outcome: 'stale-active-project',
      projectId: 'missing-project'
    })
    expect(harness.storage.workspace.has('active-project')).toBe(false)
    await harness.dispose()
  })

  it('exposes bounded raw, project-window, composed, and revision-bound selection inspection', async () => {
    const harness = await projectWithMedia()

    const initialContext = await invoke(harness, 'video-inspect', { action: 'context' })
    expect(initialContext.content).toMatchObject({
      outcome: 'context',
      context: {
        status: 'empty',
        projectId: 'agent-demo',
        revision: 1,
        generation: 0,
        selectedItemIds: []
      }
    })

    const projectWindow = await invoke(harness, 'video-inspect', {
      action: 'project-window',
      projectId: 'agent-demo',
      expectedRevision: 1,
      startFrame: 0,
      endFrame: 90,
      itemLimit: 1,
      captionLimit: 1
    })
    expect(projectWindow.content).toMatchObject({
      outcome: 'project-window',
      window: {
        projectId: 'agent-demo',
        revision: 1,
        sequence: { id: 'sequence-main' },
        requestedRange: { startFrame: 0, endFrame: 90 },
        items: [expect.objectContaining({ assetId: 'interview' })],
        captionSummary: { visible: 0, returned: 0, hidden: 0 },
        hiddenCounts: expect.objectContaining({ itemsInWindow: 0 }),
        selection: { status: 'empty', generation: 0 }
      }
    })
    const compactItem = ((contentObject(projectWindow).window as JsonObject).items as JsonObject[])[0]!
    expect(compactItem).not.toHaveProperty('transform')
    expect(compactItem).not.toHaveProperty('opacity')
    expect(compactItem).not.toHaveProperty('speed')

    const rawBeforeTranscript = await invoke(harness, 'video-inspect', {
      action: 'raw-media',
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetId: 'interview',
      includeWords: true,
      sampleFrames: [0, 30, 30]
    })
    expect(rawBeforeTranscript.content).toMatchObject({
      outcome: 'raw-media',
      inspection: {
        asset: { id: 'interview', availability: 'online' },
        transcript: null,
        samples: [
          { frame: 0, status: 'unavailable' },
          { frame: 30, status: 'unavailable' }
        ],
        capability: {
          timedTranscript: 'missing',
          wordTimestamps: 'missing',
          sampledFrames: 'missing',
          visualUnderstanding: 'not-claimed'
        }
      }
    })

    const composed = await invoke(harness, 'video-inspect', {
      action: 'composed-frame',
      projectId: 'agent-demo',
      expectedRevision: 1,
      frame: 12
    })
    expect(composed.content).toMatchObject({
      outcome: 'composed-frame',
      inspection: {
        projectId: 'agent-demo',
        revision: 1,
        frame: 12,
        frameLabel: '00:00:00:12',
        visibleMediaLayers: [expect.objectContaining({ itemId: expect.any(String) })],
        proofArtifacts: [],
        proofStatus: 'missing'
      }
    })
    expect(composed.metadata).toMatchObject({
      technicallyValidated: false,
      visuallyInspected: false,
      proofStatus: 'missing'
    })

    const loaded = contentObject(await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo'
    })).project as JsonObject
    const selectedItemId = String((loaded.items as JsonObject[])[0]!.id)
    const updated = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'context.update',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 1,
        expectedGeneration: 0,
        sequenceId: 'sequence-main',
        playheadFrame: 12,
        selectedAssetIds: ['interview'],
        selectedItemIds: [selectedItemId],
        selectedCaptionIds: [],
        selectedWordIds: [],
        range: { startFrame: 10, endFrame: 20 }
      }
    })
    expect(updated.content).toMatchObject({
      outcome: 'context-updated',
      projectId: 'agent-demo',
      revision: 1,
      generation: 1,
      eventGeneration: 2,
      selection: {
        playheadFrame: 12,
        selectedAssetIds: ['interview'],
        selectedItemIds: [selectedItemId],
        range: { startFrame: 10, endFrame: 20 }
      }
    })
    expect(harness.webview.messages).toContainEqual({
      channel: 'kun-video-editor.selection-changed',
      payload: expect.objectContaining({
        projectId: 'agent-demo', revision: 1, generation: 1, eventGeneration: 2
      })
    })

    const current = await invoke(harness, 'video-inspect', {
      action: 'context', projectId: 'agent-demo', expectedRevision: 1, expectedGeneration: 1
    })
    expect(current.content).toMatchObject({
      context: {
        status: 'current',
        revision: 1,
        generation: 1,
        selectedItemIds: [selectedItemId]
      }
    })
    const stale = await invoke(harness, 'video-inspect', {
      action: 'context', projectId: 'agent-demo', expectedRevision: 1, expectedGeneration: 0
    })
    expect(stale.content).toMatchObject({
      context: { status: 'stale', staleReason: 'generation', generation: 1 }
    })
    await expect(harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'context.update',
      payload: {
        projectId: 'agent-demo', expectedRevision: 1, expectedGeneration: 0, playheadFrame: 20
      }
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      retryable: true,
      details: {
        engineCode: 'revision_conflict',
        expectedRevision: 1,
        currentRevision: 1,
        expectedGeneration: 0,
        currentGeneration: 1
      }
    })
    const afterSelection = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo'
    })
    expect(afterSelection.content).toMatchObject({
      project: { currentRevision: 1, eventGeneration: 2, selection: { generation: 1 } }
    })
    await harness.dispose()
  })

  it('pages timed word evidence after transcript import without claiming sampled visual review', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-transcribe', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetId: 'interview',
      transcriptId: 'transcript-main',
      mode: 'import',
      language: 'en',
      segments: [{
        id: 'segment-main',
        startUs: 0,
        endUs: 3_000_000,
        text: 'Hello video world',
        words: [
          { id: 'word-hello', startUs: 0, endUs: 700_000, text: 'Hello', confidence: 0.98 },
          { id: 'word-video', startUs: 700_000, endUs: 1_500_000, text: 'video', confidence: 0.95 },
          { id: 'word-world', startUs: 1_500_000, endUs: 3_000_000, text: 'world', confidence: 0.93 }
        ]
      }]
    })
    const raw = await invoke(harness, 'video-inspect', {
      action: 'raw-media',
      projectId: 'agent-demo',
      expectedRevision: 2,
      assetId: 'interview',
      transcriptId: 'transcript-main',
      segmentOffset: 0,
      segmentLimit: 1,
      includeWords: true,
      sampleFrames: [0]
    })
    expect(raw.content).toMatchObject({
      inspection: {
        transcript: {
          id: 'transcript-main',
          offset: 0,
          returned: 1,
          total: 1,
          wordsReturned: 3,
          wordsHidden: 0,
          segments: [{
            id: 'segment-main',
            words: expect.arrayContaining([
              expect.objectContaining({ id: 'word-hello', startUs: 0 })
            ])
          }]
        },
        capability: {
          timedTranscript: 'ready',
          wordTimestamps: 'ready',
          sampledFrames: 'missing',
          visualUnderstanding: 'not-claimed'
        }
      }
    })
    await harness.dispose()
  })

  it('generates rich transcript captions as one revision-bound View transaction', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-transcribe', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetId: 'interview',
      transcriptId: 'transcript-captions',
      mode: 'import',
      language: 'en',
      segments: [{
        id: 'segment-captions',
        startUs: 0,
        endUs: 3_000_000,
        text: 'Hello caption world',
        words: [
          { id: 'word-caption-hello', startUs: 0, endUs: 800_000, text: 'Hello' },
          { id: 'word-caption-caption', startUs: 800_000, endUs: 1_800_000, text: 'caption' },
          { id: 'word-caption-world', startUs: 1_800_000, endUs: 3_000_000, text: 'world' }
        ]
      }]
    })
    const generated = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'caption.generate',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 2,
        assetId: 'interview',
        trackId: 'captions-1',
        idPrefix: 'generated-caption',
        maxWords: 2,
        style: {
          fontSize: 40,
          color: '#FFFFFF',
          background: '#000000',
          fontFamily: 'sans-serif',
          fontWeight: 600,
          maxWidthRatio: 0.8
        },
        animation: { kind: 'word-highlight', durationFrames: 4 }
      }
    })
    expect(generated.content).toMatchObject({
      outcome: 'generated',
      projectId: 'agent-demo',
      previousRevision: 2,
      currentRevision: 3,
      generatedCount: 2,
      interpolatedWordCount: 0,
      receipt: {
        previousRevision: 2,
        newRevision: 3,
        attribution: { author: 'manual', sourceOperation: 'caption.generate' }
      },
      captions: expect.arrayContaining([expect.objectContaining({
        source: expect.objectContaining({
          transcriptId: 'transcript-captions', segmentIds: ['segment-captions']
        }),
        animation: { kind: 'word-highlight', durationFrames: 4 }
      })])
    })
    const durable = JSON.parse(await readFile(join(
      harness.context.workspaceContext!.root,
      '.kun-video/projects/agent-demo/project.json'
    ), 'utf8'))
    expect(durable.currentRevision).toBe(3)
    expect(durable.revisions.at(-1)).toMatchObject({
      parentRevision: 2,
      author: 'manual',
      sourceOperation: 'caption.generate'
    })
    expect(durable.captions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTranscriptId: 'transcript-captions',
        sourceSegmentIds: ['segment-captions'],
        style: expect.objectContaining({ fontFamily: 'sans-serif', fontWeight: 600, maxWidthRatio: 0.8 }),
        words: expect.arrayContaining([expect.objectContaining({ sourceWordId: 'word-caption-hello' })]),
        animation: { kind: 'word-highlight', durationFrames: 4 }
      })
    ]))
    expect(harness.webview.messages).toContainEqual({
      channel: 'kun-video-editor.project-changed',
      payload: expect.objectContaining({
        projectId: 'agent-demo',
        revision: 3,
        reason: 'captions-generated',
        receipt: expect.objectContaining({ newRevision: 3 })
      })
    })
    await harness.dispose()
  })

  it('imports timed transcripts, exposes a revision-bound script, and rejects stale script edits', async () => {
    const harness = await projectWithMedia()
    const transcript = await invoke(harness, 'video-transcribe', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetId: 'interview',
      transcriptId: 'transcript-main',
      mode: 'import',
      language: 'en',
      segments: [
        { id: 'hello', startUs: 0, endUs: 1_000_000, text: 'Hello' },
        { id: 'filler', startUs: 1_000_000, endUs: 1_400_000, text: 'um' },
        { id: 'world', startUs: 1_400_000, endUs: 3_000_000, text: 'world' }
      ]
    })
    expect(transcript.content).toMatchObject({
      outcome: 'transcribed', currentRevision: 2, changedIds: ['interview', 'transcript-main']
    })
    expect(JSON.stringify(transcript.content)).toContain('without network access')

    const script = await invoke(harness, 'video-read-script', {
      projectId: 'agent-demo', expectedRevision: 2
    })
    expect(script.content).toMatchObject({ outcome: 'script', currentRevision: 2, truncated: false })
    const markdown = String(contentObject(script).timelineMarkdown)
    expect(markdown).toContain('| `filler` |')

    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }]
    })
    await expect(invoke(harness, 'video-apply-script', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      timelineMarkdown: markdown,
      ranges: [{ assetId: 'interview', startUs: 1_000_000, endUs: 1_400_000, reason: 'filler' }]
    })).rejects.toMatchObject({ code: 'CONFLICT', details: { engineCode: 'revision_conflict' } })
    await harness.dispose()
  })

  it('requires continuous timed evidence before destructive Agent transcript edits', async () => {
    const harness = await projectWithMedia()
    await expect(invoke(harness, 'video-apply-script', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      timelineMarkdown: '# timeline\n',
      ranges: [{ assetId: 'interview', startUs: 0, endUs: 500_000, reason: 'selection' }]
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(invoke(harness, 'video-apply-script', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      timelineMarkdown: '# timeline\n',
      ranges: [{ assetId: 'interview', startUs: 0, endUs: 500_000, reason: 'selection' }]
    })).rejects.toThrow(/continuous timed transcript evidence/u)
    const loaded = await invoke(harness, 'video-project', { action: 'get', projectId: 'agent-demo' })
    expect(loaded.content).toMatchObject({ project: { currentRevision: 1 } })
    await harness.dispose()
  })

  it('returns attributable receipts and fences Agent undo after intervening manual work', async () => {
    const harness = await projectWithMedia()
    const agentEdit = await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }],
      summary: 'Agent portrait edit'
    })
    expect(agentEdit.content).toMatchObject({
      outcome: 'updated',
      previousRevision: 1,
      currentRevision: 2,
      receipt: {
        previousRevision: 1,
        newRevision: 2,
        generation: 2,
        attribution: {
          author: 'agent',
          actorId: 'kun-agent',
          sourceOperation: 'video-update-timeline'
        },
        proofInvalidated: true
      }
    })
    expect(harness.webview.messages).toContainEqual({
      channel: 'kun-video-editor.project-changed',
      payload: expect.objectContaining({
        projectId: 'agent-demo',
        revision: 2,
        generation: 2,
        selectionGeneration: 0,
        attribution: expect.objectContaining({ author: 'agent', actorId: 'kun-agent' }),
        proofInvalidated: true,
        receipt: expect.objectContaining({ newRevision: 2 })
      })
    })

    const undone = await invoke(harness, 'video-undo', {
      projectId: 'agent-demo', expectedRevision: 2
    })
    expect(undone.content).toMatchObject({
      outcome: 'undone', previousRevision: 2, currentRevision: 3,
      receipt: { attribution: { author: 'agent', actorId: 'kun-agent', sourceOperation: 'history.agent-undo' } }
    })
    const restored = await invoke(harness, 'video-project', { action: 'get', projectId: 'agent-demo' })
    expect(restored.content).toMatchObject({ project: { currentRevision: 3, canvas: { preset: '16:9' } } })

    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 3,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }]
    })
    await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'project.update',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 4,
        operations: [{ type: 'set-canvas', preset: '1:1', fit: 'crop' }],
        summary: 'Manual square edit'
      }
    })
    await expect(invoke(harness, 'video-undo', {
      projectId: 'agent-demo', expectedRevision: 5
    })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      retryable: false,
      details: { engineCode: 'agent_undo_fenced' }
    })
    const preserved = await invoke(harness, 'video-project', { action: 'get', projectId: 'agent-demo' })
    expect(preserved.content).toMatchObject({
      project: { currentRevision: 5, canvas: { preset: '1:1', fit: 'crop' } }
    })
    await harness.dispose()
  })

  it('serializes manual/Agent races and never overwrites a stale expected revision', async () => {
    const harness = await projectWithMedia()
    const first = invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }],
      summary: 'Portrait cut'
    })
    const second = invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{ type: 'set-canvas', preset: '1:1', fit: 'crop' }],
      summary: 'Square cut'
    })
    const outcomes = await Promise.allSettled([first, second])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'CONFLICT', details: { engineCode: 'revision_conflict' } }
    })
    const loaded = await invoke(harness, 'video-project', { action: 'get', projectId: 'agent-demo' })
    expect(loaded.content).toMatchObject({ project: { currentRevision: 2 } })
    await harness.dispose()
  })

  it('offers one bounded View RPC and records manual provenance with shared undo history', async () => {
    const harness = await projectWithMedia()
    const updated = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'project.update',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 1,
        operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }],
        summary: 'Manual portrait edit'
      }
    })
    expect(updated.content).toMatchObject({ outcome: 'updated', currentRevision: 2 })
    const projectAfterUpdate = JSON.parse(await readFile(join(
      harness.context.workspaceContext!.root,
      '.kun-video/projects/agent-demo/project.json'
    ), 'utf8'))
    expect(projectAfterUpdate.revisions.at(-1)).toMatchObject({
      author: 'manual', sourceOperation: 'video-update-timeline'
    })

    const undone = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'project.undo',
      payload: { projectId: 'agent-demo', expectedRevision: 2 }
    })
    expect(undone.content).toMatchObject({ outcome: 'undone', currentRevision: 3 })
    const projectAfterUndo = JSON.parse(await readFile(join(
      harness.context.workspaceContext!.root,
      '.kun-video/projects/agent-demo/project.json'
    ), 'utf8'))
    expect(projectAfterUndo).toMatchObject({ canvas: { preset: '16:9' }, currentRevision: 3 })
    expect(projectAfterUndo.revisions.at(-1)).toMatchObject({ author: 'manual', sourceOperation: 'history.undo' })
    await harness.dispose()
  })

  it('accepts schema-v2 track, item, and link operations through the strict Host boundary', async () => {
    const harness = await projectWithMedia()
    const addedItem = {
      id: 'item-interview-linked',
      assetId: 'interview',
      trackId: 'video-1',
      timelineStartFrame: 90,
      durationFrames: 90,
      sourceStartUs: 0,
      sourceEndUs: 3_000_000,
      speed: { numerator: 1, denominator: 1 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      fadeInFrames: 3,
      fadeOutFrames: 4,
      crop: { left: 0.05, top: 0, right: 0.05, bottom: 0 },
      volume: 1.25,
      muted: false,
      visible: true,
      locked: false,
      effects: [{ id: 'effect-interview', type: 'blur', enabled: false, parameters: { radius: 2 } }],
      keyframes: [{
        id: 'keyframes-interview',
        property: 'opacity',
        interpolation: 'linear',
        points: [
          { id: 'point-interview-0', frame: 0, value: 0.5 },
          { id: 'point-interview-1', frame: 30, value: 1 }
        ]
      }]
    }
    const updated = await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [
        { type: 'add-item', item: addedItem },
        {
          type: 'set-link-group',
          group: {
            id: 'link-interview', kind: 'sync',
            itemIds: ['item-interview', 'item-interview-linked'], locked: false
          }
        },
        { type: 'update-track-state', trackId: 'video-1', muted: true, syncLocked: true },
        {
          type: 'update-item-properties', itemId: 'item-interview',
          volume: 0.75, fadeInFrames: 2, fadeOutFrames: 5, muted: true, visible: false, locked: true
        }
      ]
    })
    expect(updated.content).toMatchObject({ outcome: 'updated', currentRevision: 2 })
    const durable = JSON.parse(await readFile(join(
      harness.context.workspaceContext!.root,
      '.kun-video/projects/agent-demo/project.json'
    ), 'utf8'))
    expect(durable.tracks.find(({ id }: { id: string }) => id === 'video-1')).toMatchObject({
      muted: true, syncLocked: true
    })
    expect(durable.items.find(({ id }: { id: string }) => id === 'item-interview')).toMatchObject({
      volume: 0.75, muted: true, visible: false, locked: true
    })
    expect(durable.items.find(({ id }: { id: string }) => id === 'item-interview-linked')).toMatchObject({
      crop: { left: 0.05, right: 0.05 },
      effects: [{ id: 'effect-interview' }],
      keyframes: [{ id: 'keyframes-interview' }]
    })
    expect(durable.linkGroups).toContainEqual(expect.objectContaining({
      id: 'link-interview', itemIds: ['item-interview', 'item-interview-linked']
    }))

    const removed = await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo', expectedRevision: 2,
      operations: [
        { type: 'update-item-properties', itemId: 'item-interview', locked: false },
        { type: 'delete-link-group', linkGroupId: 'link-interview' }
      ]
    })
    expect(removed.content).toMatchObject({ outcome: 'updated', currentRevision: 3 })
    await harness.dispose()
  })

  it('reauthorizes a revoked asset without changing timeline or transcript identity', async () => {
    const harness = await projectWithMedia()
    const derived = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.start',
      payload: {
        projectId: 'agent-demo', expectedRevision: 1, assetId: 'interview', kind: 'thumbnail'
      }
    })
    expect(derived.content).toMatchObject({
      outcome: 'queued',
      record: { status: 'running' },
      jobId: expect.any(String)
    })
    const derivedRecordId = String((contentObject(derived).record as JsonObject).id)
    const derivedJobId = String(contentObject(derived).jobId)
    const replacementHandle = 'fake_media_replacement_001'
    harness.media.addHandle(mediaHandle(replacementHandle, 'read', 'replacement.mp4', 'video'))
    harness.media.setProbe(replacementHandle, videoProbe(replacementHandle))

    const result = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'media.reauthorize',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 1,
        assetId: 'interview',
        mediaHandleId: replacementHandle
      }
    })
    expect(result.content).toMatchObject({
      outcome: 'reauthorized',
      currentRevision: 2,
      asset: { id: 'interview', mediaHandleId: replacementHandle }
    })
    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo'
    })
    expect(loaded.content).toMatchObject({
      project: {
        assets: [{ id: 'interview', mediaHandleId: replacementHandle }],
        items: [{ assetId: 'interview' }]
      }
    })
    const listed = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'derived.list', payload: { projectId: 'agent-demo' }
    })
    expect(listed.content).toMatchObject({
      records: [expect.objectContaining({
        id: derivedRecordId,
        status: 'invalid',
        jobId: null,
        bytes: 0,
        error: expect.objectContaining({ code: 'source_changed' })
      })]
    })
    expect(harness.jobs.get(derivedJobId).state).toBe('cancelled')
    await harness.dispose()
  })

  it('projects authoritative undo and redo availability instead of inferring it from revision', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'history-flags', name: 'History Flags'
    })
    await invoke(harness, 'video-update-timeline', {
      projectId: 'history-flags',
      expectedRevision: 0,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }]
    })
    const changed = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'history-flags'
    })
    expect(changed.content).toMatchObject({
      project: { currentRevision: 1, canUndo: true, canRedo: false }
    })

    const undone = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'project.undo',
      payload: { projectId: 'history-flags', expectedRevision: 1 }
    })
    expect(undone.content).toMatchObject({
      details: { project: { currentRevision: 2, canUndo: false, canRedo: true } }
    })
    const redone = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'project.redo',
      payload: { projectId: 'history-flags', expectedRevision: 2 }
    })
    expect(redone.content).toMatchObject({
      details: { project: { currentRevision: 3, canUndo: true, canRedo: false } }
    })
    await harness.dispose()
  })

  it('clears a damaged active project and still lists healthy projects with diagnostics', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'healthy-project', name: 'Healthy'
    })
    const projectsRoot = join(harness.context.workspaceContext!.root, '.kun-video/projects')
    await mkdir(join(projectsRoot, 'damaged-project'), { recursive: true })
    await writeFile(join(projectsRoot, 'damaged-project/project.json'), '{broken json', 'utf8')
    harness.storage.workspace.set('active-project', {
      schemaVersion: 1, projectId: 'damaged-project'
    })

    const active = await invoke(harness, 'video-project', { action: 'active' })
    expect(active.content).toMatchObject({
      outcome: 'stale-active-project',
      projectId: 'damaged-project',
      diagnosticCode: 'invalid_project'
    })
    expect(harness.storage.workspace.get('active-project')).toBeUndefined()
    const listed = await invoke(harness, 'video-project', { action: 'list' })
    expect(listed.content).toMatchObject({
      projects: [expect.objectContaining({ id: 'healthy-project' })],
      diagnostics: [{ id: 'damaged-project', code: 'invalid_project' }]
    })
    await harness.dispose()
  })

  it('returns structured interaction-required in headless mode and rejects path-shaped inputs', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'agent-demo', name: 'Agent Demo'
    })
    harness.transport.handle('media.pickFiles', () => {
      throw new ExtensionApiError({
        code: 'INTERACTION_REQUIRED',
        message: 'No protected desktop picker is attached.',
        operation: 'media.pickFiles',
        retryable: true
      })
    })
    const gated = await invoke(harness, 'video-probe', {
      projectId: 'agent-demo', expectedRevision: 0
    })
    expect(gated.content).toEqual(expect.objectContaining({
      outcome: 'interaction-required',
      code: 'MEDIA_INTERACTION_REQUIRED'
    }))
    await expect(invoke(harness, 'video-probe', {
      projectId: 'agent-demo',
      expectedRevision: 0,
      mediaHandleId: '/tmp/raw-video.mp4'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 0,
      kind: 'h264-mp4',
      outputHandleId: '../output.mp4'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 0,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad', command: 'rm -rf .' }]
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await harness.dispose()
  })

  it('returns actionable unavailable results before picker or job admission when render capabilities are missing', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{
        type: 'add-caption',
        caption: {
          id: 'caption-capability-check',
          trackId: 'captions-1',
          startFrame: 0,
          endFrame: 45,
          text: 'Capability preflight',
          placement: 'bottom'
        }
      }]
    })

    const cases = [
      {
        code: 'FFPROBE_UNAVAILABLE',
        name: 'ffprobe executable',
        kind: 'proof-frame' as const,
        captionMode: 'none' as const,
        ffprobeAvailable: false,
        ffmpegAvailable: true,
        features: ['libx264-encoder', 'aac-encoder', 'drawtext-filter']
      },
      {
        code: 'FFMPEG_UNAVAILABLE',
        name: 'FFmpeg executable',
        kind: 'proof-frame' as const,
        captionMode: 'none' as const,
        ffprobeAvailable: true,
        ffmpegAvailable: false,
        features: []
      },
      {
        code: 'LIBX264_ENCODER_UNAVAILABLE',
        name: 'libx264 encoder',
        kind: 'preview' as const,
        captionMode: 'none' as const,
        ffprobeAvailable: true,
        ffmpegAvailable: true,
        features: ['aac-encoder', 'drawtext-filter']
      },
      {
        code: 'AAC_ENCODER_UNAVAILABLE',
        name: 'AAC encoder',
        kind: 'audio-aac' as const,
        captionMode: 'none' as const,
        ffprobeAvailable: true,
        ffmpegAvailable: true,
        features: ['libx264-encoder', 'drawtext-filter']
      },
      {
        code: 'DRAWTEXT_FILTER_UNAVAILABLE',
        name: 'drawtext filter',
        kind: 'h264-mp4' as const,
        captionMode: 'burned' as const,
        ffprobeAvailable: true,
        ffmpegAvailable: true,
        features: ['libx264-encoder', 'aac-encoder']
      }
    ]
    const capabilityRequestsBefore = harness.transport.requests
      .filter(({ method }) => method === 'media.getCapabilities').length

    for (const testCase of cases) {
      harness.media.setCapabilities({
        probedAt: new Date().toISOString(),
        ffprobe: {
          name: 'ffprobe',
          available: testCase.ffprobeAvailable,
          features: []
        },
        ffmpeg: {
          name: 'ffmpeg',
          available: testCase.ffmpegAvailable,
          features: testCase.features
        }
      })
      const unavailable = await invoke(harness, 'video-render', {
        projectId: 'agent-demo',
        expectedRevision: 2,
        kind: testCase.kind,
        captionMode: testCase.captionMode
      })
      expect(unavailable.content).toMatchObject({
        outcome: 'unavailable',
        code: testCase.code,
        projectId: 'agent-demo',
        currentRevision: 2,
        changedIds: [],
        retryable: true,
        renderKind: testCase.kind,
        captionMode: testCase.captionMode
      })
      expect(String(contentObject(unavailable).message)).toContain(testCase.name)
      expect(String(contentObject(unavailable).message)).toContain('No output target was selected')
      expect(String(contentObject(unavailable).message)).toContain('no render job was started')
    }

    const requests = harness.transport.requests.map(({ method }) => method)
    expect(requests.filter((method) => method === 'media.getCapabilities'))
      .toHaveLength(capabilityRequestsBefore + cases.length)
    expect(requests).not.toContain('media.pickSaveTarget')
    expect(requests).not.toContain('media.startFfmpegJob')
    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo'
    })
    expect(loaded.content).toMatchObject({ project: { currentRevision: 2 } })
    await harness.dispose()
  })

  it('returns a bounded unavailable result when render capability inspection itself fails', async () => {
    const harness = await projectWithMedia()
    harness.transport.handle('media.getCapabilities', () => {
      throw new Error('simulated capability inspection failure')
    })

    const unavailable = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'h264-mp4'
    })
    expect(unavailable.content).toMatchObject({
      outcome: 'unavailable',
      code: 'MEDIA_CAPABILITIES_UNAVAILABLE',
      projectId: 'agent-demo',
      currentRevision: 1,
      changedIds: [],
      retryable: true,
      renderKind: 'h264-mp4',
      captionMode: 'none',
      missingCapabilities: ['capability-inspection']
    })
    expect(String(contentObject(unavailable).message)).toContain('No output target was selected')
    const requests = harness.transport.requests.map(({ method }) => method)
    expect(requests).not.toContain('media.pickSaveTarget')
    expect(requests).not.toContain('media.startFfmpegJob')
    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo'
    })
    expect(loaded.content).toMatchObject({ project: { currentRevision: 1 } })
    await harness.dispose()
  })

  it('cancels durable renders and fences late completion without publishing artifacts', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_render_cancel_0001'
    harness.media.addHandle(mediaHandle(outputHandle, 'export', 'cancelled.mp4', 'video'))
    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'h264-mp4',
      outputHandleId: outputHandle,
      idempotencyKey: 'cancel-test'
    })
    const jobId = String(contentObject(render).jobId)
    harness.jobs.start(jobId)
    const cancelled = await invoke(harness, 'video-render-cancel', {
      jobId, projectId: 'agent-demo', reason: 'User requested cancellation'
    })
    expect(cancelled.content).toMatchObject({ outcome: 'cancelled', technicallyValidated: false })
    expect(cancelled.generatedArtifacts).toBeUndefined()
    const artifact = artifactFor(harness, jobId, outputHandle, 'cancelled.mp4')
    expect(harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] }).state)
      .toBe('cancelled')
    const after = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(after.generatedArtifacts).toBeUndefined()
    await harness.dispose()
  })

  it('keeps status read-only and refuses project-mismatched or untracked cancellation', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_render_scope_guard_001'
    harness.media.addHandle(mediaHandle(outputHandle, 'export', 'scope-guard.mp4', 'video'))
    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'h264-mp4',
      outputHandleId: outputHandle
    })
    const jobId = String(contentObject(render).jobId)
    harness.jobs.start(jobId)

    await expect(invoke(harness, 'video-render-status', {
      jobId,
      action: 'cancel'
    } as unknown as JsonObject)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(invoke(harness, 'video-render-status', {
      jobId,
      projectId: 'another-project'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(invoke(harness, 'video-render-cancel', {
      jobId,
      projectId: 'another-project'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(harness.jobs.get(jobId).state).toBe('running')

    harness.storage.workspace.set(`render-job:${jobId}`, {
      schemaVersion: 1,
      jobId,
      projectId: '../outside-workspace',
      pinnedRevision: 1,
      renderKind: 'h264-mp4',
      captionMode: 'none',
      subtitleFormat: 'srt',
      canvasPreset: '16:9',
      expectedArtifacts: [{ mediaKind: 'video', mimeType: 'video/mp4' }],
      createdAt: new Date().toISOString()
    })
    const untracked = await invoke(harness, 'video-render-status', { jobId })
    expect(untracked.content).toMatchObject({
      outcome: 'running',
      state: 'running',
      tracked: false,
      artifacts: []
    })
    expect(untracked.content).not.toHaveProperty('projectId')
    await expect(invoke(harness, 'video-render-cancel', { jobId }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(harness.jobs.get(jobId).state).toBe('running')
    await harness.dispose()
  })

  it('cancels an admitted render when its extension tracking record cannot be persisted', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_render_tracking_fail_01'
    harness.media.addHandle(mediaHandle(outputHandle, 'export', 'tracking-failed.mp4', 'video'))
    harness.transport.handle('storage.set', () => {
      throw new Error('simulated extension storage failure')
    })

    const failure = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'h264-mp4',
      outputHandleId: outputHandle
    }).then(() => undefined, (error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      retryable: false,
      details: {
        state: 'cancelled',
        cancellationAttempted: true,
        cancellationAccepted: true,
        trackingPersisted: false
      }
    })
    const details = (failure as { details: JsonObject }).details
    const jobId = String(details.jobId)
    expect((failure as Error).message).toContain(jobId)
    expect(harness.jobs.get(jobId).state).toBe('cancelled')
    expect(harness.storage.workspace.has(`render-job:${jobId}`)).toBe(false)

    const status = await invoke(harness, 'video-render-status', { jobId })
    expect(status.content).toMatchObject({ outcome: 'cancelled', jobId, technicallyValidated: false })
    await harness.dispose()
  })

  it('confirms a tracking write after an ambiguous Host acknowledgement without cancelling the job', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_render_tracking_ack_001'
    harness.media.addHandle(mediaHandle(outputHandle, 'export', 'tracking-confirmed.mp4', 'video'))
    harness.transport.handle('storage.set', (params) => {
      const request = params as JsonObject
      harness.storage.workspace.set(String(request.key), request.value!)
      throw new Error('simulated lost storage acknowledgement')
    })

    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'h264-mp4',
      outputHandleId: outputHandle
    })
    const jobId = String(contentObject(render).jobId)
    expect(render.content).toMatchObject({ outcome: 'queued', jobId })
    expect(harness.jobs.get(jobId).state).toBe('queued')
    expect(harness.jobs.get(jobId)).not.toHaveProperty('cancelRequestedAt')
    expect(harness.storage.workspace.get(`render-job:${jobId}`)).toMatchObject({ jobId })
    await harness.dispose()
  })

  it('recovers missing extension tracking from core artifact provenance without claiming visual review', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_render_output_0001'
    harness.media.addHandle({
      ...mediaHandle(outputHandle, 'export', 'output.mp4', 'video'),
      byteSize: 8192,
      completionIdentity: 'render-complete-0001'
    })
    harness.media.setProbe(outputHandle, videoProbe(outputHandle))
    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo', expectedRevision: 1, kind: 'h264-mp4', outputHandleId: outputHandle
    })
    const jobId = String(contentObject(render).jobId)
    harness.jobs.start(jobId)
    const artifact = artifactFor(harness, jobId, outputHandle, 'output.mp4')
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })
    harness.storage.workspace.delete(`render-job:${jobId}`)
    const status = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(status.content).toMatchObject({
      outcome: 'completed',
      tracked: true,
      projectId: 'agent-demo',
      technicallyValidated: true,
      proofStale: false,
      artifacts: [{ artifactId: artifact.artifactId }]
    })
    expect(status.generatedArtifacts).toEqual([artifact])
    expect(status.metadata).toEqual({
      machineValidatedOnly: true,
      visuallyInspected: false,
      proofStale: false,
      evidenceCurrent: true
    })
    expect(status.summary).toContain('No visual inspection is implied')
    expect(harness.storage.workspace.get(`render-job:${jobId}`)).toMatchObject({
      jobId,
      projectId: 'agent-demo',
      pinnedRevision: 1,
      renderKind: 'h264-mp4'
    })

    const replay = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(replay.generatedArtifacts).toEqual(status.generatedArtifacts)
    expect(replay.content).toEqual(status.content)

    const recoveredRecord = harness.storage.workspace.get(`render-job:${jobId}`) as JsonObject
    harness.storage.workspace.set(`render-job:${jobId}`, {
      ...recoveredRecord,
      projectId: 'wrong-project'
    })
    const corrected = await invoke(harness, 'video-render-status', {
      jobId,
      projectId: 'agent-demo'
    })
    expect(corrected.content).toMatchObject({
      outcome: 'completed', tracked: true, projectId: 'agent-demo', technicallyValidated: true
    })
    expect(harness.storage.workspace.get(`render-job:${jobId}`)).toMatchObject({
      projectId: 'agent-demo'
    })
    await harness.dispose()
  })

  it('keeps technical validation but withdraws stale artifacts as current visual evidence', async () => {
    const harness = await projectWithMedia()
    const outputHandle = 'fake_render_stale_proof_001'
    harness.media.addHandle({
      ...mediaHandle(outputHandle, 'export', 'stale-proof.mp4', 'video'),
      byteSize: 8192,
      completionIdentity: 'render-complete-0001'
    })
    harness.media.setProbe(outputHandle, videoProbe(outputHandle))
    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo', expectedRevision: 1, kind: 'h264-mp4', outputHandleId: outputHandle
    })
    const jobId = String(contentObject(render).jobId)
    harness.jobs.start(jobId)
    const artifact = artifactFor(harness, jobId, outputHandle, 'stale-proof.mp4')
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })

    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{ type: 'set-canvas', preset: '9:16', fit: 'pad' }]
    })
    const status = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(status.content).toMatchObject({
      outcome: 'completed',
      pinnedRevision: 1,
      currentRevision: 2,
      proofStale: true,
      technicallyValidated: true,
      visualInspection: 'not-performed',
      evidenceCurrent: false
    })
    expect(status.generatedArtifacts).toBeUndefined()
    expect(status.metadata).toMatchObject({
      machineValidatedOnly: true,
      visuallyInspected: false,
      proofStale: true,
      evidenceCurrent: false
    })
    expect(status.summary).toContain('proof is stale')
    await harness.dispose()
  })

  it('submits burned captions as a bounded drawtext filter without generated file inputs', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{
        type: 'add-caption',
        caption: {
          id: 'caption-main',
          trackId: 'captions-1',
          startFrame: 5,
          endFrame: 60,
          text: "Crime d'Amour: [x], y; \\ %",
          placement: 'bottom',
          style: { fontSize: 42, color: '#F0F0F0', background: '#101010' }
        }
      }]
    })
    const outputHandle = 'fake_render_burned_0001'
    harness.media.addHandle(mediaHandle(outputHandle, 'export', 'burned.mp4', 'video'))

    await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      kind: 'h264-mp4',
      outputHandleId: outputHandle,
      captionMode: 'burned'
    })

    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)
    expect(request?.params).toMatchObject({
      inputs: { 'clip-0': 'fake_media_source_0001' },
      outputs: { video: outputHandle },
      metadata: { pinnedRevision: 2, captionMode: 'burned' }
    })
    const argumentsValue = (request?.params as JsonObject | undefined)?.arguments
    expect(Array.isArray(argumentsValue)).toBe(true)
    const filterGraph = (argumentsValue as unknown[])[
      (argumentsValue as unknown[]).indexOf('-filter_complex') + 1
    ]
    expect(filterGraph).toEqual(expect.stringContaining('drawtext='))
    expect(filterGraph).toEqual(expect.stringContaining('expansion=none'))
    expect(filterGraph).not.toEqual(expect.stringContaining('fontfile='))
    expect(filterGraph).not.toEqual(expect.stringContaining('textfile='))
    expect(JSON.stringify(request?.params)).not.toContain('generated-text')

    const proofOutput = 'fake_render_burned_proof_01'
    harness.media.addHandle(mediaHandle(proofOutput, 'export', 'burned-proof.png', 'image'))
    await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      kind: 'proof-frame',
      outputHandleId: proofOutput,
      captionMode: 'burned',
      proofFrame: 5
    })
    const proofRequest = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    expect(proofRequest.metadata).toMatchObject({
      pinnedRevision: 2,
      renderKind: 'proof-frame',
      captionMode: 'burned',
      proofFrame: 5
    })
    expect(JSON.stringify(proofRequest.arguments)).toContain('drawtext=')
    expect(JSON.stringify(proofRequest.arguments)).toContain('trim=start_frame=5:end_frame=6')
    await harness.dispose()
  })

  it('publishes burned video and deterministic SRT sidecar artifacts from one durable job', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{
        type: 'add-caption',
        caption: {
          id: 'caption-sidecar',
          trackId: 'captions-1',
          startFrame: 0,
          endFrame: 45,
          text: 'A deterministic caption',
          placement: 'bottom'
        }
      }]
    })
    const videoTarget = 'fake_render_both_video_0001'
    const subtitleTarget = 'fake_render_both_sub_00001'
    harness.media.addHandle(mediaHandle(videoTarget, 'export', 'both.mp4', 'video'))
    harness.media.addHandle(mediaHandle(subtitleTarget, 'export', 'both.srt', 'subtitle'))

    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      kind: 'h264-mp4',
      outputHandleId: videoTarget,
      captionMode: 'both',
      subtitleOutputHandleId: subtitleTarget,
      subtitleFormat: 'srt'
    })
    const jobId = String(contentObject(render).jobId)
    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    expect(request.textOutputs).toMatchObject({
      'sidecar-captions': {
        handleId: subtitleTarget,
        mimeType: 'application/x-subrip'
      }
    })
    expect(JSON.stringify(request.textOutputs)).toContain('00:00:00,000 --> 00:00:01,500')

    const generatedVideo = 'fake_generated_video_00001'
    const generatedSubtitle = 'fake_generated_subtitle_001'
    harness.media.addHandle({
      ...mediaHandle(generatedVideo, 'read', 'both.mp4', 'video'),
      byteSize: 16_384,
      completionIdentity: 'both-video-complete'
    })
    harness.media.addHandle({
      ...mediaHandle(generatedSubtitle, 'read', 'both.srt', 'subtitle'),
      byteSize: 96,
      completionIdentity: 'both-subtitle-complete'
    })
    harness.media.setProbe(generatedVideo, videoProbe(generatedVideo))
    harness.media.setProbe(generatedSubtitle, subtitleProbe(generatedSubtitle))
    harness.jobs.start(jobId)
    const videoArtifact = createGeneratedArtifactFixture({
      artifactId: `artifact_${createSafeSuffix(jobId)}_video`,
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: generatedVideo,
      displayName: 'both.mp4',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      byteSize: 16_384,
      completionIdentity: 'both-video-complete',
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: request.metadata as JsonObject
      }
    })
    const subtitleArtifact = createGeneratedArtifactFixture({
      artifactId: `artifact_${createSafeSuffix(jobId)}_subtitle`,
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: generatedSubtitle,
      displayName: 'both.srt',
      mediaKind: 'subtitle',
      mimeType: 'application/x-subrip',
      byteSize: 96,
      completionIdentity: 'both-subtitle-complete',
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: request.metadata as JsonObject
      }
    })
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      generatedArtifacts: [videoArtifact, subtitleArtifact]
    })
    harness.storage.workspace.delete(`render-job:${jobId}`)

    const status = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(status.content).toMatchObject({
      outcome: 'completed',
      tracked: true,
      projectId: 'agent-demo',
      technicallyValidated: true,
      artifacts: [
        { artifactId: videoArtifact.artifactId },
        { artifactId: subtitleArtifact.artifactId }
      ]
    })
    expect(status.generatedArtifacts).toHaveLength(2)
    expect(harness.storage.workspace.get(`render-job:${jobId}`)).toMatchObject({
      expectedArtifacts: [
        { mediaKind: 'subtitle', mimeType: 'application/x-subrip' },
        { mediaKind: 'video', mimeType: 'video/mp4' }
      ]
    })
    await harness.dispose()
  })

  it('releases a Host-selected primary export handle when sidecar target selection is cancelled', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{
        type: 'add-caption',
        caption: {
          id: 'caption-cancel-sidecar',
          trackId: 'captions-1',
          startFrame: 0,
          endFrame: 30,
          text: 'Keep the first target bounded',
          placement: 'bottom'
        }
      }]
    })
    const primaryTarget = 'fake_render_cancel_sidecar_001'
    harness.media.queueSaveTarget(mediaHandle(primaryTarget, 'export', 'cancelled-sidecar.mp4', 'video'))
    harness.media.queueSaveTarget()

    const response = await harness.client.commands.executeCommand<ToolResult>('editor-request', {
      action: 'render.start',
      payload: {
        projectId: 'agent-demo',
        expectedRevision: 2,
        kind: 'h264-mp4',
        captionMode: 'sidecar',
        subtitleFormat: 'srt'
      }
    })

    expect(contentObject(response)).toMatchObject({ outcome: 'cancelled', code: 'MEDIA_CANCELLED' })
    expect(harness.media.handles.get(primaryTarget)?.revoked).toBe(true)
    expect(harness.transport.requests.map(({ method }) => method)).not.toContain('media.startFfmpegJob')
    await harness.dispose()
  })

  it('exports standalone WebVTT through a text-only durable job and validates its artifact', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{
        type: 'add-caption',
        caption: {
          id: 'caption-standalone',
          trackId: 'captions-1',
          startFrame: 0,
          endFrame: 45,
          text: 'Standalone caption',
          placement: 'bottom'
        }
      }]
    })
    const target = 'fake_standalone_vtt_00001'
    harness.media.addHandle({
      ...mediaHandle(target, 'export', 'captions.vtt', 'subtitle'),
      mimeType: 'text/vtt'
    })
    const capabilityRequestsBefore = harness.transport.requests
      .filter(({ method }) => method === 'media.getCapabilities').length
    harness.media.executablesAvailable = false
    const render = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      kind: 'subtitles',
      outputHandleId: target,
      subtitleFormat: 'vtt'
    })
    const jobId = String(contentObject(render).jobId)
    const request = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    expect(request).toMatchObject({
      arguments: [],
      inputs: {},
      outputs: {},
      metadata: {
        projectId: 'agent-demo',
        pinnedRevision: 2,
        renderKind: 'subtitles',
        captionMode: 'none',
        subtitleFormat: 'vtt'
      },
      textOutputs: {
        subtitles: { handleId: target, mimeType: 'text/vtt' }
      }
    })
    expect(JSON.stringify(request.textOutputs)).toContain('WEBVTT')
    expect(harness.transport.requests.filter(({ method }) => method === 'media.getCapabilities'))
      .toHaveLength(capabilityRequestsBefore)
    harness.media.executablesAvailable = true

    const generated = 'fake_generated_vtt_000001'
    harness.media.addHandle({
      ...mediaHandle(generated, 'read', 'captions.vtt', 'subtitle'),
      mimeType: 'text/vtt',
      byteSize: 96,
      completionIdentity: 'standalone-vtt-complete'
    })
    harness.media.setProbe(generated, subtitleProbe(generated))
    harness.jobs.start(jobId)
    const artifact = createGeneratedArtifactFixture({
      artifactId: `artifact_${createSafeSuffix(jobId)}_vtt`,
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: generated,
      displayName: 'captions.vtt',
      mediaKind: 'subtitle',
      mimeType: 'text/vtt',
      byteSize: 96,
      completionIdentity: 'standalone-vtt-complete',
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: request.metadata as JsonObject
      }
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })
    const status = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(status.content).toMatchObject({
      outcome: 'completed', renderKind: 'subtitles', technicallyValidated: true
    })
    expect(status.generatedArtifacts).toEqual([expect.objectContaining({ artifactId: artifact.artifactId })])
    await harness.dispose()
  })

  it('preflights, queues, observes, and cancels atomic self-contained project packages', async () => {
    const harness = await projectWithMedia()
    const preflight = await invoke(harness, 'video-project-package', {
      action: 'preflight',
      projectId: 'agent-demo',
      expectedRevision: 1,
      missingMediaPolicy: 'fail',
      includeReceipts: true,
      includeChatProvenance: true
    })
    expect(preflight.content).toMatchObject({
      outcome: 'preflight',
      projectId: 'agent-demo',
      pinnedRevision: 1,
      complete: true,
      selectedAssetCount: 1,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      executable: true,
      provenance: { chatCount: 0, chatScope: 'not-requested' }
    })

    const outputHandleId = 'fake_package_output_0001'
    harness.media.addHandle({
      handleId: outputHandleId,
      mode: 'export',
      kind: 'data',
      displayName: 'agent-demo.kun-video.zip',
      mimeType: 'application/zip'
    })
    const queued = await invoke(harness, 'video-project-package', {
      action: 'export',
      projectId: 'agent-demo',
      expectedRevision: 1,
      missingMediaPolicy: 'fail',
      outputHandleId
    })
    expect(queued.content).toMatchObject({
      outcome: 'queued',
      job: {
        kind: 'media.archive',
        state: 'queued',
        projectId: 'agent-demo',
        pinnedRevision: 1,
        complete: true
      }
    })
    const jobId = String((contentObject(queued).job as JsonObject).jobId)
    const request = harness.transport.requests.find(({ method, params }) =>
      method === 'media.startArchiveJob' &&
      (params as JsonObject).outputHandleId === outputHandleId)
    expect(request?.params).toMatchObject({
      format: 'zip',
      outputHandleId,
      idempotencyKey: expect.stringMatching(/^project-package:[a-f0-9]{64}$/u),
      entries: expect.arrayContaining([
        expect.objectContaining({ archivePath: 'manifest/package.json', kind: 'inline-text' }),
        expect.objectContaining({ archivePath: 'project/project.json', kind: 'inline-text' }),
        expect.objectContaining({ kind: 'media', inputHandleId: 'fake_media_source_0001' })
      ])
    })
    expect(JSON.stringify((request?.params as JsonObject).entries))
      .not.toContain(harness.context.workspaceContext!.root)

    expect((await invoke(harness, 'video-project-package-status', {
      projectId: 'agent-demo', jobId
    })).content).toMatchObject({ outcome: 'status', job: { state: 'queued' } })
    harness.jobs.start(jobId)
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      data: {
        schemaVersion: 1,
        format: 'zip',
        entryCount: 7,
        inputBytes: 4096,
        archiveBytes: 8192,
        sha256: 'b'.repeat(64),
        generatedMedia: {
          handleId: 'fake_package_generated_0001',
          mode: 'read',
          kind: 'data',
          displayName: 'agent-demo.kun-video.zip',
          mimeType: 'application/zip',
          byteSize: 8192,
          completionIdentity: 'package-completion-1',
          revoked: false
        }
      }
    })
    expect((await invoke(harness, 'video-project-package-status', {
      projectId: 'agent-demo', jobId
    })).content).toMatchObject({
      outcome: 'status',
      job: {
        state: 'completed',
        result: {
          format: 'zip',
          sha256: 'b'.repeat(64),
          generatedMedia: { handleId: 'fake_package_generated_0001' }
        }
      }
    })

    const cancelOutput = 'fake_package_output_cancel_1'
    harness.media.addHandle({
      handleId: cancelOutput,
      mode: 'export',
      kind: 'data',
      displayName: 'cancelled.kun-video.zip',
      mimeType: 'application/zip'
    })
    const second = await invoke(harness, 'video-project-package', {
      action: 'export',
      projectId: 'agent-demo',
      expectedRevision: 1,
      missingMediaPolicy: 'fail',
      outputHandleId: cancelOutput
    })
    const secondJobId = String((contentObject(second).job as JsonObject).jobId)
    expect((await invoke(harness, 'video-project-package-cancel', {
      projectId: 'agent-demo', jobId: secondJobId
    })).content).toMatchObject({
      outcome: 'cancellation-requested',
      accepted: true,
      job: { state: 'cancelled' }
    })
    await harness.dispose()
  })
})

async function generationHarness(broker: GenerationExecutionBroker): Promise<{
  harness: ExtensionTestHarness
  tools: VideoEditorTools
}> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-generation-tools-'))
  roots.push(root)
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.4.0'
    },
    permissions,
    workspace: { id: 'video-workspace', name: 'Video Workspace', root, trusted: true, active: true }
  })
  const tools = new VideoEditorTools(harness.context, { generationBroker: broker })
  await tools.register()
  return { harness, tools }
}

function generationCatalogFixture(): JsonObject {
  return {
    schemaVersion: 1,
    revision: 'generation-catalog-fixture',
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
        tasks: ['video'],
        outputKinds: ['video'],
        referenceKinds: ['video'],
        limits: {
          maxPromptCharacters: 2_000,
          minReferences: 1,
          maxReferences: 2,
          maxVariants: 2,
          maxWidth: 3_840,
          maxHeight: 2_160,
          maxDurationUs: 30_000_000
        },
        permissions: {
          permissionIds: ['network:provider.example.test'],
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

function generationAuthorization(challenge: GenerationAuthorizationChallenge): JsonObject {
  const issuedAtMs = Date.now() - 1_000
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
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + 60 * 60 * 1_000).toISOString()
  }
}

function generationBrokerSnapshot(
  requestValue: unknown,
  state: 'prepared' | 'running' | 'completed' | 'cancelled',
  outputs?: JsonObject[]
): JsonObject {
  const request = requestValue as Record<string, unknown>
  return {
    schemaVersion: 1,
    jobId: 'job_generation_tools_0001',
    executionId: String(request.executionId),
    owner: request.owner as JsonObject,
    state,
    ...(state === 'running' ? {
      progress: {
        completed: 1,
        total: 1,
        unit: 'variant',
        message: 'Generating one variant',
        updatedAt: new Date().toISOString()
      }
    } : {}),
    ...(outputs ? { outputs } : {})
  }
}

function generationOutputFixture(): JsonObject[] {
  return [{
    id: 'variant-primary',
    assetId: 'generated-primary',
    outputHandleId: 'generation_output_handle_0001',
    displayName: 'generated-primary.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    byteSize: 1_024,
    completionIdentity: 'completion-primary',
    width: 1_920,
    height: 1_080,
    durationUs: 5_000_000,
    primary: true,
    createdAt: new Date().toISOString()
  }]
}

function multiGenerationOutputFixture(): JsonObject[] {
  return [
    ...generationOutputFixture(),
    {
      id: 'variant-secondary',
      assetId: 'generated-secondary',
      outputHandleId: 'generation_output_handle_0002',
      displayName: 'generated-secondary.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      byteSize: 2_048,
      completionIdentity: 'completion-secondary',
      width: 1_920,
      height: 1_080,
      durationUs: 5_000_000,
      primary: false,
      createdAt: new Date().toISOString()
    }
  ]
}

async function activatedHarness(): Promise<ExtensionTestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-tools-'))
  roots.push(root)
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.1.0'
    },
    permissions,
    workspace: { id: 'video-workspace', name: 'Video Workspace', root, trusted: true, active: true }
  })
  await harness.activate(activate)
  return harness
}

async function projectWithMedia(): Promise<ExtensionTestHarness> {
  const harness = await activatedHarness()
  await invoke(harness, 'video-project', {
    action: 'create', projectId: 'agent-demo', name: 'Agent Demo'
  })
  const sourceHandle = 'fake_media_source_0001'
  harness.media.addHandle(mediaHandle(sourceHandle, 'read', 'interview.mp4', 'video'))
  harness.media.setProbe(sourceHandle, videoProbe(sourceHandle))
  await invoke(harness, 'video-probe', {
    projectId: 'agent-demo',
    expectedRevision: 0,
    mediaHandleId: sourceHandle,
    assetId: 'interview'
  })
  return harness
}

async function projectWithTwoAudioAssets(): Promise<ExtensionTestHarness> {
  const harness = await activatedHarness()
  await invoke(harness, 'video-project', {
    action: 'create', projectId: 'audio-demo', name: 'Audio Demo'
  })
  const sources = [
    { id: 'reference', handleId: 'fake_audio_reference_0001', name: 'Reference.wav' },
    { id: 'target', handleId: 'fake_audio_target_0000001', name: 'Target.wav' }
  ]
  for (const [index, source] of sources.entries()) {
    harness.media.addHandle(mediaHandle(source.handleId, 'read', source.name, 'audio'))
    harness.media.setProbe(source.handleId, audioProbe(source.handleId))
    await invoke(harness, 'video-probe', {
      projectId: 'audio-demo',
      expectedRevision: index,
      mediaHandleId: source.handleId,
      assetId: source.id
    })
  }
  return harness
}

async function nextAudioAnalysisJob(
  harness: ExtensionTestHarness,
  excluded = new Set<string>()
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = [...harness.jobs.snapshots.values()].find((snapshot) =>
      snapshot.kind === 'media.audio-analysis' && !excluded.has(snapshot.id)
    )
    if (match) return match.id
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for local audio-analysis job')
}

function visualModelStatus(state: 'missing' | 'installed') {
  const descriptor = {
    adapterId: 'kun.local.visual-features', adapterVersion: '1.0.0',
    modelId: 'kun-visual-features', modelVersion: '1.0.0',
    packageId: 'kun-bundled.visual-features-v1', manifestSha256: 'a'.repeat(64),
    files: [{ name: 'visual-features-v1.json', sha256: 'b'.repeat(64), byteSize: 582 }],
    embeddingDimensions: 24, execution: 'local' as const,
    querySemantics: 'bounded-visual-features-v1' as const
  }
  return {
    schemaVersion: 1 as const,
    state,
    descriptor,
    ...(state === 'installed' ? {
      receipt: {
        broker: 'kun-model-broker' as const,
        packageSource: 'bundled' as const,
        packageId: descriptor.packageId,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        manifestSha256: descriptor.manifestSha256,
        files: descriptor.files,
        downloadVerified: false,
        sourceVerified: true as const,
        installVerified: true as const,
        signatureVerified: true as const,
        installedAt: '2026-07-14T00:00:00.000Z'
      }
    } : {}),
    installSupported: true,
    checkedAt: '2026-07-14T00:00:00.000Z',
    remediation: state === 'installed'
      ? 'Verified signed bundled local visual features are ready.'
      : 'Install the signed bundled local visual feature package with the Host.',
    local: true as const,
    networkUsedForInference: false as const,
    rawPathsExposed: false as const,
    urlsAccepted: false as const
  }
}

async function waitForVisualOperation(harness: ExtensionTestHarness): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const progress = harness.webview.messages
      .filter(isJsonObject)
      .filter((message) => message.channel === 'kun-video-editor.media-intelligence-progress')
      .map((message) => message.payload as JsonObject)
      .find((message) => message.kind === 'visual-index' && message.status === 'running')
    if (progress && typeof progress.operationId === 'string') return progress.operationId
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for visual-index operation progress')
}

async function invoke(
  harness: ExtensionTestHarness,
  id: (typeof VIDEO_TOOL_IDS)[number],
  input: JsonObject
): Promise<ToolResult> {
  const registration = [...harness.tools.registrations]
    .find(([, declaration]) => declaration.id === id)?.[0]
  if (!registration) throw new Error(`Tool ${id} was not registered`)
  return await harness.tools.invoke(registration, input) as ToolResult
}

function contentObject(result: ToolResult): JsonObject {
  if (result.content === null || typeof result.content !== 'object' || Array.isArray(result.content)) {
    throw new Error('Expected a tool result object')
  }
  return result.content
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mediaHandle(
  handleId: string,
  mode: 'read' | 'export',
  displayName: string,
  kind: 'video' | 'audio' | 'image' | 'subtitle'
): JsonObject {
  return {
    handleId,
    mode,
    kind,
    displayName,
    mimeType: kind === 'video'
      ? 'video/mp4'
      : kind === 'audio'
        ? 'audio/mp4'
        : kind === 'subtitle'
          ? 'application/x-subrip'
          : 'image/png',
    byteSize: mode === 'read' ? 4096 : 0
  }
}

function subtitleProbe(handleId: string): JsonObject {
  return {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['srt'], durationMicros: 1_500_000 },
    streams: [{
      index: 0,
      kind: 'subtitle',
      codecName: 'subrip',
      durationMicros: 1_500_000,
      disposition: { default: true }
    }]
  }
}

function videoProbe(handleId: string): JsonObject {
  return {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['mp4'], durationMicros: 3_000_000 },
    streams: [
      {
        index: 0,
        kind: 'video',
        codecName: 'h264',
        durationMicros: 3_000_000,
        frameRate: { numerator: 30, denominator: 1 },
        width: 1920,
        height: 1080,
        disposition: { default: true }
      },
      {
        index: 1,
        kind: 'audio',
        codecName: 'aac',
        durationMicros: 3_000_000,
        sampleRate: 48_000,
        channelCount: 2,
        disposition: { default: true }
      }
    ]
  }
}

function audioProbe(handleId: string): JsonObject {
  return {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['wav'], durationMicros: 3_000_000 },
    streams: [{
      index: 0,
      kind: 'audio',
      codecName: 'pcm_s16le',
      durationMicros: 3_000_000,
      sampleRate: 48_000,
      channelCount: 1,
      disposition: { default: true }
    }]
  }
}

function silenceAnalysisResult(handleId: string, fingerprint: string): JsonObject {
  return {
    schemaVersion: 1,
    analysis: 'silence',
    source: { handleId, fingerprint, fingerprintAlgorithm: 'sha256-file-identity-v1' },
    provenance: {
      algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
      local: true, networkUsed: false
    },
    parameters: { noiseThresholdDb: -35, minimumSilenceMicros: 300_000 },
    intervals: [{
      startMicros: 200_000,
      endMicros: 600_000,
      confidence: 1,
      confidenceSemantics: 'threshold-classification'
    }],
    analyzedDurationMicros: 3_000_000,
    truncated: false
  }
}

function beatAnalysisResult(handleId: string, fingerprint: string): JsonObject {
  return {
    schemaVersion: 1,
    analysis: 'beat-grid',
    source: { handleId, fingerprint, fingerprintAlgorithm: 'sha256-file-identity-v1' },
    provenance: {
      algorithm: 'kun.pcm-onset-autocorrelation', algorithmVersion: '1.0.0',
      local: true, networkUsed: false
    },
    tempoBpm: 120,
    markers: [
      { timeMicros: 500_000, kind: 'downbeat', confidence: 0.91, strength: 0.94 },
      { timeMicros: 1_000_000, kind: 'beat', confidence: 0.86, strength: 0.89 }
    ],
    analyzedDurationMicros: 3_000_000,
    truncated: false
  }
}

function syncAnalysisResult(
  referenceHandleId: string,
  targetHandleId: string,
  seed: number,
  referenceFeatures: number[],
  targetFeatures: number[]
): JsonObject {
  return {
    schemaVersion: 1,
    analysis: 'sync-features',
    reference: {
      handleId: referenceHandleId,
      fingerprint: 'b'.repeat(64),
      fingerprintAlgorithm: 'sha256-file-identity-v1'
    },
    target: {
      handleId: targetHandleId,
      fingerprint: 'c'.repeat(64),
      fingerprintAlgorithm: 'sha256-file-identity-v1'
    },
    provenance: {
      algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
      local: true, networkUsed: false
    },
    seed,
    samplePeriodMicros: 100_000,
    referenceFeatures,
    targetFeatures,
    referenceAnalyzedDurationMicros: referenceFeatures.length * 100_000,
    targetAnalyzedDurationMicros: targetFeatures.length * 100_000,
    truncated: false
  }
}

function imageDerivedArtifact(
  harness: ExtensionTestHarness,
  input: {
    jobId: string
    handleId: string
    displayName: string
    byteSize: number
    metadata: JsonObject
  }
) {
  const completionIdentity = `derived-${createSafeSuffix(input.jobId)}-complete`
  harness.media.addHandle({
    ...mediaHandle(input.handleId, 'read', input.displayName, 'image'),
    byteSize: input.byteSize,
    completionIdentity
  })
  return createGeneratedArtifactFixture({
    artifactId: `artifact_derived_${createSafeSuffix(input.jobId)}`,
    ownerExtensionId: harness.identity.id,
    ownerExtensionVersion: harness.identity.version,
    workspaceId: harness.context.workspaceContext!.id,
    mediaHandleId: input.handleId,
    displayName: input.displayName,
    mediaKind: 'image',
    mimeType: 'image/png',
    byteSize: input.byteSize,
    completionIdentity,
    provenance: {
      jobId: input.jobId,
      operation: 'media.startFfmpegJob',
      metadata: input.metadata
    }
  })
}

function artifactFor(
  harness: ExtensionTestHarness,
  jobId: string,
  mediaHandleId: string,
  displayName: string
) {
  return createGeneratedArtifactFixture({
    artifactId: `artifact_${createSafeSuffix(jobId)}_0001`,
    ownerExtensionId: harness.identity.id,
    ownerExtensionVersion: harness.identity.version,
    workspaceId: harness.context.workspaceContext!.id,
    mediaHandleId,
    displayName,
    byteSize: 8192,
    completionIdentity: 'render-complete-0001',
    provenance: {
      jobId,
      operation: 'media.startFfmpegJob',
      metadata: latestRenderMetadata(harness)
    }
  })
}

function latestRenderMetadata(harness: ExtensionTestHarness): JsonObject {
  const metadata = harness.transport.requests
    .filter(({ method }) => method === 'media.startFfmpegJob')
    .at(-1)?.params as JsonObject | undefined
  if (!metadata || metadata.metadata === undefined) {
    throw new Error('No submitted render metadata was recorded by the Host harness')
  }
  return structuredClone(metadata.metadata as JsonObject)
}

function createSafeSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_')
}

async function loadManifest(): Promise<ExtensionManifest> {
  const path = join(import.meta.dirname, '..', 'kun-extension.json')
  return parseExtensionManifest(JSON.parse(await readFile(path, 'utf8')))
}
