import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AttributionLedger,
  isAttributableLine,
  lineHash,
  lineHashesFor,
  normalizeLine
} from './attribution-ledger.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-attr-'))
  dirs.push(dataDir)
  return new AttributionLedger(dataDir, () => '2026-01-01T00:00:00Z')
}

const entry = (path: string, text: string, unitId = 'wrk_1', harnessId = 'codex') => ({
  path,
  lineHashes: lineHashesFor(text),
  unitId,
  harnessId,
  at: '2026-01-01T00:00:00Z'
})

describe('line hashing', () => {
  it('normalizes trailing whitespace and skips boilerplate lines', () => {
    expect(normalizeLine('const x = 1   ')).toBe('const x = 1')
    expect(normalizeLine('const x = 1\t\n')).toBe('const x = 1')
    expect(isAttributableLine('')).toBe(false)
    expect(isAttributableLine('   ')).toBe(false)
    expect(isAttributableLine('}')).toBe(false)
    expect(isAttributableLine('});')).toBe(false)
    expect(isAttributableLine('return value')).toBe(true)
    expect(lineHash('a')).toHaveLength(16)
  })
})

describe('AttributionLedger', () => {
  it('attributes current lines to the writer that recorded their hash', async () => {
    const ledger = await harness()
    await ledger.record('tws_1', entry('src/a.ts', 'const a = 1\nconst b = 2', 'wrk_1', 'codex'))
    const lines = await ledger.attribute('tws_1', 'src/a.ts', 'const a = 1\nconst b = 2')
    expect(lines).toEqual([
      { line: 1, unitId: 'wrk_1', harnessId: 'codex' },
      { line: 2, unitId: 'wrk_1', harnessId: 'codex' }
    ])
  })

  it('keeps human edits unattributed and re-attributes on the newer writer', async () => {
    const ledger = await harness()
    await ledger.record('tws_1', entry('src/a.ts', 'const a = 1\nconst b = 2', 'wrk_1'))
    // Human rewrote line 2; a different agent then wrote line 3's content.
    await ledger.record('tws_1', entry('src/a.ts', 'const c = a + b', 'wrk_2', 'claude-code'))
    const lines = await ledger.attribute(
      'tws_1', 'src/a.ts', 'const a = 1\nconst b = a * 2\nconst c = a + b'
    )
    expect(lines).toEqual([
      { line: 1, unitId: 'wrk_1', harnessId: 'codex' },
      { line: 3, unitId: 'wrk_2', harnessId: 'claude-code' }
    ])
  })

  it('scopes entries per workspace and per path', async () => {
    const ledger = await harness()
    await ledger.record('tws_1', entry('src/a.ts', 'shared line content'))
    expect(await ledger.attribute('tws_1', 'src/b.ts', 'shared line content')).toEqual([])
    expect(await ledger.attribute('tws_2', 'src/a.ts', 'shared line content')).toEqual([])
  })

  it('drops the newest-writer-wins marker when a dispatch id is recorded', async () => {
    const ledger = await harness()
    await ledger.record('tws_1', {
      ...entry('f.ts', 'x = compute()'),
      dispatchId: 'dsp_9'
    })
    expect(await ledger.attribute('tws_1', 'f.ts', 'x = compute()')).toEqual([
      { line: 1, unitId: 'wrk_1', harnessId: 'codex', dispatchId: 'dsp_9' }
    ])
  })

  it('newest writer wins for a repeated line', async () => {
    const ledger = await harness()
    await ledger.record('tws_1', entry('f.ts', 'const marker = true', 'wrk_early'))
    await ledger.record('tws_1', entry('f.ts', 'const marker = true', 'wrk_late'))
    const lines = await ledger.attribute('tws_1', 'f.ts', 'const marker = true')
    expect(lines[0]?.unitId).toBe('wrk_late')
  })

  it('evicts the oldest entries beyond the 50k cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-attr-cap-'))
    dirs.push(dir)
    const ledger = new AttributionLedger(dir, () => 't')
    // Seed the file at the cap, then one more write must drop the oldest.
    const seeded = Array.from({ length: 50_000 }, (_, index) => ({
      path: 'f.ts',
      lineHashes: [`seed_${index}`],
      unitId: index === 0 ? 'wrk_old' : 'wrk_mid',
      harnessId: 'kun',
      at: 't'
    }))
    const { writeAdeJson } = await import('./ade-file.js')
    const { adeAttributionFile } = await import('./ade-paths.js')
    await writeAdeJson(adeAttributionFile(dir, 'tws_1'), { version: 1, entries: seeded })
    await ledger.record('tws_1', entry('f.ts', 'const newest = 1', 'wrk_new'))
    const lines = await ledger.attribute('tws_1', 'f.ts', 'const newest = 1')
    expect(lines[0]?.unitId).toBe('wrk_new')
    // The seeded 'wrk_old' entry was evicted: its hash no longer resolves.
    const { readFile } = await import('node:fs/promises')
    const file = JSON.parse(
      await readFile(adeAttributionFile(dir, 'tws_1'), 'utf8')
    ) as { entries: Array<{ unitId: string }> }
    expect(file.entries).toHaveLength(50_000)
    expect(file.entries[0]?.unitId).toBe('wrk_mid')
    expect(file.entries.at(-1)?.unitId).toBe('wrk_new')
  })
})
