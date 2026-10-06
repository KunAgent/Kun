import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { HarnessTokenService } from './harness-token-service.js'
import { createAcpCredentialEnv } from '../runtime/acp/acp-credential-env.js'
import { resolveDelegatedCredentialContext } from '../session/delegated-credentials.js'
import type { HarnessGatewayAliasGrant } from '../contracts/harness-gateway-binding.js'
import { retainFrozenHarnessAliases } from './gateway-alias-binding.js'

describe('Agent alias environment isolation', () => {
  it('injects the public alias and a model-only grant, and never expands a resumed turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-alias-env-'))
    try {
      const definition = BUILTIN_HARNESSES.find((entry) => entry.id === 'codex')!
      const tokens = new HarnessTokenService()
      const original: HarnessGatewayAliasGrant[] = [{ routeId: 'coding', alias: 'route/coding', role: 'main',
        targets: [{ providerId: 'one', modelId: 'model-a' }] }]
      let current = original
      let frozen: HarnessGatewayAliasGrant[] | undefined
      const resolve = createAcpCredentialEnv({ tokens, endpoint: () => 'http://127.0.0.1:18899', configDir: () => root,
        resolveAliases: async () => current })
      const input = { definition, credentialMode: 'kun-gateway' as const, threadId: 'thread', turnId: 'turn', model: 'route/coding',
        gatewayBinding: { main: { routeId: 'coding', allowedConnectionIds: ['one', 'two'] } },
        onResolvedAliases: async (aliases: HarnessGatewayAliasGrant[]) => { frozen ??= structuredClone(aliases) } }
      const first = await resolveDelegatedCredentialContext(resolve, input)
      expect(first.wireModel).toBe('route/coding')
      const key = first.env[definition.gateway!.env.token]
      const grant = tokens.verify(key)!
      expect(grant.routes).toEqual([])
      expect(grant.aliasRoutes).toEqual(original)
      expect(grant.turnId).toBe('turn')
      expect(tokens.verifyScope(key, 'kun-tools')).toBeNull()
      const file = await readFile(join(first.env.CODEX_HOME, 'config.toml'), 'utf8')
      expect(file).toContain('route/coding'); expect(file).not.toContain(key)
      current = [{ ...original[0], targets: [...original[0].targets, { providerId: 'two', modelId: 'model-b' }] }]
      const resumed = await resolveDelegatedCredentialContext(resolve, { ...input, frozenGatewayAliases: frozen })
      expect(resumed.credentialIdentity).toBe(first.credentialIdentity)
      expect(tokens.verify(resumed.env[definition.gateway!.env.token])?.aliasRoutes).toEqual(original)
      expect(retainFrozenHarnessAliases(current, frozen)[0].targets).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
