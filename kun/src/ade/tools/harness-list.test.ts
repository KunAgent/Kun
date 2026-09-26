import { describe, expect, it } from 'vitest'
import type { HarnessStatus } from '../../contracts/harness.js'
import {
  BUILTIN_HARNESSES,
  KUN_NATIVE_CAPABILITIES
} from '../../harness/builtin-harnesses.js'
import {
  listHarnessesForManager,
  type HarnessListDeps,
  type HarnessProviderModelGroup
} from './harness-list.js'

const NOW = '2026-09-28T00:00:00.000Z'

const catalog = {
  get: (id: string) => BUILTIN_HARNESSES.find((def) => def.id === id),
  list: () => BUILTIN_HARNESSES,
  isDisabled: () => false
}

function readyStatus(harnessId: string): HarnessStatus {
  return {
    harnessId: harnessId as HarnessStatus['harnessId'],
    installed: 'yes',
    login: 'signed-in',
    checkedAt: NOW
  }
}

const detector = { status: async (id: string) => readyStatus(id) } as never

function deps(overrides: Partial<HarnessListDeps> = {}): HarnessListDeps {
  return {
    catalog: catalog as never,
    detector,
    ...overrides
  }
}

describe('listHarnessesForManager', () => {
  it('lists static models under native-login and gateway groups under kun-gateway', async () => {
    const providers: HarnessProviderModelGroup[] = [
      { providerId: 'deepseek', label: 'DeepSeek', kind: 'http', models: ['deepseek-chat'] },
      { providerId: 'moonshot', kind: 'http', models: ['kimi-k2'] }
    ]
    const out = await listHarnessesForManager(
      deps({ providers: async () => providers })
    )
    const claude = out.agents.find((entry) => entry.harnessId === 'claude-code')!
    expect(
      claude.models.filter((entry) => entry.credentialMode === 'native-login')
        .map((entry) => entry.model)
    ).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'])
    const gateway = claude.models.filter((entry) => entry.credentialMode === 'kun-gateway')
    expect(gateway).toEqual([
      { model: 'kun/deepseek/deepseek-chat', providerId: 'deepseek', credentialMode: 'kun-gateway' },
      { model: 'kun/moonshot/kimi-k2', providerId: 'moonshot', credentialMode: 'kun-gateway' }
    ])
  })

  it('prefers the cached probe result over the static list for probe harnesses', async () => {
    const out = await listHarnessesForManager(
      deps({
        probedModels: (def) =>
          def.id === 'claude-code' ? ['claude-probed-1'] : undefined
      })
    )
    const claude = out.agents.find((entry) => entry.harnessId === 'claude-code')!
    expect(
      claude.models.filter((entry) => entry.credentialMode === 'native-login')
    ).toEqual([{ model: 'claude-probed-1', credentialMode: 'native-login' }])
    const gemini = out.agents.find((entry) => entry.harnessId === 'gemini-cli')!
    // No static list and no probe cache: no model entries.
    expect(gemini.models).toEqual([])
  })

  it('caps each group at 8 models and reports the overflow', async () => {
    const providers: HarnessProviderModelGroup[] = [
      {
        providerId: 'deepseek',
        kind: 'http',
        models: Array.from({ length: 11 }, (_, index) => `m${index}`)
      }
    ]
    const out = await listHarnessesForManager(
      deps({ providers: async () => providers })
    )
    const claude = out.agents.find((entry) => entry.harnessId === 'claude-code')!
    const gateway = claude.models.filter((entry) => entry.credentialMode === 'kun-gateway')
    expect(gateway).toHaveLength(8)
    expect(gateway.every((entry) => entry.providerId === 'deepseek')).toBe(true)
    expect(claude.modelsTruncated).toBe(3)
  })

  it('filters provider-mode groups to the harness connection kind', async () => {
    const providers: HarnessProviderModelGroup[] = [
      { providerId: 'deepseek', kind: 'http', models: ['deepseek-chat'] },
      { providerId: 'cursor-prov', kind: 'cursor-sdk', models: ['composer-2'] }
    ]
    const out = await listHarnessesForManager(
      deps({ providers: async () => providers })
    )
    const cursor = out.agents.find((entry) => entry.harnessId === 'cursor')!
    expect(cursor.models).toEqual([
      { model: 'composer-2', providerId: 'cursor-prov', credentialMode: 'provider' }
    ])
    const kun = out.agents.find((entry) => entry.harnessId === 'kun')!
    // kun (no required kind) sees every provider.
    expect(kun.models.map((entry) => entry.providerId).sort())
      .toEqual(['cursor-prov', 'deepseek'])
  })

  it('keeps the manager current model at the head of the kun list', async () => {
    const providers: HarnessProviderModelGroup[] = [
      { providerId: 'deepseek', kind: 'http', models: ['deepseek-chat'] }
    ]
    const out = await listHarnessesForManager(
      deps({ providers: async () => providers }),
      'deepseek-reasoner'
    )
    const kun = out.agents.find((entry) => entry.harnessId === 'kun')!
    expect(kun.models[0]).toEqual({ model: 'deepseek-reasoner', credentialMode: 'provider' })
    expect(kun.models).toContainEqual({
      model: 'deepseek-chat', providerId: 'deepseek', credentialMode: 'provider'
    })
  })

  it('reports readiness and manager-worker admission per harness', async () => {
    const out = await listHarnessesForManager(deps())
    const kun = out.agents.find((entry) => entry.harnessId === 'kun')!
    expect(kun.ready).toBe(true)
    expect(kun.admission.managerWorker).toBe(true)
    expect(out.agents.every((entry) => entry.ready)).toBe(true)
  })
})
