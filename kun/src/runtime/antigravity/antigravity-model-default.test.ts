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

it.each(['gemini-pro-orchestrator', 'models/gemini-pro-orchestrator-argon'])('omits a saved effort for %s in print mode', (model) => {
  const args = buildAntigravityArgs({ prompt: 'hello', model, effort: 'max', timeoutMs: 10000,
    planMode: true, approvalPolicy: 'never', sandboxMode: 'read-only' })
  expect(args[args.indexOf('--model') + 1]).toBe(model.replace(/^models\//, ''))
  expect(args).not.toContain('--effort')
  expect(args).toContain('--sandbox')
})

it.each([
  ['gemini-4-hydrogen', 'xhigh', 'xhigh'],
  ['gemini-4-hydrogen-xhigh', undefined, 'xhigh'],
  ['models/gemini-4-hydrogen-xhigh', 'auto', 'xhigh'],
  ['gemini-4-hydrogen-xhigh', 'low', 'low']
] as const)('passes the selected Hydrogen level for %s / %s in print mode', (model, effort, expected) => {
  const args = buildAntigravityArgs({ prompt: 'hello', model, effort, timeoutMs: 10000,
    planMode: false, approvalPolicy: 'never', sandboxMode: 'read-only' })
  expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-hydrogen')
  expect(args[args.indexOf('--effort') + 1]).toBe(expected)
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
