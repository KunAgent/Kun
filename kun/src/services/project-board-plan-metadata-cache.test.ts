import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProjectBoardPlanMetadataCache,
  loadPlanMetadataConcurrently
} from './project-board-plan-metadata-cache.js'

const temporary: string[] = []
afterEach(async () => Promise.all(
  temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))
))

describe('ProjectBoardPlanMetadataCache', () => {
  it('reuses unchanged Plan metadata and invalidates it after a file change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-board-plan-cache-'))
    temporary.push(root)
    const path = join(root, 'plan.md')
    await writeFile(path, '## First\n- [ ] Task\n  Description\n')
    const cache = new ProjectBoardPlanMetadataCache()

    const first = await cache.load(path)
    const second = await cache.load(path)
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(second.entries.get(0)).toEqual({
      sectionTitle: 'First',
      description: 'Description'
    })

    await writeFile(path, '## Updated\n- [ ] Task\n  Longer description\n')
    const updated = await cache.load(path)
    expect(updated.cacheHit).toBe(false)
    expect(updated.entries.get(0)?.sectionTitle).toBe('Updated')
  })

  it('loads distinct Plan files with a bounded worker pool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-board-plan-pool-'))
    temporary.push(root)
    const paths = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const path = join(root, `${index}.md`)
      await writeFile(path, `- [ ] Task ${index}\n`)
      return path
    }))
    const loaded = await loadPlanMetadataConcurrently(
      paths,
      new ProjectBoardPlanMetadataCache(),
      4
    )
    expect(loaded.metadata.size).toBe(8)
    expect(loaded.cacheHits).toBe(0)
  })
})
