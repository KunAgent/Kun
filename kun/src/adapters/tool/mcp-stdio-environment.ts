import { posix, win32 } from 'node:path'
import type { McpServerConfig } from '../../contracts/capabilities.js'

/**
 * Environment + error helpers for stdio MCP servers.
 *
 * Building a sane PATH for child processes (so bare `npx`/`node` commands
 * resolve when Kun is launched from a GUI shell) and turning spawn failures
 * into actionable messages are self-contained concerns, separated from the
 * connection orchestration in `mcp-tool-provider.ts`.
 */

export type McpStdioEnvironmentOptions = {
  platform?: NodeJS.Platform
  baseEnv?: NodeJS.ProcessEnv
}

export function buildMcpStdioEnvironment(
  serverEnv: Record<string, string> = {},
  options: McpStdioEnvironmentOptions = {}
): Record<string, string> {
  const platform = options.platform ?? process.platform
  const baseEnv = options.baseEnv ?? process.env
  const pathKey = findPathKey(serverEnv) ?? findPathKey(baseEnv) ?? 'PATH'
  const configuredPath = readEnvPath(serverEnv)
  const inheritedPath = readEnvPath(baseEnv)
  const pathValue = mergePathEntries(
    [configuredPath ?? inheritedPath ?? '', ...commonMcpCommandPathEntries(platform, baseEnv)],
    pathDelimiter(platform)
  )
  return {
    ...serverEnv,
    ...(pathValue ? { [pathKey]: pathValue } : {})
  }
}

export function formatMcpConnectionError(error: unknown, server: McpServerConfig): string {
  const message = errorMessage(error)
  if (server.transport !== 'stdio' || !isMissingExecutableError(error, message)) return message
  const command = missingExecutableCommand(error) ?? server.command ?? 'configured command'
  const hint = isBareCommand(command)
    ? missingBareCommandHint(command)
    : `Could not find MCP command "${command}". Check that the configured executable path exists.`
  return `${message}. ${hint}`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function commonMcpCommandPathEntries(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/local/bin',
      homePath(env, '.volta/bin'),
      homePath(env, '.local/bin'),
      homePath(env, '.bun/bin')
    ].filter((entry): entry is string => Boolean(entry))
  }
  if (platform === 'linux') {
    return [
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      homePath(env, '.volta/bin'),
      homePath(env, '.local/bin'),
      homePath(env, '.bun/bin')
    ].filter((entry): entry is string => Boolean(entry))
  }
  if (platform === 'win32') {
    return [
      env.APPDATA ? win32.join(env.APPDATA, 'npm') : '',
      env.ProgramFiles ? win32.join(env.ProgramFiles, 'nodejs') : '',
      env['ProgramFiles(x86)'] ? win32.join(env['ProgramFiles(x86)'], 'nodejs') : ''
    ].filter((entry): entry is string => Boolean(entry))
  }
  return []
}

function findPathKey(env: Record<string, string | undefined>): string | undefined {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path')
}

function readEnvPath(env: Record<string, string | undefined>): string | undefined {
  const key = findPathKey(env)
  const value = key ? env[key] : undefined
  return value && value.trim() ? value : undefined
}

function mergePathEntries(values: string[], delimiter: string): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const value of values) {
    for (const entry of value.split(delimiter)) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(trimmed)
    }
  }
  return entries.join(delimiter)
}

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

function homePath(env: NodeJS.ProcessEnv, relativePath: string): string {
  return env.HOME ? posix.join(env.HOME, relativePath) : ''
}

function isMissingExecutableError(error: unknown, message: string): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  return code === 'ENOENT' || /\bspawn\s+\S+\s+ENOENT\b/i.test(message)
}

function missingExecutableCommand(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const path = (error as { path?: unknown }).path
  return typeof path === 'string' && path.trim() ? path.trim() : undefined
}

function isBareCommand(command: string): boolean {
  return Boolean(command.trim()) && !command.includes('/') && !command.includes('\\')
}

function missingBareCommandHint(command: string): string {
  if (process.platform === 'win32') {
    return `Could not find "${command}" on PATH while starting the MCP server. Make sure Node/npm is installed and available to Kun, or set the MCP command to an absolute path.`
  }
  if (process.platform === 'darwin') {
    return `Could not find "${command}" on PATH while starting the MCP server. If Kun was launched from Finder or the desktop, make sure Node/npm is installed and available to GUI apps, or set the MCP command to an absolute path such as /opt/homebrew/bin/${command}.`
  }
  return `Could not find "${command}" on PATH while starting the MCP server. Make sure Node/npm is installed and available to Kun, or set the MCP command to an absolute path such as /usr/local/bin/${command}.`
}
