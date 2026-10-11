import { describe, expect, it, vi } from 'vitest'
import { probeFxNativeCredentials } from './fx-native-credential-probe.js'
import type { SpawnCaptured } from './harness-detector.js'

const capture = (stdout: string, options: { timedOut?: boolean; exitCode?: number | null } = {}): SpawnCaptured =>
  vi.fn(async () => ({ stdout, stderr: 'private account and token details', timedOut: options.timedOut ?? false,
    exitCode: options.exitCode === undefined ? 0 : options.exitCode }))

describe('fx native credential status probe', () => {
  it('recognizes Keychain-backed fx login as configured while keeping authentication unverified', async () => {
    const spawn = capture(JSON.stringify({ auth: 'fx login', auth_help: 'private-help',
      account: 'private@example.test', access_token: 'private-token' }))
    const result = await probeFxNativeCredentials('/selected/fx', { env: { HOME: '/profile/home' }, spawnCaptured: spawn })
    expect(result).toEqual({ configured: true, authentication: 'unverified' })
    expect(JSON.stringify(result)).not.toMatch(/private|auth_help|expired/)
    expect(spawn).toHaveBeenCalledWith('/selected/fx', ['status', '--json'], {
      timeoutMs: 10_000, signal: undefined, env: { HOME: '/profile/home', FX_AUTO_UPGRADE: '0' }
    })
  })

  it('recognizes the official missing status without echoing its private help', async () => {
    const result = await probeFxNativeCredentials('fx', {
      env: {}, spawnCaptured: capture(JSON.stringify({ auth: 'missing', auth_help: 'private storage path' }))
    })
    expect(result).toEqual({ configured: false, authentication: 'missing' })
  })

  it('does not enable an expired login even when the CLI marks it refreshable', async () => {
    const result = await probeFxNativeCredentials('fx', { env: {}, spawnCaptured: capture(JSON.stringify({
      auth: 'fx login', auth_expired: true, auth_refreshable: true, account: 'private-account'
    })) })
    expect(result).toEqual({ configured: false, authentication: 'unverified' })
  })

  it.each([
    '', 'not JSON', 'null', '[]', '{"authenticated":true}', '{"auth":"unknown"}',
    '{"auth":"fx login example"}', '{"auth":"configured provider"}', '{"auth":"fx login"} trailing',
    '{"auth":"fx login", "auth_expired":"true"}',
    JSON.stringify({ auth: 'fx login', padding: 'x'.repeat(65 * 1024) })
  ])('leaves unsupported or malformed status unknown: %s', async (stdout) => {
    expect(await probeFxNativeCredentials('fx', { env: {}, spawnCaptured: capture(stdout) }))
      .toEqual({ configured: 'unknown', authentication: 'unverified' })
  })

  it.each([
    { timedOut: true, exitCode: 0 }, { timedOut: false, exitCode: 1 }, { timedOut: false, exitCode: null }
  ])('does not trust a failed or timed-out command: %j', async (state) => {
    expect(await probeFxNativeCredentials('fx', { env: {}, spawnCaptured: capture('{"auth":"fx login"}', state) }))
      .toEqual({ configured: 'unknown', authentication: 'unverified' })
  })

  it('does not add ambient host credentials or a Keychain-disabling flag', async () => {
    const original = { HOME: '/profile/home', FX_PROVIDER: 'gateway', FX_AUTO_UPGRADE: '1' }
    const spawn = capture('{"auth":"fx login"}')
    await probeFxNativeCredentials('fx', { env: original, spawnCaptured: spawn })
    const env = (vi.mocked(spawn).mock.calls[0]![2].env)!
    expect(env).toEqual({ HOME: '/profile/home', FX_PROVIDER: 'gateway', FX_AUTO_UPGRADE: '0' })
    expect(env.FX_DISABLE_KEYCHAIN).toBeUndefined()
    expect(env.KUN_RUNTIME_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(original.FX_AUTO_UPGRADE).toBe('1')
  })

  it('keeps command and spawn failures categorical without exposing errors', async () => {
    const spawn: SpawnCaptured = vi.fn(async () => { throw new Error('private-token') })
    expect(await probeFxNativeCredentials(undefined, { env: {}, spawnCaptured: spawn }))
      .toEqual({ configured: 'unknown', authentication: 'unverified' })
    expect(spawn).not.toHaveBeenCalled()
    expect(await probeFxNativeCredentials('fx', { env: {}, spawnCaptured: spawn }))
      .toEqual({ configured: 'unknown', authentication: 'unverified' })
    const synchronous: SpawnCaptured = () => { throw new Error('private synchronous failure') }
    expect(await probeFxNativeCredentials('fx', { env: {}, spawnCaptured: synchronous }))
      .toEqual({ configured: 'unknown', authentication: 'unverified' })
  })

  it('honors cancellation before and during the status call', async () => {
    const before = new AbortController()
    before.abort(new Error('cancelled before'))
    const spawn = capture('{"auth":"fx login"}')
    await expect(probeFxNativeCredentials('fx', { env: {}, spawnCaptured: spawn, signal: before.signal })).rejects.toThrow('cancelled before')
    expect(spawn).not.toHaveBeenCalled()
    const during = new AbortController()
    const blocked: SpawnCaptured = vi.fn(() => new Promise<Awaited<ReturnType<SpawnCaptured>>>(() => undefined))
    const result = probeFxNativeCredentials('fx', { env: {}, spawnCaptured: blocked, signal: during.signal })
    during.abort(new Error('cancelled during'))
    await expect(result).rejects.toThrow('cancelled during')
    expect(blocked).not.toHaveBeenCalled()
  })
})
