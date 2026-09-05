import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import { FileMemoryStore } from '../../memory/memory-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildMemoryToolProviders } from './memory-tool-provider.js'

const roots: string[] = []
const policy: MemoryCapabilityConfig = {
  enabled: true,
  scopes: ['user', 'workspace', 'project'],
  maxInjectedRecords: 8
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('memory tool provider', () => {
  it('creates an approved memory with validated V2 fields', async () => {
    const store = await createStore('mem_tool_create')
    const tool = memoryTool(store, 'memory_create')

    expect(tool.policy).toBe('on-request')
    expect((tool.inputSchema.properties as Record<string, unknown>)).not.toHaveProperty('authority')
    const result = await tool.execute({
      content: '  Use pnpm for this workspace  ',
      scope: 'workspace',
      tags: ['tooling'],
      type: 'decision',
      confidence: 0.95,
      importance: 0.8,
      observedAt: '2026-08-28T00:00:00.000Z',
      validFrom: '2026-08-28T00:00:00.000Z',
      validTo: '2026-12-31T00:00:00.000Z',
      ttlDays: 2,
      sources: [{
        id: 'turn-evidence-1',
        kind: 'user',
        turnId: 'turn-1',
        excerpt: 'Use pnpm for this workspace',
        trust: 'explicit-user'
      }]
    }, context())

    expect(result.isError).not.toBe(true)
    await expect(store.list({ all: true })).resolves.toMatchObject([{
      id: 'mem_tool_create',
      content: 'Use pnpm for this workspace',
      scope: 'workspace',
      workspace: resolve('/workspace-a').toLowerCase(),
      sourceThreadId: 'thread-1',
      sourceTurnId: 'turn-1',
      provenance: { kind: 'user', turnId: 'turn-1', origin: 'memory_create' },
      tags: ['tooling'],
      type: 'decision',
      authority: 'reference',
      confidence: 0.95,
      importance: 0.8,
      observedAt: '2026-08-28T00:00:00.000Z',
      validFrom: '2026-08-28T00:00:00.000Z',
      validTo: '2026-12-31T00:00:00.000Z',
      expiresAt: '2026-08-30T00:00:00.000Z',
      sources: [{
        id: 'turn-evidence-1',
        kind: 'user',
        turnId: 'turn-1',
        excerpt: 'Use pnpm for this workspace',
        trust: 'explicit-user'
      }]
    }])
  })

  it('updates all mutable V2 fields and rejects invalid or empty patches', async () => {
    const store = await createStore('mem_tool_update')
    await store.createWithId('mem_existing', {
      content: 'Original memory', scope: 'workspace', workspace: '/workspace-a'
    })
    const tool = memoryTool(store, 'memory_update')

    const result = await tool.execute({
      id: 'mem_existing',
      content: 'Updated memory',
      tags: ['updated'],
      type: 'insight',
      confidence: 0.7,
      importance: 0.9,
      observedAt: '2026-08-27T00:00:00.000Z',
      validFrom: '2026-08-27T00:00:00.000Z',
      validTo: '2026-09-30T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabled: true,
      sources: [{
        kind: 'file',
        locator: 'docs/decision.md',
        excerpt: 'Updated memory',
        trust: 'observed'
      }]
    }, context())

    expect(result.isError).not.toBe(true)
    await expect(store.list({ all: true })).resolves.toMatchObject([{
      id: 'mem_existing',
      content: 'Updated memory',
      tags: ['updated'],
      type: 'insight',
      confidence: 0.7,
      importance: 0.9,
      observedAt: '2026-08-27T00:00:00.000Z',
      validFrom: '2026-08-27T00:00:00.000Z',
      validTo: '2026-09-30T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabledAt: '2026-08-28T00:00:00.000Z',
      sources: [{
        kind: 'file',
        locator: 'docs/decision.md',
        excerpt: 'Updated memory',
        trust: 'observed'
      }]
    }])

    await expect(tool.execute({
      id: 'mem_existing',
      validFrom: '2026-10-01T00:00:00.000Z',
      validTo: '2026-09-01T00:00:00.000Z'
    }, context())).resolves.toMatchObject({ isError: true })
    await expect(tool.execute({ id: 'mem_existing' }, context())).resolves.toMatchObject({ isError: true })

    const [unchanged] = await store.list({ all: true })
    expect(unchanged).toMatchObject({
      content: 'Updated memory',
      validFrom: '2026-08-27T00:00:00.000Z',
      validTo: '2026-09-30T00:00:00.000Z'
    })
  })

  it('rejects malformed V2 create fields instead of silently dropping them', async () => {
    const store = await createStore('mem_tool_invalid')
    const tool = memoryTool(store, 'memory_create')

    await expect(tool.execute({
      content: 'Invalid observation time',
      observedAt: 'not-an-iso-date'
    }, context())).resolves.toMatchObject({ isError: true })
    await expect(store.list({ all: true })).resolves.toEqual([])
  })
})

async function createStore(id: string): Promise<FileMemoryStore> {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-tool-'))
  roots.push(root)
  return new FileMemoryStore({
    rootDir: join(root, 'memory'),
    config: policy,
    idGenerator: () => id,
    nowIso: () => '2026-08-28T00:00:00.000Z'
  })
}

function memoryTool(store: FileMemoryStore, name: string) {
  const tool = buildMemoryToolProviders(store)[0]?.tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`missing memory tool: ${name}`)
  return tool
}

function context(): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/workspace-a',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}
