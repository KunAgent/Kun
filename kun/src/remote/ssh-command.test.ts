import { describe, expect, it } from 'vitest'
import { buildSshBaseArgs, buildSshExecArgv, buildSshResolveArgv, assertSafeSshAlias, shellQuoteRemote } from './ssh-command.js'

describe('ssh-command', () => {
  it('quotes remote shell values safely', () => {
    expect(shellQuoteRemote('/srv/my app')).toBe("'/srv/my app'")
    expect(shellQuoteRemote("it's")).toBe("'it'\\''s'")
  })

  it('builds base args with batch mode, timeout, and control master', () => {
    expect(buildSshBaseArgs({ alias: 'h', batchMode: true, connectTimeoutSec: 8 })).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8'
    ])
    const withControl = buildSshBaseArgs({ alias: 'h', controlPath: '/tmp/cm', controlPersistSec: 120 })
    expect(withControl).toEqual([
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPath=/tmp/cm',
      '-o', 'ControlPersist=120'
    ])
  })

  it('runs a command inside a quoted remote directory', () => {
    const argv = buildSshExecArgv({ alias: 'prod', remoteDir: '/srv/my app', command: 'git status' })
    expect(argv).toEqual(['prod', "cd -- '/srv/my app' && git status"])
  })

  it('passes the command directly when no remote dir is given', () => {
    expect(buildSshExecArgv({ alias: 'prod', command: 'uname -a' })).toEqual(['prod', 'uname -a'])
  })

  it('does not enable control master unless a control path is provided', () => {
    expect(buildSshBaseArgs({ alias: 'h' })).toEqual([])
  })

  it('rejects unsafe host aliases (option-like or shell-hostile)', () => {
    expect(() => assertSafeSshAlias('-oProxyCommand=evil')).toThrow(/unsafe/)
    expect(() => assertSafeSshAlias('a b')).toThrow(/unsafe/)
    expect(() => assertSafeSshAlias('')).toThrow(/empty/)
    expect(assertSafeSshAlias('production-api')).toBe('production-api')
    expect(() => buildSshExecArgv({ alias: '-x', command: 'ls' })).toThrow(/unsafe/)
  })

  it('builds the ssh -G resolver argv (authoritative config resolution)', () => {
    expect(buildSshResolveArgv('prod')).toEqual(['-G', 'prod'])
    expect(() => buildSshResolveArgv('-evil')).toThrow(/unsafe/)
  })
})
