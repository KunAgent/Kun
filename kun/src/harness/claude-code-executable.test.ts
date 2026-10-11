import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeCodeSdkExecutable, installedClaudeCode } from './claude-code-executable.js'
import { providerModule } from './providers/registry.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'

const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-claude-exe-')); dirs.push(dir); return dir
}
async function executable(path: string, mode = 0o755): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '#!/bin/sh\n'); await chmod(path, mode)
  return path
}

describe('Claude Code executable for the Agent SDK', () => {
  it('prefers the settings path, then Kun\'s download, then the SDK binary, then the user\'s installation', () => {
    const installed = () => '/home/user/.local/bin/claude'
    expect(claudeCodeSdkExecutable(' /custom/claude ', { env: { KUN_CLAUDE_BINARY: '/kun/claude' }, bundled: () => '/sdk/claude', installed }))
      .toBe('/custom/claude')
    expect(claudeCodeSdkExecutable(undefined, { env: { KUN_CLAUDE_BINARY: '/kun/claude' }, bundled: () => '/sdk/claude', installed }))
      .toBe('/kun/claude')
    // The SDK finds its own platform binary; Kun must not override it.
    expect(claudeCodeSdkExecutable(undefined, { env: {}, bundled: () => '/sdk/claude', installed })).toBeUndefined()
    // Packaged builds ship no SDK binary: launch the detected Claude Code.
    expect(claudeCodeSdkExecutable('', { env: { KUN_CLAUDE_BINARY: ' ' }, bundled: () => undefined, installed }))
      .toBe('/home/user/.local/bin/claude')
    expect(claudeCodeSdkExecutable(undefined, { env: {}, bundled: () => undefined, installed: () => undefined })).toBeUndefined()
  })

  it('finds the native launcher before PATH, as a shell with the installer\'s PATH entry would', async () => {
    const dir = await home()
    const npm = await executable(join(dir, 'npm-bin', 'claude'))
    expect(installedClaudeCode({ HOME: dir, PATH: join(dir, 'npm-bin') }, 'darwin')).toBe(npm)
    const native = await executable(join(dir, '.local', 'bin', 'claude'))
    expect(installedClaudeCode({ HOME: dir, PATH: join(dir, 'npm-bin') }, 'darwin')).toBe(native)
  })

  it('skips files it cannot execute and Windows shims it cannot spawn', async () => {
    const dir = await home()
    await executable(join(dir, 'a', 'claude'), 0o644)
    const runnable = await executable(join(dir, 'b', 'claude'))
    expect(installedClaudeCode({ HOME: dir, PATH: [join(dir, 'a'), join(dir, 'b')].join(':') }, 'darwin')).toBe(runnable)
    await executable(join(dir, 'w', 'claude.cmd'))
    expect(installedClaudeCode({ HOME: dir, PATH: join(dir, 'w') }, 'win32')).toBeUndefined()
    const exe = await executable(join(dir, 'w', 'claude.exe'))
    expect(installedClaudeCode({ HOME: dir, PATH: join(dir, 'w') }, 'win32')).toBe(exe)
  })

  it('detects the same Claude Code the SDK will launch', async () => {
    const dir = await home()
    const native = await executable(join(dir, '.local', 'bin', 'claude'))
    vi.stubEnv('HOME', dir)
    vi.stubEnv('PATH', '/usr/bin:/bin')
    expect(await providerModule('claude-code')?.resolveExecutable?.()).toBe(native)
    await rm(native)
    // Falls back to the search PATH (a machine may have one in /usr/local/bin).
    expect(await providerModule('claude-code')?.resolveExecutable?.()).not.toBe(native)
  })
})

describe('CodeMaker install directory', () => {
  it('resolves codemaker from ~/.codemaker/bin when a GUI launch has no shell PATH', async () => {
    const dir = await home()
    const codemaker = await executable(join(dir, '.codemaker', 'bin', 'codemaker'))
    expect(await resolveExecutable('codemaker', { env: harnessExecutableEnv({ HOME: dir, PATH: '/usr/bin:/bin' }) })).toBe(codemaker)
  })
})
