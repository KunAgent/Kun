import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantProfileStore } from './profile-store'
import { AssistantSecretStore } from './secret-store'
import { AssistantTaskStore } from './task-store'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'kun-am-store-')); dirs.push(dir); return dir }
const cipher = async () => ({ encrypt: async (text: string) => Buffer.from(`sealed:${text}`), decrypt: async (data: Buffer) => data.toString().slice(7) })

describe('assistant mailbox stores', () => {
  it('keeps enrollment secrets encrypted and forgets revoked ones after a grace period', async () => {
    const path = join(await temp(), 'secrets.enc')
    const store = new AssistantSecretStore(path, cipher)
    await store.set('a', 'secret-a', new Date('2026-10-22T00:00:00Z'))
    await store.set('b', 'secret-b', new Date('2026-10-22T00:00:00Z'))
    expect((await readFile(path, 'utf8')).startsWith('sealed:')).toBe(true)
    await store.retain(new Set(['a']), new Date('2026-10-22T00:05:00Z'))
    expect(await store.get('b')).toBe('secret-b')
    await store.retain(new Set(['a']), new Date('2026-10-22T00:11:00Z'))
    const reloaded = new AssistantSecretStore(path, cipher)
    expect([await reloaded.get('a'), await reloaded.get('b')]).toEqual(['secret-a', undefined])
  })

  it('applies each reply once, keeps cancellations, and files other messages as notes', async () => {
    const path = join(await temp(), 'tasks.json')
    const store = new AssistantTaskStore(path)
    const assistant = { id: 'as-1', name: 'Cue' }
    await store.addTask({ id: 't-1', assistantId: 'as-1', assistantName: 'Cue', title: 'Book', body: 'Book a table', createdAt: '2026-10-22T00:00:00Z' })
    const reply = { id: 'm-1', kind: 'reply' as const, createdAt: '2026-10-22T00:10:00Z', body: 'Booked', inReplyTo: 't-1', status: 'done' as const }
    await store.applyIncoming(assistant, reply)
    await store.applyIncoming(assistant, reply)
    await store.markCancelled('t-1')
    await store.applyIncoming(assistant, { ...reply, id: 'm-2', status: 'working' })
    await store.applyIncoming({ id: 'as-2', name: 'Grok' }, { ...reply, id: 'm-3' })
    await store.applyIncoming(assistant, { id: 'm-4', kind: 'note', createdAt: '2026-10-22T00:20:00Z', body: 'Hello', title: 'Hi' })
    const view = await new AssistantTaskStore(path).view(new Map([['as-1', 'Cue (renamed)']]))
    expect(view.tasks[0]).toMatchObject({ status: 'cancelled', assistantName: 'Cue (renamed)' })
    expect(view.tasks[0].updates.map((update) => update.status)).toEqual(['done', 'working'])
    expect(view.notes.map((note) => [note.assistantName, note.body])).toEqual([['Cue (renamed)', 'Hello'], ['Grok', 'Booked']])
  })

  it('records the user\'s own replies once and labels who wrote each note', async () => {
    const path = join(await temp(), 'tasks.json')
    const store = new AssistantTaskStore(path)
    const note = { id: 'm-9', assistantId: 'as-1', assistantName: 'Cue', body: 'Saturday', at: '2026-10-22T00:30:00Z', inReplyTo: 't-1' }
    await store.addOutgoingNote(note)
    await store.addOutgoingNote(note)
    await store.applyIncoming({ id: 'as-1', name: 'Cue' }, { id: 'm-10', kind: 'note', createdAt: '2026-10-22T00:40:00Z', body: 'Thanks' })
    const view = await new AssistantTaskStore(path).view(new Map())
    expect(view.notes.map((item) => [item.from, item.body])).toEqual([['assistant', 'Thanks'], ['you', 'Saturday']])
  })

  it('keeps custom assistant profiles on disk and drops the ones that no longer exist', async () => {
    const path = join(await temp(), 'profiles.json')
    const store = new AssistantProfileStore(path)
    await store.update('e-1', { product: 'Zo', website: 'https://zo.computer' })
    await store.update('e-1', { icon: 'data:image/png;base64,AAAA' })
    await store.update('e-2', { product: 'Other' })
    await store.retain(new Set(['e-1']))
    const reloaded = await new AssistantProfileStore(path).all()
    expect([...reloaded]).toEqual([['e-1', { product: 'Zo', website: 'https://zo.computer', icon: 'data:image/png;base64,AAAA' }]])
  })
})
