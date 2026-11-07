/** Protocol scope names. Only trusted desktop UI may choose advanced permissions. */
export const MOBILE_LINK_SCOPES = ['personal', 'groups.read', 'groups.write', 'collaboration.read',
  'collaboration.control', 'schedules.read', 'extensions.read', 'extensions.control', 'shares.manage', 'desktop.view', 'desktop.control'] as const
export type MobileLinkScope = typeof MOBILE_LINK_SCOPES[number]
/** Desktop-only pairing never supplies the implicit legacy personal scope. */
export function computerDesktopScopes(raw: unknown): MobileLinkScope[] {
  if (raw === undefined) return ['desktop.view']
  if (!Array.isArray(raw) || raw.length > 2 || new Set(raw).size !== raw.length ||
    raw.some(value => !['desktop.view', 'desktop.control'].includes(value)) ||
    raw.includes('desktop.control') && !raw.includes('desktop.view')) throw Error('INVALID_SCOPES')
  return MOBILE_LINK_SCOPES.filter(scope => raw.includes(scope))
}
/** The explicit phone-remote switch includes desktop viewing and input, not unrelated advanced access. */
export const MOBILE_REMOTE_SCOPES: MobileLinkScope[] = ['personal', 'desktop.view', 'desktop.control']
export function mobileLinkScopes(raw: unknown): MobileLinkScope[] {
  if (raw === undefined) return ['personal']
  if (!Array.isArray(raw) || raw.length > MOBILE_LINK_SCOPES.length || new Set(raw).size !== raw.length ||
    raw.some((scope) => typeof scope !== 'string' || !(MOBILE_LINK_SCOPES as readonly string[]).includes(scope)))
    throw new Error('INVALID_SCOPES')
  const scopes = MOBILE_LINK_SCOPES.filter((scope) => scope === 'personal' || raw.includes(scope))
  if (scopes.some((scope) => ['groups.write', 'collaboration.read', 'collaboration.control'].includes(scope)) && !scopes.includes('groups.read'))
    throw new Error('INVALID_SCOPES')
  if (scopes.includes('collaboration.control') && !scopes.includes('collaboration.read')) throw new Error('INVALID_SCOPES')
  if (scopes.includes('extensions.control') && !scopes.includes('extensions.read')) throw new Error('INVALID_SCOPES')
  if (scopes.includes('desktop.control') && !scopes.includes('desktop.view')) throw new Error('INVALID_SCOPES')
  return scopes
}
