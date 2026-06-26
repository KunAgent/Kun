import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveBundledClaudeBinary, runClaudeSetupToken } from './claude-subscription-auth'

function fakeChild(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  return child
}

describe('runClaudeSetupToken', () => {
  test('captures the OAuth token printed across stdout chunks', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    child.stdout.emit('data', Buffer.from('Visit https://claude.ai/... then\n'))
    child.stdout.emit('data', Buffer.from('Your token: sk-ant-oat01-AbC123_xyz-DEF\n'))
    expect(await promise).toEqual({ ok: true, token: 'sk-ant-oat01-AbC123_xyz-DEF' })
  })

  test('reports a friendly message when the CLI is missing', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    child.emit('error', err)
    expect(await promise).toEqual({ ok: false, message: 'claude-cli-not-found' })
  })

  test('fails when the process exits without a token', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    child.stderr.emit('data', Buffer.from('authorization cancelled'))
    child.emit('exit', 1)
    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('authorization cancelled')
  })

  test('only settles once (exit after a successful capture is ignored)', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    child.stdout.emit('data', Buffer.from('sk-ant-oat01-TOKEN'))
    child.emit('exit', 0)
    expect(await promise).toEqual({ ok: true, token: 'sk-ant-oat01-TOKEN' })
  })

  test('spawns the provided bundled binaryPath instead of a PATH lookup', async () => {
    const child = fakeChild()
    let seenCommand: string | undefined
    const promise = runClaudeSetupToken({
      binaryPath: '/bundled/claude',
      spawnFn: ((cmd: string) => {
        seenCommand = cmd
        return child
      }) as never
    })
    child.stdout.emit('data', Buffer.from('sk-ant-oat01-Z'))
    await promise
    expect(seenCommand).toBe('/bundled/claude')
  })
})

describe('resolveBundledClaudeBinary', () => {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  const plat =
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : null

  test.runIf(arch && plat)('finds the per-platform bundled binary; undefined when absent', () => {
    const bin = plat === 'win32' ? 'claude.exe' : 'claude'
    const root = join(tmpdir(), `kun-sub-bin-${process.pid}`)
    const dir = join(root, 'node_modules', `@anthropic-ai/claude-agent-sdk-${plat}-${arch}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, bin), '')
    try {
      expect(resolveBundledClaudeBinary([root])).toBe(join(dir, bin))
      expect(resolveBundledClaudeBinary([join(tmpdir(), 'kun-sub-none')])).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
