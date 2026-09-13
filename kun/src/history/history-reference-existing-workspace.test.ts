import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { historyReferenceFixture } from '../../tests/support/history-reference-fixtures.js'

it('recomputes old descriptor defaults at the frozen cutoff without moving existing branches', async () => {
  const f = await historyReferenceFixture()
  try {
    const nextWorkspace = join(f.root, 'project-B')
    await mkdir(nextWorkspace)
    const record = (type: string, payload: unknown) => JSON.stringify({ type, payload, timestamp: f.nowIso() })
    await writeFile(f.path, [
      record('session_meta', { id: 'changed-workspace', cwd: f.root }),
      record('event_msg', { type: 'task_started', turn_id: 'later' }),
      record('turn_context', { turn_id: 'later', cwd: nextWorkspace }),
      record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Work in B' }] }),
      record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] }),
      record('event_msg', { type: 'task_complete', turn_id: 'later' })
    ].join('\n') + '\n')
    const first = await f.historyReferences.createBranch({ path: f.path, workspace: f.root, idempotencyKey: 'old' })
    await f.historyReferences.store.put({ ...first.reference, workspace: f.root })
    const next = await f.historyReferences.createBranch({ referenceId: first.reference.id, idempotencyKey: 'new' })
    expect(next.thread.workspace).toBe(nextWorkspace)
    expect(next.reference.workspace).toBe(nextWorkspace)
    expect((await f.threadService.getMetadata(first.thread.id))?.workspace).toBe(f.root)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
