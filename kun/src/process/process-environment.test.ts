import { describe, expect, it } from 'vitest'
import { mergeProcessEnvironments } from './process-environment.js'

describe('mergeProcessEnvironments', () => {
  it('returns an empty environment when no sources are supplied', () => {
    expect(mergeProcessEnvironments('win32')).toEqual({})
  })

  it.each([
    ['PATH', 'Path', 'PATHEXT', 'PathExt', 'TOKEN', 'Token'],
    ['Path', 'PATH', 'PathExt', 'PATHEXT', 'Token', 'TOKEN']
  ])('replaces inherited Windows %s with explicit %s without retaining aliases', (basePath, path, baseExt, ext, baseToken, token) => {
    const inherited = Object.freeze({ [basePath]: 'inherited', [baseExt]: '.EXE', [baseToken]: 'old', KEEP: 'keep' })
    const configured = Object.freeze({ [path]: 'configured', [ext]: '.CMD', [token]: 'new' })
    expect(mergeProcessEnvironments('win32', inherited, configured)).toEqual({
      [path]: 'configured', [ext]: '.CMD', [token]: 'new', KEEP: 'keep'
    })
    expect(inherited[basePath]).toBe('inherited')
    expect(configured[path]).toBe('configured')
  })

  it('deduplicates aliases within one source and lets later sources win', () => {
    expect(mergeProcessEnvironments('win32', { PATH: 'first', Path: 'second' }, { path: 'third' }))
      .toEqual({ path: 'third' })
  })

  it('preserves explicit undefined as an unset operation for every Windows variable', () => {
    const result = mergeProcessEnvironments('win32', { PATH: 'parent', PATHEXT: '.EXE', TOKEN: 'secret' },
      { Path: undefined, PathExt: undefined, Token: undefined })
    expect(result).toEqual({ Path: undefined, PathExt: undefined, Token: undefined })
    expect(Object.keys(result)).toEqual(['Path', 'PathExt', 'Token'])
  })

  it('does not treat empty string overrides as absent', () => {
    expect(mergeProcessEnvironments('win32', { PATH: 'parent', TOKEN: 'secret' }, { Path: '', token: '' }))
      .toEqual({ Path: '', token: '' })
  })

  it.each(['linux', 'darwin'] as const)('preserves differently cased names on %s', platform => {
    expect(mergeProcessEnvironments(platform, { PATH: 'parent', PATHEXT: '.EXE', TOKEN: 'old' },
      { Path: 'configured', PathExt: '.CMD', Token: 'new', TOKEN: undefined }))
      .toEqual({ PATH: 'parent', PATHEXT: '.EXE', TOKEN: undefined, Path: 'configured', PathExt: '.CMD', Token: 'new' })
  })
})
