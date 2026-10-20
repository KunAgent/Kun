import { MemoryCapabilityConfig } from '../../kun/src/contracts/capabilities.js'
import { FileMemoryStore } from '../../kun/src/memory/memory-store.js'
import { memoryRelations } from '../../kun/src/server/routes/memory-relations.js'
import type { ServerRuntime } from '../../kun/src/server/routes/server-runtime.js'
import type { ModelClient } from '../../kun/src/ports/model-client.js'

// Synthetic provider: validates plumbing, not the quality of a real model.
export async function createRelationSmokeBackend(rootDir: string) {
  const options = { rootDir, config: MemoryCapabilityConfig.parse({ enabled: true }) }
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
      if (method !== 'POST' || !['/v1/memory/relations', '/v1/memory/relations/analyze'].includes(path)) {
        throw new Error('Unexpected fixture request')
      }
      const runtime = { memoryStore: store, modelClient: model, defaultModel: 'fixture' } as ServerRuntime
      const result = await memoryRelations(runtime, new Request('http://localhost' + path, {
        method, headers: { 'content-type': 'application/json' }, body
      }), path.endsWith('/analyze'))
      return { ok: result.status >= 200 && result.status < 300, ...result }
    },
    async reopen() { store = new FileMemoryStore(options) },
    async editTarget() { await store.update(target.id, { content: 'The project database uses SQLite.' }) },
    async eraseTarget() {
      const current = await store.getById(target.id)
      await store.lifecycle(target.id, { action: 'erase', expectedRevision: current.revision,
        confirmation: { memoryId: target.id, irreversible: true } })
    },
    async snapshot() {
      return store.relations({ action: 'list', memoryId: source.id, access: {} })
    }
  }
}
