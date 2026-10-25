import { MemoryCapabilityConfig } from '../../kun/src/contracts/capabilities.js'
import { FileMemoryStore } from '../../kun/src/memory/memory-store.js'
import { memoryRelations } from '../../kun/src/server/routes/memory-relations.js'
import { previewMemoryWorkingContext } from '../../kun/src/server/routes/memory-working-context.js'
import { resolveMemoryTurnContext } from '../../kun/src/memory/memory-turn-context.js'
import { relationBinding } from '../../kun/src/memory/memory-relations.js'
import type { ServerRuntime } from '../../kun/src/server/routes/server-runtime.js'
import type { ModelClient } from '../../kun/src/ports/model-client.js'

// Synthetic provider: validates plumbing, not the quality of a real model.
export async function createRelationSmokeBackend(rootDir: string) {
  let config = MemoryCapabilityConfig.parse({ enabled: true })
  const options = { rootDir, config: () => config }
  let store = new FileMemoryStore(options)
  const source = await store.createWithId('mem_source', {
    content: 'The project database uses PostgreSQL 17.', scope: 'user'
  })
  const target = await store.createWithId('mem_target', {
    content: 'The project database uses PostgreSQL 16.', scope: 'user'
  })
  const extension = await store.createWithId('mem_extension', {
    content: 'The project database uses PostgreSQL 17 with daily backups.', scope: 'user'
  })
  let calls = 0
  const model: ModelClient = {
    provider: 'synthetic', model: 'fixture',
    async *stream() {
      calls++
      yield { kind: 'assistant_text_delta', text: JSON.stringify({ relations: [
        { targetId: target.id, kind: 'contradicts', sourceQuote: 'PostgreSQL 17', targetQuote: 'PostgreSQL 16' },
        { targetId: extension.id, kind: 'confirms', sourceQuote: 'PostgreSQL 17', targetQuote: 'PostgreSQL 17' }
      ] }) }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
  return {
    source,
    get calls() { return calls },
    async request(path: string, method: string, body: string) {
      if (method !== 'POST' || !['/v1/memory/relations', '/v1/memory/relations/analyze', '/v1/memory/context/preview'].includes(path)) {
        throw new Error('Unexpected fixture request')
      }
      const runtime = { memoryStore: store, modelClient: model, defaultModel: 'fixture' } as ServerRuntime
      const request = new Request('http://localhost' + path, {
        method, headers: { 'content-type': 'application/json' }, body
      })
      const result = path.endsWith('/preview')
        ? await previewMemoryWorkingContext(runtime, request)
        : await memoryRelations(runtime, request, path.endsWith('/analyze'))
      return { ok: result.status >= 200 && result.status < 300, ...result }
    },
    async reopen() { store = new FileMemoryStore(options) },
    configureRelations(enabled: boolean) { config = MemoryCapabilityConfig.parse({ enabled: true, relationContextEnabled: enabled }) },
    async turnContext() { return resolveMemoryTurnContext(store, { query: 'project database PostgreSQL', workspace: rootDir }) },
    async editTarget() { await store.update(target.id, { content: 'The project database uses SQLite.' }) },
    async eraseTarget() {
      const current = await store.getById(target.id)
      await store.lifecycle(target.id, { action: 'erase', expectedRevision: current.revision,
        confirmation: { memoryId: target.id, irreversible: true } })
    },
    async snapshot() {
      return store.relations({ action: 'list', memoryId: source.id, access: {} })
    },
    async seedPagination() {
      let oldestId = ''
      let oldestTarget = target
      for (let index = 0; index < 25; index++) {
        const record = await store.createWithId(`mem_page_${index}`, { content: `Synthetic page sample ${index}.`, scope: 'user' })
        const proposal = { source: relationBinding(source), target: relationBinding(record), kind: 'extends' as const,
          sourceEvidence: { start: 0, end: 3 }, targetEvidence: { start: 0, end: 9 } }
        const id = (await store.relations({ action: 'propose', proposals: [proposal], access: {} })).relations[0].suggestion.id
        if (index === 0) {
          oldestId = id
          oldestTarget = record
          await store.relations({ action: 'review', id, decision: 'accepted', access: {} })
        }
      }
      return { id: oldestId, projection: () => store.relationContext({
        selected: [source, oldestTarget].map(({ id, revision, content }) => ({ id, revision, content })),
        access: {}, purpose: 'injection', remainingCharacters: 1600
      }) }
    }
  }
}
