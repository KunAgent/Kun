import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { sharedAttachmentDirectory } from '../attachments/shared-attachment-content.js'
import { KunCapabilitiesConfig } from '../contracts/capabilities.js'
import { makeUserItem } from '../domain/item.js'
import { TurnAttachmentService } from './turn-attachment-service.js'
import { createToolExecutionContext } from './tool-context-factory.js'
import { createToolDiscoveryContext } from './tool-discovery-context-factory.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { buildImageGenToolProviders, type ImageGenClient } from '../adapters/tool/image-gen-tool-provider.js'
import { png } from '../../tests/support/attachment-store-fixtures.js'
import type { ToolDispatchInput } from './turn-execution-types.js'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
const model = { id: 'vision', inputModalities: ['text' as const, 'image' as const], outputModalities: ['text' as const], supportsToolCalling: true, messageParts: ['text' as const, 'image_url' as const] }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-shared-model-alias-')), threadId = 'thread_' + Date.now()
  const config = KunCapabilitiesConfig.parse({ attachments: { enabled: true }, imageGen: { enabled: true, baseUrl: 'https://fake.invalid', apiKey: 'test', model: 'fake' } })
  const store = new FileAttachmentStore({ rootDir: join(root, 'store'), config: config.attachments })
  const originalPath = join(root, 'PRIVATE_FILENAME.png'), bytes = png(4, 4)
  const original = await store.create({ name: 'PRIVATE_FILENAME.png', data: bytes, mimeType: 'image/png', threadId, workspace: root, localFilePath: originalPath })
  return { root, threadId, config, store, original, bytes, service: new TurnAttachmentService(store),
    close: async () => { await rm(sharedAttachmentDirectory(threadId), { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) } }
}
describe('shared alias snapshots reach model and tool consumers', () => {
  it('carries a persisted native shared alias through the real AgentLoop model request', async () => {
    const f = await fixture(), requests: ModelRequest[] = []
    try {
      const modelClient: ModelClient = { provider: 'fake', model: 'fake', async *stream(request) {
        requests.push(request); yield { kind: 'assistant_text_delta', text: 'received' }; yield { kind: 'completed', stopReason: 'stop' }
      } }
      const h = makeHarness(modelClient, { attachmentStore: f.store, modelCapabilities: () => model, tools: [] })
      const thread = await h.threads.create({ workspace: f.root, model: 'fake', mode: 'agent' })
      const turn = await h.turns.startTurn({ threadId: thread.id, request: { prompt: 'look at this image', attachmentIds: [f.original.id], clientSurface: 'api' } },
        { attachmentAliases: [{ attachmentId: f.original.id, displayName: 'visitor.png', mimeType: 'image/png', byteSize: f.bytes.length }] })
      expect(await h.loop.runTurn(thread.id, turn.turnId)).toBe('completed')
      expect(requests.length).toBeGreaterThan(0)
      expect(JSON.stringify(requests)).not.toContain('PRIVATE_FILENAME')
      expect(JSON.stringify(requests)).toContain('visitor.png')
      const user = (await h.sessionStore.loadItems(thread.id)).find((item) => item.kind === 'user_message')!
      expect(user).toMatchObject({ attachmentAliases: [{ attachmentId: f.original.id, displayName: 'visitor.png' }] })
      await rm(sharedAttachmentDirectory(thread.id), { recursive: true, force: true })
    } finally { await f.close() }
  })
  it('replaces current and retained model names/paths without changing ordinary undefined behavior', async () => {
    const f = await fixture()
    try {
      const base = { attachmentIds: [f.original.id], threadId: f.threadId, workspace: f.root, modelCapabilities: model }
      expect((await f.service.resolveTurnAttachments(base)).imageAttachments[0]).toMatchObject({ name: 'PRIVATE_FILENAME.png', localFilePath: f.original.localFilePath })
      const aliases = [{ attachmentId: f.original.id, displayName: 'phone.png' }]
      const current = await f.service.resolveTurnAttachments({ ...base, attachmentAliases: aliases })
      expect(current.imageAttachments[0].name).toBe('phone.png')
      expect(JSON.stringify(current)).not.toContain('PRIVATE_FILENAME')
      expect(await readFile(current.imageAttachments[0].localFilePath!)).toEqual(f.bytes)
      const items = [makeUserItem({ id: 'old_user', threadId: f.threadId, turnId: 'old_turn', text: 'old', attachmentIds: [f.original.id] }),
        makeUserItem({ id: 'shared_user', threadId: f.threadId, turnId: 'shared_turn', text: 'shared', attachmentIds: [f.original.id], attachmentAliases: aliases })]
      const history = await f.service.resolveHistoryAttachments({ items, threadId: f.threadId, workspace: f.root, modelCapabilities: model, restrictMetadata: true })
      expect(history.old_user.images[0].name).toBe('attachment.png'); expect(history.shared_user.images[0].name).toBe('phone.png')
      expect(JSON.stringify(history)).not.toContain('PRIVATE_FILENAME')
      const normalHistory = await f.service.resolveHistoryAttachments({ items, threadId: f.threadId, workspace: f.root, modelCapabilities: model })
      expect(normalHistory.old_user.images[0].name).toBe('PRIVATE_FILENAME.png')
      expect(normalHistory.shared_user.images[0].name).toBe('phone.png')
    } finally { await f.close() }
  })
  it('retains [] through discovery/execution and sends safe multipart names to image generation', async () => {
    const f = await fixture()
    try {
      const input: ToolDispatchInput = { calls: [], toolProviderKinds: new Map(), threadId: f.threadId, turnId: 'turn', workspace: f.root,
        attachmentAliases: [], clientSurface: 'api', threadMode: 'agent', activeSkillIds: [], modelCapabilities: model,
        approvalPolicy: 'auto', sandboxMode: 'workspace-write', signal: new AbortController().signal }
      const bridge = { awaitApproval: vi.fn(async () => 'allow' as const), awaitUserInput: vi.fn() }
      expect(createToolDiscoveryContext(input, { memoryEnabled: false, interactiveToolBridge: bridge }).attachmentAliases).toEqual([])
      const context = createToolExecutionContext(input, { memoryEnabled: false, interactiveToolBridge: bridge })
      expect(context.attachmentAliases).toEqual([])
      const edit = vi.fn(async () => ({ data: f.bytes, mimeType: 'image/png' })), client = { id: 'fake', generate: edit, edit } as ImageGenClient
      const host = new LocalToolHost({ registry: new CapabilityRegistry(buildImageGenToolProviders(f.config.imageGen, { client, attachmentStore: f.store }).providers) })
      const result = await host.execute({ callId: 'reference', toolName: 'generate_image', arguments: { prompt: 'edit', reference_attachment_ids: [f.original.id] } }, context)
      expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
      expect((edit.mock.calls[0] as unknown as [any])[0].images[0].name).toBe('attachment.png')
      expect(JSON.stringify(result.item)).not.toContain('PRIVATE_FILENAME')
      edit.mockClear()
      await host.execute({ callId: 'named', toolName: 'generate_image', arguments: { prompt: 'edit', reference_attachment_ids: [f.original.id] } },
        { ...context, attachmentAliases: [{ attachmentId: f.original.id, displayName: 'visitor.png' }] })
      expect((edit.mock.calls[0] as unknown as [any])[0].images[0].name).toBe('visitor.png')
      const prepared = await f.service.resolveTurnAttachments({ attachmentIds: [f.original.id], threadId: f.threadId,
        workspace: f.root, modelCapabilities: model, attachmentAliases: [] })
      edit.mockClear()
      const fromPath = await host.execute({ callId: 'safe_path', toolName: 'generate_image', arguments: { prompt: 'edit',
        reference_image_paths: [prepared.imageAttachments[0].localFilePath] } }, context)
      expect(fromPath.item).toMatchObject({ kind: 'tool_result', isError: false })
      expect((edit.mock.calls[0] as unknown as [any])[0].images[0].name).toBe(f.original.id + '.png')
    } finally { await f.close() }
  })
})
