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
  maxInjectedRecords: 8,
  distillation: { enabled: false },
  directives: { enabled: true, maxRecords: 20, maxCharacters: 4_000 },
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('memory tool provider', () => {
  it('advertises memory tools only when the scoped memory policy is enabled', async () => {
    const store = await createStore('mem_tool_policy')
    const tool = memoryTool(store, 'memory_create')
    expect(tool.shouldAdvertise?.({ ...context(), memoryPolicy: { enabled: true } })).toBe(true)
    expect(tool.shouldAdvertise?.({ ...context(), memoryPolicy: { enabled: false } })).toBe(false)
    expect(tool.shouldAdvertise?.(context())).toBe(false)
  })

  it('creates an approved memory with validated V2 fields', async () => {
    const store = await createStore('mem_tool_create')
    const tool = memoryTool(store, 'memory_create')

    expect(tool.policy).toBe('on-request')
    expect(tool.inputSchema.properties).toMatchObject({
      authority: { enum: ['reference', 'directive'] }
    })
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

  it('advertises read-only memory_search and memory_list without approval', async () => {
    const store = await createStore('mem_tool_read')
    for (const name of ['memory_search', 'memory_list']) {
      const tool = memoryTool(store, name)
      expect(tool).toBeDefined()
      expect(tool.policy).toBe('auto')
      expect(tool.requiresApprovalInFullAccess).not.toBe(true)
      expect(tool.shouldAdvertise?.({ ...context(), memoryPolicy: { enabled: true } })).toBe(true)
      expect(tool.shouldAdvertise?.({ ...context(), memoryPolicy: { enabled: false } })).toBe(false)
    }
  })

  it('enumerates all active memories through memory_list', async () => {
    const store = await createStore('mem_tool_list')
    await store.createWithId('mem_list_a', {
      content: 'Prefers concise replies', scope: 'workspace', workspace: '/workspace-a'
    })
    await store.createWithId('mem_list_b', {
      content: 'Uses pnpm workspaces', scope: 'workspace', workspace: '/workspace-a'
    })
    const tool = memoryTool(store, 'memory_list')
    const result = await tool.execute({ workspace: '/workspace-a' }, context())
    expect(result.isError).not.toBe(true)
    const output = result.output as { memories: Array<{ id: string }> }
    expect(output.memories.map((memory) => memory.id)).toEqual(
      expect.arrayContaining(['mem_list_a', 'mem_list_b'])
    )
  })

  it('searches memories by query through memory_search', async () => {
    const store = await createStore('mem_tool_search')
    await store.createWithId('mem_search_a', {
      content: 'Always answer in English', scope: 'workspace', workspace: '/workspace-a'
    })
    await store.createWithId('mem_search_b', {
      content: 'zzqxv unrelated topic', scope: 'workspace', workspace: '/workspace-a'
    })
    const tool = memoryTool(store, 'memory_search')
    const result = await tool.execute(
      { query: 'answer in English', workspace: '/workspace-a' },
      { ...context(), memoryPolicy: { enabled: true } }
    )
    expect(result.isError).not.toBe(true)
    const output = result.output as { memories: Array<{ id: string }> }
    expect(output.memories.map((memory) => memory.id)).toContain('mem_search_a')
  })

  it('marks directive creation as requiring explicit approval', async () => {
    const store = await createStore('mem_tool_directive')
    const tool = memoryTool(store, 'memory_create')
    const requires = tool.requiresExplicitApproval
    expect(typeof requires).toBe('function')
    const call = (authority?: string) => ({
      callId: 'call-1',
      toolName: 'memory_create',
      arguments: { content: 'Reply in English', scope: 'user', ...(authority ? { authority } : {}) }
    })
    if (typeof requires !== 'function') throw new Error('expected predicate')
    expect(requires(call('directive'), context())).toBe(true)
    expect(requires(call(), context())).toBe(false)
    expect(requires(call('reference'), context())).toBe(false)
    expect(tool.requiresApprovalInFullAccess).toBe(true)
  })

  it('rejects updating a directive without repeating authority=directive', async () => {
    const store = await createStore('mem_tool_dir_update')
    await store.createWithId('mem_rule', {
      content: 'Reply in English', scope: 'user', authority: 'directive'
    })
    const tool = memoryTool(store, 'memory_update')
    await expect(tool.execute({
      id: 'mem_rule',
      content: 'Reply in French'
    }, context())).resolves.toMatchObject({ isError: true })
    const approved = await tool.execute({
      id: 'mem_rule',
      content: 'Reply in French',
      authority: 'directive'
    }, context())
    expect(approved.isError).not.toBe(true)
  })

  it('rejects re-enabling or re-timing a directive without authority=directive', async () => {
    const store = await createStore('mem_tool_dir_revive')
    await store.createWithId('mem_rule', {
      content: 'Reply in English', scope: 'user', authority: 'directive', disabled: true
    })
    const tool = memoryTool(store, 'memory_update')
    for (const patch of [
      { disabled: false },
      { expiresAt: null },
      { validTo: null },
      { validFrom: '2026-08-01T00:00:00.000Z' }
    ]) {
      await expect(tool.execute({ id: 'mem_rule', ...patch }, context()))
        .resolves.toMatchObject({ isError: true })
    }
    expect((await store.getById('mem_rule')).disabledAt).toBeDefined()
    // Removing a rule stays on the ordinary path.
    const demoted = await tool.execute({ id: 'mem_rule', authority: 'reference' }, context())
    expect(demoted.isError).not.toBe(true)
    // Reference memories keep the ordinary update path.
    await store.createWithId('mem_fact', { content: 'Uses pnpm', scope: 'user', disabled: true })
    const revived = await tool.execute({ id: 'mem_fact', disabled: false }, context())
    expect(revived.isError).not.toBe(true)
  })

  it('hides memories from scopes the memory policy disables in memory_list', async () => {
    const store = await createStore('mem_tool_scopes')
    await store.createWithId('mem_user_scope', { content: 'Prefers tabs', scope: 'user' })
    await store.createWithId('mem_ws_scope', {
      content: 'Uses pnpm', scope: 'workspace', workspace: '/workspace-a'
    })
    const tool = memoryTool(store, 'memory_list')
    const result = await tool.execute({}, {
      ...context(),
      memoryPolicy: { enabled: true, scopes: ['workspace'] }
    })
    const output = result.output as { memories: Array<{ id: string }> }
    expect(output.memories.map((memory) => memory.id)).toEqual(['mem_ws_scope'])
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
