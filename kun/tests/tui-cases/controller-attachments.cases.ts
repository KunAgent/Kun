import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThreadSchema } from '../../src/contracts/threads.js'
import type { RuntimeEvent } from '../../src/contracts/events.js'
import type { ModelConnectionSnapshot } from '../../src/contracts/model-connections.js'
import type { KunTuiClient, ThreadDetail, TuiConnection } from '../../src/tui/client.js'
import { TuiClientError } from '../../src/tui/client.js'
import { TuiController } from '../../src/tui/controller.js'
import type { TuiOptions } from '../../src/tui/options.js'
import { buildRuntimeCapabilityManifest } from '../../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../../src/loop/model-context-profile.js'
import { testGraphEnvelope, testGraphPlan } from '../../src/graph/graph-test-fixtures.test-support.js'
import { testTuiGraphRun } from '../../src/tui/graph-mode.test-support.js'

function detail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_1',
      title: 'Shared',
      workspace: '/tmp/project',
      model: 'model-a',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      relation: 'primary',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: [],
    ...overrides
  }
}

function options(): TuiOptions {
  return {
    runtimeToken: 'secret',
    dataDir: '/tmp/data',
    workspace: '/tmp/project',
    continueLatest: true,
    noStart: false,
    help: false
  }
}

const runtime = {
  baseUrl: 'http://127.0.0.1:18899',
  runtimeToken: 'secret',
  discovered: true,
  runtimeInfo: {
    model: 'model-a',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write'
  }
} as unknown as TuiConnection

function credentialSnapshot(
  credentialStatus: 'ready' | 'missing' | 'unreadable' | undefined
): ModelConnectionSnapshot {
  return {
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision: 9,
    providers: [{
      id: 'legacy-provider',
      accountId: 'account:legacy-provider',
      name: 'Legacy Provider',
      kind: 'http',
      authType: 'api-key',
      endpointFormat: 'chat_completions',
      useProxy: false,
      configured: true,
      ...(credentialStatus ? { credentialStatus } : {}),
      models: ['model-a'],
      selectedModel: 'model-a'
    }],
    defaultProviderId: 'legacy-provider',
    defaultAccountId: 'account:legacy-provider',
    defaultModel: 'model-a',
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  }
}

describe("TuiController attachments", () => {
  it('hot-enables local attachment storage and sends uploaded files with the next turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-attachment-'))
    const file = join(root, 'notes.txt')
    await writeFile(file, 'hello')
    const source = detail({ workspace: root })
    const setLocalCapabilityEnabled = vi.fn(async () => ({ id: 'attachments' as const, enabled: true }))
    const uploadAttachment = vi.fn(async () => ({
      attachment: {
        id: 'attachment_1',
        name: 'notes.txt',
        kind: 'document' as const,
        mimeType: 'text/plain',
        byteSize: 5,
        hash: 'hash',
        localFilePath: file,
        threadIds: [source.id],
        workspaces: [root],
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      }
    }))
    const startTurn = vi.fn(async () => ({ turnId: 'turn_attachment' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      setLocalCapabilityEnabled,
      uploadAttachment,
      startTurn
    } as unknown as KunTuiClient
    const attachmentRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: buildRuntimeCapabilityManifest({
          model: modelCapabilitiesForModel('model-a')
        })
      }
    } as TuiConnection
    const controller = new TuiController(client, {
      ...options(),
      dataDir: join(root, 'data'),
      workspace: root
    }, attachmentRuntime)
    try {
      await controller.start()
      await controller.manageAttachments(file)
      expect(setLocalCapabilityEnabled).toHaveBeenCalledWith('attachments', true)
      expect(controller.state.pendingAttachments).toHaveLength(1)
      await controller.submit('read this')
      expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
        prompt: 'read this',
        attachmentIds: ['attachment_1']
      }))
      expect(controller.state.pendingAttachments).toEqual([])
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('binds distinct @file mentions to attachment IDs without rewriting the prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-file-mention-'))
    const notes = join(root, 'notes.txt')
    const design = join(root, 'design notes.md')
    await writeFile(notes, 'notes')
    await writeFile(design, '# design')
    const source = detail({ workspace: root })
    const uploadAttachment = vi.fn(async (input: {
      name: string
      mimeType: string
      localFilePath?: string
      dataBase64: string
    }) => ({
      attachment: {
        id: `attachment_${input.name}`,
        name: input.name,
        kind: 'document' as const,
        mimeType: input.mimeType,
        byteSize: Buffer.from(input.dataBase64, 'base64').length,
        hash: `hash_${input.name}`,
        localFilePath: input.localFilePath,
        threadIds: [source.id],
        workspaces: [root],
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      }
    }))
    const startTurn = vi.fn(async () => ({ turnId: 'turn_mentions' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      setLocalCapabilityEnabled: vi.fn(async () => ({ id: 'attachments' as const, enabled: true })),
      uploadAttachment,
      startTurn
    } as unknown as KunTuiClient
    const attachmentRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: buildRuntimeCapabilityManifest({
          model: modelCapabilitiesForModel('model-a')
        })
      }
    } as TuiConnection
    const controller = new TuiController(client, {
      ...options(),
      dataDir: join(root, 'data'),
      workspace: root
    }, attachmentRuntime)
    const prompt = 'Compare @notes.txt with @"design notes.md", then re-check @notes.txt'
    try {
      await controller.start()
      await expect(controller.prepareFileMentions(prompt)).resolves.toBe(true)
      expect(uploadAttachment).toHaveBeenCalledTimes(2)
      expect(controller.state.pendingAttachments.map((attachment) => attachment.name)).toEqual([
        'notes.txt',
        'design notes.md'
      ])

      await controller.submit(prompt)
      expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
        prompt,
        attachmentIds: ['attachment_notes.txt', 'attachment_design notes.md']
      }))
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rolls back staged mention leases and preserves existing pending attachments on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-file-mention-rollback-'))
    const existing = join(root, 'existing.txt')
    const staged = join(root, 'staged.txt')
    const unsupported = join(root, 'unsupported.bin')
    await writeFile(existing, 'existing')
    await writeFile(staged, 'staged')
    await writeFile(unsupported, Buffer.from([0, 1, 2, 3]))
    const source = detail({ workspace: root })
    const uploadAttachment = vi.fn(async (input: {
      name: string
      mimeType: string
      localFilePath?: string
      dataBase64: string
    }) => ({
      attachment: {
        id: `attachment_${input.name}`,
        name: input.name,
        kind: 'document' as const,
        mimeType: input.mimeType,
        byteSize: Buffer.from(input.dataBase64, 'base64').length,
        hash: `hash_${input.name}`,
        localFilePath: input.localFilePath,
        threadIds: [source.id],
        workspaces: [root],
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      }
    }))
    const releaseAttachment = vi.fn(async () => ({ released: true }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      setLocalCapabilityEnabled: vi.fn(async () => ({ id: 'attachments' as const, enabled: true })),
      uploadAttachment,
      releaseAttachment
    } as unknown as KunTuiClient
    const attachmentRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: buildRuntimeCapabilityManifest({
          model: modelCapabilitiesForModel('model-a')
        })
      }
    } as TuiConnection
    const controller = new TuiController(client, {
      ...options(),
      dataDir: join(root, 'data'),
      workspace: root
    }, attachmentRuntime)
    try {
      await controller.start()
      await controller.manageAttachments(existing)
      expect(controller.state.pendingAttachments.map((attachment) => attachment.name)).toEqual(['existing.txt'])

      await expect(controller.prepareFileMentions(
        'Use @staged.txt and @unsupported.bin'
      )).resolves.toBe(false)
      expect(controller.state.pendingAttachments.map((attachment) => attachment.name)).toEqual(['existing.txt'])
      expect(releaseAttachment).toHaveBeenCalledWith(
        'attachment_staged.txt',
        expect.stringMatching(/^tui_/u)
      )
      expect(controller.state.notification?.message).toContain('unsupported attachment type')
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an @file symlink whose canonical target is outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-file-mention-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'kun-tui-file-mention-outside-'))
    const target = join(outside, 'secret.txt')
    await writeFile(target, 'secret')
    await symlink(target, join(root, 'escape.txt'))
    const source = detail({ workspace: root })
    const uploadAttachment = vi.fn()
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      uploadAttachment
    } as unknown as KunTuiClient
    const controller = new TuiController(client, {
      ...options(),
      dataDir: join(root, 'data'),
      workspace: root
    }, runtime)
    try {
      await controller.start()
      await expect(controller.prepareFileMentions('Read @escape.txt')).resolves.toBe(false)
      expect(uploadAttachment).not.toHaveBeenCalled()
      expect(controller.state.notification?.message).toContain('outside the active workspace')
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('uploads a system clipboard image without requiring a local file path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-clipboard-image-'))
    const source = detail({ workspace: root })
    const bytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52
    ])
    const setLocalCapabilityEnabled = vi.fn(async () => ({ id: 'attachments' as const, enabled: true }))
    const uploadAttachment = vi.fn(async (input: {
      name: string
      mimeType?: string
      dataBase64?: string
      localFilePath?: string
    }) => ({
      attachment: {
        id: 'attachment_clipboard',
        name: input.name,
        kind: 'image' as const,
        mimeType: input.mimeType ?? 'image/png',
        byteSize: bytes.length,
        hash: 'clipboard-hash',
        threadIds: [source.id],
        workspaces: [root],
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      }
    }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      setLocalCapabilityEnabled,
      uploadAttachment
    } as unknown as KunTuiClient
    const attachmentRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: buildRuntimeCapabilityManifest({
          model: modelCapabilitiesForModel('model-a')
        })
      }
    } as TuiConnection
    const controller = new TuiController(client, {
      ...options(),
      dataDir: join(root, 'data'),
      workspace: root
    }, attachmentRuntime)
    try {
      await controller.start()
      expect(await controller.attachClipboardImage({
        bytes,
        mimeType: 'image/png',
        source: 'macos'
      })).toBe(true)
      expect(setLocalCapabilityEnabled).toHaveBeenCalledWith('attachments', true)
      expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({
        name: expect.stringMatching(/^clipboard-\d{14}\.png$/u),
        mimeType: 'image/png',
        dataBase64: bytes.toString('base64'),
        threadId: source.id,
        workspace: root
      }))
      expect(uploadAttachment.mock.calls[0]?.[0]).not.toHaveProperty('localFilePath')
      expect(controller.state.pendingAttachments).toHaveLength(1)
      expect(controller.state.notification?.message).toContain('Pasted clipboard image')
      expect(controller.removeLastPendingAttachment()).toBe(true)
      expect(controller.state.pendingAttachments).toEqual([])
      expect(controller.state.notification?.message).toContain('Removed clipboard-')
      expect(controller.removeLastPendingAttachment()).toBe(false)

      expect(await controller.attachClipboardImage({
        bytes,
        mimeType: 'image/png',
        source: 'macos'
      })).toBe(true)
      expect(controller.clearPendingAttachments()).toBe(true)
      expect(controller.state.pendingAttachments).toEqual([])
      expect(controller.state.notification?.message).toBe('Pending attachments cleared.')
      expect(controller.clearPendingAttachments()).toBe(false)
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('turns a pasted image path into a queued attachment and keeps it when the model is text-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-pasted-image-'))
    const file = join(root, 'screen shot.png')
    await writeFile(file, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 1, 0, 0, 0, 1
    ]))
    const source = detail({ workspace: root, model: 'text-only', providerId: 'custom' })
    const setLocalCapabilityEnabled = vi.fn(async () => ({ id: 'attachments' as const, enabled: true }))
    const uploadAttachment = vi.fn(async (input: { name: string; mimeType?: string; localFilePath?: string }) => ({
      attachment: {
        id: 'attachment_image',
        name: input.name,
        kind: 'image' as const,
        mimeType: input.mimeType ?? 'image/png',
        byteSize: 24,
        hash: 'image-hash',
        localFilePath: input.localFilePath,
        threadIds: [source.id],
        workspaces: [root],
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      }
    }))
    const startTurn = vi.fn(async () => ({ turnId: 'turn_image' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      setLocalCapabilityEnabled,
      uploadAttachment,
      startTurn
    } as unknown as KunTuiClient
    const attachmentRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: buildRuntimeCapabilityManifest({
          model: modelCapabilitiesForModel('text-only')
        })
      }
    } as TuiConnection
    const textOnly: ModelConnectionSnapshot = {
      schemaVersion: 1,
      proxyRoutingVersion: 1,
      revision: 1,
      providers: [{
        id: 'custom',
        accountId: 'account:custom',
        name: 'Custom',
        kind: 'http',
        authType: 'api-key',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['text-only'],
        selectedModel: 'text-only',
        modelCapabilities: {
          'text-only': {
            id: 'text-only',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }],
      defaultProviderId: 'custom',
      defaultAccountId: 'account:custom',
      defaultModel: 'text-only',
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    }
    const controller = new TuiController(client, {
      ...options(),
      dataDir: join(root, 'data'),
      workspace: root
    }, attachmentRuntime)
    try {
      await controller.start()
      controller.applyModelSelection(textOnly, false)
      expect(await controller.attachPastedPaths(`'${file}'`)).toBe(true)
      expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({
        name: 'screen shot.png',
        mimeType: 'image/png',
        localFilePath: await realpath(file)
      }))
      expect(controller.state.pendingAttachments).toHaveLength(1)
      expect(controller.validatePendingAttachmentsForCurrentModel()).toBe(false)
      expect(controller.state.notification?.message).toContain('does not support image input')
      expect(controller.state.notification?.message).toContain('still attached')
      expect(controller.state.pendingAttachments).toHaveLength(1)

      controller.applyModelSelection({
        ...textOnly,
        revision: 2,
        providers: [{
          ...textOnly.providers[0]!,
          models: ['vision'],
          selectedModel: 'vision',
          modelCapabilities: {
            vision: {
              id: 'vision',
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text', 'image_url']
            }
          }
        }],
        defaultModel: 'vision'
      }, false)
      // Registry events update the shared default for future sessions. The
      // current session changes only after an explicit model choice.
      controller.options.model = 'vision'
      expect(controller.validatePendingAttachmentsForCurrentModel()).toBe(true)
      await controller.submit('What is in this screenshot?')
      expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
        prompt: 'What is in this screenshot?',
        model: 'vision',
        attachmentIds: ['attachment_image']
      }))
      expect(controller.state.pendingAttachments).toEqual([])
    } finally {
      await controller.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps ordinary text and unsupported video paths in the composer paste flow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-pasted-video-'))
    const video = join(root, 'demo clip.mp4')
    await writeFile(video, 'not-a-real-video')
    const controller = new TuiController({} as KunTuiClient, {
      ...options(),
      workspace: root
    }, runtime)
    try {
      expect(await controller.attachPastedPaths('please inspect /tmp/example.png')).toBe(false)
      expect(await controller.attachPastedPaths(`'${video}'`)).toBe(false)
      expect(controller.state.notification?.message).toContain('does not support video input yet')
      expect(controller.state.notification?.message).toContain('kept in the composer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
