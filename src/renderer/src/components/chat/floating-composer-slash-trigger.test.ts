import { describe, expect, it } from 'vitest'
import { getSlashQuery } from './floating-composer-commands'

describe('slash command trigger', () => {
  it('opens the command menu from the Chinese punctuation a slash key types', () => {
    expect(getSlashQuery('/')).toBe('')
    expect(getSlashQuery('、')).toBe('')
    expect(getSlashQuery('、Comp')).toBe('comp')
    expect(getSlashQuery('  ／goal')).toBe('goal')
  })

  it('stays closed for ordinary text and once the command has an argument', () => {
    expect(getSlashQuery('先看、再改')).toBeNull()
    expect(getSlashQuery('、compact now')).toBeNull()
    expect(getSlashQuery('hello')).toBeNull()
  })
})
