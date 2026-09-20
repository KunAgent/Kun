import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHistoryReference, readHistoryPage } from './codex-history.js'
import { readHistoryAttachment } from './history-reference-attachments.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlN8AAAAASUVORK5CYII='
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function root() {
  const directory = await mkdtemp(join(tmpdir(), 'kun-source-attachment-'))
  roots.push(directory)
  return directory
}
async function fixture(directory: string, content: unknown[], payload?: Record<string, unknown>) {
  const path = join(directory, 'rollout.jsonl')
  const records = [
    { type: 'session_meta', payload: { id: 'attachment-source', cwd: directory } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'first' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content } },
    ...(payload ? [{ type: 'response_item', payload }] : []),
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'first' } }
  ]
  await writeFile(path, records.map((record) => JSON.stringify({ timestamp: '2026-09-13T00:00:00Z', ...record })).join('\n') + '\n')
  const reference = await createHistoryReference(path)
  const page = await readHistoryPage(reference, { threadId: 'branch' })
  return { path, reference, page, item: page.turns.flatMap((turn) => turn.items).find((item) => item.sourceAttachments?.length)! }
}

describe('read-only source attachments', () => {
  it('projects descriptors without base64 bodies and reads embedded images only on demand', async () => {
    const h = await fixture(await root(), [{ type: 'input_image', image_url: `data:image/png;base64,${PNG}` }])
    expect(h.item.sourceAttachments).toEqual([{ index: 0, name: 'Codex image' }])
    expect(JSON.stringify(h.page)).not.toContain(PNG)
    const before = await readFile(h.path, 'utf8')
    expect(await readHistoryAttachment(h.reference, h.item.id, 0)).toEqual({
      name: 'Codex image', mimeType: 'image/png', dataBase64: PNG
    })
    expect(await readFile(h.path, 'utf8')).toBe(before)
  })

  it('reads declared workspace files and generated image results without creating Kun attachments', async () => {
    const directory = await root()
    await writeFile(join(directory, 'notes.txt'), 'source notes')
    const h = await fixture(directory, [{ type: 'input_file', path: 'notes.txt', filename: 'notes.txt' }],
      { type: 'image_generation_call', result: PNG })
    expect(await readHistoryAttachment(h.reference, h.item.id, 0)).toEqual({
      name: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from('source notes').toString('base64')
    })
    const generated = h.page.turns.flatMap((turn) => turn.items).find((item) => item.sourceAttachments?.[0]?.name === 'Generated image')!
    expect((await readHistoryAttachment(h.reference, generated.id, 0)).mimeType).toBe('image/png')
  })

  it('rejects arbitrary paths, symlink escapes, missing IDs and remote URL fetches', async () => {
    const directory = await root()
    const outside = await root()
    const privatePath = join(outside, 'private.txt')
    await writeFile(privatePath, 'not a declared workspace file')
    await symlink(privatePath, join(directory, 'escape.txt'))
    const h = await fixture(directory, [
      { type: 'input_file', path: privatePath },
      { type: 'input_file', path: 'escape.txt' },
      { type: 'input_image', image_url: 'https://example.test/private.png' }
    ])
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(readHistoryAttachment(h.reference, h.item.id, 0)).rejects.toThrow(/outside/)
    await expect(readHistoryAttachment(h.reference, h.item.id, 1)).rejects.toThrow(/outside/)
    await expect(readHistoryAttachment(h.reference, h.item.id, 2)).rejects.toThrow(/Remote/)
    await expect(readHistoryAttachment(h.reference, 'outside-item', 0)).rejects.toThrow(/unavailable/)
    await expect(readHistoryAttachment(h.reference, h.item.id, 31)).rejects.toThrow(/does not exist/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not trust source MIME declarations and refuses changed history', async () => {
    const malicious = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')
    const h = await fixture(await root(), [{ type: 'input_image', image_url: `data:image/png;base64,${malicious}` }])
    expect((await readHistoryAttachment(h.reference, h.item.id, 0)).mimeType).toBe('application/octet-stream')
    const contents = await readFile(h.path, 'utf8')
    await writeFile(h.path, contents.replace(malicious, PNG))
    await expect(readHistoryAttachment(h.reference, h.item.id, 0)).rejects.toThrow(/changed|truncated/)
  })
})
