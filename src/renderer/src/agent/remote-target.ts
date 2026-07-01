/**
 * Renderer-side, secret-free SSH remote target input.
 *
 * The UI only sends an SSH alias, remote working directory, run mode, and
 * safety metadata. Credentials remain in the user's ssh config / ssh-agent.
 */

export type RemoteRunMode = 'observe' | 'develop' | 'operations' | 'deploy'

export type RemoteTargetInput = {
  alias: string
  host?: string
  remoteDir?: string
  runMode?: RemoteRunMode
  production?: boolean
  profileName?: string
  protectedPaths?: string[]
}

export type NormalizedRemoteTarget = {
  kind: 'ssh'
  alias: string
  host?: string
  remoteDir?: string
  runMode: RemoteRunMode
  production: boolean
  profileName?: string
  protectedPaths: string[]
}

export function normalizeRemoteTarget(input: RemoteTargetInput): NormalizedRemoteTarget {
  return {
    kind: 'ssh',
    alias: input.alias.trim(),
    ...(input.host?.trim() ? { host: input.host.trim() } : {}),
    ...(input.remoteDir?.trim() ? { remoteDir: input.remoteDir.trim() } : {}),
    runMode: input.runMode ?? 'observe',
    production: input.production ?? false,
    ...(input.profileName?.trim() ? { profileName: input.profileName.trim() } : {}),
    protectedPaths: (input.protectedPaths ?? []).map((path) => path.trim()).filter(Boolean)
  }
}

export type RemoteHostSummary = {
  alias: string
  hostName?: string
  user?: string
  port?: number
  proxyJump?: string
}

export type RemoteHostsResult = {
  hosts: RemoteHostSummary[]
  configFound: boolean
}

export type RemoteConnectionTestResult = {
  ok: boolean
  alias: string
  remoteDir?: string
  status: 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error'
  latencyMs?: number
  os?: string
  branch?: string
  dirty?: boolean
  repoRoot?: string
  tools: Record<string, boolean>
  error?: string
}
