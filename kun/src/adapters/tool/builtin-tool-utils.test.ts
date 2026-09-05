import { statSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  cursorSdkRipgrepPackageName,
  createShellCommandRunner,
  globToRegExp,
  makeListEntry,
  normalizeToolPath,
  resolveCursorSdkRipgrep,
  resolveExecutable,
  resolveRipgrepExecutable,
  ShellSpawnError,
  shellConfig,
  shellCommandArgs,
  shellDisplayName,
  shellRuntimeInfo,
  shellRuntimeInstruction,
  shellRuntimePlan,
  shellSpawnEnv,
  terminateSpawnTree
} from './builtin-tool-utils.js'

function lookup(results: Record<string, string>) {
  return ((command: string, args: string[]) => {
    const key = `${command} ${args.join(' ')}`
    const stdout = results[key] ?? ''
    return {
      status: stdout ? 0 : 1,
      stdout
    }
  }) as never
}

function powerShellRuntime(shell: string) {
  return shellRuntimeInfo({
    shell,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
  })
}

function spawnFailure(code: string, errno: number): NodeJS.ErrnoException {
  return Object.assign(new Error('spawn failed'), {
    code,
    errno,
    syscall: 'spawn'
  })
}

describe('shellConfig', () => {
  it('prefers Git Bash on Windows when Git for Windows is installed', () => {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(shellConfig('win32', lookup({
      'where pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n',
      'where git.exe': 'C:\\Program Files\\Git\\cmd\\git.exe\r\n',
      'where bash.exe': `${gitBash}\r\n`
    }), (path) => path === gitBash, {})).toEqual({
      shell: gitBash,
      args: ['-lc']
    })
  })

  it('falls back to Windows PowerShell when pwsh is unavailable', () => {
    expect(shellConfig('win32', lookup({
      'where powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n'
    }), () => false, {})).toEqual({
      shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
    })
  })

  it('falls back to Git Bash on Windows when PowerShell is unavailable', () => {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(shellConfig('win32', lookup({
      'where git.exe': 'C:\\Program Files\\Git\\cmd\\git.exe\r\n',
      'where bash.exe': `${gitBash}\r\n`
    }), (path) => path === gitBash, {})).toEqual({
      shell: gitBash,
      args: ['-lc']
    })
  })

  it('resolves Windows PowerShell by absolute path when PATH lookups all fail', () => {
    // Simulates a GUI-launched app whose PATH lost System32: every `where`
    // lookup returns nothing, so resolution must not depend on PATH.
    const winPwsh = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    expect(
      shellConfig('win32', lookup({}), (path) => path === winPwsh, { SystemRoot: 'C:\\Windows' })
    ).toEqual({
      shell: winPwsh,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
    })
  })

  it('skips WindowsApps aliases and keeps PowerShell fallbacks in one syntax family', () => {
    const winPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const plan = shellRuntimePlan({
      platform: 'win32',
      lookup: lookup({
        'where pwsh.exe': [
          'C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
          'D:\\Tools\\PowerShell\\pwsh.exe'
        ].join('\r\n'),
        'where powershell.exe': winPowerShell
      }),
      fileExists: (path) => path === winPowerShell,
      env: { SystemRoot: 'C:\\Windows' }
    })

    expect(plan.candidates
      .filter((candidate) => candidate.syntax === 'PowerShell')
      .map((candidate) => candidate.shell)).toEqual([
      'D:\\Tools\\PowerShell\\pwsh.exe',
      winPowerShell
    ])
    expect(plan.candidates.at(-1)?.syntax).toBe('cmd.exe batch')
    expect(plan.candidates.some((candidate) => /WindowsApps/i.test(candidate.shell))).toBe(false)
  })

  it('falls back to an absolute cmd.exe (never a bare name) when nothing else resolves', () => {
    expect(shellConfig('win32', lookup({}), () => false, { SystemRoot: 'C:\\Windows' })).toEqual({
      shell: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c']
    })
  })

  it('prefers %ComSpec% for the cmd.exe fallback when it is set', () => {
    expect(
      shellConfig('win32', lookup({}), () => false, { ComSpec: 'D:\\Windows\\System32\\cmd.exe' })
    ).toEqual({
      shell: 'D:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c']
    })
  })

  it('keeps the POSIX shell behavior on non-Windows platforms', () => {
    expect(shellConfig('darwin', lookup({}), () => true)).toEqual({
      shell: '/bin/bash',
      args: ['-lc']
    })
  })
})

describe('shellSpawnEnv', () => {
  it('keeps only the shell allow-list on non-Windows platforms', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      KUN_RUNTIME_INSTANCE_ID: 'runtime-safe-identity',
      KUN_RUNTIME_TOKEN: 'runtime-secret',
      DEEPSEEK_API_KEY: 'model-secret',
      AWS_SECRET_ACCESS_KEY: 'cloud-secret'
    }
    expect(shellSpawnEnv(env, 'darwin')).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      KUN_RUNTIME_INSTANCE_ID: 'runtime-safe-identity'
    })
  })

  it('appends the core Windows system dirs when PATH is missing them', () => {
    const result = shellSpawnEnv({ Path: 'C:\\Program Files\\nodejs', SystemRoot: 'C:\\Windows' }, 'win32')
    const entries = (result.Path ?? '').split(';')
    expect(entries[0]).toBe('C:\\Program Files\\nodejs') // user entries keep precedence
    expect(entries).toContain('C:\\Windows\\System32')
    expect(entries).toContain('C:\\Windows\\System32\\WindowsPowerShell\\v1.0')
  })

  it('rebuilds PATH from scratch when the inherited PATH is empty', () => {
    const result = shellSpawnEnv({ Path: '', SystemRoot: 'C:\\Windows' }, 'win32')
    expect((result.Path ?? '').split(';')).toContain('C:\\Windows\\System32')
  })

  it('does not duplicate system dirs already present (case-insensitive)', () => {
    const path = [
      'c:\\windows\\system32',
      'C:\\Windows',
      'C:\\Windows\\System32\\Wbem',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'
    ].join(';')
    const result = shellSpawnEnv({ Path: path, SystemRoot: 'C:\\Windows' }, 'win32')
    expect(result.Path).toBe(path)
  })

  it('does not inherit runtime or provider credentials on Windows', () => {
    const result = shellSpawnEnv({
      Path: 'C:\\Tools',
      SystemRoot: 'C:\\Windows',
      KUN_RUNTIME_INSTANCE_ID: 'runtime-safe-identity',
      KUN_RUNTIME_TOKEN: 'runtime-secret',
      DEEPSEEK_API_KEY: 'model-secret',
      GITHUB_TOKEN: 'github-secret'
    }, 'win32')
    expect(result).not.toHaveProperty('KUN_RUNTIME_TOKEN')
    expect(result).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(result).not.toHaveProperty('GITHUB_TOKEN')
    expect(result).toMatchObject({
      SystemRoot: 'C:\\Windows',
      KUN_RUNTIME_INSTANCE_ID: 'runtime-safe-identity'
    })
  })
})

describe('resolveExecutable', () => {
  it('uses where on Windows to find executables on PATH', () => {
    expect(resolveExecutable(
      ['rg'],
      'win32',
      lookup({ 'where rg': 'C:\\Tools\\ripgrep\\rg.exe\r\n' }),
      () => false,
      () => true
    )).toBe('C:\\Tools\\ripgrep\\rg.exe')
  })

  it('treats Windows backslash candidates as explicit paths', () => {
    expect(resolveExecutable(
      ['C:\\Tools\\fd.exe'],
      'win32',
      lookup({}),
      (path) => path === 'C:\\Tools\\fd.exe',
      () => true
    )).toBe('C:\\Tools\\fd.exe')
  })

  it('keeps using which on non-Windows platforms', () => {
    expect(resolveExecutable(
      ['rg'],
      'darwin',
      lookup({ 'which rg': '/opt/homebrew/bin/rg\n' }),
      () => false,
      () => true
    )).toBe('/opt/homebrew/bin/rg')
  })
})

describe('Cursor SDK ripgrep resolution', () => {
  it('resolves the packaged binary directly without a PATH lookup', () => {
    const packageName = cursorSdkRipgrepPackageName('darwin', 'arm64')
    expect(packageName).toBe('@cursor/sdk-darwin-arm64')
    const resolvePackage = vi.fn((specifier: string) => {
      expect(specifier).toBe(`${packageName}/package.json`)
      return '/Applications/Kun.app/Contents/Resources/app.asar.unpacked/kun/node_modules/@cursor/sdk-darwin-arm64/package.json'
    })
    const responds = vi.fn(() => true)

    expect(resolveCursorSdkRipgrep({
      platform: 'darwin',
      arch: 'arm64',
      resolvePackage,
      fileExists: (path) => path.endsWith('/bin/rg'),
      responds
    })).toBe('/Applications/Kun.app/Contents/Resources/app.asar.unpacked/kun/node_modules/@cursor/sdk-darwin-arm64/bin/rg')
    expect(resolvePackage).toHaveBeenCalledOnce()
    expect(responds).toHaveBeenCalledWith(expect.stringContaining('/bin/rg'))
  })

  it('falls back to normal executable lookup when the packaged platform dependency is absent', () => {
    expect(resolveRipgrepExecutable({
      platform: 'linux',
      arch: 'x64',
      candidates: ['rg'],
      resolvePackage: () => { throw new Error('optional package unavailable') },
      lookup: lookup({ 'which rg': '/usr/local/bin/rg\n' }),
      fileExists: () => false,
      responds: () => true
    })).toBe('/usr/local/bin/rg')
  })

  it('can require the packaged binary and safely fall back to a scan instead of PATH', () => {
    const lookupPath = vi.fn(lookup({ 'which rg': '/usr/local/bin/rg\n' }))
    expect(resolveRipgrepExecutable({
      platform: 'linux',
      arch: 'x64',
      candidates: ['rg'],
      allowPathFallback: false,
      resolvePackage: () => { throw new Error('optional package unavailable') },
      lookup: lookupPath,
      fileExists: () => false,
      responds: () => true
    })).toBeNull()
    expect(lookupPath).not.toHaveBeenCalled()
  })

  it('does not claim a package for unsupported Cursor SDK targets', () => {
    expect(cursorSdkRipgrepPackageName('win32', 'arm64')).toBeNull()
    expect(cursorSdkRipgrepPackageName('freebsd', 'x64')).toBeNull()
  })
})

describe('shell runtime metadata', () => {
  it('normalizes shell display names', () => {
    expect(shellDisplayName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe')
    expect(shellDisplayName('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(shellDisplayName('/bin/bash')).toBe('bash')
  })

  it('describes the syntax for the current shell', () => {
    expect(shellRuntimeInfo({ shell: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c'] })).toMatchObject({
      name: 'cmd.exe',
      syntax: 'cmd.exe batch'
    })
    const instruction = shellRuntimeInstruction({
      shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-Command']
    })
    expect(instruction).toContain('<shell_environment>')
    expect(instruction).toContain('<shell>pwsh</shell>')
    expect(instruction).toContain('<syntax>PowerShell</syntax>')
    // Factual block only: no imperative directives the model would echo back.
    expect(instruction).not.toMatch(/Do not assume|Write shell commands/)
  })

  it('runs PowerShell commands through a plain UTF-8 command argument', () => {
    const args = shellCommandArgs(
      {
        shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
      },
      'Write-Output "测试"'
    )

    expect(args.slice(0, -1)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command'
    ])
    expect(args).not.toContain('-ExecutionPolicy')
    expect(args).not.toContain('Bypass')
    expect(args).not.toContain('-EncodedCommand')
    const script = args.at(-1) ?? ''
    expect(script).toContain('[Console]::OutputEncoding = $OutputEncoding')
    expect(script).toContain('Write-Output "测试"')
  })

  it('keeps non-PowerShell command arguments unchanged', () => {
    expect(shellCommandArgs({ shell: '/bin/bash', args: ['-lc'] }, 'echo hi')).toEqual(['-lc', 'echo hi'])
  })
})

describe('shell command runner', () => {
  it('keeps the requested cwd when Windows Git Bash loads its profile', async () => {
    const bash = shellRuntimeInfo({
      shell: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-lc']
    })
    const child = new EventEmitter()
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child as never
    })
    const runner = createShellCommandRunner({
      platform: 'win32',
      env: { Path: 'C:\\Tools', SystemRoot: 'C:\\Windows' },
      plan: { primary: bash, candidates: [bash] },
      spawnImpl: spawnImpl as never
    })

    await runner.spawn('pwd', { cwd: 'C:\\Workspace' })

    expect(spawnImpl).toHaveBeenCalledWith(
      bash.shell,
      ['-lc', 'pwd'],
      expect.objectContaining({
        cwd: 'C:\\Workspace',
        env: expect.objectContaining({ CHERE_INVOKING: '1' })
      })
    )
  })

  it('retries a same-syntax candidate when error arrives before spawn', async () => {
    const primary = powerShellRuntime('C:\\Blocked\\pwsh.exe')
    const fallback = powerShellRuntime('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    const calls: Array<{ shell: string; args: string[]; options: Record<string, unknown> }> = []
    const spawnImpl = vi.fn((shell: string, args: string[], options: Record<string, unknown>) => {
      const child = new EventEmitter()
      const callIndex = calls.length
      calls.push({ shell, args, options })
      queueMicrotask(() => {
        if (callIndex === 0) child.emit('error', spawnFailure('EPERM', -4048))
        else child.emit('spawn')
      })
      return child as never
    })
    const runner = createShellCommandRunner({
      platform: 'win32',
      env: { Path: 'C:\\Tools', SystemRoot: 'C:\\Windows' },
      plan: { primary, candidates: [primary, fallback] },
      spawnImpl: spawnImpl as never
    })

    const result = await runner.spawn('Write-Output "中文"', {
      cwd: 'C:\\Workspace With Spaces',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    expect(result.runtime.shell).toBe(fallback.shell)
    expect(calls.map((call) => call.shell)).toEqual([primary.shell, fallback.shell])
    expect(calls[0]?.args).toEqual(calls[1]?.args)
    expect(calls[1]?.args.at(-1)).toContain('Write-Output "中文"')
    expect(calls[1]?.options).toMatchObject({
      cwd: 'C:\\Workspace With Spaces',
      windowsHide: true,
      shell: false
    })
    expect((calls[1]?.options.env as NodeJS.ProcessEnv).Path).toContain('C:\\Windows\\System32')
  })

  it('does not fall back after the child emits spawn', async () => {
    const primary = powerShellRuntime('C:\\PowerShell\\pwsh.exe')
    const fallback = powerShellRuntime('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    const child = new EventEmitter()
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child as never
    })
    const runner = createShellCommandRunner({
      platform: 'win32',
      plan: { primary, candidates: [primary, fallback] },
      spawnImpl: spawnImpl as never
    })

    const result = await runner.spawn('Write-Output ok', { cwd: 'C:\\Workspace' })
    const observedError = vi.fn()
    child.once('error', observedError)
    child.emit('error', spawnFailure('EIO', -5))

    expect(result.runtime.shell).toBe(primary.shell)
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(observedError).toHaveBeenCalledTimes(1)
  })

  it('returns a structured error without command arguments when every candidate fails', async () => {
    const primary = powerShellRuntime('C:\\Blocked\\pwsh.exe')
    const fallback = powerShellRuntime('C:\\Blocked\\powershell.exe')
    const differentSyntax = shellRuntimeInfo({
      shell: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c']
    })
    let callIndex = 0
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter()
      const current = callIndex
      callIndex += 1
      queueMicrotask(() => {
        child.emit('error', current === 0
          ? spawnFailure('EPERM', -4048)
          : spawnFailure('ENOENT', -4058))
      })
      return child as never
    })
    const runner = createShellCommandRunner({
      platform: 'win32',
      plan: { primary, candidates: [primary, fallback, differentSyntax] },
      spawnImpl: spawnImpl as never
    })
    const command = 'Write-Output "do-not-leak-this-command"'

    let caught: unknown
    try {
      await runner.spawn(command, { cwd: 'C:\\Workspace' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ShellSpawnError)
    const shellError = caught as ShellSpawnError
    expect(shellError.attempts).toEqual([
      {
        shell: primary.shell,
        name: 'pwsh',
        code: 'EPERM',
        errno: -4048,
        syscall: 'spawn'
      },
      {
        shell: fallback.shell,
        name: 'powershell',
        code: 'ENOENT',
        errno: -4058,
        syscall: 'spawn'
      }
    ])
    expect(shellError.code).toBe('ENOENT')
    expect(spawnImpl).toHaveBeenCalledTimes(2)
    const serialized = JSON.stringify(shellError)
    expect(serialized).not.toContain(command)
    expect(serialized).not.toContain('do-not-leak-this-command')
    expect(serialized).not.toContain('EncodedCommand')
  })
})

describe('terminateSpawnTree', () => {
  it('uses taskkill to terminate process trees on Windows', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const child = {
      pid: 1234,
      kill: vi.fn()
    }
    const spawnImpl = vi.fn((command: string, args: string[]) => {
      calls.push({ command, args })
      return {
        once: vi.fn(),
        unref: vi.fn()
      }
    })

    terminateSpawnTree(child as never, {
      platform: 'win32',
      spawnImpl: spawnImpl as never
    })

    expect(calls).toEqual([{ command: 'taskkill', args: ['/pid', '1234', '/T', '/F'] }])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('falls back to child.kill when no pid is available', () => {
    const child = {
      kill: vi.fn()
    }

    terminateSpawnTree(child as never, { platform: 'win32' })

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

describe('tool path normalization', () => {
  it('normalizes Windows separators in tool-facing paths', () => {
    expect(normalizeToolPath('src\\main\\index.ts')).toBe('src/main/index.ts')
  })

  it('normalizes ls relative paths', () => {
    const fileStat = statSync(new URL('builtin-tool-utils.ts', import.meta.url))
    const entry = makeListEntry('/workspace/src/index.ts', '/workspace', fileStat)

    expect(entry.relative_path).toBe('src/index.ts')
  })
})

describe('globToRegExp', () => {
  it('matches ? as exactly one non-separator character', () => {
    const matcher = globToRegExp('src/?.ts')

    expect(matcher.test('src/a.ts')).toBe(true)
    expect(matcher.test('src/A.ts')).toBe(true)
    expect(matcher.test('src/😀.ts')).toBe(true)
    expect(matcher.test('src/ab.ts')).toBe(false)
    expect(matcher.test('src/😀😀.ts')).toBe(false)
    expect(matcher.test('src/.ts')).toBe(false)
    expect(matcher.test('src/a/b.ts')).toBe(false)
  })

  it('keeps the optional **/ prefix without allowing ? to cross directories', () => {
    const matcher = globToRegExp('**/a?.tsx')

    expect(matcher.test('ab.tsx')).toBe(true)
    expect(matcher.test('src/ab.tsx')).toBe(true)
    expect(matcher.test('src/nested/ab.tsx')).toBe(true)
    expect(matcher.test('src/nested/abc.tsx')).toBe(false)
    expect(matcher.test('src/nested/a/b.tsx')).toBe(false)
  })
})
