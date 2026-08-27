import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atomicWriteFile } from './atomic-json-file'

describe('atomicWriteFile', () => {
  it('flushes and atomically replaces an owner-only file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-atomic-write-'))
    const target = join(directory, 'config.json')
    try {
      await atomicWriteFile(target, '{"next":true}\n')

      expect(await readFile(target, 'utf8')).toBe('{"next":true}\n')
      expect((await stat(target)).mode & 0o777).toBe(0o600)
      expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves the previous target and removes its temporary file when commit is rejected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-atomic-write-'))
    const target = join(directory, 'config.json')
    try {
      await atomicWriteFile(target, '{"previous":true}\n')
      await expect(atomicWriteFile(target, '{"next":true}\n', {
        beforeCommit: () => { throw new Error('stale revision') }
      })).rejects.toThrow('stale revision')

      expect(await readFile(target, 'utf8')).toBe('{"previous":true}\n')
      expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
