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
