import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { buildMemoryToolProviders } from '../src/adapters/tool/memory-tool-provider.js'
import { KunCapabilitiesConfig, type MemoryCapabilityConfig } from '../src/contracts/capabilities.js'
import { FileMemoryStore } from '../src/memory/memory-store.js'
import type { ModelClient, ModelRequest } from '../src/ports/model-client.js'
import { dispatchRequest } from '../src/server/http-server.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('Memory store and recall', () => {
  let dir = ''
  let nextId = 1

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-memory-'))
    nextId = 1
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores scoped memories, retrieves relevant records, and keeps tombstones', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'User prefers pnpm for frontend projects',
      scope: 'workspace',
      workspace: '/tmp/ws',
      tags: ['frontend'],
      confidence: 0.9
    })
    await store.create({
      content: 'Unrelated backend preference',
      scope: 'workspace',
      workspace: '/tmp/other'
    })

    expect((await store.retrieve({ query: 'frontend pnpm preference', workspace: '/tmp/ws', limit: 3 })).map((item) => item.id)).toEqual([memory.id])
    expect(await createStore({ enabled: false }).retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])

    await store.update(memory.id, { disabled: true })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    await store.update(memory.id, { disabled: false, content: 'User strongly prefers pnpm' })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toHaveLength(1)
    await store.delete(memory.id)
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    expect((await store.list({ workspace: '/tmp/ws', includeDeleted: true })).find((item) => item.id === memory.id)?.deletedAt).toBeTruthy()
  })

  it('exposes memory API routes with diagnostics', async () => {
    const h = buildHarness()
    h.runtime.memoryStore = createStore()
    const created = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Remember pnpm',
          scope: 'workspace',
          workspace: '/tmp/ws'
        })
      })
    )
    expect(created.status).toBe(201)
    const body = await readJson(created) as { memory: { id: string } }

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect((await readJson(list)) as { memories: unknown[] }).toMatchObject({ memories: [expect.any(Object)] })

    const disabled = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}?workspace=/tmp/ws`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true })
      })
    )
    expect(disabled.status).toBe(200)
    const deleted = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}?workspace=/tmp/ws`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(200)
    const diagnostics = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory/diagnostics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(await readJson(diagnostics)).toMatchObject({ tombstoneCount: 1 })
  })

  it('gates memory mutation tools through approval', async () => {
    const store = createStore()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildMemoryToolProviders(store))
    })
    let approvals = 0
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'memory_create',
      arguments: { content: 'Use pnpm', workspace: '/tmp/forged' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'on-request',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => {
        approvals += 1
        return 'allow'
      }
    })

    expect(approvals).toBe(1)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(await store.list({ workspace: '/tmp/ws' })).toHaveLength(1)
    expect(await store.list({ workspace: '/tmp/forged' })).toEqual([])
  })

  it('injects relevant memories into AgentLoop metadata and stops after deletion', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'Use pnpm when touching frontend code',
      scope: 'workspace',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequests.at(-1)?.contextInstructions?.join('\n')).toContain(memory.id)
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([memory.id])
    expect((await store.diagnostics()).lastInjectedIds).toEqual([memory.id])

    await store.delete(memory.id)
    const h2 = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h2, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })
    await h2.loop.runTurn(h2.threadId, h2.turnId)
    const finalInstructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(finalInstructions).not.toContain(memory.id)
    expect(finalInstructions).toContain('<shell_environment>')
  })

  it('injects project memory into new threads only inside the same project', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'Project Alpha release command is pnpm ship',
      scope: 'project',
      workspace: '/tmp/project-alpha'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }

    const sameProject = makeHarness(model, { memoryStore: store })
    await bootstrapThread(sameProject, {
      workspace: '/tmp/project-alpha',
      request: { prompt: 'What is the pnpm release command?' }
    })
    await sameProject.loop.runTurn(sameProject.threadId, sameProject.turnId)
    expect(seenRequests.at(-1)?.contextInstructions?.join('\n')).toContain(memory.id)

    const otherProject = makeHarness(model, { memoryStore: store })
    await bootstrapThread(otherProject, {
      workspace: '/tmp/project-beta',
      request: { prompt: 'What is the pnpm release command?' }
    })
    await otherProject.loop.runTurn(otherProject.threadId, otherProject.turnId)
    expect(seenRequests.at(-1)?.contextInstructions?.join('\n')).not.toContain(memory.id)
  })

  it('retrieves memories for CJK queries (regression: token-split-on-[^a-z0-9_])', async () => {
    const store = createStore()
    // Use workspace scope so this exercises the scored n-gram path. (user scope
    // is now injected unconditionally, which would mask the n-gram behavior.)
    const memory = await store.create({
      content: '用户的名字叫小明，喜欢用 TypeScript',
      scope: 'workspace',
      workspace: '/tmp/ws'
    })

    // A pure-Chinese query must match a Chinese memory. The previous
    // implementation split on [^a-z0-9_]+, which treated every CJK character
    // as a separator and returned an empty token set, so retrieval always
    // missed. With n-gram matching this must now succeed.
    const hits = await store.retrieve({ query: '用户叫什么名字', workspace: '/tmp/ws', limit: 3 })
    expect(hits.map((item) => item.id)).toEqual([memory.id])

    // Unrelated CJK query should not match.
    const misses = await store.retrieve({ query: '今天天气怎么样', workspace: '/tmp/ws', limit: 3 })
    expect(misses).toEqual([])
  })

  it('quarantines legacy workspace memories that have no workspace field', async () => {
    const store = createStore()
    // Older GUI versions created unbound workspace memories. Treating them as
    // global leaks their contents into every project, so they must stay out of
    // retrieval until the user recreates them with an explicit workspace.
    const memory = await store.create({
      content: 'Workspace prefers tabs over spaces',
      scope: 'workspace'
    })
    expect(memory.workspace).toBeUndefined()
    const hits = await store.retrieve({ query: 'tabs spaces indentation', workspace: '/tmp/ws', limit: 3 })
    expect(hits).toEqual([])
  })

  it('isolates project memories and scope-protects mutations', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'Project Alpha deploys with pnpm',
      scope: 'project',
      workspace: '/tmp/project-alpha'
    })

    const expectedProject = resolve('/tmp/project-alpha')
    expect(memory.project).toBe(process.platform === 'win32' ? expectedProject.toLowerCase() : expectedProject)
    expect(await store.retrieve({
      query: 'pnpm deploy',
      workspace: '/tmp/project-alpha/.',
      limit: 3
    })).toHaveLength(1)
    expect(await store.retrieve({
      query: 'pnpm deploy',
      workspace: '/tmp/project-beta',
      limit: 3
    })).toEqual([])
    await expect(store.update(memory.id, { content: 'leaked' }, {
      workspace: '/tmp/project-beta'
    })).rejects.toThrow(`memory not found: ${memory.id}`)
    await expect(store.delete(memory.id, {
      workspace: '/tmp/project-beta'
    })).rejects.toThrow(`memory not found: ${memory.id}`)
    await expect(store.update(memory.id, { content: 'Project Alpha uses npm' }, {
      workspace: '/tmp/project-alpha'
    })).resolves.toMatchObject({ content: 'Project Alpha uses npm' })
  })

  it('injects user-scope memories on semantic queries with zero keyword overlap', async () => {
    const store = createStore()
    const userMemory = await store.create({
      content: 'whitelonng',
      scope: 'user'
    })
    // "who am I" shares zero characters with "whitelonng". Keyword retrieval
    // (word or n-gram) cannot match this, so user memories must be injected
    // unconditionally instead of gated behind scored retrieval.
    const hits = await store.retrieve({ query: 'who am I', workspace: '/tmp/ws', limit: 8 })
    expect(hits.map((item) => item.id)).toContain(userMemory.id)

    // Chinese semantic query should also hit the user memory.
    const cjkHits = await store.retrieve({ query: '你知道我是谁吗', workspace: '/tmp/ws', limit: 8 })
    expect(cjkHits.map((item) => item.id)).toContain(userMemory.id)

    // Disabled user memories are still excluded.
    await store.update(userMemory.id, { disabled: true })
    const afterDisable = await store.retrieve({ query: 'who am I', workspace: '/tmp/ws', limit: 8 })
    expect(afterDisable.map((item) => item.id)).not.toContain(userMemory.id)
  })

  it('writes memory records atomically (no .tmp file left on success)', async () => {
    const store = createStore()
    await store.create({ content: 'atomic test memory' })

    // Final file present and parseable.
    const finalContents = await readFile(
      join(dir, 'memory', 'mem_1.json'),
      'utf8'
    )
    expect(finalContents.length).toBeGreaterThan(0)
    expect(JSON.parse(finalContents).content).toBe('atomic test memory')

    // No .tmp leftover from the atomic write.
    const entries = await readdir(join(dir, 'memory'))
    expect(entries.filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  function createStore(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return new FileMemoryStore({
      rootDir: join(dir, 'memory'),
      config: memoryConfig(overrides),
      nowIso: () => '2026-06-03T00:00:00.000Z',
      idGenerator: () => `mem_${nextId++}`
    })
  }

  function memoryConfig(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return KunCapabilitiesConfig.parse({
      memory: {
        enabled: true,
        ...overrides
      }
    }).memory
  }
})
