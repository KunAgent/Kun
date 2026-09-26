import { describe, expect, it } from 'vitest'
import { sameCanonicalPath } from './canonical-path.js'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('sameCanonicalPath', () => {
  it('accepts equivalent Windows paths with mixed separators and casing', () => {
    expect(sameCanonicalPath(
      'C:\\Users\\Administrator/.kun/data',
      'c:/users/administrator/.kun/data\\',
      'win32'
    )).toBe(true)
  })

  it('accepts equivalent extended-length Windows paths', () => {
    expect(sameCanonicalPath(
      '\\\\?\\C:\\Users\\Administrator\\.kun\\data',
      'C:\\Users\\Administrator\\.kun\\data',
      'win32'
    )).toBe(true)
  })

  it('rejects different Windows directories', () => {
    expect(sameCanonicalPath(
      'C:\\Users\\Administrator\\.kun\\data',
      'C:\\Users\\Administrator\\.kun\\other-data',
      'win32'
    )).toBe(false)
  })

  it('keeps POSIX path comparison case-sensitive', () => {
    expect(sameCanonicalPath('/home/kun/data', '/home/Kun/data', 'linux')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('recognizes data and absent settings paths beneath symlink aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-canonical-profile-'))
    try {
      const physical = join(root, 'physical')
      const alias = join(root, 'alias')
      await mkdir(physical)
      await symlink(physical, alias, 'dir')
      expect(sameCanonicalPath(physical, alias)).toBe(true)
      expect(sameCanonicalPath(join(physical, 'settings.json'), join(alias, 'settings.json'))).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
