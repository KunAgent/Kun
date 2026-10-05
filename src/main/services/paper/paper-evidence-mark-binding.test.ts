import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { validatePaperMarkBinding } from './paper-evidence-mark-binding'
import { writePaperAnnotations } from './paper-marks-service'
import type { PaperHighlight } from '../../../shared/paper/paper-marks-types'
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

let unit: string
const bytes = '%PDF-1.7\noriginal'
const hash = createHash('sha256').update(bytes).digest('hex')
const highlight: PaperHighlight = { id: 'mark', kind: 'highlight', page: 1, rects: [[0, 0, 1, 1]],
  quote: 'quote', color: 'yellow', createdAt: 'now', updatedAt: 'now' }
beforeEach(async () => {
  unit = await mkdtemp(join(tmpdir(), 'paper-binding-'))
  await mkdir(join(unit, 'marks'))
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ version: 2, slug: 'paper', title: 'Paper', authors: [], importedAt: 'now', pdfFile: 'paper.pdf' }))
  await writeFile(join(unit, 'paper.pdf'), bytes)
})
afterEach(async () => { await rm(unit, { recursive: true, force: true }) })
it('binds a new highlight only to bytes displayed by its reader', async () => {
  expect(await validatePaperMarkBinding(unit, { ...highlight, pdfSha256: hash })).toMatchObject({ pdfSha256: hash })
  await expect(validatePaperMarkBinding(unit, highlight, 'f'.repeat(64))).rejects.toMatchObject({ code: 'stale-anchor' })
  expect(await validatePaperMarkBinding(unit, highlight)).not.toHaveProperty('pdfSha256')
})
it('never upgrades legacy marks while editing comments', async () => {
  await writePaperAnnotations(unit, [highlight])
  expect(await validatePaperMarkBinding(unit, { ...highlight, comment: 'Edit', pdfSha256: hash })).not.toHaveProperty('pdfSha256')
})
it('preserves old binding for comment edits after replacement but rejects anchor edits/rebinding', async () => {
  await writePaperAnnotations(unit, [{ ...highlight, pdfSha256: hash }])
  await writeFile(join(unit, 'paper.pdf'), '%PDF-1.7\nreplacement')
  expect(await validatePaperMarkBinding(unit, { ...highlight, comment: 'Still my note' })).toMatchObject({ pdfSha256: hash })
  await expect(validatePaperMarkBinding(unit, { ...highlight, page: 2 })).rejects.toMatchObject({ code: 'stale-anchor' })
  await expect(validatePaperMarkBinding(unit, { ...highlight, pdfSha256: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'stale-anchor' })
})
