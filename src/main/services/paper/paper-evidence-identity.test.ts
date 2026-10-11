import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readPaperIdentity } from './paper-evidence-version'
import { PAPER_EVIDENCE_IDENTITY_FILE } from './paper-evidence-identity'
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))
let unit: string
let moved: string
const meta = { version: 2, slug: 'original-slug', title: 'Original title', authors: ['A. Author'], year: '2026', importedAt: 'now' }
beforeEach(async () => {
  unit = await mkdtemp(join(tmpdir(), 'paper-identity-'))
  moved = `${unit}-moved`
  await writeFile(join(unit, 'paper.json'), JSON.stringify(meta))
})
afterEach(async () => { await Promise.all([rm(unit, { recursive: true, force: true }), rm(moved, { recursive: true, force: true })]) })
it('keeps generated citation key and local UUID stable through metadata edits and unit moves', async () => {
  const original = await readPaperIdentity(unit)
  expect(original.canonicalId).toMatch(/^local:[a-f0-9-]{36}$/)
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ ...meta, slug: 'changed-slug', title: 'Changed title', authors: ['Different Author'], year: '2027' }))
  const edited = await readPaperIdentity(unit)
  expect(edited.citeKey).toBe(original.citeKey)
  expect(edited.canonicalId).toBe(original.canonicalId)
  await rename(unit, moved)
  const relocated = await readPaperIdentity(moved)
  expect(relocated.citeKey).toBe(original.citeKey)
  expect(relocated.canonicalId).toBe(original.canonicalId)
})
it('preserves explicit metadata and imported BibTeX citation keys without rewriting paper metadata', async () => {
  const text = JSON.stringify({ ...meta, bibtex: '@article{OriginalBibKey,title={Original title}}' })
  await writeFile(join(unit, 'paper.json'), text)
  expect((await readPaperIdentity(unit)).citeKey).toBe('OriginalBibKey')
  expect(await readFile(join(unit, 'paper.json'), 'utf8')).toBe(text)
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ ...meta, citeKey: 'UserChosenKey' }))
  expect((await readPaperIdentity(unit)).citeKey).toBe('UserChosenKey')
})
it('creates one durable identity for concurrent first reads', async () => {
  const identities = await Promise.all(Array.from({ length: 12 }, () => readPaperIdentity(unit)))
  expect(new Set(identities.map((item) => item.canonicalId)).size).toBe(1)
  expect(new Set(identities.map((item) => item.citeKey)).size).toBe(1)
  expect(JSON.parse(await readFile(join(unit, PAPER_EVIDENCE_IDENTITY_FILE), 'utf8')).citeKey).toBe(identities[0].citeKey)
})
it('surfaces corrupt identity without overwriting it', async () => {
  const path = join(unit, PAPER_EVIDENCE_IDENTITY_FILE)
  await writeFile(path, '{bad identity')
  await expect(readPaperIdentity(unit)).rejects.toMatchObject({ code: 'corrupt-identity' })
  expect(await readFile(path, 'utf8')).toBe('{bad identity')
})
