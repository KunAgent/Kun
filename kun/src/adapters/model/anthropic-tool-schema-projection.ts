import type { ModelToolSpec } from '../../ports/model-client.js'

/**
 * Anthropic-compatible relays commonly reject JSON Schema composition at the
 * top level, even when the schema is valid JSON Schema. Tool dispatch still
 * validates the canonical schema locally, so this wire projection only keeps
 * the portable object envelope for those relays.
 */
export function projectAnthropicToolInputSchema(schema: ModelToolSpec['inputSchema']): Record<string, unknown> {
  const source = schema as Record<string, unknown>
  const isActionUnion = ['oneOf', 'anyOf', 'allOf'].some((key) => Array.isArray(source[key]))
  const projected = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== 'oneOf' && key !== 'anyOf' && key !== 'allOf')
  )
  projected.type = 'object'

  // A discriminated action union's per-variant requirements cannot be
  // represented without composition. `action` remains the discriminator;
  // the tool's Zod parser enforces the selected action's arguments.
  if (isActionUnion && isActionProperty(projected.properties)) projected.required = ['action']
  return projected
}

function isActionProperty(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'action' in value)
}
