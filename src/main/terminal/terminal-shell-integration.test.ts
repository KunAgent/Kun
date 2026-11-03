import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyShellIntegration, detectTerminalShells, shellIntegrationKind } from './terminal-shell-integration'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kun-shell-integration-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const posix = process.platform !== 'win32'

describe('shell integration', () => {
  it('recognises the shells it ships hooks for', () => {
    expect(shellIntegrationKind('/bin/zsh')).toBe('zsh')
    expect(shellIntegrationKind('/usr/local/bin/bash')).toBe('bash')
    expect(shellIntegrationKind('/opt/homebrew/bin/fish')).toBe('fish')
    expect(shellIntegrationKind('/bin/sh')).toBeNull()
    expect(shellIntegrationKind('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('bash')
  })

  it('keeps the user zsh directory and points ZDOTDIR at the hook files', async () => {
    const dir = tempDir()
    const launch = await applyShellIntegration('/bin/zsh', dir, { HOME: '/Users/me', ZDOTDIR: '/Users/me/.config/zsh' }, 'darwin')
    expect(launch?.args).toEqual([])
    expect(launch?.env).toMatchObject({
      ZDOTDIR: join(dir, 'zsh'),
      KUN_USER_ZDOTDIR: '/Users/me/.config/zsh',
      KUN_SHELL_INTEGRATION: '1'
    })
    expect(readFileSync(join(dir, 'zsh', '.zshrc'), 'utf8')).toContain('builtin source "$ZDOTDIR/.zshrc"')
  })

  it('loads bash and fish hooks through their init flags', async () => {
    const dir = tempDir()
    expect((await applyShellIntegration('/bin/bash', dir, {}, 'linux'))?.args).toEqual(['--init-file', join(dir, 'kun.bash')])
    const fish = await applyShellIntegration('/usr/bin/fish', dir, {}, 'linux')
    expect(fish?.args[0]).toBe('--init-command')
    expect(fish?.args[1]).toContain(join(dir, 'kun.fish'))
  })

  it('leaves unsupported shells and Windows untouched', async () => {
    const dir = tempDir()
    expect(await applyShellIntegration('/bin/sh', dir, {}, 'darwin')).toBeNull()
    expect(await applyShellIntegration('C:\\bash.exe', dir, {}, 'win32')).toBeNull()
    expect(await applyShellIntegration('/bin/zsh', undefined, {}, 'darwin')).toBeNull()
  })

  it.runIf(posix && existsSync('/bin/zsh'))('writes zsh hooks that parse and report a command', async () => {
    const dir = tempDir()
    await applyShellIntegration('/bin/zsh', dir, {}, process.platform)
    execFileSync('/bin/zsh', ['-n', join(dir, 'zsh', 'kun.zsh')])
    const output = execFileSync('/bin/zsh', ['-f', '-c', [
      `source ${JSON.stringify(join(dir, 'zsh', 'kun.zsh'))}`,
      '__kun_preexec "echo a;b"',
      'false',
      '__kun_precmd'
    ].join('\n')]).toString('latin1')
    expect(output).toContain('\u001b]633;E;echo a\\x3bb\u0007')
    expect(output).toContain('\u001b]633;C\u0007')
    expect(output).toContain('\u001b]633;D;1\u0007')
    expect(output).toContain('\u001b]633;A\u0007')
  })

  it.runIf(posix && existsSync('/bin/bash'))('writes bash hooks that parse', async () => {
    const dir = tempDir()
    await applyShellIntegration('/bin/bash', dir, {}, process.platform)
    execFileSync('/bin/bash', ['-n', join(dir, 'kun.bash')])
    const output = execFileSync('/bin/bash', ['-c', [
      `HOME=${JSON.stringify(dir)} source ${JSON.stringify(join(dir, 'kun.bash'))}`,
      'printf "%s" "$(__kun_escape "a\\\\b;c")"'
    ].join('\n')]).toString()
    // The trap reports the test's own command, then the escaped value prints.
    expect(output).toContain('\u001b]633;C\u0007')
    expect(output.endsWith('a\\\\b\\x3bc')).toBe(true)
    expect(readFileSync(join(dir, 'kun.bash'), 'utf8').trimEnd().endsWith("trap '__kun_preexec' DEBUG")).toBe(true)
  })

  it('lists existing shells once, skipping nologin', () => {
    const shells = detectTerminalShells(
      'darwin',
      { SHELL: '/bin/zsh' },
      (path) => ['/bin/zsh', '/bin/bash', '/usr/bin/false', '/sbin/nologin'].includes(path),
      () => '# comment\n/bin/zsh\n/bin/bash\n/sbin/nologin\n/usr/bin/false\n'
    )
    expect(shells.map((shell) => shell.path)).toEqual(['/bin/zsh', '/bin/bash'])
    expect(shells.every((shell) => shell.supportsIntegration)).toBe(true)
    expect(detectTerminalShells('win32')).toEqual([])
  })
})
