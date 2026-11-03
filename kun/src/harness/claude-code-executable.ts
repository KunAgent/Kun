/**
 * The Claude Code executable the Agent SDK launches.
 *
 * The installer does not ship the SDK's per-platform binary
 * (electron-builder excludes it); the main process downloads one on demand
 * and passes it as KUN_CLAUDE_BINARY. Without that download the SDK cannot
 * start at all, although the Agent Center detects the user's own Claude
 * Code. In that case Kun launches the user's installation, the way the
 * detector finds it: the native installer's launcher first (a Dock-launched
 * app lacks the shell PATH entry the installer adds), then the search PATH.
 */
import { accessSync, constants, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { harnessExecutableEnv } from './harness-executable-env.js'

const runtimeRequire = createRequire(import.meta.url)

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude'
}

function isExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch { return false }
}

/** The SDK's own platform binary, when its optional package is installed. */
export function sdkBundledClaudeBinary(): string | undefined {
  try {
    return runtimeRequire.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${binaryName(process.platform)}`)
  } catch { return undefined }
}

/**
 * The user's own Claude Code. Windows npm shims (`claude.cmd`) cannot be
 * spawned without a shell, so only executables qualify there.
 */
export function installedClaudeCode(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const home = env.HOME || env.USERPROFILE || homedir()
  const name = binaryName(platform)
  const native = join(home, '.local', 'bin', name)
  if (isExecutable(native, platform)) return native
  for (const dir of (harnessExecutableEnv(env).PATH ?? '').split(delimiter)) {
    if (dir && isExecutable(join(dir, name), platform)) return join(dir, name)
  }
  return undefined
}

/**
 * Settings override, then Kun's managed download, then the SDK's own binary
 * (undefined: the SDK resolves it), then the user's installation.
 */
export function claudeCodeSdkExecutable(override?: string, deps: {
  env?: NodeJS.ProcessEnv
  bundled?: () => string | undefined
  installed?: () => string | undefined
} = {}): string | undefined {
  const env = deps.env ?? process.env
  const explicit = override?.trim() || env.KUN_CLAUDE_BINARY?.trim()
  if (explicit) return explicit
  if ((deps.bundled ?? sdkBundledClaudeBinary)()) return undefined
  return (deps.installed ?? (() => installedClaudeCode(env)))()
}
