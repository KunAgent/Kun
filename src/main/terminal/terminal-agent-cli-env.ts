import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { KunBinaryResolution } from '../resolve-kun-binary'

/**
 * Bundled `kun` CLI surfaced to ADE terminal-agent PTYs (docs/ade/05 §5.3,
 * P3-18): the agent's PATH puts this directory first so a bare `kun`
 * resolves, and `KUN_CLI` exports the absolute command for the callback
 * appendix instructions.
 */
export type KunCliLaunch = {
  binDir: string
  cliPath: string
}

const POSIX_LAUNCHER = 'kun'
const WIN32_LAUNCHER = 'kun.cmd'

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function shimText(input: {
  platform: NodeJS.Platform
  resolution: KunBinaryResolution
}): { name: string; text: string } {
  const runAsNode = input.resolution.kind === 'node-script'
  const command = input.resolution.command
  const args = input.resolution.args
  if (input.platform === 'win32') {
    const lines = [
      '@echo off',
      ...(runAsNode ? ['set "ELECTRON_RUN_AS_NODE=1"'] : []),
      `"${command}"${args.length ? ` ${args.map((a) => `"${a}"`).join(' ')}` : ''} %*`
    ]
    return { name: WIN32_LAUNCHER, text: `${lines.join('\r\n')}\r\n` }
  }
  const execParts = [command, ...args].map(shQuote).join(' ')
  const prefix = runAsNode ? 'ELECTRON_RUN_AS_NODE=1 ' : ''
  return {
    name: POSIX_LAUNCHER,
    text: `#!/bin/sh\n${prefix}exec ${execParts} "$@"\n`
  }
}

/**
 * Resolve the `kun` launch for a terminal-agent PTY. Packaged builds prefer
 * the generated launcher (`resources/bin/kun` on macOS, `bin/kun.cmd` next to
 * the executable on Windows); development and launcher-less packages fall
 * back to a generated shim under `shimDir` that execs the resolved entry.
 * Returns null when nothing usable can be produced — the agent launch must
 * still proceed (the callback appendix degrades to a bare `kun`).
 */
export function ensureKunCliLaunch(input: {
  isPackaged: boolean
  platform: NodeJS.Platform
  resourcesPath: string
  execDir: string
  shimDir: string
  resolution: KunBinaryResolution
}): KunCliLaunch | null {
  if (input.isPackaged) {
    const launcher = input.platform === 'win32'
      ? join(input.execDir, 'bin', WIN32_LAUNCHER)
      : join(input.resourcesPath, 'bin', POSIX_LAUNCHER)
    if (existsSync(launcher)) return { binDir: dirname(launcher), cliPath: launcher }
  }
  const shim = shimText(input)
  const cliPath = join(input.shimDir, shim.name)
  try {
    mkdirSync(input.shimDir, { recursive: true, mode: 0o755 })
    const existing = existsSync(cliPath) ? readFileSync(cliPath, 'utf8') : null
    if (existing !== shim.text) writeFileSync(cliPath, shim.text, { encoding: 'utf8' })
    chmodSync(cliPath, 0o755)
    return { binDir: input.shimDir, cliPath }
  } catch {
    return null
  }
}

/** Prepend the CLI dir to PATH and export the absolute `KUN_CLI`. */
export function applyKunCliEnv(env: NodeJS.ProcessEnv, launch: KunCliLaunch): void {
  env.KUN_CLI = launch.cliPath
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = env[pathKey] ? `${launch.binDir}${delimiter}${env[pathKey]}` : launch.binDir
}
