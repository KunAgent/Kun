import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryReference, readSourceHistory } from './codex-history.js'
import type { ReadSourceHistoryOptions } from './codex-history-tool.js'

let root: string
let path: string
const record = (type: string, payload: unknown) => ({ timestamp: '2026-09-01T00:00:00.000Z', type, payload })
const message = (role: string, text: string) => record('response_item', {
  type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
})
const turn = (id: string, answer: string) => [record('turn_context', { turn_id: id }),
  message('user', `Question ${id}`), message('assistant', answer), record('event_msg', { type: 'task_complete', turn_id: id })]
const save = (turns: unknown[]) => writeFile(path, [record('session_meta', { id: 's', cwd: '/project' }), ...turns]
  .map((entry) => JSON.stringify(entry)).join('\n') + '\n')
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-codex-tool-')); path = join(root, 'rollout-session.jsonl') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const entries = (text: string): Array<{ id: string; text: string }> => Array.from(text.matchAll(/\[[^\n]+ \/ ([^\n]+) \/ [^\n]+\]\n([\s\S]*?)(?=\n\n\[|$)/g),
  (match) => ({ id: match[1], text: match[2] }))

describe('Codex history tool continuations', () => {
  it('reads long recent turns fully and resumes older turns without rereading newer ones', async () => {
    const answers = new Map([['a', 'A'.repeat(6500)], ['b', 'B'.repeat(13000)], ['c', 'C'.repeat(6100)]])
    await save([...answers].flatMap(([id, answer]) => turn(id, answer)))
    const reference = await createHistoryReference(path)
    let options: ReadSourceHistoryOptions = { operation: 'recent', limit: 1 }
    const reads: Array<{ id: string; text: string }> = []
    const operations: string[] = []
    for (let pageNumber = 0; ; pageNumber += 1) {
      expect(pageNumber).toBeLessThan(20)
      const result = await readSourceHistory(reference, options)
      expect(result.status).toBe('available')
      reads.push(...entries(result.text))
      operations.push(options.operation)
      if (!result.nextCursor) break
      expect(result.nextOperation).toBeDefined()
      options = { operation: result.nextOperation!, cursor: result.nextCursor, limit: 1, contentOffset: result.nextContentOffset }
    }
    const bodies = new Map<string, string>()
    for (const entry of reads) bodies.set(entry.id, (bodies.get(entry.id) ?? '') + entry.text)
    expect([...bodies.values()]).toEqual([
      'Question c', answers.get('c'), 'Question b', answers.get('b'), 'Question a', answers.get('a')
    ])
    expect(operations).toEqual(['recent', 'read', 'recent', 'read', 'read', 'recent', 'read'])
  })

  it('retains the original recent window when a result budget causes a mid-window continuation', async () => {
    await save(['a', 'b', 'c', 'd', 'e', 'f'].flatMap((id) => turn(id, id.repeat(5900))))
    const reference = await createHistoryReference(path)
    const latest = await readSourceHistory(reference, { operation: 'recent', limit: 1 })
    const window = await readSourceHistory(reference, { operation: 'recent', limit: 4, cursor: latest.nextCursor })
    expect(window.nextOperation).toBe('read')
    const tail = await readSourceHistory(reference, { operation: 'read', cursor: window.nextCursor })
    expect(tail.text).toContain('e'.repeat(5900))
    expect(tail.text).not.toContain('Question f')
    expect(tail.nextOperation).toBe('recent')
    const oldest = await readSourceHistory(reference, { operation: 'recent', cursor: tail.nextCursor })
    expect(oldest.text).toContain('Question a')
    expect(oldest.nextCursor).toBeUndefined()
    const seen = [...entries(latest.text), ...entries(window.text), ...entries(tail.text), ...entries(oldest.text)]
    expect(seen).toHaveLength(12)
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(12)
  })

  it('retains a requested turn scope and content offset even when only the returned cursor is passed', async () => {
    await save([...turn('a', 'A'.repeat(12500)), ...turn('b', 'Excluded answer b')])
    const reference = await createHistoryReference(path)
    let result = await readSourceHistory(reference, { operation: 'read', turnId: 'codex:s:a' })
    const reads = entries(result.text)
    while (result.nextCursor) {
      result = await readSourceHistory(reference, { operation: result.nextOperation!, cursor: result.nextCursor })
      reads.push(...entries(result.text))
    }
    expect(reads.map((entry) => entry.text).join('')).toBe('Question a' + 'A'.repeat(12500))
    expect(reads.every((entry) => entry.id.startsWith('codex:s:a:'))).toBe(true)
  })
})
