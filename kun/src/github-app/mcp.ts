import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { GitHubAppError } from './client.js'
import { GITHUB_WIRE_FENCE, type GitHubFetchInit } from './network.js'

/** Defense in depth alongside GitHub App read permissions and the official readonly endpoint. */
export const GITHUB_READ_TOOLS = [
  'get_me', 'get_commit', 'get_file_contents', 'get_latest_release', 'get_release_by_tag', 'get_tag',
  'list_branches', 'list_commits', 'list_releases', 'list_tags', 'search_code', 'search_commits',
  'search_repositories', 'get_label', 'issue_read', 'list_issues', 'search_issues',
  'list_pull_requests', 'pull_request_read', 'search_pull_requests', 'search_users'
] as const
export type GitHubReadTool = typeof GITHUB_READ_TOOLS[number]

export class GitHubReadMcp {
  constructor(private readonly request: typeof fetch) {}
  async run(token: string, fence: () => void, input?: { name: GitHubReadTool; arguments: Record<string, unknown> }, signal?: AbortSignal) {
    const client = new Client({ name: 'kun-github-app', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL('https://api.githubcopilot.com/mcp/readonly'), {
      requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-MCP-Readonly': 'true',
        'X-MCP-Toolsets': 'context,repos,issues,pull_requests,users' } },
      fetch: async (url, init) => {
        const destination = new URL(url)
        if (destination.origin !== 'https://api.githubcopilot.com' || !destination.pathname.startsWith('/mcp')) {
          throw new GitHubAppError('unexpected_destination', 'GitHub tool destination was rejected')
        }
        fence()
        const signals = [signal, init?.signal, AbortSignal.timeout(30000)].filter((item): item is AbortSignal => Boolean(item))
        const response = await this.request(url, { ...init, signal: AbortSignal.any(signals), redirect: 'error',
          [GITHUB_WIRE_FENCE]: fence } as GitHubFetchInit)
        fence()
        return response
      }
    })
    try {
      fence()
      await client.connect(transport, { timeout: 30000 })
      if (input) {
        if (!GITHUB_READ_TOOLS.includes(input.name)) throw new GitHubAppError('read_only', 'Only GitHub read operations are available')
        const result = await client.callTool(input, { signal, timeout: 30000 })
        fence()
        // Models receive text reference data only, never executable MCP Apps/resources or remote images.
        const content = (result.content ?? []).filter((item) => item.type === 'text')
          .map((item) => ({ type: 'text', text: String(item.text).slice(0, 100000) })).slice(0, 10)
        return { content, isError: result.isError === true, untrusted: true }
      }
      const listed = await client.listTools(undefined, { signal, timeout: 30000 })
      fence()
      return { tools: listed.tools.filter((tool) => (GITHUB_READ_TOOLS as readonly string[]).includes(tool.name))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), untrusted: true }
    } catch (error) {
      if (error instanceof GitHubAppError) throw error
      throw new GitHubAppError('tools_unavailable', 'GitHub tools are unavailable. Check the connection card and repository permissions.')
    } finally { await client.close().catch(() => undefined); await transport.close().catch(() => undefined) }
  }
}
