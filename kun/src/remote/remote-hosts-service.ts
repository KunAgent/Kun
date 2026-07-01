/**
 * Remote hosts service (Issue #647) — the adapter behind the remote HTTP API.
 *
 * Reads the user's ~/.ssh/config to list selectable host aliases (never asking
 * for IP/port/key again), runs the read-only precheck to test a connection, and
 * exposes shareable secret-free Remote Profiles. The filesystem read and the
 * SSH executor are injected so this is unit-testable without a real config file
 * or SSH host.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseSshConfig } from './ssh-config.js'
import { SshExecutor, type SshSpawnFn } from './ssh-executor.js'
import { runRemotePrecheck } from './remote-connect.js'
import { parseRemoteProfile } from './remote-profile.js'
import type {
  ListRemoteHostsResponse,
  RemoteConnectionTestResponse,
  RemoteProfileSummary
} from '../contracts/remote.js'

export type RemoteHostsServiceDeps = {
  /** Reads the ssh config text; defaults to reading ~/.ssh/config. */
  readSshConfig?: () => Promise<string | null>
  /** Injectable spawn for the connection test; defaults to system ssh. */
  spawn?: SshSpawnFn
  /** Raw profile definitions (e.g. from project/team config). */
  profiles?: unknown[]
  /** Reads user-owned profiles; defaults to ~/.kun/remote-profiles.json. */
  readProfiles?: () => Promise<unknown[]>
  connectTimeoutSec?: number
}

export type RemoteHostsService = {
  listHosts(): Promise<ListRemoteHostsResponse>
  testConnection(input: { alias: string; remoteDir?: string }): Promise<RemoteConnectionTestResponse>
  listProfiles(): Promise<RemoteProfileSummary[]>
  resolveProfile(alias: string): Promise<RemoteProfileSummary | undefined>
}

async function defaultReadSshConfig(): Promise<string | null> {
  try {
    return await readFile(join(homedir(), '.ssh', 'config'), 'utf8')
  } catch {
    return null
  }
}

async function defaultReadProfiles(): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(join(homedir(), '.kun', 'remote-profiles.json'), 'utf8')) as unknown
    return Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && 'profiles' in parsed && Array.isArray((parsed as { profiles?: unknown }).profiles)
        ? (parsed as { profiles: unknown[] }).profiles
        : []
  } catch {
    return []
  }
}

export function createRemoteHostsService(deps: RemoteHostsServiceDeps = {}): RemoteHostsService {
  const readSshConfig = deps.readSshConfig ?? defaultReadSshConfig
  const readProfiles = deps.readProfiles ?? defaultReadProfiles
  const parsedProfiles = async (): Promise<RemoteProfileSummary[]> => {
    const summaries: RemoteProfileSummary[] = []
    for (const entry of deps.profiles ?? await readProfiles()) {
      try {
        const profile = parseRemoteProfile(entry)
        summaries.push({
          name: profile.name,
          host: profile.host,
          workspace: profile.workspace,
          mode: profile.mode,
          production: profile.production,
          ...(profile.healthCheck ? { healthCheck: profile.healthCheck } : {}),
          ...(profile.testCommand ? { testCommand: profile.testCommand } : {}),
          protectedPaths: profile.protectedPaths
        })
      } catch {
        // Skip malformed/secret-bearing profiles rather than leaking them.
      }
    }
    return summaries
  }

  return {
    async listHosts() {
      const text = await readSshConfig()
      if (text === null) return { hosts: [], configFound: false }
      const hosts = parseSshConfig(text).map((host) => ({
        alias: host.alias,
        ...(host.hostName ? { hostName: host.hostName } : {}),
        ...(host.user ? { user: host.user } : {}),
        ...(host.port ? { port: host.port } : {}),
        ...(host.proxyJump ? { proxyJump: host.proxyJump } : {})
      }))
      return { hosts, configFound: true }
    },

    async testConnection(input) {
      const executor = new SshExecutor({
        alias: input.alias,
        ...(input.remoteDir ? { remoteDir: input.remoteDir } : {}),
        ...(deps.spawn ? { spawn: deps.spawn } : {}),
        ...(deps.connectTimeoutSec ? { connectTimeoutSec: deps.connectTimeoutSec } : {})
      })
      const probe = await executor.probe()
      if (!probe.ok) {
        return {
          ok: false,
          alias: input.alias,
          ...(input.remoteDir ? { remoteDir: input.remoteDir } : {}),
          status: 'error',
          tools: {},
          ...(probe.error ? { error: probe.error } : {})
        }
      }
      const profile = await runRemotePrecheck({
        exec: (command) => executor.exec(command),
        ...(input.remoteDir ? { remoteDir: input.remoteDir } : {})
      })
      return {
        ok: profile.ok,
        alias: input.alias,
        ...(input.remoteDir ? { remoteDir: input.remoteDir } : {}),
        status: profile.ok ? 'connected' : 'error',
        ...(probe.latencyMs !== undefined ? { latencyMs: probe.latencyMs } : {}),
        ...(profile.os ? { os: profile.os } : {}),
        ...(profile.branch ? { branch: profile.branch } : {}),
        ...(profile.dirty !== undefined ? { dirty: profile.dirty } : {}),
        ...(profile.repoRoot ? { repoRoot: profile.repoRoot } : {}),
        tools: profile.tools,
        ...(profile.error ? { error: profile.error } : {})
      }
    },

    async listProfiles() {
      return await parsedProfiles()
    },

    async resolveProfile(alias) {
      return (await parsedProfiles()).find((profile) => profile.host === alias)
    }
  }
}
