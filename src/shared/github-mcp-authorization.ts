export const DEFAULT_GITHUB_MCP_HOST = 'github.com'

export type BuiltinGitHubMcpCredentialSource =
  | 'GITHUB_PAT_TOKEN'
  | 'GH_TOKEN'
  | 'GITHUB_TOKEN'
  | 'github-cli'

export type BuiltinGitHubMcpIdentity = {
  source: BuiltinGitHubMcpCredentialSource
  host: string
  login: string
  scopes: string[]
  fingerprint: string
}

export type BuiltinGitHubMcpAuthorizationPreflight =
  | { status: 'missing'; host: string }
  | {
      status: 'ready'
      nonce: string
      identity: BuiltinGitHubMcpIdentity
      enabled: boolean
      allowedOrganizations: string[]
      allowedRepositories: string[]
    }

export type BuiltinGitHubMcpAuthorizationConfirmation = {
  nonce: string
  allowedHosts: string[]
  allowedOrganizations: string[]
  allowedRepositories: string[]
}

export type BuiltinGitHubMcpAuthorizationResult = {
  authorized: boolean
  reason?: 'expired' | 'invalid' | 'identity-changed'
}

/** Result of a user-triggered GitHub CLI browser-login launch. */
export type BuiltinGitHubMcpLoginResult = {
  started: boolean
  reason?: 'github-cli-unavailable' | 'unsupported-host' | 'login-failed'
}

export type KunGitHubMcpSettingsV1 = {
  enabled: boolean
  githubHost: string
  allowedHosts: string[]
  allowedOrganizations: string[]
  allowedRepositories: string[]
  authorization?: BuiltinGitHubMcpIdentity
}

export type KunGitHubMcpSettingsPatchV1 = Partial<
  Omit<KunGitHubMcpSettingsV1, 'authorization'>
> & {
  authorization?: BuiltinGitHubMcpIdentity | null
}

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/

export function normalizeGitHubHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!host || host.includes('/') || host.includes(':') || !HOST_PATTERN.test(host)) return undefined
  return host
}

export function isSupportedGitHubMcpHost(value: unknown): boolean {
  return normalizeGitHubHost(value) === DEFAULT_GITHUB_MCP_HOST
}

export function normalizeGitHubOrganizations(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const organization = entry.trim()
    return OWNER_PATTERN.test(organization) ? [organization.toLowerCase()] : []
  }))
}

export function normalizeGitHubRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const [owner, repository, ...rest] = entry.trim().split('/')
    if (rest.length || !owner || !repository ||
      !OWNER_PATTERN.test(owner) || !REPOSITORY_PATTERN.test(repository)) return []
    return [`${owner.toLowerCase()}/${repository.toLowerCase()}`]
  }))
}

export function normalizeGitHubMcpSettings(
  value: Partial<KunGitHubMcpSettingsV1> | null | undefined
): KunGitHubMcpSettingsV1 {
  const githubHost = normalizeGitHubHost(value?.githubHost) ?? DEFAULT_GITHUB_MCP_HOST
  const allowedHosts = uniqueSorted([
    githubHost,
    ...((value?.allowedHosts ?? []).flatMap((entry) => normalizeGitHubHost(entry) ?? []))
  ])
  const authorization = normalizeGitHubIdentity(value?.authorization)
  return {
    enabled: value?.enabled === true &&
      githubHost === DEFAULT_GITHUB_MCP_HOST && authorization?.host === githubHost,
    githubHost,
    allowedHosts,
    allowedOrganizations: normalizeGitHubOrganizations(value?.allowedOrganizations),
    allowedRepositories: normalizeGitHubRepositories(value?.allowedRepositories),
    ...(authorization?.host === githubHost ? { authorization } : {})
  }
}

export function normalizeGitHubIdentity(value: unknown): BuiltinGitHubMcpIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const identity = value as Partial<BuiltinGitHubMcpIdentity>
  const host = normalizeGitHubHost(identity.host)
  const source = identity.source
  const login = typeof identity.login === 'string' ? identity.login.trim() : ''
  const fingerprint = typeof identity.fingerprint === 'string' ? identity.fingerprint.trim().toLowerCase() : ''
  if (!host || !login || !/^[0-9a-f]{64}$/.test(fingerprint) || !isCredentialSource(source)) return undefined
  return {
    source,
    host,
    login,
    scopes: uniqueSorted(Array.isArray(identity.scopes)
      ? identity.scopes.filter((scope): scope is string => typeof scope === 'string').map((scope) => scope.trim()).filter(Boolean)
      : []),
    fingerprint
  }
}

function isCredentialSource(value: unknown): value is BuiltinGitHubMcpCredentialSource {
  return value === 'GITHUB_PAT_TOKEN' || value === 'GH_TOKEN' ||
    value === 'GITHUB_TOKEN' || value === 'github-cli'
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}
