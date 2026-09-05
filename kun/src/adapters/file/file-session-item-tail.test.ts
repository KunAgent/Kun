import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeAssistantTextItem, makeUserItem } from '../../domain/item.js'
import { FileSessionItemIndex } from './file-session-item-index.js'
import { FileSessionStore } from './file-session-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function userItem(threadId: string, id: string) {
  return makeUserItem({ id, threadId, turnId: `turn_${id}`, text: id })
}

describe('messages.jsonl torn tails', () => {
  it('commits a valid final item missing only its newline before append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-item-tail-valid-'))
    roots.push(root)
    const threadId = 'thread_item_tail_valid'
    const directory = join(root, 'threads', threadId)
    const path = join(directory, 'messages.jsonl')
    await mkdir(directory, { recursive: true })
    await writeFile(path, JSON.stringify(userItem(threadId, 'old')))

    const store = new FileSessionStore({ dataDir: root })
    await store.appendItem(threadId, userItem(threadId, 'new'))

    expect((await store.loadItems(threadId)).map((item) => item.id)).toEqual(['old', 'new'])
    expect((await readFile(path, 'utf8')).split('\n').filter(Boolean)).toHaveLength(2)
    await expect(stat(join(directory, 'messages.torn-tail.json'))).rejects.toThrow()
  })

  it('records and removes a partial tail before append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-item-tail-partial-'))
    roots.push(root)
    const threadId = 'thread_item_tail_partial'
    const directory = join(root, 'threads', threadId)
    const path = join(directory, 'messages.jsonl')
    await mkdir(directory, { recursive: true })
    await writeFile(path, `${JSON.stringify(userItem(threadId, 'old'))}\n{"id":`)

    const store = new FileSessionStore({ dataDir: root })
    await store.appendItem(threadId, userItem(threadId, 'new'))

    expect((await store.loadItems(threadId)).map((item) => item.id)).toEqual(['old', 'new'])
    const evidence = JSON.parse(await readFile(join(directory, 'messages.torn-tail.json'), 'utf8')) as {
      truncatedBytes: number
      sampleBase64: string
    }
    expect(evidence.truncatedBytes).toBeGreaterThan(0)
    expect(Buffer.from(evidence.sampleBase64, 'base64').toString('utf8')).toContain('"id"')
    expect(await readFile(path, 'utf8')).toMatch(/\n$/)
  })

  it('repairs an interrupted append before finalizeLiveItem appends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-item-tail-finalize-'))
    roots.push(root)
    const threadId = 'thread_item_tail_finalize'
    const store = new FileSessionStore({ dataDir: root })
    await store.appendItem(threadId, userItem(threadId, 'old'))
    const path = join(root, 'threads', threadId, 'messages.jsonl')
    await appendFile(path, '{"id":')

    await new FileSessionStore({ dataDir: root }).finalizeLiveItem(threadId, makeAssistantTextItem({
      id: 'final', threadId, turnId: 'turn_final', text: 'final', status: 'completed'
    }))

    expect((await new FileSessionStore({ dataDir: root }).loadItems(threadId)).map((item) => item.id))
      .toEqual(['old', 'final'])
  })

  it('repairs the tail before rebuilding a v3 complete item index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-item-tail-index-'))
    roots.push(root)
    const threadId = 'thread_item_tail_index'
    const directory = join(root, 'threads', threadId)
    const sourcePath = join(directory, 'messages.jsonl')
    const indexPath = join(directory, 'messages-index.jsonl')
    const statePath = join(directory, 'messages-index.state.json')
    await mkdir(directory, { recursive: true })
    await writeFile(sourcePath, `${JSON.stringify(userItem(threadId, 'old'))}\n${JSON.stringify(userItem(threadId, 'tail'))}`)

    await new FileSessionItemIndex().rebuild({
      sourcePath, indexPath, statePath, threadId,
      evidencePath: join(directory, 'messages.torn-tail.json')
    })

    expect((await readFile(sourcePath, 'utf8')).endsWith('\n')).toBe(true)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      version: 3, tailReady: true, rowCount: 2, sourceBytes: (await stat(sourcePath)).size
    })
  })
})
