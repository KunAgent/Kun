import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeHarnessLogin, type HarnessLoginProbeDeps } from './harness-login-probes.js'
import { HarnessCatalog } from './harness-catalog.js'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'login-probe-')) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })
const def = (id: string) => new HarnessCatalog({ custom: () => [] }).get(id)!
const deps = (): HarnessLoginProbeDeps => ({ providers: () => ({}), homeDir: home, env: {} })
async function file(path: string, value: unknown) {
  const target = join(home, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(value))
  return target
}

describe('local login evidence', () => {
  it('does not authenticate Claude from an OAuth file or arbitrary parsed object', async () => {
    for (const value of [{}, { claudeAiOauth: { accessToken: 'fixture-only', expiresAt: 0 } }]) {
      await file('.claude/.credentials.json', value)
      expect(await probeHarnessLogin(def('claude-code'), deps())).toBe('unknown')
    }
  })
  it.each([
    [{ loggedIn: true, authMethod: 'claude.ai', email: 'fixture@example.test' }, 0, 'signed-in'],
    [{ loggedIn: true, authMethod: 'oauth', subscriptionType: 'pro' }, 0, 'signed-in'],
    [{ loggedIn: true, authMethod: 'api_key' }, 0, 'unknown'],
    [{ loggedIn: true }, 0, 'unknown'], [{ loggedIn: false }, 1, 'signed-out'],
    [{ loggedIn: true }, 1, 'unknown'], [{ success: true }, 0, 'unknown']
  ] as const)('accepts only explicit CLI account evidence %j', async (account, exitCode, expected) => {
    const spawnCaptured = vi.fn(async () => ({ stdout: JSON.stringify(account), stderr: '', timedOut: false, exitCode }))
    expect(await probeHarnessLogin(def('claude-code'), { ...deps(), spawnCaptured }, '/selected/claude')).toBe(expected)
    expect(spawnCaptured).toHaveBeenCalledWith('/selected/claude', ['auth', 'status', '--json'],
      expect.objectContaining({ timeoutMs: 5_000, env: {} }))
  })
  it('does not substitute Gemini CLI OAuth for Antigravity agy authentication', async () => {
    const geminiCredentialsPath = await file('.gemini/oauth_creds.json', { access_token: 'fixture' })
    expect(await probeHarnessLogin(def('antigravity'), { ...deps(), geminiCredentialsPath })).toBe('signed-out')
    expect(await probeHarnessLogin(def('antigravity'), { ...deps(), env: { GOOGLE_API_KEY: 'fixture' } })).toBe('unknown')
    await file('.config/gcloud/application_default_credentials.json', { type: 'authorized_user', refresh_token: 'fixture' })
    expect(await probeHarnessLogin(def('antigravity'), deps())).toBe('unknown')
  })
  it('treats supported Devin/Windsurf key bindings as unverified', async () => {
    expect(await probeHarnessLogin(def('devin'), deps())).toBe('signed-out')
    expect(await probeHarnessLogin(def('devin'), { ...deps(), env: { DEVIN_API_KEY: 'fixture' } })).toBe('signed-out')
    expect(await probeHarnessLogin(def('devin'), { ...deps(), env: { WINDSURF_API_KEY: 'fixture' } })).toBe('unknown')
  })
  it.each([
    ['Logged in (via Devin).\nEmail: private@example.test', 0, 'signed-in'],
    ['Logged in (via Windsurf).', 0, 'signed-in'],
    ['\u001b[32mLogged in.\u001b[0m', 0, 'signed-in'],
    ['Not logged in.', 1, 'signed-out'],
    ['Logged in (via Devin).', 1, 'unknown'],
    ['Authentication failed', 0, 'unknown'],
    ['Example: Logged in (via Devin).', 0, 'unknown']
  ] as const)('uses explicit selected Devin account status: %s', async (stdout, exitCode, expected) => {
    const spawnCaptured = vi.fn(async () => ({ stdout, stderr: '', timedOut: false, exitCode }))
    expect(await probeHarnessLogin(def('devin'), { ...deps(), spawnCaptured }, '/selected/devin')).toBe(expected)
    expect(spawnCaptured).toHaveBeenCalledWith('/selected/devin', ['auth', 'status'], expect.objectContaining({ signal: undefined }))
  })
  it('does not infer Devin login after a timeout or cancellation', async () => {
    const controller = new AbortController()
    const spawnCaptured = vi.fn(async () => ({ stdout: 'Logged in.', stderr: '', timedOut: true, exitCode: 0 }))
    expect(await probeHarnessLogin(def('devin'), { ...deps(), spawnCaptured }, '/selected/devin')).toBe('unknown')
    spawnCaptured.mockImplementation(async () => { controller.abort(); return { stdout: 'Logged in.', stderr: '', timedOut: false, exitCode: 0 } })
    await expect(probeHarnessLogin(def('devin'), { ...deps(), spawnCaptured, signal: controller.signal }, '/selected/devin')).rejects.toThrow()
  })
  it('does not authenticate Pi from auth file presence', async () => {
    await file('.pi/agent/auth.json', { anthropic: { key: 'fixture' } })
    expect(await probeHarnessLogin(def('pi'), deps())).toBe('unknown')
  })
  it('does not start a command after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const spawnCaptured = vi.fn()
    await expect(probeHarnessLogin(def('claude-code'), { ...deps(), signal: controller.signal, spawnCaptured }, 'claude'))
      .rejects.toThrow('cancelled')
    expect(spawnCaptured).not.toHaveBeenCalled()
  })
})

it('does not resurrect host model keys or private Kun tokens during a native account probe', async () => {
  const spawnCaptured = vi.fn(async () => ({ stdout: '{}', stderr: '', timedOut: false, exitCode: 0 }))
  await probeHarnessLogin(def('devin'), { ...deps(), spawnCaptured, env: {
    HOME: '/fixture/home', WINDSURF_API_KEY: 'selected-native', ANTHROPIC_API_KEY: 'host-key',
    OPENAI_API_KEY: 'unrelated', KUN_RUNTIME_TOKEN: 'private-runtime', KUN_BROWSER_USE_BRIDGE_TOKEN: 'private-bridge'
  } }, '/fixture/devin')
  const env = (spawnCaptured.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }])[2].env
  expect(env).toMatchObject({ HOME: '/fixture/home', WINDSURF_API_KEY: 'selected-native' })
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KUN_RUNTIME_TOKEN', 'KUN_BROWSER_USE_BRIDGE_TOKEN']) expect(env[key]).toBeUndefined()
})
