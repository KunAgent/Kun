import { z } from 'zod'

const AliasBinding = z.object({
  routeId: z.string().min(1).max(64),
  /** Explicit consent ceiling; adding a new account to the route does not expand an Agent profile. */
  allowedConnectionIds: z.array(z.string().min(1).max(128)).min(1).max(500)
}).strict()

export const HarnessGatewayBindingSchema = z.object({ main: AliasBinding, small: AliasBinding.optional() }).strict()
export type HarnessGatewayBinding = z.infer<typeof HarnessGatewayBindingSchema>
export const HarnessGatewayAliasGrantSchema = z.object({ routeId: z.string().min(1).max(64),
  alias: z.string().min(1).max(512), role: z.enum(['main', 'small']),
  targets: z.array(z.object({ providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(512) }).strict()).min(1).max(50)
}).strict()
export type HarnessGatewayAliasGrant = z.infer<typeof HarnessGatewayAliasGrantSchema>

export function harnessGatewayBindingKey(binding: HarnessGatewayBinding): string {
  const key = (value: z.infer<typeof AliasBinding>) => [value.routeId, [...new Set(value.allowedConnectionIds)].sort()]
  return JSON.stringify([key(binding.main), binding.small ? key(binding.small) : null])
}

/** Tool metadata only; the same Zod contract validates every host-side worker request. */
export const HARNESS_GATEWAY_BINDING_JSON_SCHEMA = z.toJSONSchema(HarnessGatewayBindingSchema)
