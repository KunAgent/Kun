import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPaperMatrix, readPaperMatrices } from './paper-matrix-service'
import { movePaperUnitToGroup } from './paper-library-service'
const failure = vi.hoisted(() => ({ save: false }))
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))
vi.mock('../../atomic-json-file', async (original) => {
  const actual = await original<typeof import('../../atomic-json-file')>()
  return { ...actual, atomicWriteFile: async (path: string, contents: string) => {
    if (failure.save && path.endsWith('workspace.json')) throw new Error('Simulated disk full')
    return actual.atomicWriteFile(path, contents)
  } }
})
let root: string
let papers: string
let unit: string
beforeEach(async () => {
  failure.save = false
  root = await mkdtemp(join(tmpdir(), 'evidence-move-'))
  papers = join(root, 'papers')
  unit = join(papers, 'a')
  await mkdir(unit, { recursive: true })
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ version: 2, slug: 'a', title: 'A', authors: [], importedAt: 'now' }))
})
afterEach(async () => { failure.save = false; await rm(root, { recursive: true, force: true }) })
it('rolls back the directory move when the evidence index cannot be committed', async () => {
  const before = await createPaperMatrix(root, { title: 'Comparison', unitDirs: ['papers/a'], axes: ['result'], expectedRevision: 0 })
  failure.save = true
  await expect(movePaperUnitToGroup(root, papers, unit, 'reviewed')).rejects.toThrow('Simulated disk full')
  expect(JSON.parse(await readFile(join(unit, 'paper.json'), 'utf8')).title).toBe('A')
  await expect(access(join(papers, 'reviewed/a'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readPaperMatrices(root)).toEqual(before)
})
it('moves units with no evidence without creating an empty evidence store', async () => {
  await movePaperUnitToGroup(root, papers, unit, 'reviewed')
  await expect(access(join(papers, 'reviewed/a/paper.json'))).resolves.toBeUndefined()
  await expect(access(join(root, '.kun/paper-evidence/workspace.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
