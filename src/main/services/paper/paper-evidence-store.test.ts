import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { mutatePaperEvidenceWorkspace, readPaperEvidenceWorkspace } from './paper-evidence-store'
let root: string
let path: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'evidence-store-')); path = join(root, '.kun/paper-evidence/workspace.json') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
it('rejects malformed JSON without overwriting it', async () => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '{malformed')
  await expect(mutatePaperEvidenceWorkspace(root, 0, () => undefined)).rejects.toMatchObject({ code: 'corrupt-store' })
  expect(await readFile(path, 'utf8')).toBe('{malformed')
})
it('serializes concurrent mutations and preserves the winning revision', async () => {
  const results = await Promise.allSettled([
    mutatePaperEvidenceWorkspace(root, 0, async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }),
    mutatePaperEvidenceWorkspace(root, 0, () => undefined)
  ])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'revision-conflict' } })
  expect((await readPaperEvidenceWorkspace(root)).revision).toBe(1)
})
it('does not overwrite an external edit during async capture', async () => {
  await mutatePaperEvidenceWorkspace(root, 0, () => undefined)
  await expect(mutatePaperEvidenceWorkspace(root, 1, async () => {
    await writeFile(path, JSON.stringify({ version: 1, revision: 7, evidence: [], matrices: [] }))
  })).rejects.toMatchObject({ code: 'revision-conflict' })
  expect((await readPaperEvidenceWorkspace(root)).revision).toBe(7)
})
