/**
 * OpenSSH client-config parsing for the Remote Agent Target (Issue #647).
 *
 * Kun reuses the user's existing `~/.ssh/config` so a remote target is just a
 * host alias — no re-entering IP / port / key. This module is pure (operates on
 * config text) so it is unit-testable without touching the filesystem or the
 * network. Connection itself always goes through the system `ssh` binary
 * (ProxyJump, certificates, FIDO keys, MFA, ssh-agent, known_hosts all handled
 * by OpenSSH); Kun never stores passwords, private keys, or passphrases.
 */

export type SshConfigHost = {
  /** The alias the user types (the concrete `Host` pattern, never a wildcard). */
  alias: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
}

type RawHostBlock = {
  patterns: string[]
  settings: Map<string, string>
}

function isWildcard(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.startsWith('!')
}

function parseBlocks(text: string): RawHostBlock[] {
  const blocks: RawHostBlock[] = []
  let current: RawHostBlock | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // `Key value` or `Key=value`; keys are case-insensitive.
    const match = line.match(/^(\S+?)[=\s]+(.+)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (key === 'host') {
      current = { patterns: value.split(/\s+/).filter(Boolean), settings: new Map() }
      blocks.push(current)
      continue
    }
    if (key === 'match') {
      // `Match` blocks use conditional logic we don't evaluate; start a block
      // with no concrete patterns so its settings never bind to a plain alias.
      current = { patterns: [], settings: new Map() }
      blocks.push(current)
      continue
    }
    if (!current) continue
    // First value wins in OpenSSH; keep the earliest occurrence per block.
    if (!current.settings.has(key)) current.settings.set(key, value)
  }
  return blocks
}

function patternMatches(pattern: string, alias: string): boolean {
  if (pattern === alias) return true
  if (!isWildcard(pattern) || pattern.startsWith('!')) return false
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  try {
    return new RegExp(`^${escaped}$`).test(alias)
  } catch {
    return false
  }
}

function blockSetting(blocks: readonly RawHostBlock[], alias: string, key: string): string | undefined {
  for (const block of blocks) {
    if (block.patterns.some((pattern) => patternMatches(pattern, alias)) && block.settings.has(key)) {
      return block.settings.get(key)
    }
  }
  return undefined
}

function toHost(alias: string, blocks: readonly RawHostBlock[]): SshConfigHost {
  const port = blockSetting(blocks, alias, 'port')
  const parsedPort = port ? Number.parseInt(port, 10) : Number.NaN
  return {
    alias,
    ...(blockSetting(blocks, alias, 'hostname') ? { hostName: blockSetting(blocks, alias, 'hostname') } : {}),
    ...(blockSetting(blocks, alias, 'user') ? { user: blockSetting(blocks, alias, 'user') } : {}),
    ...(Number.isInteger(parsedPort) && parsedPort > 0 ? { port: parsedPort } : {}),
    ...(blockSetting(blocks, alias, 'identityfile') ? { identityFile: blockSetting(blocks, alias, 'identityfile') } : {}),
    ...(blockSetting(blocks, alias, 'proxyjump') ? { proxyJump: blockSetting(blocks, alias, 'proxyjump') } : {})
  }
}

/**
 * Concrete host aliases the user can pick (wildcard/`Match`/negated patterns are
 * excluded — you cannot connect to a pattern). Order follows the config file.
 */
export function listSshHostAliases(text: string): string[] {
  const aliases: string[] = []
  const seen = new Set<string>()
  for (const block of parseBlocks(text)) {
    for (const pattern of block.patterns) {
      if (isWildcard(pattern) || seen.has(pattern)) continue
      seen.add(pattern)
      aliases.push(pattern)
    }
  }
  return aliases
}

/** Parse every concrete host alias into a merged {@link SshConfigHost}. */
export function parseSshConfig(text: string): SshConfigHost[] {
  const blocks = parseBlocks(text)
  return listSshHostAliases(text).map((alias) => toHost(alias, blocks))
}

/**
 * Resolve one alias to its effective settings (later wildcard blocks fill gaps,
 * matching OpenSSH "first value wins" precedence). Returns null when the alias
 * is not present as a concrete Host entry.
 */
export function resolveSshHost(text: string, alias: string): SshConfigHost | null {
  const blocks = parseBlocks(text)
  const hasConcrete = blocks.some((block) => block.patterns.includes(alias))
  if (!hasConcrete) return null
  return toHost(alias, blocks)
}
