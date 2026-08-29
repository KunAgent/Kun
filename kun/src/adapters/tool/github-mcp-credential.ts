import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants, accessSync, realpathSync, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import {
  KUN_GITHUB_PAT_ENV_VAR,
  githubPolicyFromServer,
  isKunManagedGitHubMcpServer,
  type KunGitHubCredentialSource,
  type KunGitHubMcpAuthorization
} from '../../contracts/builtin-mcp.js'
import { McpAuthorizationRequiredError } from './mcp-types.js'

const TOKEN_TIMEOUT_MS = 5_000
const TOKEN_MAX_BUFFER_BYTES = 64 * 1024
const GITHUB_TOKEN_ENV_VARS = [KUN_GITHUB_PAT_ENV_VAR, 'GH_TOKEN', 'GITHUB_TOKEN'] as const
const GITHUB_CLI_ENV_ALLOWLIST = [
  'HOME', 'USER', 'LOGNAME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS', 'GH_CONFIG_DIR', 'SystemRoot', 'WINDIR',
  'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'
] as const

export const GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE =
  'GitHub MCP needs explicit authorization in Kun before it can use local credentials.'
export const GITHUB_MCP_AUTHORIZATION_REJECTED_MESSAGE =
  'GitHub credentials were rejected or changed. Reauthorize the GitHub MCP connector in Kun.'

export type GitHubCredentialPreview = KunGitHubMcpAuthorization

type ResolvedCredential = { source: KunGitHubCredentialSource; token: string }

export type GitHubMcpCredentialOptions = {
  env?: NodeJS.ProcessEnv
  readGitHubCliToken?: (env: NodeJS.ProcessEnv, host?: string) => Promise<string | undefined>
  inspectToken?: (token: string, host: string) => Promise<{ login: string; scopes: string[] }>
}

export async function previewBuiltinGitHubMcpCredential(
  host = 'github.com',
  options: GitHubMcpCredentialOptions = {}
): Promise<GitHubCredentialPreview | undefined> {
  const env = options.env ?? process.env
  const credential = await resolveCredential(env, host, options.readGitHubCliToken)
  if (!credential) return undefined
  const inspected = await (options.inspectToken ?? inspectGitHubToken)(credential.token, host)
  const scopes = [...new Set(inspected.scopes.map((scope) => scope.trim()).filter(Boolean))].sort()
  return {
    source: credential.source,
    host,
    login: inspected.login.trim(),
    scopes,
    fingerprint: credentialFingerprint(credential.source, host, inspected.login.trim(), scopes, credential.token)
  }
}

export async function resolveBuiltinGitHubMcpCredentials(
  serverId: string,
  server: McpServerConfig,
  options: GitHubMcpCredentialOptions = {}
): Promise<McpServerConfig> {
  if (!isKunManagedGitHubMcpServer(server) || !server.enabled) return server
  const policy = githubPolicyFromServer(server)
  if (!policy?.authorization || !policy.allowedHosts.includes(policy.host)) {
    throw new McpAuthorizationRequiredError(serverId, GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE)
  }
  const env = options.env ?? process.env
  const credential = await resolveCredential(env, policy.host, options.readGitHubCliToken)
  if (!credential) throw new McpAuthorizationRequiredError(serverId, GITHUB_MCP_AUTHORIZATION_REQUIRED_MESSAGE)
  const inspected = await (options.inspectToken ?? inspectGitHubToken)(credential.token, policy.host)
  const scopes = [...new Set(inspected.scopes.map((scope) => scope.trim()).filter(Boolean))].sort()
  const fingerprint = credentialFingerprint(
    credential.source, policy.host, inspected.login.trim(), scopes, credential.token
  )
  const approved = policy.authorization
  if (approved.source !== credential.source || approved.host !== policy.host ||
    approved.login !== inspected.login.trim() || approved.fingerprint !== fingerprint ||
    approved.scopes.join('\n') !== scopes.join('\n')) {
    throw new McpAuthorizationRequiredError(serverId, GITHUB_MCP_AUTHORIZATION_REJECTED_MESSAGE)
  }
  return {
    ...server,
    headers: { ...server.headers, Authorization: `Bearer ${credential.token}` }
  }
}

async function resolveCredential(
  env: NodeJS.ProcessEnv,
  host: string,
  readCli: GitHubMcpCredentialOptions['readGitHubCliToken']
): Promise<ResolvedCredential | undefined> {
  for (const name of GITHUB_TOKEN_ENV_VARS) {
    const token = env[name]?.trim()
    if (token) return { source: name, token }
  }
  const token = await (readCli ?? readGitHubCliToken)(env, host)
  return token?.trim() ? { source: 'github-cli', token: token.trim() } : undefined
}

async function inspectGitHubToken(
  token: string,
  host: string
): Promise<{ login: string; scopes: string[] }> {
  const apiHost = host === 'github.com' ? 'api.github.com' : host
  const response = await fetch(`https://${apiHost}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Kun-GitHub-MCP-Authorization'
    },
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`GitHub identity check failed with HTTP ${response.status}`)
  const body = await response.json() as { login?: unknown }
  if (typeof body.login !== 'string' || !body.login.trim()) throw new Error('GitHub identity response omitted login')
  const scopes = (response.headers.get('x-oauth-scopes') ?? '')
    .split(',').map((scope) => scope.trim()).filter(Boolean)
  return { login: body.login.trim(), scopes }
}

function credentialFingerprint(
  source: KunGitHubCredentialSource,
  host: string,
  login: string,
  scopes: string[],
  token: string
): string {
  return createHash('sha256')
    .update([source, host, login, scopes.join(','), token].join('\n'))
    .digest('hex')
}

export type GitHubCliExecutableSource = 'fixed' | 'path' | 'windows-fallback'
export type ResolvedGitHubCliExecutable = { path: string; source: GitHubCliExecutableSource }

export function readGitHubCliToken(env: NodeJS.ProcessEnv, host = 'github.com'): Promise<string | undefined> {
  const resolved = resolveGitHubCliExecutableDetails(env)
  if (!resolved) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(resolved.path, ['auth', 'token', '--hostname', host], {
      encoding: 'utf8',
      env: githubCliEnvironment(env, resolved.path),
      maxBuffer: TOKEN_MAX_BUFFER_BYTES,
      timeout: TOKEN_TIMEOUT_MS,
      windowsHide: true,
      shell: false
    }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined))
  })
}

export function resolveGitHubCliExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isExecutable: (path: string) => boolean = (path) => isExecutableFile(path, platform),
  resolveRealpath: (path: string) => string = realpathSync
): string | undefined {
  return resolveGitHubCliExecutableDetails(env, platform, isExecutable, resolveRealpath)?.path
}

export function resolveGitHubCliExecutableDetails(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isExecutable: (path: string) => boolean = (path) => isExecutableFile(path, platform),
  resolveRealpath: (path: string) => string = realpathSync
): ResolvedGitHubCliExecutable | undefined {
  for (const [source, candidates] of [
    ['fixed', githubCliExecutableCandidates(platform, env)],
    ['path', githubCliPathCandidates(platform, env)],
    ['windows-fallback', windowsGitHubCliFallbackCandidates(platform, env)]
  ] as const) {
    for (const candidate of candidates) {
      const path = resolveExecutableCandidate(candidate, platform, isExecutable, resolveRealpath)
      if (path) return { path, source }
    }
  }
  return undefined
}

export function githubCliEnvironment(
  env: NodeJS.ProcessEnv,
  executable: string,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {}
  for (const key of GITHUB_CLI_ENV_ALLOWLIST) {
    const value = env[key]
    if (value !== undefined) childEnv[key] = value
  }
  const systemPaths = platform === 'win32' ? windowsSystemPaths(env) : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const pathApi = platform === 'win32' ? win32 : posix
  childEnv.PATH = [...new Set([pathApi.dirname(executable), ...systemPaths])]
    .join(platform === 'win32' ? ';' : ':')
  return childEnv
}

function githubCliExecutableCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const executable = platform === 'win32' ? 'gh.exe' : 'gh'
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'].map((root) => posix.join(root, executable))
  if (platform === 'linux') return ['/home/linuxbrew/.linuxbrew/bin', '/usr/local/bin', '/usr/bin', '/snap/bin'].map((root) => posix.join(root, executable))
  if (platform === 'win32') return [
    env.ProgramFiles ? win32.join(env.ProgramFiles, 'GitHub CLI', executable) : '',
    env['ProgramFiles(x86)'] ? win32.join(env['ProgramFiles(x86)'], 'GitHub CLI', executable) : '',
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Programs', 'GitHub CLI', executable) : ''
  ].filter(Boolean)
  return []
}

function githubCliPathCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.PATH
  if (!pathValue) return []
  const pathApi = platform === 'win32' ? win32 : posix
  const executable = platform === 'win32' ? 'gh.exe' : 'gh'
  const pathDelimiter = platform === 'win32' ? win32.delimiter : posix.delimiter
  const directories = pathValue
    .split(pathDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [...new Set(directories)].map((directory) => pathApi.join(directory, executable))
}

function windowsGitHubCliFallbackCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') return []
  return [
    env.USERPROFILE ? win32.join(env.USERPROFILE, 'scoop', 'shims', 'gh.exe') : '',
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'gh.exe') : ''
  ].filter(Boolean)
}

function resolveExecutableCandidate(
  candidate: string,
  platform: NodeJS.Platform,
  isExecutable: (path: string) => boolean,
  resolveRealpath: (path: string) => string
): string | undefined {
  try {
    const pathApi = platform === 'win32' ? win32 : posix
    const resolved = resolveRealpath(pathApi.resolve(candidate))
    return isExecutable(resolved) ? resolved : undefined
  } catch {
    return undefined
  }
}

function windowsSystemPaths(env: NodeJS.ProcessEnv): string[] {
  const root = env.SystemRoot ?? env.WINDIR
  return root ? [win32.join(root, 'System32'), root] : []
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}
