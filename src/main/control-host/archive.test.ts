import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('../../../scripts/fixtures/control-archive-unpack.mjs', import.meta.url))
function unpack(mode: string) {
  const child = spawnSync(process.execPath, [fixture, mode], { encoding: 'utf8', timeout: 20_000 })
  expect(child.error).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  return JSON.parse(child.stdout) as {
    ok: boolean; code?: string; files: number; readOnly: boolean
    events: Array<{ file: string; operation: string; mode?: number; flags?: string }>
  }
}

describe('vendored control package archive durability', () => {
  it.each(['windows-handles', 'readonly-input'])('syncs writable handles before sealing files (%s)', mode => {
    const result = unpack(mode)
    expect(result.ok).toBe(true)
    expect(result.files).toBe(2)
    expect(result.readOnly).toBe(true)
    for (const file of ['manifest.json', 'runtime.cjs']) {
      const operations = result.events.filter(event => event.file === file)
      const sync = operations.findIndex(event => event.operation === 'sync')
      const close = operations.findIndex(event => event.operation === 'close')
      const seal = operations.findIndex(event => event.operation === 'chmod' && event.mode === 0o400)
      expect(operations.find(event => event.operation === 'open')?.flags).toBe('r+')
      expect(sync).toBeGreaterThanOrEqual(0)
      expect(close).toBeGreaterThan(sync)
      expect(seal).toBeGreaterThan(close)
    }
  })

  it('propagates a real writable-handle sync error instead of sealing a partial installation', () => {
    const result = unpack('sync-failure')
    expect(result).toMatchObject({ ok: false, code: 'EIO' })
    expect(result.events.some(event => event.operation === 'close')).toBe(true)
    expect(result.events.some(event => event.operation === 'chmod' && event.mode === 0o400)).toBe(false)
  })

  it('rejects corrupt contents before syncing or sealing any file', () => {
    const result = unpack('corrupt')
    expect(result).toMatchObject({ ok: false, code: 'CONTROL_PACKAGE_CORRUPT' })
    expect(result.events).toEqual([])
  })
})
