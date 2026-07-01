/**
 * Remote connection test + first-entry precheck (Issue #647).
 *
 * Runs the read-only precheck plan (pwd/uname/git status/git root/tool detection)
 * on first entry to a target and parses the raw outputs into an environment
 * profile (#8) the agent can rely on without re-probing. Also powers the "Test
 * connection" button. The exec function is injected so this is unit-testable
 * without a live SSH host.
 */

import { buildRemotePrecheckPlan } from './remote-target.js'
import type { RemoteTargetDescriptor } from './remote-target.js'
import type { SshExecOutcome } from './ssh-executor.js'

export type RemoteEnvironmentProfile = {
  ok: boolean
  cwd?: string
  os?: string
  branch?: string
  dirty?: boolean
  repoRoot?: string
  tools: Record<string, boolean>
  error?: string
}

export type RemotePrecheckExec = (command: string) => Promise<SshExecOutcome>

/**
 * Run the read-only precheck and parse it into an environment profile. None of
 * the commands mutate the remote, so this is safe to run automatically on first
 * entry without an approval prompt.
 */
export async function runRemotePrecheck(input: {
  exec: RemotePrecheckExec
  remoteDir?: string
}): Promise<RemoteEnvironmentProfile> {
  const plan = buildRemotePrecheckPlan(input.remoteDir)
  const tools: Record<string, boolean> = {}
  const profile: RemoteEnvironmentProfile = { ok: true, tools }
  for (const step of plan) {
    let outcome: SshExecOutcome
    try {
      outcome = await input.exec(step.command)
    } catch (error) {
      profile.ok = false
      profile.error = error instanceof Error ? error.message : String(error)
      return profile
    }
    if (outcome.exitCode !== 0 && step.id !== 'git-status' && step.id !== 'git-root') {
      // pwd/uname/toolcheck failing means the connection or shell is unusable.
      if (step.id === 'pwd' || step.id === 'uname') {
        profile.ok = false
        profile.error = outcome.stderr.trim() || `precheck step '${step.id}' exited ${outcome.exitCode}`
        return profile
      }
    }
    applyPrecheckStep(profile, step.id, outcome)
  }
  return profile
}

function applyPrecheckStep(profile: RemoteEnvironmentProfile, id: string, outcome: SshExecOutcome): void {
  const stdout = outcome.stdout.trim()
  switch (id) {
    case 'pwd':
      if (stdout) profile.cwd = stdout
      break
    case 'uname':
      if (stdout) profile.os = stdout
      break
    case 'git-status': {
      if (outcome.exitCode !== 0) break
      const { branch, dirty } = parseGitStatus(stdout)
      if (branch) profile.branch = branch
      profile.dirty = dirty
      break
    }
    case 'git-root':
      if (outcome.exitCode === 0 && stdout) profile.repoRoot = stdout
      break
    case 'toolcheck':
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^(\w[\w-]*)=(yes|no)$/)
        if (match) profile.tools[match[1]] = match[2] === 'yes'
      }
      break
  }
}

/** Parse `git status --porcelain=v1 -b` output for branch + dirty state. */
export function parseGitStatus(output: string): { branch?: string; dirty: boolean } {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0)
  let branch: string | undefined
  let dirty = false
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // `## main...origin/main [ahead 1]` → take the local branch up to `...`.
      const rest = line.slice(3)
      branch = rest.split(/\.\.\.|\s/)[0]
    } else {
      dirty = true
    }
  }
  return { ...(branch ? { branch } : {}), dirty }
}

/** Build a descriptor from a precheck profile for the thread header / UI. */
export function descriptorFromPrecheck(input: {
  alias: string
  remoteDir?: string
  host?: string
  profile: RemoteEnvironmentProfile
  latencyMs?: number
}): RemoteTargetDescriptor {
  return {
    target: {
      kind: 'ssh',
      alias: input.alias,
      ...(input.host ? { host: input.host } : {}),
      ...(input.remoteDir ? { remoteDir: input.remoteDir } : {})
    },
    status: input.profile.ok ? 'connected' : 'error',
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.profile.os ? { os: input.profile.os } : {}),
    ...(input.profile.branch ? { branch: input.profile.branch } : {}),
    ...(input.profile.dirty !== undefined ? { dirty: input.profile.dirty } : {}),
    ...(input.profile.error ? { lastError: input.profile.error } : {})
  }
}
