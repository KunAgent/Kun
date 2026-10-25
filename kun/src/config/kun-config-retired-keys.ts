/**
 * Config keys that older Kun builds wrote but no longer read. Strict config
 * schemas drop them on parse so an existing config.json keeps loading.
 */

/**
 * `lab.pptAgent.imageFirst` switched whole-page generated slide previews on,
 * and `model` / `providerId` / `reasoningEffort` / `fast` configured the PPT
 * sub-agent. Both are gone: the slides skill runs in the main conversation.
 */
const RETIRED_PPT_AGENT_KEYS = ['imageFirst', 'model', 'providerId', 'reasoningEffort', 'fast'] as const

export function withoutRetiredPptAgentKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!RETIRED_PPT_AGENT_KEYS.some((key) => key in value)) return value
  const rest = { ...(value as Record<string, unknown>) }
  for (const key of RETIRED_PPT_AGENT_KEYS) delete rest[key]
  return rest
}

/**
 * `lab.genUi` and `lab.mcpApps` were Lab toggles. Generated widgets and MCP App
 * pages are built in, so the flags are dropped and the features always run.
 */
const RETIRED_LAB_APP_SURFACE_KEYS = ['genUi', 'mcpApps'] as const

export function withoutRetiredLabAppSurfaceFlags(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!RETIRED_LAB_APP_SURFACE_KEYS.some((key) => key in value)) return value
  const rest = { ...(value as Record<string, unknown>) }
  for (const key of RETIRED_LAB_APP_SURFACE_KEYS) delete rest[key]
  return rest
}
