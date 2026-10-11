import { describe, expect, it, vi } from 'vitest'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import { ACP_DEFAULT_CAPABILITIES } from './builtin-harnesses.js'
import {
  harnessSecretRefResolver,
  resolveHarnessSecretEnv
} from './harness-secret-env.js'
import type { ExtensionCredentialStore } from '../services/extension-credential-store.js'

function def(
  secretEnv?: { name: string; secretRef: string }[]
): HarnessDefinition {
  return {
    id: 'fake-acp' as HarnessId,
    displayName: 'Fake ACP',
    transport: 'acp',
    launch: {
      command: 'fake-agent',
      args: [],
      env: {},
      ...(secretEnv ? { secretEnv } : {})
    },
    credentialModes: ['native-login'],
    permissionModes: [],
    modelSource: 'static',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    builtin: false
  }
}

function store(
  payloads: Record<string, { apiKey?: string; accessToken?: string } | null>
): Pick<ExtensionCredentialStore, 'get'> {
  return { get: async (ref) => payloads[ref] ?? null }
}

describe('harnessSecretRefResolver', () => {
  it('is undefined without a credential store', () => {
    expect(harnessSecretRefResolver(undefined)).toBeUndefined()
  })

  it('resolves apiKey payloads and falls back to accessToken', async () => {
    const resolve = harnessSecretRefResolver(
      store({ a: { apiKey: 'key-1' }, b: { accessToken: 'tok-2' }, c: null })
    )
    expect(await resolve?.('a')).toBe('key-1')
    expect(await resolve?.('b')).toBe('tok-2')
    expect(await resolve?.('c')).toBeNull()
  })

  it('fails closed when the store throws', async () => {
    const resolve = harnessSecretRefResolver({
      get: async () => {
        throw new Error('store locked')
      }
    })
    expect(await resolve?.('anything')).toBeNull()
  })
})

describe('resolveHarnessSecretEnv', () => {
  it('returns an empty map when the definition has no secretEnv', async () => {
    await expect(resolveHarnessSecretEnv(def(), undefined)).resolves.toEqual({})
    await expect(resolveHarnessSecretEnv(def([]), undefined)).resolves.toEqual({})
  })

  it('requires a resolver when secretEnv is configured', async () => {
    await expect(
      resolveHarnessSecretEnv(def([{ name: 'MY_KEY', secretRef: 'cred_1' }]), undefined)
    ).rejects.toThrow('no credential store')
  })

  it('resolves refs into a plain env map', async () => {
    const env = await resolveHarnessSecretEnv(
      def([
        { name: 'A_KEY', secretRef: 'cred_a' },
        { name: 'B_KEY', secretRef: 'cred_b' }
      ]),
      harnessSecretRefResolver(store({ cred_a: { apiKey: 'va' }, cred_b: { apiKey: 'vb' } }))
    )
    expect(env).toEqual({ A_KEY: 'va', B_KEY: 'vb' })
  })

  it('fails closed on missing secrets and leaks neither ref nor value', async () => {
    const resolve = vi.fn(async (ref: string) =>
      ref === 'cred_ok' ? 'good-value' : null
    )
    const error = await resolveHarnessSecretEnv(
      def([
        { name: 'GOOD', secretRef: 'cred_ok' },
        { name: 'GONE', secretRef: 'cred_missing' }
      ]),
      resolve
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('GONE')
    expect(message).not.toContain('cred_missing')
    expect(message).not.toContain('good-value')
  })
})
