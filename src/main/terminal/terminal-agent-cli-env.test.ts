import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyKunCliEnv, ensureKunCliLaunch } from './terminal-agent-cli-env'

const NODE_SCRIPT = {
  kind: 'node-script' as const,
  command: '/Applications/Kun.app/Contents/MacOS/Kun',
  args: ['/Applications/Kun.app/Contents/Resources/app.asar.unpacked/kun/dist/cli/serve-entry.js'],
  dataDir: ''
}

const CUSTOM = {
  kind: 'custom' as const,
  command: '/opt/kun-nightly/kun',
  args: [],
  dataDir: ''
}

function base(shimDir: string) {
  return {
    isPackaged: false,
    platform: 'darwin' as const,
    resourcesPath: '/unused/resources',
    execDir: '/unused/exec',
    shimDir,
    resolution: NODE_SCRIPT
  }
}

describe('ensureKunCliLaunch', () => {
  it('prefers the packaged resources/bin launcher when it exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-cli-'))
    const resources = join(root, 'resources')
    mkdirSync(join(resources, 'bin'), { recursive: true })
    const launcher = join(resources, 'bin', 'kun')
    writeFileSync(launcher, '#!/bin/sh\n')
    const launch = ensureKunCliLaunch({
      ...base(join(root, 'shim')),
      isPackaged: true,
      resourcesPath: resources
    })
    expect(launch).toEqual({ binDir: join(resources, 'bin'), cliPath: launcher })
  })

  it('prefers bin/kun.cmd next to the executable on Windows packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-cli-'))
    const execDir = join(root, 'app')
    mkdirSync(join(execDir, 'bin'), { recursive: true })
    const launcher = join(execDir, 'bin', 'kun.cmd')
    writeFileSync(launcher, '@echo off\r\n')
    const launch = ensureKunCliLaunch({
      ...base(join(root, 'shim')),
      isPackaged: true,
      platform: 'win32',
      execDir
    })
    expect(launch).toEqual({ binDir: join(execDir, 'bin'), cliPath: launcher })
  })

  it('generates an executable node shim for development', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-cli-'))
    const shimDir = join(root, 'cli-bin')
    const launch = ensureKunCliLaunch(base(shimDir))
    expect(launch).toEqual({ binDir: shimDir, cliPath: join(shimDir, 'kun') })
    const text = readFileSync(launch!.cliPath, 'utf8')
    expect(text).toBe(
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${NODE_SCRIPT.command}' '${NODE_SCRIPT.args[0]}' "$@"\n`
    )
    expect(statSync(launch!.cliPath).mode & 0o111).not.toBe(0)
  })

  it('falls back to a shim when a package has no launcher', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-cli-'))
    const shimDir = join(root, 'cli-bin')
    const launch = ensureKunCliLaunch({
      ...base(shimDir),
      isPackaged: true,
      resourcesPath: join(root, 'resources')
    })
    expect(launch?.cliPath).toBe(join(shimDir, 'kun'))
  })

  it('omits ELECTRON_RUN_AS_NODE for custom executables', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-cli-'))
    const launch = ensureKunCliLaunch({ ...base(join(root, 'cli-bin')), resolution: CUSTOM })
    expect(readFileSync(launch!.cliPath, 'utf8')).toBe(
      `#!/bin/sh\nexec '${CUSTOM.command}' "$@"\n`
    )
  })

  it('rewrites the shim only when the content changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-cli-'))
    const shimDir = join(root, 'cli-bin')
    const first = ensureKunCliLaunch(base(shimDir))!
    writeFileSync(first.cliPath, 'stale\n')
    const second = ensureKunCliLaunch(base(shimDir))!
    expect(readFileSync(second.cliPath, 'utf8')).toContain('exec')
    // Idempotent: identical input keeps the current file untouched.
    expect(ensureKunCliLaunch(base(shimDir))?.cliPath).toBe(first.cliPath)
  })
})

describe('applyKunCliEnv', () => {
  it('prepends the bin dir to PATH and exports KUN_CLI', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' }
    applyKunCliEnv(env, { binDir: '/opt/kun/bin', cliPath: '/opt/kun/bin/kun' })
    expect(env.PATH).toBe(`/opt/kun/bin${delimiter}/usr/bin:/bin`)
    expect(env.KUN_CLI).toBe('/opt/kun/bin/kun')
  })

  it('preserves an existing Path key case and empty PATH', () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows' }
    applyKunCliEnv(env, { binDir: 'C:\\Kun\\bin', cliPath: 'C:\\Kun\\bin\\kun.cmd' })
    expect(env.Path).toBe(`C:\\Kun\\bin${delimiter}C:\\Windows`)
    expect(env.PATH).toBeUndefined()
    const empty: NodeJS.ProcessEnv = {}
    applyKunCliEnv(empty, { binDir: '/b', cliPath: '/b/kun' })
    expect(empty.PATH).toBe('/b')
  })
})
