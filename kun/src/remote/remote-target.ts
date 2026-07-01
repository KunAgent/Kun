/**
 * Remote Agent Target model (Issue #647).
 *
 * A thread binds to exactly ONE primary execution target. Local threads run the
 * tool chain on this machine; SSH threads run the SAME tools on a remote host
 * via the system `ssh` binary. The model, API keys, approvals, and session
 * records always stay local — only tool EXECUTION moves to the remote.
 */

export type RemoteTarget =
  | { kind: 'local' }
  | {
      kind: 'ssh'
      /** The ~/.ssh/config alias the user selected. */
      alias: string
      /** Resolved hostname (display/diagnostics only), when known. */
      host?: string
      /** Remote working directory the agent operates in (the "project root"). */
      remoteDir?: string
    }

export type RemoteConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'degraded'
  | 'disconnected'
  | 'error'

export type RemoteTargetDescriptor = {
  target: RemoteTarget
  status: RemoteConnectionStatus
  /** Round-trip latency in ms for the last probe, when measured. */
  latencyMs?: number
  /** Remote OS string from `uname`, when known. */
  os?: string
  /** Current git branch on the remote working dir, when in a repo. */
  branch?: string
  /** True when the remote working dir has uncommitted changes. */
  dirty?: boolean
  lastError?: string
}

export function isSshTarget(target: RemoteTarget): target is Extract<RemoteTarget, { kind: 'ssh' }> {
  return target.kind === 'ssh'
}

/** A short, stable label for the thread header: `alias · dir · branch`. */
export function describeRemoteTarget(descriptor: RemoteTargetDescriptor): string {
  const { target } = descriptor
  if (target.kind === 'local') return 'local'
  const parts = [target.alias]
  if (target.remoteDir) parts.push(target.remoteDir)
  if (descriptor.branch) parts.push(descriptor.branch)
  return parts.join(' · ')
}

export type RemotePrecheckStep = {
  id: string
  description: string
  /** Remote shell command — always read-only. */
  command: string
  /** Always false here; the precheck must never mutate the remote. */
  writes: false
}

/**
 * Read-only commands the agent runs once on first entry to a remote target so
 * it understands the environment before doing anything: working dir, OS, git
 * state, available tooling, and the repository root. None of these mutate the
 * remote, so they are safe to run automatically without an approval prompt.
 */
export function buildRemotePrecheckPlan(remoteDir?: string): RemotePrecheckStep[] {
  const gitDir = remoteDir ? `git -C ${shellDir(remoteDir)} ` : 'git '
  return [
    { id: 'pwd', description: 'Confirm the working directory', command: 'pwd', writes: false },
    { id: 'uname', description: 'Identify the remote OS', command: 'uname -a', writes: false },
    {
      id: 'git-status',
      description: 'Check git branch and dirty state',
      command: `${gitDir}status --porcelain=v1 -b`,
      writes: false
    },
    {
      id: 'git-root',
      description: 'Locate the repository root',
      command: `${gitDir}rev-parse --show-toplevel`,
      writes: false
    },
    {
      id: 'toolcheck',
      description: 'Detect available tooling (rg/git/node/python/docker)',
      command: 'for t in rg git node python docker; do command -v "$t" >/dev/null 2>&1 && echo "$t=yes" || echo "$t=no"; done',
      writes: false
    }
  ]
}

function shellDir(dir: string): string {
  return `'${dir.replace(/'/g, `'\\''`)}'`
}
