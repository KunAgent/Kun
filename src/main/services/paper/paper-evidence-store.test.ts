import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import * as workspacePaths from '../workspace-paths'
import { mutatePaperEvidenceWorkspace, readPaperEvidenceWorkspace } from './paper-evidence-store'
let root: string
let path: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'evidence-store-')); path = join(root, '.kun/paper-evidence/workspace.json') })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
it('rejects malformed JSON without overwriting it', async () => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '{malformed')
  await expect(mutatePaperEvidenceWorkspace(root, 0, () => undefined)).rejects.toMatchObject({ code: 'corrupt-store' })
  expect(await readFile(path, 'utf8')).toBe('{malformed')
})
it('serializes concurrent mutations and preserves the winning revision', async () => {
  // Canonical path resolution is asynchronous; invocation order does not decide
  // which request acquires the queue. Hold the first mutation after admission.
  let entered!: () => void
  let release!: () => void
  const admitted = new Promise<void>((resolve) => { entered = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  // Resolve the queue key immediately so the second call is definitely admitted
  // while the first callback is held. Other tests exercise real path resolution.
  vi.spyOn(workspacePaths, 'canonicalPath').mockResolvedValue(root)
  const first = mutatePaperEvidenceWorkspace(root, 0, async () => { entered(); await held })
  await admitted
  const secondMutation = vi.fn()
  const second = mutatePaperEvidenceWorkspace(root, 0, secondMutation)
  await Promise.resolve()
  await Promise.resolve()
  expect(secondMutation).not.toHaveBeenCalled()
  release()
  const results = await Promise.allSettled([first, second])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'revision-conflict' } })
  expect(secondMutation).not.toHaveBeenCalled()
  expect((await readPaperEvidenceWorkspace(root)).revision).toBe(1)
})
it('does not overwrite an external edit during async capture', async () => {
  await mutatePaperEvidenceWorkspace(root, 0, () => undefined)
  await expect(mutatePaperEvidenceWorkspace(root, 1, async () => {
    await writeFile(path, JSON.stringify({ version: 1, revision: 7, evidence: [], matrices: [] }))
  })).rejects.toMatchObject({ code: 'revision-conflict' })
  expect((await readPaperEvidenceWorkspace(root)).revision).toBe(7)
})
