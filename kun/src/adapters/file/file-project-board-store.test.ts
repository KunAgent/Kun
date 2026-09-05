import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectBoardRevisionConflictError } from '../../ports/project-board-store.js'
import { FileProjectBoardStore } from './file-project-board-store.js'

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'kun-project-board-store-'))
  temporary.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  await mkdir(workspace)
  let tick = 0
  const store = new FileProjectBoardStore({
    dataDir,
    nowIso: () => `2026-08-31T00:00:0${tick++}.000Z`
  })
  return { root, workspace, dataDir, store }
}

describe('FileProjectBoardStore', () => {
  it('increments revisions atomically and rejects a stale writer', async () => {
    const { workspace, store } = await setup()
    const initial = await store.read(workspace)
    expect(initial.document.revision).toBe(0)
    const written = await store.mutate(workspace, 0, (document) => document)
    expect(written.document.revision).toBe(1)
    await expect(store.mutate(workspace, 0, (document) => document))
      .rejects.toBeInstanceOf(ProjectBoardRevisionConflictError)
  })

  it('preserves a corrupt document and returns a visible empty-board warning', async () => {
    const { workspace, dataDir, store } = await setup()
    await store.mutate(workspace, 0, (document) => document)
    const hash = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
    const path = join(dataDir, 'project-boards', `${hash}.json`)
    await writeFile(path, '{broken', 'utf8')

    const recovered = await store.read(workspace)

    expect(recovered.document.revision).toBe(0)
    expect(recovered.warning).toMatch(/corrupt/i)
    const files = await readdir(join(dataDir, 'project-boards'))
    expect(files.some((file) => file.startsWith(`${hash}.json.corrupt-`))).toBe(true)
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
