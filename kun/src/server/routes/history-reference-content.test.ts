import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { historyReferenceFixture } from '../../../tests/support/history-reference-fixtures.js'
import type { HistoryPage } from '../../history/codex-history.js'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerHistoryReferenceRoutes } from './register-history-reference-routes.js'

it('reads every long source-tool-output fragment through HTTP without native persistence', async () => {
  const f = await historyReferenceFixture()
  try {
    const output = 'A'.repeat(16_384) + 'B'.repeat(16_384) + 'SOURCE_OUTPUT_TAIL'
    const path = join(f.root, 'long-output.jsonl')
    const records = [
      { type: 'session_meta', payload: { id: 'long-source', cwd: f.root } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'long-turn' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect output' }] } },
      { type: 'response_item', payload: { type: 'function_call', name: 'read', call_id: 'call-1', arguments: '{}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'long-turn' } }
    ]
    await writeFile(path, records.map((record) => JSON.stringify({ timestamp: f.nowIso(), ...record })).join('\n') + '\n')
    const { thread, reference } = await f.historyReferences.createBranch({ path, idempotencyKey: 'long-output' })
    const router = new Router()
    registerHistoryReferenceRoutes(router, { ...f, runtimeToken: 'test-token', insecure: false } as unknown as ServerRuntime)
    const read = async (query: string, referenceId = reference.id) => {
      const url = `http://kun/v1/history-sources/${referenceId}/timeline${query}`
      const matched = router.match('GET', new URL(url).pathname)!
      return await matched.handler(new Request(url, { headers: { authorization: 'Bearer test-token' } }), {
        params: matched.params
      }) as JsonResponse
    }
    const initial = JSON.parse((await read('')).body) as HistoryPage
    const item = initial.turns.flatMap((turn) => turn.items).find((candidate) => candidate.kind === 'tool_result')!
    expect(JSON.stringify(item)).not.toContain('SOURCE_OUTPUT_TAIL')
    const parts: string[] = []
    let offset: number | undefined = 0
    do {
      const response = await read(`?itemId=${encodeURIComponent(item.id)}&contentOffset=${offset}`)
      expect(response.status).toBe(200)
      const content = (JSON.parse(response.body) as HistoryPage).content!
      expect(content).toMatchObject({ itemId: item.id, field: 'output', offset, totalChars: output.length })
      expect(content.text.length).toBeLessThanOrEqual(16_384)
      parts.push(content.text)
      offset = content.nextOffset
    } while (offset !== undefined)
    expect(parts.join('')).toBe(output)
    const unrelated = JSON.parse((await read(`?itemId=${encodeURIComponent(item.id)}&contentOffset=0`, f.reference.id)).body) as HistoryPage
    expect(unrelated.content).toBeUndefined()
    expect(unrelated.turns).toEqual([])
    expect(await f.sessionStore.loadItems(thread.id)).toEqual([])
    expect((await f.threadService.getMetadata(thread.id))?.turns).toEqual([])
    f.disable()
    expect((await read(`?itemId=${encodeURIComponent(item.id)}&contentOffset=0`)).status).toBe(403)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
