import { expect, it } from 'vitest'
import { AntigravityCliRuntime, buildAntigravityArgs, normalizeAntigravityModel } from './antigravity-cli-runtime.js'

it('lets agy choose its native default model without passing a literal default ID', () => {
  expect(normalizeAntigravityModel('default')).toBe('default')
  const args = buildAntigravityArgs({ prompt: 'hello', model: 'default', timeoutMs: 10000,
    planMode: false, approvalPolicy: 'never', sandboxMode: 'read-only' })
  expect(args).not.toContain('--model')
  expect(args).toContain('--sandbox')
  expect(args).toContain('plan')
})

it('accepts the explicit native harness without borrowing unrelated model providers', () => {
  const runtime = new AntigravityCliRuntime({ providerConfigs: {}, providerIds: new Set(['native-account']),
    defaultIsAntigravity: false } as never)
  const route = { harnessId: 'antigravity', credentialMode: 'native-login' as const, model: 'default' }
  expect(runtime.handlesRoute(route)).toBe(true)
  expect(runtime.handlesRoute({ ...route, providerId: 'default' })).toBe(true)
  expect(runtime.handlesRoute({ ...route, providerId: 'native-account' })).toBe(true)
  expect(runtime.handlesRoute({ ...route, providerId: 'http-account' })).toBe(false)
  expect(runtime.handlesRoute({ ...route, credentialMode: 'kun-gateway' })).toBe(false)
  expect(runtime.handlesRoute({ ...route, harnessId: 'codex' })).toBe(false)
  expect(runtime.handlesProvider(undefined)).toBe(false)
})
