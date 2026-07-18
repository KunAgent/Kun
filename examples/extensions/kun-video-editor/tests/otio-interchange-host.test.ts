import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type JsonObject,
  type ToolResult
} from '@kun/extension-api'
import {
  createExtensionTestHarness,
  createGeneratedArtifactFixture,
  type ExtensionTestHarness
} from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import { activate, VIDEO_TOOL_IDS } from '../src/host/extension.js'

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

describe('durable OTIO interchange Host flow', () => {
  it('queues, restores, validates, and cancels path-opaque OTIO exports', async () => {
    const harness = await projectWithMedia()
    const firstOutput = 'fake_otio_output_000001'
    harness.media.addHandle(exportHandle(firstOutput, 'agent-demo.otio'))

    const queued = await invoke(harness, 'video-interchange', {
      action: 'export',
      projectId: 'agent-demo',
      expectedRevision: 1,
      outputHandleId: firstOutput
    })
    const projection = object(content(queued).job)
    expect(queued.content).toMatchObject({
      outcome: 'queued',
      job: {
        kind: 'media.ffmpeg',
        state: 'queued',
        projectId: 'agent-demo',
        pinnedRevision: 1,
        stale: false,
        adapterId: 'kun.otio-json',
        adapterVersion: '1.0.0',
        documentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        projectDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lossManifest: {
          adapterId: 'kun.otio-json',
          portableLossless: expect.any(Boolean),
          kunRoundTripLossless: true,
          entries: expect.any(Array)
        }
      }
    })

    const request = latestRequest(harness, 'media.startFfmpegJob')
    expect(request).toMatchObject({
      arguments: [],
      inputs: {},
      outputs: {},
      scheduling: { priority: 'export', maxAttempts: 1 },
      metadata: {
        projectId: 'agent-demo',
        pinnedRevision: 1,
        interchangeAdapterId: 'kun.otio-json',
        interchangeAdapterVersion: '1.0.0',
        documentDigest: projection.documentDigest,
        projectDigest: projection.projectDigest
      },
      textOutputs: {
        interchange: {
          handleId: firstOutput,
          mimeType: 'application/x-otio+json',
          content: expect.any(String)
        }
      }
    })
    const serializedRequest = JSON.stringify(request)
    expect(serializedRequest).not.toContain(harness.context.workspaceContext!.root)
    expect(serializedRequest).not.toContain('file://')
    expect(JSON.parse(String(object(object(request.textOutputs).interchange).content)))
      .toMatchObject({ OTIO_SCHEMA: 'SerializableCollection.1' })

    const jobId = String(projection.jobId)
    expect((await invoke(harness, 'video-interchange-status', {
      projectId: 'agent-demo', jobId
    })).content).toMatchObject({
      outcome: 'queued',
      technicallyValidated: false,
      job: { jobId, pinnedRevision: 1, currentRevision: 1, stale: false }
    })

    harness.jobs.start(jobId)
    harness.jobs.reportProgress(jobId, { completed: 1, total: 1, percentage: 100 })
    const generatedHandleId = 'fake_otio_generated_0001'
    const documentBytes = Number(projection.documentBytes)
    const artifact = createGeneratedArtifactFixture({
      artifactId: 'artifact_otio_document_0001',
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: generatedHandleId,
      displayName: 'agent-demo.otio',
      mediaKind: 'document',
      mimeType: 'application/x-otio+json',
      byteSize: documentBytes,
      completionIdentity: 'otio-document-complete-0001',
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: object(request.metadata)
      }
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })
    const completed = await invoke(harness, 'video-interchange-status', {
      projectId: 'agent-demo', jobId
    })
    expect(completed.content).toMatchObject({
      outcome: 'completed',
      technicallyValidated: true,
      visualInspection: 'not-applicable',
      artifacts: [{ artifactId: artifact.artifactId, mediaKind: 'document' }]
    })
    expect(completed.generatedArtifacts).toEqual([artifact])

    const secondOutput = 'fake_otio_output_000002'
    harness.media.addHandle(exportHandle(secondOutput, 'cancelled.otio'))
    const second = await invoke(harness, 'video-interchange', {
      action: 'export', projectId: 'agent-demo', expectedRevision: 1,
      outputHandleId: secondOutput
    })
    const secondJobId = String(object(content(second).job).jobId)
    const cancelled = await invoke(harness, 'video-interchange-cancel', {
      projectId: 'agent-demo', jobId: secondJobId, reason: 'User cancelled export'
    })
    expect(cancelled.content).toMatchObject({
      outcome: 'cancelled',
      technicallyValidated: false,
      job: { jobId: secondJobId, state: 'cancelled' }
    })

    await harness.dispose()
  })

  it('previews before write, fences the selected document, and never overwrites a project', async () => {
    const harness = await projectWithMedia()
    const outputHandleId = 'fake_otio_output_import_1'
    harness.media.addHandle(exportHandle(outputHandleId, 'source.otio'))
    await invoke(harness, 'video-interchange', {
      action: 'export', projectId: 'agent-demo', expectedRevision: 1, outputHandleId
    })
    const request = latestRequest(harness, 'media.startFfmpegJob')
    const document = String(object(object(request.textOutputs).interchange).content)
    const inputHandleId = 'fake_otio_input_000001'
    harness.media.addHandle(readHandle(inputHandleId, 'source.otio'))
    harness.media.setText(inputHandleId, document)

    const preview = await editorCommand(harness, {
      action: 'interchange.import-preview', inputHandleId
    })
    const previewContent = content(preview)
    expect(previewContent).toMatchObject({
      outcome: 'interchange-import-preview',
      inputHandleId,
      displayName: 'source.otio',
      adapterId: 'kun.otio-json',
      sourceDocumentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sourceProjectId: 'agent-demo',
      sourceProjectRevision: 1,
      suggestedProjectId: 'agent-demo-import',
      persisted: false,
      confirmationRequired: true,
      lossManifest: { kunRoundTripLossless: true }
    })
    expect(await projectIds(harness)).toEqual(['agent-demo'])

    const imported = await editorCommand(harness, {
      action: 'interchange.import',
      inputHandleId,
      expectedDocumentDigest: previewContent.sourceDocumentDigest,
      expectedSourceProjectId: previewContent.sourceProjectId,
      expectedSourceRevision: previewContent.sourceProjectRevision,
      targetProjectId: 'agent-demo-imported'
    })
    expect(imported.content).toMatchObject({
      outcome: 'interchange-imported',
      persisted: true,
      overwritten: false,
      project: {
        id: 'agent-demo-imported',
        currentRevision: 2,
        activeSequenceId: 'sequence-main',
        assets: [{ id: 'interview' }]
      }
    })
    expect(await projectIds(harness)).toEqual(['agent-demo', 'agent-demo-imported'])

    const importedBefore = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo-imported'
    })
    await expect(editorCommand(harness, {
      action: 'interchange.import',
      inputHandleId,
      expectedDocumentDigest: previewContent.sourceDocumentDigest,
      expectedSourceProjectId: previewContent.sourceProjectId,
      expectedSourceRevision: previewContent.sourceProjectRevision,
      targetProjectId: 'agent-demo-imported'
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    const importedAfter = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'agent-demo-imported'
    })
    expect(importedAfter.content).toEqual(importedBefore.content)

    const secondInput = 'fake_otio_input_000002'
    harness.media.addHandle(readHandle(secondInput, 'changed.otio'))
    harness.media.setText(secondInput, document)
    const secondPreview = content(await editorCommand(harness, {
      action: 'interchange.import-preview', inputHandleId: secondInput
    }))
    const changedDocument = JSON.parse(document) as JsonObject
    changedDocument.name = 'Changed after preview'
    harness.media.setText(secondInput, JSON.stringify(changedDocument))
    await expect(editorCommand(harness, {
      action: 'interchange.import',
      inputHandleId: secondInput,
      expectedDocumentDigest: secondPreview.sourceDocumentDigest,
      expectedSourceProjectId: secondPreview.sourceProjectId,
      expectedSourceRevision: secondPreview.sourceProjectRevision,
      targetProjectId: 'changed-import'
    })).rejects.toThrow(/changed after preview/u)
    expect(await projectIds(harness)).not.toContain('changed-import')

    expect(VIDEO_TOOL_IDS).toContain('video-interchange')
    expect(VIDEO_TOOL_IDS).not.toContain('video-interchange-import' as never)
    expect([...harness.tools.registrations].map(([, declaration]) => declaration.id))
      .not.toContain('video-interchange-import')
    expect(JSON.stringify(harness.transport.requests)).not.toContain(harness.context.workspaceContext!.root)

    await harness.dispose()
  })
})

async function activatedHarness(): Promise<ExtensionTestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-otio-host-'))
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
  await harness.activate(activate)
  return harness
}

async function projectWithMedia(): Promise<ExtensionTestHarness> {
  const harness = await activatedHarness()
  await invoke(harness, 'video-project', {
    action: 'create', projectId: 'agent-demo', name: 'Agent Demo'
  })
  const handleId = 'fake_media_source_0001'
  harness.media.addHandle({
    handleId,
    mode: 'read',
    kind: 'video',
    displayName: 'interview.mp4',
    mimeType: 'video/mp4',
    byteSize: 4096
  })
  harness.media.setProbe(handleId, {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['mp4'], durationMicros: 3_000_000 },
    streams: [{
      index: 0,
      kind: 'video',
      codecName: 'h264',
      durationMicros: 3_000_000,
      frameRate: { numerator: 30, denominator: 1 },
      width: 1920,
      height: 1080,
      disposition: { default: true }
    }]
  })
  await invoke(harness, 'video-probe', {
    projectId: 'agent-demo', expectedRevision: 0, mediaHandleId: handleId, assetId: 'interview'
  })
  return harness
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

async function editorCommand(
  harness: ExtensionTestHarness,
  input: JsonObject
): Promise<ToolResult> {
  const { action, ...payload } = input
  return await harness.client.commands.executeCommand<ToolResult>('editor-request', {
    action,
    payload
  })
}

async function projectIds(harness: ExtensionTestHarness): Promise<string[]> {
  const listed = content(await invoke(harness, 'video-project', { action: 'list' }))
  if (!Array.isArray(listed.projects)) throw new Error('Expected project list')
  return listed.projects.map((project) => String(object(project).id)).sort()
}

function latestRequest(harness: ExtensionTestHarness, method: string): JsonObject {
  const request = harness.transport.requests.filter((entry) => entry.method === method).at(-1)?.params
  return object(request)
}

function content(value: ToolResult): JsonObject {
  return object(value.content)
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object')
  }
  return value as JsonObject
}

function exportHandle(handleId: string, displayName: string): JsonObject {
  return {
    handleId,
    mode: 'export',
    kind: 'data',
    displayName,
    mimeType: 'application/x-otio+json'
  }
}

function readHandle(handleId: string, displayName: string): JsonObject {
  return {
    handleId,
    mode: 'read',
    kind: 'data',
    displayName,
    mimeType: 'application/x-otio+json',
    byteSize: 0
  }
}
