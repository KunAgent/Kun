import { describe, expect, it, vi } from 'vitest'
import { McpServerConfig } from '../../contracts/capabilities.js'
import {
  KUN_MANAGED_GITHUB_MCP_MARKER,
  KUN_MANAGED_GITHUB_MCP_TOOLSETS,
  KUN_MANAGED_GITHUB_MCP_URL
} from '../../contracts/builtin-mcp.js'
import {
  GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE,
  githubCliEnvironment,
  resolveGitHubCliExecutable,
  resolveGitHubCliExecutableDetails,
  previewBuiltinGitHubMcpCredential,
  resolveBuiltinGitHubMcpCredentials
} from './github-mcp-credential.js'
import { serverDiagnostic, startupConnectionError } from './mcp-tool-runtime.js'
import {
  McpAuthorizationRequiredError,
  isMcpAuthorizationRequiredError
} from './mcp-types.js'

function managedServer(authorization?: {
  source: 'GITHUB_PAT_TOKEN' | 'GH_TOKEN' | 'GITHUB_TOKEN' | 'github-cli'
  host: string
  login: string
  scopes: string[]
  fingerprint: string
}, enabled = true) {
  return McpServerConfig.parse({
    enabled,
    managedBy: KUN_MANAGED_GITHUB_MCP_MARKER,
    transport: 'streamable-http',
    url: KUN_MANAGED_GITHUB_MCP_URL,
    headers: {
      Authorization: 'Bearer ${GITHUB_PAT_TOKEN}',
      'X-MCP-Toolsets': KUN_MANAGED_GITHUB_MCP_TOOLSETS,
      'X-MCP-Readonly': 'true'
    },
    githubPolicy: {
      host: 'github.com',
      allowedHosts: ['github.com'],
      allowedOrganizations: [],
      allowedRepositories: [],
      ...(authorization ? { authorization } : {})
    },
    trustScope: 'user'
  })
}

describe('built-in GitHub MCP credentials', () => {
  it('uses an explicitly approved PAT without mutating persisted config', async () => {
    const options = {
      env: { GITHUB_PAT_TOKEN: 'environment-secret' },
      inspectToken: async () => ({ login: 'octocat', scopes: ['repo'] })
    }
    const authorization = await previewBuiltinGitHubMcpCredential('github.com', options)
    expect(authorization).toBeDefined()
    const server = managedServer(authorization)
    const readGitHubCliToken = vi.fn(async () => 'unused-cli-token')

    const resolved = await resolveBuiltinGitHubMcpCredentials('github', server, {
      ...options,
      readGitHubCliToken
    })

    expect(resolved.headers.Authorization).toBe('Bearer environment-secret')
    expect(server.headers.Authorization).toBe('Bearer ${GITHUB_PAT_TOKEN}')
    expect(readGitHubCliToken).not.toHaveBeenCalled()
  })

  it('uses an explicitly approved GitHub CLI session for desktop launches', async () => {
    const options = {
      env: {},
      readGitHubCliToken: async () => 'cli-secret\n',
      inspectToken: async () => ({ login: 'octocat', scopes: ['repo'] })
    }
    const authorization = await previewBuiltinGitHubMcpCredential('github.com', options)
    const resolved = await resolveBuiltinGitHubMcpCredentials('github', managedServer(authorization), options)

    expect(resolved.headers.Authorization).toBe('Bearer cli-secret')
  })

  it('does not read credentials while disabled or before explicit authorization', async () => {
    const readGitHubCliToken = vi.fn(async () => 'cli-secret')
    await expect(resolveBuiltinGitHubMcpCredentials('github', managedServer(undefined, false), {
      env: {}, readGitHubCliToken
    })).resolves.toEqual(managedServer(undefined, false))
    expect(readGitHubCliToken).not.toHaveBeenCalled()

    await expect(resolveBuiltinGitHubMcpCredentials('github', managedServer(), {
      env: {}, readGitHubCliToken
    })).rejects.toSatisfy(isMcpAuthorizationRequiredError)
    expect(readGitHubCliToken).not.toHaveBeenCalled()
  })

  it('prefers fixed install locations before verified PATH entries', () => {
    const checked: string[] = []
    const executable = resolveGitHubCliExecutable(
      { PATH: '/workspace/bin:/tmp/attacker' },
      'darwin',
      (candidate) => {
        checked.push(candidate)
        return candidate === '/opt/homebrew/bin/gh' || candidate === '/workspace/bin/gh'
      },
      (candidate) => candidate
    )

    expect(executable).toBe('/opt/homebrew/bin/gh')
    expect(checked).toEqual(['/opt/homebrew/bin/gh'])
  })

  it('resolves the first verified PATH entry, skipping empty and duplicate directories', () => {
    const checked: string[] = []
    const executable = resolveGitHubCliExecutable(
      { PATH: ':/nix/profile/bin:/nix/profile/bin:/asdf/shims:/mise/shims:' },
      'linux',
      (candidate) => {
        checked.push(candidate)
        return candidate === '/asdf/shims/gh'
      },
      (candidate) => candidate
    )

    expect(executable).toBe('/asdf/shims/gh')
    expect(checked).toEqual([
      '/home/linuxbrew/.linuxbrew/bin/gh',
      '/usr/local/bin/gh',
      '/usr/bin/gh',
      '/snap/bin/gh',
      '/nix/profile/bin/gh',
      '/asdf/shims/gh'
    ])
  })

  it('returns the resolved executable path and PATH source metadata', () => {
    const resolved = resolveGitHubCliExecutableDetails(
      { PATH: '/devbox/bin' },
      'linux',
      (candidate) => candidate === '/resolved/gh',
      (candidate) => candidate === '/devbox/bin/gh' ? '/resolved/gh' : candidate
    )

    expect(resolved).toEqual({ path: '/resolved/gh', source: 'path' })
  })

  it('skips candidates whose realpath lookup fails', () => {
    const executable = resolveGitHubCliExecutable(
      { PATH: '/broken/bin:/working/bin' },
      'linux',
      (candidate) => candidate === '/working/bin/gh',
      (candidate) => {
        if (candidate === '/broken/bin/gh') throw new Error('dangling link')
        return candidate
      }
    )

    expect(executable).toBe('/working/bin/gh')
  })

  it('uses Windows gh.exe PATH entries before Scoop and WinGet fallbacks', () => {
    const pathExecutable = resolveGitHubCliExecutable(
      {
        PATH: 'C:\\Tools;D:\\Custom',
        USERPROFILE: 'C:\\Users\\example',
        LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local'
      },
      'win32',
      (candidate) => candidate === 'D:\\Custom\\gh.exe',
      (candidate) => candidate
    )
    const scoopExecutable = resolveGitHubCliExecutable(
      { USERPROFILE: 'C:\\Users\\example' },
      'win32',
      (candidate) => candidate === 'C:\\Users\\example\\scoop\\shims\\gh.exe',
      (candidate) => candidate
    )
    const wingetExecutable = resolveGitHubCliExecutable(
      { LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' },
      'win32',
      (candidate) => candidate === 'C:\\Users\\example\\AppData\\Local\\Microsoft\\WinGet\\Links\\gh.exe',
      (candidate) => candidate
    )

    expect(pathExecutable).toBe('D:\\Custom\\gh.exe')
    expect(scoopExecutable).toBe('C:\\Users\\example\\scoop\\shims\\gh.exe')
    expect(wingetExecutable).toBe('C:\\Users\\example\\AppData\\Local\\Microsoft\\WinGet\\Links\\gh.exe')
  })

  it('passes only credential-store support variables to GitHub CLI', () => {
    const childEnv = githubCliEnvironment({
      HOME: '/Users/example',
      GH_CONFIG_DIR: '/Users/example/.config/gh',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/501/bus',
      KUN_RUNTIME_TOKEN: 'runtime-secret',
      OPENAI_API_KEY: 'model-secret',
      SOME_TOKEN: 'other-secret',
      PATH: '/tmp/attacker'
    }, '/opt/homebrew/bin/gh', 'darwin')

    expect(childEnv).toMatchObject({
      HOME: '/Users/example',
      GH_CONFIG_DIR: '/Users/example/.config/gh',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/501/bus',
      PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    })
    expect(childEnv).not.toHaveProperty('KUN_RUNTIME_TOKEN')
    expect(childEnv).not.toHaveProperty('OPENAI_API_KEY')
    expect(childEnv).not.toHaveProperty('SOME_TOKEN')
    expect(JSON.stringify(childEnv)).not.toContain('secret')
  })

  it('reports an actionable authorization state when no credential is available', async () => {
    const result = resolveBuiltinGitHubMcpCredentials('github', managedServer({
      source: 'github-cli', host: 'github.com', login: 'octocat', scopes: ['repo'], fingerprint: 'a'.repeat(64)
    }), {
      env: {},
      readGitHubCliToken: async () => undefined
    })

    await expect(result).rejects.toSatisfy((error: unknown) =>
      isMcpAuthorizationRequiredError(error) &&
      error.userMessage === GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE
    )

    const error = new McpAuthorizationRequiredError(
      'github',
      GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE
    )
    expect(startupConnectionError(error, managedServer())).toBe(
      GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE
    )
    expect(serverDiagnostic(
      { serverId: 'github', server: managedServer() },
      'authorization_required',
      0,
      startupConnectionError(error, managedServer())
    )).toMatchObject({
      managedBy: KUN_MANAGED_GITHUB_MCP_MARKER,
      status: 'authorization_required',
      lastError: GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE
    })
  })

  it('never injects GitHub credentials into a user-owned server', async () => {
    const server = McpServerConfig.parse({
      enabled: true,
      transport: 'streamable-http',
      url: KUN_MANAGED_GITHUB_MCP_URL,
      headers: { 'X-MCP-Readonly': 'true' },
      trustScope: 'user'
    })
    const readGitHubCliToken = vi.fn(async () => 'cli-secret')

    await expect(resolveBuiltinGitHubMcpCredentials('github', server, {
      env: { GITHUB_PAT_TOKEN: 'environment-secret' },
      readGitHubCliToken
    })).resolves.toBe(server)
    expect(readGitHubCliToken).not.toHaveBeenCalled()
  })
})
