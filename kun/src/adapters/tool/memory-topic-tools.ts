import { MemoryScope } from '../../contracts/memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { memoryInScope } from '../../memory/memory-ranking.js'
import { resolveMemoryProjectAccess } from '../../memory/memory-project-identity.js'
import { buildMemoryTopicIndex, MEMORY_TOPIC_INDEX_MAX_RECORDS } from '../../memory/memory-topic-index.js'
import { LocalToolHost } from './local-tool-host.js'
import { fitsMemoryToolOutput, MEMORY_READ_NOTICE } from './memory-tool-output.js'

const MEMORY_TOPIC_SCAN_LIMIT = 500

/** Derived discovery only. Canonical records and normal read authorization remain authoritative. */
export function buildMemoryTopicsTool(store: MemoryStore) {
  return LocalToolHost.defineTool({
    name: 'memory_topics',
    description: 'Discover a compact topic index from a bounded window of active visible memories. ' +
      'Use the returned memory IDs with memory_read; use memory_list to enumerate beyond this window. ' +
      'Topic counts are window-local, not global totals.',
    shouldAdvertise: (context) => context.memoryPolicy?.enabled === true,
    inputSchema: {
      type: 'object', properties: { scope: { type: 'string', enum: MemoryScope.options } },
      additionalProperties: false
    },
    sideEffect: 'read-only',
    policy: 'auto',
    execute: async (args, context) => {
      if (context.memoryPolicy?.enabled !== true) {
        return { output: { error: 'memory is disabled' }, isError: true }
      }
      if (args.scope !== undefined && !MemoryScope.options.includes(args.scope as never)) {
        return { output: { error: 'invalid scope' }, isError: true }
      }
      const access = await resolveMemoryProjectAccess({ workspace: context.workspace })
      const allowedScopes = MemoryScope.options.filter((scope) =>
        !context.memoryPolicy?.scopes || context.memoryPolicy.scopes.includes(scope))
      const rows = await store.list({ ...access, limit: MEMORY_TOPIC_SCAN_LIMIT })
      const records = rows.filter((record) => memoryInScope(record, access, allowedScopes) &&
        (args.scope === undefined || record.scope === args.scope))
      const index = buildMemoryTopicIndex(records, access)
      const output = {
        notice: MEMORY_READ_NOTICE,
        derived: true,
        canonicalDigest: index.canonicalDigest,
        topics: [] as typeof index.topics,
        truncated: index.truncated || rows.length >= MEMORY_TOPIC_SCAN_LIMIT,
        scanLimit: MEMORY_TOPIC_SCAN_LIMIT,
        indexedRecordLimit: MEMORY_TOPIC_INDEX_MAX_RECORDS,
        countScope: 'bounded-active-window'
      }
      for (const topic of index.topics) {
        if (!fitsMemoryToolOutput({ ...output, topics: [...output.topics, topic], truncated: true })) {
          output.truncated = true
          break
        }
        output.topics.push(topic)
      }
      return { output }
    }
  })
}
