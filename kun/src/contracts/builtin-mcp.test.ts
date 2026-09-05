import { describe, expect, it } from 'vitest'
import { McpServerConfig } from './capabilities.js'
import {
  KUN_MANAGED_GITHUB_MCP_AUTHORIZATION,
  KUN_MANAGED_GITHUB_MCP_MARKER,
  KUN_MANAGED_GITHUB_MCP_TOOLSETS,
  KUN_MANAGED_GITHUB_MCP_URL,
  assertBuiltinGitHubMcpCallAllowed
} from './builtin-mcp.js'

const server = McpServerConfig.parse({
  enabled: true,
  managedBy: KUN_MANAGED_GITHUB_MCP_MARKER,
  transport: 'streamable-http',
  url: KUN_MANAGED_GITHUB_MCP_URL,
  headers: {
    Authorization: KUN_MANAGED_GITHUB_MCP_AUTHORIZATION,
    'X-MCP-Toolsets': KUN_MANAGED_GITHUB_MCP_TOOLSETS,
    'X-MCP-Readonly': 'true'
  },
  trustScope: 'user',
  planModeReadOnlyTools: ['get_me', 'get_file_contents'],
  githubPolicy: {
    host: 'github.com',
    allowedHosts: ['github.com'],
    allowedOrganizations: ['acme'],
    allowedRepositories: ['example/public'],
    authorization: {
      source: 'github-cli', host: 'github.com', login: 'octocat',
      scopes: ['repo'], fingerprint: 'a'.repeat(64)
    }
  }
})

describe('managed GitHub MCP call allowlist', () => {
  it('allows account inspection and explicitly authorized resources', () => {
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'get_me', {})).not.toThrow()
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'get_file_contents', {
      owner: 'acme', repo: 'private'
    })).not.toThrow()
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'get_file_contents', {
      owner: 'example', repo: 'public'
    })).not.toThrow()
  })

  it('rejects resources and unknown targets outside the reviewed allowlist', () => {
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'get_file_contents', {
      owner: 'other', repo: 'private'
    })).toThrow('outside the authorized allowlist')
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'search_code', {
      query: 'repo:acme/allowed secret OR (repo:other/private secret)'
    })).toThrow('Boolean or grouped')
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'search_code', {
      query: 'repo:acme/allowed foo OR bar'
    })).toThrow('Boolean or grouped')
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'search_code', {
      query: 'repo:acme/allowed repo:other/private security'
    })).toThrow('multiple targets')
    expect(() => assertBuiltinGitHubMcpCallAllowed(server, 'search_repositories', {
      query: 'security issue'
    })).toThrow('no target covered')
  })
})
