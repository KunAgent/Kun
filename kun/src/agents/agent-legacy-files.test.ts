import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { legacyAgentFiles } from './agent-legacy-files.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
it('pages beyond 200 messages and 100 root files without pretending paths are historical snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-legacy-files-'))
  const workspace = { id: 'workspace', path: join(root, 'files') }
  await mkdir(workspace.path)
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanup.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const puts = Array.from({ length: 225 }, (_, i) => ({ kind: 'message' as const, id: 'm' + i, roomId: 'room', value: {
    references: i === 0 ? [{ kind: 'agent_file', workspaceId: workspace.id, relativePath: 'old/nested.txt', titleSnapshot: 'Old' }] : []
  } }))
  await store.commit({ requestId: 'seed', puts, checks: puts.map((row) => ({ kind: row.kind, id: row.id, expectedRevision: null })) })
  await Promise.all(Array.from({ length: 105 }, (_, i) => writeFile(join(workspace.path, `file-${String(i).padStart(3, '0')}.txt`), 'current')))
  const found: string[] = []
  let cursor: string | undefined = 'start', pages = 0
  while (cursor) {
    const page = await legacyAgentFiles(store, 'room', workspace, cursor, '', 17)
    found.push(...page.files.map((file) => file.kind === 'agent_file' ? file.relativePath : ''))
    expect(page.files.every((file) => file.kind === 'agent_file' && !file.artifactId)).toBe(true)
    cursor = page.nextLegacyCursor
    expect(++pages).toBeLessThan(20)
  }
  expect(found).toHaveLength(106)
  expect(found).toContain('old/nested.txt')
  expect(found).toContain('file-104.txt')
  await expect(legacyAgentFiles(store, 'room', workspace, 'not-a-cursor')).rejects.toThrow('invalid legacy')
})
