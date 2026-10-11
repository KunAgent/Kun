import { describe, expect, it, vi } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessDetector } from './harness-detector.js'
import { harnessInstallPlan } from './harness-install-plan.js'
import { acpModelCatalog } from './acp-model-catalog.js'

const definition = new HarnessCatalog().get('opencode2')!
describe('OpenCode2 integration', () => {
  it('declares the independent official preview command and native setup', async () => {
    expect(definition).toMatchObject({ displayName: 'OpenCode2', availability: 'preview',
      detect: { command: 'opencode2', aliases: [] }, launch: { command: 'opencode2', args: ['acp'] },
      credentialModes: ['native-login'], modelSource: 'probe', staticModels: [] })
    expect(definition.historySource).toBeUndefined()
    expect(definition.gateway).toBeUndefined()
    expect(definition.setup?.login).toMatchObject({ command: 'opencode2', args: ['auth', 'login', '--standalone'] })
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(await harnessInstallPlan(definition, 'install', platform, async (command) => `/fixture/${command}`))
        .toMatchObject({ available: true, command: 'npm install -g @opencode-ai/cli@next' })
    }
  })
  it('does not resolve V1 as V2, and honors the explicit V2 binary', async () => {
    let binary: string | undefined
    const resolve = vi.fn(async (command: string): Promise<string | undefined> => command === 'opencode' ? '/bin/opencode' : undefined)
    const detector = new HarnessDetector({ definitions: () => [definition],
      overrides: () => ({ opencode2: { binaryPath: binary } }), resolveExecutable: resolve,
      spawnCaptured: async () => ({ stdout: 'opencode2 v0.0.0-beta-17823', stderr: '', exitCode: 0, timedOut: false }),
      probeLogin: async () => 'unknown', nowMs: Date.now, nowIso: () => new Date().toISOString() })
    expect(await detector.status('opencode2')).toMatchObject({ installed: 'no' })
    expect(resolve).not.toHaveBeenCalledWith('opencode')
    binary = '/selected/opencode2'
    resolve.mockImplementation(async (command) => command === binary ? command : undefined)
    expect(await detector.status('opencode2', { force: true })).toMatchObject({
      installed: 'yes', version: '0.0.0-beta-17823', resolvedCommand: binary })
  })
  it('keeps V1/V2 opt-in independent and preserves native model IDs', () => {
    const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => [{ harnessId: 'opencode2', credentialMode: 'native-login' }] })
    expect(catalog.isDisabled('opencode2')).toBe(false)
    expect(catalog.isDisabled('opencode')).toBe(true)
    expect(acpModelCatalog({ harnessId: 'opencode2', configOptions: [{ id: 'model', name: 'Model', category: 'model',
      type: 'select', currentValue: 'openai/gpt-5.2', options: [{ name: 'GPT 5.2', value: 'openai/gpt-5.2' }] }] }))
      .toMatchObject({ models: ['openai/gpt-5.2'], modelInfo: [{ id: 'openai/gpt-5.2', displayName: 'GPT 5.2' }] })
  })
})
