import {
  KUN_GITHUB_PAT_ENV_VAR,
  KUN_MANAGED_GITHUB_MCP_AUTHORIZATION,
  KUN_MANAGED_GITHUB_MCP_MARKER,
  KUN_MANAGED_GITHUB_MCP_TOOLSETS,
  KUN_MANAGED_GITHUB_MCP_URL,
  isKunManagedGitHubMcpServer
} from '../../kun/src/contracts/builtin-mcp'
import type { KunGitHubMcpSettingsV1 } from './github-mcp-authorization'
import { normalizeGitHubMcpSettings } from './github-mcp-authorization'

export const BUILTIN_GITHUB_MCP_SERVER_ID = 'github'
export const BUILTIN_GITHUB_MCP_URL = KUN_MANAGED_GITHUB_MCP_URL
export const BUILTIN_GITHUB_MCP_MANAGED_BY = KUN_MANAGED_GITHUB_MCP_MARKER
export const GITHUB_MCP_PAT_ENV_VAR = KUN_GITHUB_PAT_ENV_VAR
export const BUILTIN_GITHUB_MCP_TOOLSETS = ['context', 'repos', 'issues', 'pull_requests', 'users'] as const

export const BUILTIN_GITHUB_MCP_PLAN_READ_ONLY_TOOLS = [
  'get_me', 'get_team_members', 'get_teams', 'get_commit', 'get_file_contents',
  'get_latest_release', 'get_release_by_tag', 'get_tag', 'list_branches', 'list_commits',
  'list_releases', 'list_repository_collaborators', 'list_tags', 'search_code', 'search_commits',
  'search_repositories', 'get_label', 'issue_read', 'list_issue_fields', 'list_issue_types',
  'list_issues', 'search_issues', 'list_pull_requests', 'pull_request_read',
  'search_pull_requests', 'search_users'
] as const

export type BuiltinGitHubMcpServerConfig = {
  enabled: boolean
  managedBy: typeof BUILTIN_GITHUB_MCP_MANAGED_BY
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
  trustScope: 'user'
  planModeReadOnlyTools: string[]
  githubPolicy: {
    host: string
    allowedHosts: string[]
    allowedOrganizations: string[]
    allowedRepositories: string[]
    authorization?: KunGitHubMcpSettingsV1['authorization']
  }
  timeoutMs: number
}

/** Build the managed descriptor without materializing any token. */
export function buildBuiltinGitHubMcpServer(
  settings?: Partial<KunGitHubMcpSettingsV1>
): BuiltinGitHubMcpServerConfig {
  const policy = normalizeGitHubMcpSettings(settings)
  return {
    enabled: policy.enabled,
    managedBy: BUILTIN_GITHUB_MCP_MANAGED_BY,
    transport: 'streamable-http',
    url: BUILTIN_GITHUB_MCP_URL,
    headers: {
      Authorization: KUN_MANAGED_GITHUB_MCP_AUTHORIZATION,
      'X-MCP-Toolsets': KUN_MANAGED_GITHUB_MCP_TOOLSETS,
      'X-MCP-Readonly': 'true'
    },
    trustScope: 'user',
    planModeReadOnlyTools: [...BUILTIN_GITHUB_MCP_PLAN_READ_ONLY_TOOLS],
    githubPolicy: {
      host: policy.githubHost,
      allowedHosts: [...policy.allowedHosts],
      allowedOrganizations: [...policy.allowedOrganizations],
      allowedRepositories: [...policy.allowedRepositories],
      ...(policy.authorization ? { authorization: { ...policy.authorization, scopes: [...policy.authorization.scopes] } } : {})
    },
    timeoutMs: 30_000
  }
}

export function isBuiltinGitHubMcpServer(value: unknown): boolean {
  return isKunManagedGitHubMcpServer(value)
}
