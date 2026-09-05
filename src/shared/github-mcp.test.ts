import { describe, expect, it } from 'vitest'
import { McpServerConfig } from '../../kun/src/contracts/capabilities.js'
import {
  BUILTIN_GITHUB_MCP_PLAN_READ_ONLY_TOOLS,
  BUILTIN_GITHUB_MCP_MANAGED_BY,
  BUILTIN_GITHUB_MCP_URL,
  GITHUB_MCP_PAT_ENV_VAR,
  buildBuiltinGitHubMcpServer,
  isBuiltinGitHubMcpServer
} from './github-mcp'

describe('built-in GitHub MCP', () => {
  it('defaults to disabled while preserving the official strict read-only descriptor', () => {
    const server = buildBuiltinGitHubMcpServer()

    expect(McpServerConfig.safeParse(server).success).toBe(true)
    expect(server).toMatchObject({
      enabled: false,
      managedBy: BUILTIN_GITHUB_MCP_MANAGED_BY,
      transport: 'streamable-http',
      url: BUILTIN_GITHUB_MCP_URL,
      headers: {
        Authorization: `Bearer \${${GITHUB_MCP_PAT_ENV_VAR}}`,
        'X-MCP-Toolsets': 'context,repos,issues,pull_requests,users',
        'X-MCP-Readonly': 'true'
      },
      trustScope: 'user'
    })
    expect(server.planModeReadOnlyTools).toEqual(BUILTIN_GITHUB_MCP_PLAN_READ_ONLY_TOOLS)
    expect(JSON.stringify(server)).not.toMatch(/github_pat_|gh[pousr]_[A-Za-z0-9]/)
  })

  it('recognizes ownership by marker instead of claiming user config at the same URL', () => {
    const server = buildBuiltinGitHubMcpServer()

    expect(isBuiltinGitHubMcpServer(server)).toBe(true)
    expect(isBuiltinGitHubMcpServer({
      ...server,
      managedBy: undefined,
      headers: {
        ...server.headers,
        Authorization: 'Bearer ${MY_GITHUB_TOKEN}'
      }
    })).toBe(false)
  })
})
