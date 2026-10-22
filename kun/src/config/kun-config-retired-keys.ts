/**
 * Config keys that older Kun builds wrote but no longer read. Strict config
 * schemas drop them on parse so an existing config.json keeps loading.
 */

/** `lab.pptAgent.imageFirst` switched whole-page generated slide previews on; that flow is gone. */
export function withoutRetiredPptAgentKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('imageFirst' in value)) return value
  const { imageFirst: _retired, ...rest } = value as Record<string, unknown>
  return rest
}
