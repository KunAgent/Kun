import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserWindow, IpcMain } from 'electron'
import type { AppSettingsPatch, AppSettingsV1 } from '../shared/app-settings'
import { getKunRuntimeSettings } from '../shared/app-settings'
import {
  DEFAULT_GITHUB_MCP_HOST,
  isSupportedGitHubMcpHost,
  normalizeGitHubHost,
  normalizeGitHubOrganizations,
  normalizeGitHubRepositories,
  type BuiltinGitHubMcpAuthorizationConfirmation,
  type BuiltinGitHubMcpAuthorizationPreflight,
  type BuiltinGitHubMcpAuthorizationResult,
  type BuiltinGitHubMcpIdentity,
  type BuiltinGitHubMcpLoginResult
} from '../shared/github-mcp-authorization'
import {
  githubCliEnvironment,
  previewBuiltinGitHubMcpCredential,
  resolveGitHubCliExecutable
} from '../../kun/src/adapters/tool/github-mcp-credential.js'
import { assertTrustedWorkbenchSender } from './ipc/app-ipc-handler-utils'

const execFileAsync = promisify(execFile)
const NONCE_TTL_MS = 60_000
const GITHUB_LOGIN_TIMEOUT_MS = 5 * 60_000

type PendingAuthorization = {
  expiresAt: number
  identity: BuiltinGitHubMcpIdentity
}

async function launchGitHubLogin(host: string): Promise<BuiltinGitHubMcpLoginResult> {
  const executable = resolveGitHubCliExecutable(process.env)
  if (!executable || !isSupportedGitHubMcpHost(host)) {
    return { started: false, reason: executable ? 'unsupported-host' : 'github-cli-unavailable' }
  }
  try {
    await execFileAsync(executable, [
      'auth', 'login', '--hostname', host, '--web', '--git-protocol', 'https'
    ], {
      timeout: GITHUB_LOGIN_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      env: githubCliEnvironment(process.env, executable)
    })
    return { started: true }
  } catch (error) {
    const code = error as NodeJS.ErrnoException
    return { started: false, reason: code.code === 'ENOENT' ? 'github-cli-unavailable' : 'login-failed' }
  }
}

export function registerBuiltinGitHubMcpAuthorizationIpc(options: {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  getSettings: () => Promise<AppSettingsV1>
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<unknown>
  previewCredential?: (host: string) => Promise<BuiltinGitHubMcpIdentity | undefined>
  launchLogin?: (host: string) => Promise<BuiltinGitHubMcpLoginResult>
  assertSender?: typeof assertTrustedWorkbenchSender
  now?: () => number
  createNonce?: () => string
}): void {
  const pending = new Map<string, PendingAuthorization>()
  const now = options.now ?? Date.now
  const createNonce = options.createNonce ?? randomUUID
  const previewCredential = options.previewCredential ?? ((host) =>
    previewBuiltinGitHubMcpCredential(host) as Promise<BuiltinGitHubMcpIdentity | undefined>)
  const startLogin = options.launchLogin ?? launchGitHubLogin
  const assertSender = options.assertSender ?? assertTrustedWorkbenchSender

  options.ipcMain.handle('github-mcp:authorization:preflight', async (event, rawHost?: unknown) => {
    assertSender(event, options.getMainWindow)
    const host = normalizeGitHubHost(rawHost) ?? DEFAULT_GITHUB_MCP_HOST
    if (!isSupportedGitHubMcpHost(host)) return { status: 'missing', host } satisfies BuiltinGitHubMcpAuthorizationPreflight
    const identity = await previewCredential(host)
    if (!identity) return { status: 'missing', host } satisfies BuiltinGitHubMcpAuthorizationPreflight
    const nonce = createNonce()
    pending.set(nonce, { expiresAt: now() + NONCE_TTL_MS, identity })
    const settings = getKunRuntimeSettings(await options.getSettings()).githubMcp
    return {
      status: 'ready', nonce, identity,
      enabled: settings.enabled,
      allowedOrganizations: [...settings.allowedOrganizations],
      allowedRepositories: [...settings.allowedRepositories]
    } satisfies BuiltinGitHubMcpAuthorizationPreflight
  })

  options.ipcMain.handle('github-mcp:authorization:login', async (event, rawHost?: unknown) => {
    assertSender(event, options.getMainWindow)
    const host = normalizeGitHubHost(rawHost) ?? DEFAULT_GITHUB_MCP_HOST
    if (!isSupportedGitHubMcpHost(host)) return { started: false, reason: 'unsupported-host' }
    return await startLogin(host)
  })

  options.ipcMain.handle('github-mcp:authorization:disable', async (event) => {
    assertSender(event, options.getMainWindow)
    pending.clear()
    await options.applySettingsPatch({
      agents: { kun: { githubMcp: { enabled: false, authorization: null } } }
    })
    return { disabled: true as const }
  })

  options.ipcMain.handle('github-mcp:authorization:confirm', async (
    event,
    raw: BuiltinGitHubMcpAuthorizationConfirmation
  ): Promise<BuiltinGitHubMcpAuthorizationResult> => {
    assertSender(event, options.getMainWindow)
    const nonce = typeof raw?.nonce === 'string' ? raw.nonce : ''
    const request = pending.get(nonce)
    pending.delete(nonce)
    if (!request) return { authorized: false, reason: 'invalid' }
    if (request.expiresAt < now()) return { authorized: false, reason: 'expired' }
    const liveIdentity = await previewCredential(request.identity.host)
    if (!liveIdentity || liveIdentity.fingerprint !== request.identity.fingerprint) {
      return { authorized: false, reason: 'identity-changed' }
    }
    const allowedHosts = [
      ...new Set([liveIdentity.host, ...(raw.allowedHosts ?? []).flatMap((host) => normalizeGitHubHost(host) ?? [])])
    ].sort()
    await options.applySettingsPatch({
      agents: {
        kun: {
          githubMcp: {
            enabled: true,
            githubHost: liveIdentity.host,
            allowedHosts,
            allowedOrganizations: normalizeGitHubOrganizations(raw.allowedOrganizations),
            allowedRepositories: normalizeGitHubRepositories(raw.allowedRepositories),
            authorization: liveIdentity
          }
        }
      }
    })
    return { authorized: true }
  })
}
