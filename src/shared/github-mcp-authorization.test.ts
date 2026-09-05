import { describe, expect, it } from 'vitest'
import { normalizeGitHubMcpSettings } from './github-mcp-authorization'

describe('GitHub MCP authorization settings', () => {
  it('normalizes identity and preserves explicit repository scope', () => {
    expect(normalizeGitHubMcpSettings({
      enabled: true,
      githubHost: 'GitHub.com',
      allowedHosts: ['github.com'],
      allowedOrganizations: ['Acme'],
      allowedRepositories: ['Acme/Web'],
      authorization: {
        source: 'github-cli', host: 'github.com', login: 'octocat',
        scopes: ['repo'], fingerprint: 'A'.repeat(64)
      }
    })).toMatchObject({
      enabled: true,
      githubHost: 'github.com',
      allowedOrganizations: ['acme'],
      allowedRepositories: ['acme/web'],
      authorization: { fingerprint: 'a'.repeat(64) }
    })
  })

  it('drops malformed legacy fingerprints and fails closed', () => {
    expect(normalizeGitHubMcpSettings({
      enabled: true,
      githubHost: 'github.com',
      allowedHosts: ['github.com'],
      allowedOrganizations: [],
      allowedRepositories: [],
      authorization: {
        source: 'github-cli', host: 'github.com', login: 'octocat',
        scopes: ['repo'], fingerprint: 'legacy-short-value'
      }
    })).toEqual({
      enabled: false,
      githubHost: 'github.com',
      allowedHosts: ['github.com'],
      allowedOrganizations: [],
      allowedRepositories: []
    })
  })

  it('fails closed for unsupported enterprise hosts', () => {
    expect(normalizeGitHubMcpSettings({
      enabled: true,
      githubHost: 'github.enterprise.test',
      allowedHosts: ['github.enterprise.test'],
      allowedOrganizations: [],
      allowedRepositories: [],
      authorization: {
        source: 'github-cli', host: 'github.enterprise.test', login: 'octocat',
        scopes: ['repo'], fingerprint: 'a'.repeat(64)
      }
    }).enabled).toBe(false)
  })
})
