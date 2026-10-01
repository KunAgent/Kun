import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessInstaller } from './harness-installer.js'
import { harnessInstallPlan } from './harness-install-plan.js'
import { HarnessInstallRequestSchema } from '../contracts/harness-install.js'
import { harnessExecutableEnv } from './harness-executable-env.js'

const definition = new HarnessCatalog().get('devin')!
const plan = { action: 'install' as const, command: 'fixture-installer', platform: 'darwin', available: true }
function fixture(options: { installed?: boolean; spawnDelayed?: boolean; timeoutMs?: number } = {}) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  const spawn = vi.fn(async () => { if (options.spawnDelayed) await wait; return child })
  const stop = vi.fn(async () => { child.emit('exit', null, 'SIGTERM') })
  const detect = vi.fn(async () => ({ harnessId: 'devin', installed: options.installed === false ? 'no' as const : 'yes' as const,
    login: 'signed-out' as const, checkedAt: new Date().toISOString() }))
  const installer = new HarnessInstaller({ definition: () => definition, plan: async () => plan, spawn, stop, detect,
    timeoutMs: options.timeoutMs })
  return { installer, child, spawn, stop, detect, release }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('Agent installation plans', () => {
  it('chooses a host-platform installer and falls back when Homebrew is absent', async () => {
    expect(await harnessInstallPlan(definition, 'install', 'darwin', async (cmd) => '/bin/' + cmd))
      .toMatchObject({ command: 'brew install --cask devin-cli', available: true })
    expect(await harnessInstallPlan(definition, 'install', 'darwin', async (cmd) => cmd === 'brew' ? undefined : '/bin/' + cmd))
      .toMatchObject({ command: 'curl -fsSL https://cli.devin.ai/install.sh | bash', available: true })
  })
  it('does not accept custom commands from API callers or custom catalog entries', async () => {
    expect(HarnessInstallRequestSchema.safeParse({ action: 'install', command: 'untrusted' }).success).toBe(false)
    expect(await harnessInstallPlan({ ...definition, builtin: false }, 'install')).toBeNull()
    const installer = new HarnessInstaller({ definition: () => ({ ...definition, builtin: false }), detect: vi.fn() })
    await expect(installer.start('custom', 'install')).rejects.toThrow('built-in')
  })
  it('reports missing prerequisites and recognizes Windows npm.cmd', async () => {
    expect(await harnessInstallPlan(definition, 'install', 'linux', async () => undefined))
      .toMatchObject({ available: false, missingCommand: 'bash' })
    const gemini = new HarnessCatalog().get('gemini-cli')!
    expect(await harnessInstallPlan(gemini, 'install', 'win32', async (cmd) =>
      ['powershell.exe', 'npm.cmd'].includes(cmd) ? cmd : undefined)).toMatchObject({ available: true })
  })
  it('finds new user installs without replacing explicit PATH precedence', () => {
    const env = harnessExecutableEnv({ HOME: '/fixture', PATH: '/custom/bin' })
    expect(env.PATH?.startsWith('/custom/bin')).toBe(true)
    expect(env.PATH).toContain('/fixture/.local/bin')
  })
})

describe('Agent installation jobs', () => {
  it('deduplicates clicks, redacts bounded output, and verifies installation before success', async () => {
    const { installer, child, spawn, detect } = fixture()
    const [first, second] = await Promise.all([installer.start('devin', 'install'), installer.start('devin', 'install')])
    expect(first.job?.id).toBe(second.job?.id)
    expect(spawn).toHaveBeenCalledTimes(1)
    child.stdout!.emit('data', 'x'.repeat(40_000) + '\napi_key=private-value\n')
    const running = await installer.state('devin')
    expect(running.job?.output.length).toBeLessThanOrEqual(32_768)
    expect(running.job?.output).not.toContain('private-value')
    child.emit('exit', 0)
    await flush()
    expect(detect).toHaveBeenCalledOnce()
    expect((await installer.state('devin')).job).toMatchObject({ status: 'completed', detected: { login: 'signed-out' } })
  })
  it('does not mistake a zero installer exit for a working command', async () => {
    const { installer, child } = fixture({ installed: false })
    await installer.start('devin', 'install')
    child.emit('exit', 0)
    await flush()
    expect((await installer.state('devin')).job).toMatchObject({ status: 'failed', error: expect.stringContaining('still unavailable') })
  })
  it('handles nonzero exits and permits a retry with a new job identity', async () => {
    const { installer, child } = fixture()
    const first = await installer.start('devin', 'install')
    child.emit('exit', 2)
    await flush()
    expect((await installer.state('devin')).job?.status).toBe('failed')
    const next = await installer.start('devin', 'install')
    expect(next.job?.id).not.toBe(first.job?.id)
    await expect(installer.cancel('devin', first.job!.id)).rejects.toThrow('changed')
    await installer.cancel('devin', next.job!.id)
  })
  it('cancels an in-flight launch without reporting success or starting a duplicate', async () => {
    const { installer, spawn, release, detect } = fixture({ spawnDelayed: true })
    const first = await installer.start('devin', 'install')
    await installer.cancel('devin', first.job!.id)
    expect((await installer.start('devin', 'install')).job?.id).toBe(first.job?.id)
    release()
    await flush()
    expect((await installer.state('devin')).job?.status).toBe('cancelled')
    expect(detect).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledOnce()
  })
  it('terminates stalled installers at a bounded deadline', async () => {
    vi.useFakeTimers()
    try {
      const { installer, stop } = fixture({ timeoutMs: 100 })
      await installer.start('devin', 'install')
      await vi.advanceTimersByTimeAsync(100)
      expect(stop).toHaveBeenCalled()
      expect((await installer.state('devin')).job).toMatchObject({ status: 'failed', error: 'Installation timed out' })
    } finally { vi.useRealTimers() }
  })
})
