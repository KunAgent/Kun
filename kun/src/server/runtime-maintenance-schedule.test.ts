import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createMaintenanceCompletionLog } from './runtime-maintenance-schedule.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('keeps the last completion per task and ignores an unreadable file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-schedule-')); roots.push(root)
  const log = createMaintenanceCompletionLog(root)
  expect(await log.read()).toEqual({})
  await log.record('attachment pruning', Date.parse('2026-10-19T08:00:00.000Z'))
  await log.record('thread guardian', Date.parse('2026-10-19T09:00:00.000Z'))
  expect(await createMaintenanceCompletionLog(root).read()).toEqual({
    'attachment pruning': Date.parse('2026-10-19T08:00:00.000Z'),
    'thread guardian': Date.parse('2026-10-19T09:00:00.000Z')
  })
  await writeFile(join(root, 'maintenance-schedule.json'), '{ not json')
  expect(await log.read()).toEqual({})
})
