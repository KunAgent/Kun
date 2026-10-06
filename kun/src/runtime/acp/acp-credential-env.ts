import { retainFrozenHarnessAliases } from '../../harness/gateway-alias-binding.js'
import { createHash } from 'node:crypto'
import type { HarnessGatewayBinding, HarnessGatewayAliasGrant } from '../../contracts/harness-gateway-binding.js'
/**
 * `kun-gateway` credential env for ACP harnesses (docs/ade impl P3-10).
 *
 * A harness child never sees a real provider secret: it gets a process-local
 * `gateway` grant restricted to the selected provider/model route plus a
 * generated, provider-only config pointing at the loopback `/v1` surface.
 * Env names come from the definition's `gateway.env` block, matching the
 * SDK-transport gateway wiring in `agent-sdk-gateway.ts`.
 *
 * Verified config mechanisms (real binaries):
 * - OpenCode (`opencode acp`): `OPENCODE_CONFIG` names a generated
 *   `opencode.json` carrying only the `kun` OpenAI-compatible provider;
 *   `apiKey` stays an env reference so the token never lands on disk.
 * - Codex (`codex-acp`): a generated `CODEX_HOME/config.toml` declares a
 *   `model_providers.kun` entry with `env_key` pointing at the token var
 *   and `wire_api = "responses"` (the `/v1/responses` gateway surface).
 * - Pi (`pi --mode rpc`): a generated `PI_CODING_AGENT_DIR/models.json`
 *   declares only the `kun` openai-completions provider; `apiKey` is pi's
 *   `$NAME` env interpolation so the grant token stays env-only (P6-11).
 * - Gemini CLI is deferred: its gateway protocol is google-specific and Kun
 *   has no matching entry point yet.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HarnessGateway } from '../../contracts/harness.js'
import {
  formatGatewayModelId,
  parseGatewayModelId
} from '../../harness/gateway-model-id.js'
import type { HarnessTokenService } from '../../harness/harness-token-service.js'
import type { AcpCredentialEnvInput } from './acp-runtime-support.js'
import { codexConfig, opencodeConfig, piModelsConfig } from '../../harness/gateway-config-templates.js'

export type AcpCredentialEnvDeps = {
  tokens: Pick<HarnessTokenService, 'issue'>
  /** Loopback `kun serve` base URL; absent means not serve-hosted. */
  endpoint: () => string | undefined
  /** Root for generated per-route harness config, e.g. `<dataDir>/acp-gateway`. */
  configDir: () => string
  resolveAliases?: (binding: HarnessGatewayBinding) => Promise<HarnessGatewayAliasGrant[]>
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 96) || 'route'
}

function writeConfigFile(path: string, content: string): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, { mode: 0o600 })
  return path
}

/**
 * Resolve the child env for an ACP credential mode. `native-login` returns
 * nothing; `kun-gateway` issues a route-scoped grant and generates the
 * per-harness provider-only config, returning only env var names and paths.
 */
export function createAcpCredentialEnv(
  deps: AcpCredentialEnvDeps
): (input: AcpCredentialEnvInput) => Promise<Record<string, string>> {
  return async (input) => {
    if (input.credentialMode === 'native-login') return {}
    if (input.credentialMode !== 'kun-gateway') {
      throw new Error(
        `harness '${input.harnessId}' cannot satisfy credentialMode '${input.credentialMode}'`
      )
    }
    const gateway: HarnessGateway | undefined = input.gateway
    if (!gateway) {
      throw new Error(
        `harness '${input.harnessId}' declares no gateway surface`
      )
    }
    const baseUrl = deps.endpoint()?.trim()
    if (!baseUrl) {
      throw new Error('kun-gateway requires a serve-hosted Kun runtime')
    }
    // `model` arrives either bare (providerId alongside) or preformatted as
    // `kun/<provider>/<model>` (worker-route normalized); parse it back so the
    // grant route and generated config see the bare provider/model pair.
    const parsed = input.model?.trim() ? parseGatewayModelId(input.model.trim()) : undefined
    const providerId = input.providerId?.trim() || parsed?.providerId
    const model = parsed?.model ?? input.model?.trim()
    if (input.gatewayBinding && !deps.resolveAliases) throw new Error('Agent alias resolution is unavailable')
    if (input.gatewayBinding?.small && !gateway.env.smallModel) throw new Error('This Agent does not expose a separate small-model setting')
    const aliases = input.gatewayBinding ? retainFrozenHarnessAliases(await deps.resolveAliases!(input.gatewayBinding), input.frozenGatewayAliases) : undefined
    const mainAlias = aliases?.find((route) => route.role === 'main')
    if (input.gatewayBinding && (!mainAlias || (model && model !== 'default' && model !== mainAlias.alias))) throw new Error('The Agent model does not match its selected gateway alias')
    if (!mainAlias && (!providerId || !model)) {
      throw new Error(
        `harness '${input.harnessId}' kun-gateway needs a provider/model route`
      )
    }
    // Same rule as the SDK gateway env: routes are not hashed into the grant
    // id, so the caller must bind the route into credentialIdentity itself —
    // a later turn can never widen a live token's route set.
    if (aliases) await input.onResolvedAliases?.(aliases)
    const identity = aliases ? `${input.credentialIdentity}:aliases:${createHash('sha256').update(JSON.stringify(aliases)).digest('hex')}` : input.credentialIdentity
    const gatewayModelId = mainAlias?.alias ?? formatGatewayModelId(providerId!, model!)
    if (mainAlias) input.onResolvedIdentity?.(identity, gatewayModelId)
    const token = deps.tokens.issue({
      threadId: input.threadId,
      harnessId: input.harnessId,
      credentialIdentity: identity,
      scopes: ['gateway'],
      ...(aliases ? { turnId: input.turnId, onResolvedRoute: input.onGatewayRoute } : {}),
      ...(aliases ? { aliasRoutes: aliases } : { routes: [{ providerId: providerId!, model: model!, role: 'main' as const }] })
    })
    const v1 = `${baseUrl.replace(/\/+$/, '')}/v1`
    const env = {
      [gateway.env.token]: token,
      [gateway.env.baseUrl]: v1,
      ...(mainAlias && gateway.env.model ? { [gateway.env.model]: mainAlias.alias } : {}),
      ...(mainAlias && gateway.env.smallModel ? { [gateway.env.smallModel]: aliases?.find((route) => route.role === 'small')?.alias ?? mainAlias.alias } : {})
    }
    const dir = join(
      deps.configDir(),
      input.harnessId,
      `${slugify(input.threadId)}-${aliases ? createHash('sha256').update(identity).digest('hex').slice(0, 24) : slugify(`${providerId}-${model}`)}`
    )
    switch (`${input.harnessId}:${gateway.protocol}`) {
      case 'opencode:openai-chat':
        return {
          ...env,
          OPENCODE_CONFIG: writeConfigFile(
            join(dir, 'opencode.json'),
            opencodeConfig(v1, gatewayModelId, gateway.env.token)
          )
        }
      case 'codex:openai-responses':
        writeConfigFile(
          join(dir, 'config.toml'),
          codexConfig(v1, gatewayModelId, gateway.env.token)
        )
        return { ...env, CODEX_HOME: dir }
      case 'pi:openai-chat':
        writeConfigFile(
          join(dir, 'models.json'),
          piModelsConfig(v1, gatewayModelId, gateway.env.token)
        )
        return { ...env, PI_CODING_AGENT_DIR: dir }
      default:
        throw new Error(
          `harness '${input.harnessId}' gateway protocol '${gateway.protocol}' has no config mapping`
        )
    }
  }
}
