import { z } from 'zod'

export const ACP_MAX_PERMISSION_OPTIONS = 32

/** One wire ID must identify exactly one permission scope and behavior. */
export function validAcpPermissionMenu(options: readonly { optionId: string }[]): boolean {
  return options.length <= ACP_MAX_PERMISSION_OPTIONS &&
    new Set(options.map((option) => option.optionId)).size === options.length
}

export const AcpPermissionOptionsSchema = z.array(z.object({
  _meta: z.record(z.string(), z.unknown()).nullish(),
  optionId: z.string().min(1).max(1_024),
  name: z.string().max(1_024),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always'])
}).passthrough()).max(ACP_MAX_PERMISSION_OPTIONS).refine(validAcpPermissionMenu,
  { message: 'Permission option IDs must be unique' })
