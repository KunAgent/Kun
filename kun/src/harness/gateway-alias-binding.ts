import type { ModelConnectionSnapshot } from '../contracts/model-connections.js'
import { HarnessGatewayBindingSchema, type HarnessGatewayAliasGrant } from '../contracts/harness-gateway-binding.js'
import { gatewayPoolTargets } from '../domain/model-gateway-export-policy.js'

/** Resolve at the next turn's admission; the returned grant never follows future target additions. */
export function freezeHarnessGatewayAliases(snapshot: ModelConnectionSnapshot, raw: unknown): HarnessGatewayAliasGrant[] {
  const binding = HarnessGatewayBindingSchema.parse(raw)
  const aliases = (['main', 'small'] as const).flatMap((role) => {
    const selection = binding[role]
    if (!selection) return []
    const pool = snapshot.routePools.find((entry) => entry.id === selection.routeId && entry.enabled)
    if (!pool || pool.modelId.startsWith('kun/') || /^[\s-]|\0/.test(pool.modelId)) throw new Error('The selected Agent gateway route is unavailable')
    const targets = gatewayPoolTargets(snapshot.providers, pool)
      .filter((target) => selection.allowedConnectionIds.includes(target.providerId))
    if (!targets.length) throw new Error('The selected Agent gateway route has no approved exportable target')
    return [{ routeId: pool.id, alias: pool.modelId, role, targets: structuredClone(targets) }]
  })
  if (aliases.length > 1 && aliases[0].alias === aliases[1].alias && JSON.stringify(aliases[0].targets) !== JSON.stringify(aliases[1].targets)) {
    throw new Error('Main and small bindings for the same alias must approve the same targets')
  }
  return aliases
}

/** A resumed turn may lose targets, but cannot acquire models/accounts added after its first launch. */
export function retainFrozenHarnessAliases(current: HarnessGatewayAliasGrant[], frozen?: readonly HarnessGatewayAliasGrant[]): HarnessGatewayAliasGrant[] {
  if (!frozen) return current
  return frozen.map((previous) => {
    const active = current.find((alias) => alias.role === previous.role && alias.routeId === previous.routeId && alias.alias === previous.alias)
    const targets = previous.targets.filter((target) => active?.targets.some((candidate) => candidate.providerId === target.providerId && candidate.modelId === target.modelId))
    if (!targets.length) throw new Error('The original Agent alias grant is no longer available; start a new turn with a reviewed route')
    return { ...previous, targets: structuredClone(targets) }
  })
}
