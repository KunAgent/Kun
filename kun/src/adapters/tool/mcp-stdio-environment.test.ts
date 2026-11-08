import { describe, expect, it } from 'vitest'
import { buildMcpStdioEnvironment } from './mcp-stdio-environment.js'

const pathKeys = (env: NodeJS.ProcessEnv) => Object.keys(env).filter(key => key.toLowerCase() === 'path')

describe('MCP stdio GUI environment construction', () => {
  it.each([['PATH', 'Path'], ['Path', 'PATH']])('augments configured %s over inherited %s without leaving aliases', (configuredKey, inheritedKey) => {
    const result = buildMcpStdioEnvironment({ [configuredKey]: 'C:\\Tools', TOKEN: 'first', Token: 'last' }, {
      platform: 'win32', baseEnv: { [inheritedKey]: 'C:\\Windows\\System32',
        appdata: 'C:\\Users\\alice\\AppData\\Roaming', PROGRAMFILES: 'C:\\Program Files',
        'programfiles(x86)': 'C:\\Program Files (x86)', SECRET: 'not inherited by the builder' }
    })
    expect(pathKeys(result)).toEqual([configuredKey])
    expect(result[configuredKey]?.split(';')).toEqual([
      'C:\\Tools', 'C:\\Users\\alice\\AppData\\Roaming\\npm',
      'C:\\Program Files\\nodejs', 'C:\\Program Files (x86)\\nodejs'
    ])
    expect(result.Token).toBe('last')
    expect(Object.hasOwn(result, 'TOKEN')).toBe(false)
    expect(Object.hasOwn(result, 'SECRET')).toBe(false)
  })

  it('retains inherited Path spelling and adds npm paths when there is no explicit PATH', () => {
    const result = buildMcpStdioEnvironment({}, { platform: 'win32',
      baseEnv: { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' } })
    expect(result).toEqual({ Path: 'C:\\Windows;C:\\Users\\alice\\AppData\\Roaming\\npm' })
  })

  it('normalizes aliases already present in one Windows source before augmenting PATH', () => {
    const result = buildMcpStdioEnvironment({ PATH: 'C:\\Stale', Path: 'C:\\Tools', PATHEXT: '.EXE', PathExt: '.CMD' }, {
      platform: 'win32', baseEnv: { PATH: 'C:\\Parent', Path: 'C:\\Other', APPDATA: 'C:\\AppData' }
    })
    expect(result).toEqual({ Path: 'C:\\Tools;C:\\AppData\\npm', PathExt: '.CMD' })
  })

  it('does not resurrect or augment explicitly unset variables', () => {
    const result = buildMcpStdioEnvironment({ Path: undefined, PathExt: undefined, Token: undefined }, {
      platform: 'win32', baseEnv: { PATH: 'C:\\Parent', PATHEXT: '.EXE', TOKEN: 'old', APPDATA: 'C:\\AppData' }
    })
    expect(result).toEqual({ Path: undefined, PathExt: undefined, Token: undefined })
  })

  it('does not restore an inherited PATH over an explicitly empty one', () => {
    const result = buildMcpStdioEnvironment({ Path: '' }, { platform: 'win32', baseEnv: { PATH: 'C:\\Parent' } })
    expect(result).toEqual({ Path: '' })
  })

  it.each(['linux', 'darwin'] as const)('does not interpret Path as PATH on %s', platform => {
    const result = buildMcpStdioEnvironment({ Path: '/configured', Token: 'new' }, {
      platform, baseEnv: { PATH: '/Parent:/parent', TOKEN: 'old' }
    })
    expect(result.Path).toBe('/configured')
    expect(result.PATH?.split(':').slice(0, 2)).toEqual(['/Parent', '/parent'])
    expect(result.PATH).not.toContain('/configured')
    expect(result.Token).toBe('new')
  })
})
