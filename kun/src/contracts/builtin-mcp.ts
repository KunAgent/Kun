import type { McpServerConfig } from './capabilities.js'

export const KUN_MANAGED_GITHUB_MCP_MARKER = 'kun:github' as const
export const KUN_MANAGED_GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/readonly' as const
export const KUN_GITHUB_PAT_ENV_VAR = 'GITHUB_PAT_TOKEN' as const
export const KUN_MANAGED_GITHUB_MCP_TOOLSETS = 'context,repos,issues,pull_requests,users' as const
export const KUN_MANAGED_GITHUB_MCP_AUTHORIZATION = `Bearer \${${KUN_GITHUB_PAT_ENV_VAR}}` as const

export const KUN_GITHUB_CREDENTIAL_SOURCES = [
  'GITHUB_PAT_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'github-cli'
] as const
export type KunGitHubCredentialSource = (typeof KUN_GITHUB_CREDENTIAL_SOURCES)[number]

export type KunGitHubMcpAuthorization = {
  source: KunGitHubCredentialSource
  host: string
  login: string
  scopes: string[]
  fingerprint: string
}

export type KunGitHubMcpPolicy = {
  host: string
  allowedHosts: string[]
  allowedOrganizations: string[]
  allowedRepositories: string[]
  authorization?: KunGitHubMcpAuthorization
}

/** Recognize only the exact host-authored read-only GitHub connector. */
export function isKunManagedGitHubMcpServer(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const server = value as Record<string, unknown>
  const headers = recordValue(server.headers)
  const policy = githubPolicyFromUnknown(server.githubPolicy)
  return policy?.host === 'github.com' && server.managedBy === KUN_MANAGED_GITHUB_MCP_MARKER &&
    typeof server.enabled === 'boolean' &&
    server.transport === 'streamable-http' &&
    server.url === KUN_MANAGED_GITHUB_MCP_URL &&
    server.trustScope === 'user' &&
    headers?.Authorization === KUN_MANAGED_GITHUB_MCP_AUTHORIZATION &&
    headers['X-MCP-Toolsets'] === KUN_MANAGED_GITHUB_MCP_TOOLSETS &&
    headers['X-MCP-Readonly'] === 'true' &&
    Array.isArray(server.planModeReadOnlyTools) &&
    policy !== undefined
}

export function githubPolicyFromServer(server: McpServerConfig): KunGitHubMcpPolicy | undefined {
  return githubPolicyFromUnknown(server.githubPolicy)
}

export function assertBuiltinGitHubMcpCallAllowed(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): void {
  if (!isKunManagedGitHubMcpServer(server)) return
  const policy = githubPolicyFromServer(server)
  if (!policy) throw new Error('GitHub MCP authorization policy is missing.')
  if (!policy.allowedOrganizations.length && !policy.allowedRepositories.length) return
  assertUnambiguousGitHubQuery(args)
  if (toolName === 'get_me') return

  const target = githubTarget(args)
  if (target.repository) {
    const [owner] = target.repository.split('/')
    if (policy.allowedRepositories.includes(target.repository) ||
      (owner && policy.allowedOrganizations.includes(owner))) return
    throw new Error('GitHub MCP repository is outside the authorized allowlist.')
  }
  if (target.organization && policy.allowedOrganizations.includes(target.organization)) return
  throw new Error('GitHub MCP call has no target covered by the authorized allowlist.')
}

function githubPolicyFromUnknown(value: unknown): KunGitHubMcpPolicy | undefined {
  const policy = recordValue(value)
  if (!policy) return undefined
  const host = normalizedHost(policy.host)
  const allowedHosts = stringArray(policy.allowedHosts).map(normalizedHost).filter(Boolean) as string[]
  if (!host || !allowedHosts.includes(host)) return undefined
  const authorization = authorizationFromUnknown(policy.authorization)
  return {
    host,
    allowedHosts: uniqueSorted(allowedHosts),
    allowedOrganizations: uniqueSorted(stringArray(policy.allowedOrganizations).map((item) => item.toLowerCase())),
    allowedRepositories: uniqueSorted(stringArray(policy.allowedRepositories).map((item) => item.toLowerCase())),
    ...(authorization ? { authorization } : {})
  }
}

function authorizationFromUnknown(value: unknown): KunGitHubMcpAuthorization | undefined {
  const auth = recordValue(value)
  if (!auth || !KUN_GITHUB_CREDENTIAL_SOURCES.includes(auth.source as KunGitHubCredentialSource)) return undefined
  const host = normalizedHost(auth.host)
  const login = stringValue(auth.login)
  const fingerprint = stringValue(auth.fingerprint)
  if (!host || !login || !fingerprint) return undefined
  return {
    source: auth.source as KunGitHubCredentialSource,
    host,
    login,
    scopes: uniqueSorted(stringArray(auth.scopes)),
    fingerprint
  }
}

function assertUnambiguousGitHubQuery(args: Record<string, unknown>): void {
  const query = firstString(args.query, args.q)
  if (!query) return
  if (/\b(?:OR|NOT)\b|[()]/i.test(query)) {
    throw new Error('GitHub MCP search uses Boolean or grouped syntax that cannot be authorized safely.')
  }
  const qualifierPattern = /(?:^|[^A-Za-z0-9_])(?:repo|org|user):([A-Za-z0-9-]+(?:\/[A-Za-z0-9_.-]+)?)/ig
  const targets = [...query.matchAll(qualifierPattern)]
  const qualifierMentions = query.match(/(?:repo|org|user):/ig)?.length ?? 0
  if (targets.length !== qualifierMentions || targets.length > 1) {
    throw new Error('GitHub MCP search contains multiple targets and cannot be authorized safely.')
  }
}

function githubTarget(args: Record<string, unknown>): { organization?: string; repository?: string } {
  const owner = firstString(args.owner, args.organization, args.org)?.toLowerCase()
  const repositoryName = firstString(args.repo, args.repository)
  if (repositoryName) {
    const normalized = repositoryName.toLowerCase()
    if (normalized.includes('/')) return { repository: normalized }
    if (owner) return { organization: owner, repository: `${owner}/${normalized}` }
  }
  const query = firstString(args.query, args.q)
  const repoQualifier = query?.match(/(?:^|\s)repo:([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)/i)?.[1]
  if (repoQualifier) return { repository: repoQualifier.toLowerCase() }
  const orgQualifier = query?.match(/(?:^|\s)(?:org|user):([A-Za-z0-9-]+)/i)?.[1]
  return { ...(owner || orgQualifier ? { organization: (owner ?? orgQualifier)?.toLowerCase() } : {}) }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstString(...values: unknown[]): string | undefined {
  return values.map(stringValue).find(Boolean)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function normalizedHost(value: unknown): string | undefined {
  const host = stringValue(value)?.toLowerCase()
  return host && !host.includes('/') && !host.includes(':') ? host : undefined
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}
