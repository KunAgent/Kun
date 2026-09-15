import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import { evaluateMemoryFeedbackTiebreakerCase } from './memory-feedback-tiebreaker-evaluator.js'

const kunSourceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const rendererSourceRoot = join(kunSourceRoot, '..', '..', 'src')

describe('memory feedback tiebreaker evaluator isolation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is imported only by its offline modules and tests', async () => {
    const sourceFiles = [
      ...await sourceFilesBelow(kunSourceRoot),
      ...await sourceFilesBelow(rendererSourceRoot)
    ]
    const violations: string[] = []

    for (const path of sourceFiles) {
      const source = await readFile(path, 'utf8')
      if (!source.includes('memory-feedback-tiebreaker-')) continue
      if (path.split(/[\\/]/u).at(-1)?.startsWith('memory-feedback-tiebreaker-')) continue
      violations.push(relative(join(kunSourceRoot, '..', '..'), path).replaceAll('\\', '/'))
    }

    expect(violations).toEqual([])
  })

  it('runs development evaluation without attempting network access', async () => {
    let networkAttempts = 0
    vi.stubGlobal('fetch', async () => {
      networkAttempts += 1
      throw new Error('network access is forbidden in the P3-B evaluator')
    })
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()

    for (const item of fixture.cases.filter((candidate) => candidate.partition === 'development')) {
      evaluateMemoryFeedbackTiebreakerCase({
        fixture,
        item,
        signalRule: 'confirmation-correction',
        maximumGap: 1
      })
    }

    expect(networkAttempts).toBe(0)
  })
})

async function sourceFilesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFilesBelow(path))
    else if (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx') files.push(path)
  }
  return files
}
