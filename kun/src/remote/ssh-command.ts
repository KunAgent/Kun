/**
 * Build argv for the system `ssh` binary (Issue #647).
 *
 * Always invoked as `spawn('ssh', argv, { shell: false })` so there is no local
 * shell to inject into. The remote command runs in the remote login shell, so
 * any path WE control (the working directory) is single-quote escaped for that
 * remote shell; the command body itself is intentionally a shell command (the
 * agent's tool), gated by the approval layer, not by quoting here.
 */

export type SshConnectionOptions = {
  alias: string
  /** ControlMaster socket path for connection reuse; omit to disable multiplexing. */
  controlPath?: string
  /** Seconds before a connection attempt is abandoned. */
  connectTimeoutSec?: number
  /**
   * Refuse interactive prompts (used for the read-only precheck and any
   * non-interactive probe) so a missing key/host never hangs the agent.
   */
  batchMode?: boolean
  /** Persist the multiplexed master this long after the last client (seconds). */
  controlPersistSec?: number
}

/** Single-quote escape a string for a POSIX remote shell. */
export function shellQuoteRemote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Reject host aliases that the system `ssh` binary could misread as an option
 * or that contain shell-hostile characters. A leading `-` would be parsed as an
 * ssh flag; whitespace/control chars indicate a malformed or injected alias.
 * Throws on an unsafe alias so it can never reach `spawn`.
 */
export function assertSafeSshAlias(alias: string): string {
  const value = alias.trim()
  if (!value) throw new Error('SSH host alias must not be empty')
  if (value.startsWith('-')) throw new Error(`unsafe SSH host alias (must not start with '-'): ${alias}`)
  // eslint-disable-next-line no-control-regex -- intentionally rejecting control chars in an alias
  if (/[\s\u0000-\u001f"'`\\]/.test(value)) throw new Error(`unsafe SSH host alias (illegal characters): ${alias}`)
  return value
}

/**
 * argv for `ssh -G <alias>`, the AUTHORITATIVE config resolver. The hand-written
 * parser in ssh-config.ts is for listing aliases only; for a concrete
 * connection the executor should run `ssh -G` so Include/Match/Host wildcards
 * and all OpenSSH precedence rules are honored by ssh itself.
 */
export function buildSshResolveArgv(alias: string): string[] {
  return ['-G', assertSafeSshAlias(alias)]
}

/**
 * Base ssh options shared by exec and probe invocations. Host fingerprint
 * verification is left to the system known_hosts (StrictHostKeyChecking is NOT
 * disabled). Connection reuse is opt-in via `controlPath`.
 */
export function buildSshBaseArgs(options: SshConnectionOptions): string[] {
  const args: string[] = []
  if (options.batchMode) args.push('-o', 'BatchMode=yes')
  if (typeof options.connectTimeoutSec === 'number' && options.connectTimeoutSec > 0) {
    args.push('-o', `ConnectTimeout=${Math.floor(options.connectTimeoutSec)}`)
  }
  if (options.controlPath) {
    args.push('-o', 'ControlMaster=auto')
    args.push('-o', `ControlPath=${options.controlPath}`)
    const persist = options.controlPersistSec && options.controlPersistSec > 0 ? Math.floor(options.controlPersistSec) : 60
    args.push('-o', `ControlPersist=${persist}`)
  }
  return args
}

/**
 * Full argv for executing a command on the remote host, optionally inside a
 * working directory. The directory is escaped for the remote shell; `cd -- ...`
 * stops a leading-dash directory from being read as an option.
 */
export function buildSshExecArgv(
  options: SshConnectionOptions & { remoteDir?: string; command: string }
): string[] {
  const remoteCommand = options.remoteDir
    ? `cd -- ${shellQuoteRemote(options.remoteDir)} && ${options.command}`
    : options.command
  return [...buildSshBaseArgs(options), assertSafeSshAlias(options.alias), remoteCommand]
}
