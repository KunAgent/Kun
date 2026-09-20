import { execFile as defaultExecFile } from 'node:child_process'
import { existsSync as defaultExistsSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { RemoteTailscaleInfo } from '../../shared/remote-access'
import { lanIpv4Addresses } from './remote-lan-urls'

const DETECT_TIMEOUT_MS = 4_000
const MACOS_APP_PATH = '/Applications/Tailscale.app'
const MACOS_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const IPV4_IN_TEXT = /\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g

type TailscaleProbe = { kind: 'ip'; ipv4: string } | { kind: 'present' } | { kind: 'missing' }

type ExecFileFn = typeof defaultExecFile

export type DetectTailscaleAccessOptions = {
  interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>
  execFile?: ExecFileFn
  existsSync?: (path: string) => boolean
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

/** Tailscale's default userspace IPv4 pool is CGNAT 100.64.0.0/10. */
export function isTailscaleCgnatIpv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const numbers = parts.map((part) => Number(part))
  if (!numbers.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return false
  const [a, b] = numbers
  return a === 100 && b >= 64 && b <= 127
}

export function parseTailscaleIpv4FromCliOutput(stdout: string | Buffer | null | undefined): string | null {
  const text = Buffer.isBuffer(stdout)
    ? stdout.toString('utf8')
    : typeof stdout === 'string'
      ? stdout
      : ''
  for (const match of text.match(IPV4_IN_TEXT) ?? []) {
    if (isTailscaleCgnatIpv4(match)) return match
  }
  return null
}

function tailscaleInterfaceNameScore(name: string): number {
  const normalized = name.toLowerCase()
  if (normalized.includes('tailscale')) return 20
  if (normalized.startsWith('utun')) return 10
  return 0
}

export function findTailscaleIpv4FromInterfaces(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string | null {
  const hits = lanIpv4Addresses(interfaces)
    .filter((candidate) => isTailscaleCgnatIpv4(candidate.address))
    .sort(
      (left, right) =>
        tailscaleInterfaceNameScore(right.name) - tailscaleInterfaceNameScore(left.name) ||
        left.order - right.order
    )
  return hits[0]?.address ?? null
}

function windowsTailscaleCliPaths(env: NodeJS.ProcessEnv): string[] {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.PROGRAMFILES].filter(
    (root): root is string => Boolean(root)
  )
  return [...new Set(roots)].map((root) => join(root, 'Tailscale', 'tailscale.exe'))
}

export function tailscaleBinaryCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform === 'darwin') {
    return ['tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', MACOS_APP_CLI]
  }
  if (platform === 'linux') {
    return ['tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale']
  }
  if (platform === 'win32') {
    return ['tailscale.exe', 'tailscale', ...windowsTailscaleCliPaths(env)]
  }
  return ['tailscale']
}

function installedMarkerPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'darwin') {
    return [MACOS_APP_PATH, MACOS_APP_CLI, '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']
  }
  if (platform === 'linux') return ['/usr/local/bin/tailscale', '/usr/bin/tailscale']
  if (platform === 'win32') return windowsTailscaleCliPaths(env)
  return []
}

function isAbsoluteBinary(binary: string): boolean {
  return binary.includes('/') || binary.includes('\\')
}

function probeEnv(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const delimiter = platform === 'win32' ? ';' : ':'
  const extras =
    platform === 'darwin'
      ? ['/usr/local/bin', '/opt/homebrew/bin']
      : platform === 'linux'
        ? ['/usr/local/bin', '/usr/bin']
        : []
  const current = env.PATH ?? env.Path ?? ''
  const PATH = [...extras, current].filter(Boolean).join(delimiter)
  return { ...env, PATH }
}

function probeTailscaleBinary(
  binary: string,
  run: ExecFileFn,
  env: NodeJS.ProcessEnv
): Promise<TailscaleProbe> {
  return new Promise((resolve) => {
    try {
      run(
        binary,
        ['ip', '-4'],
        {
          timeout: DETECT_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          encoding: 'utf8',
          env,
          windowsHide: true
        },
        (error, stdout) => {
          const ipv4 = parseTailscaleIpv4FromCliOutput(stdout)
          if (ipv4) {
            resolve({ kind: 'ip', ipv4 })
            return
          }
          resolve(
            error && (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? { kind: 'missing' }
              : { kind: 'present' }
          )
        }
      )
    } catch {
      resolve({ kind: 'missing' })
    }
  })
}

/**
 * Probe whether Tailscale is installed and connected on this host, and return
 * the tailnet IPv4 when it is. Used by the Remote panel's "detect Tailscale"
 * action; deliberately read-only and bounded by a short timeout.
 *
 * Interface scan is preferred because GUI-launched Electron often cannot see
 * Homebrew/`/usr/local/bin` on PATH, and the Tailscale CLI may fail to talk to
 * the IPN daemon even when utun already has a 100.64/10 address.
 */
export async function detectTailscaleAccess(
  options: DetectTailscaleAccessOptions = {}
): Promise<RemoteTailscaleInfo> {
  const fromIface = findTailscaleIpv4FromInterfaces(options.interfaces ?? os.networkInterfaces())
  if (fromIface) {
    return { installed: true, connected: true, ipv4: fromIface }
  }

  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.existsSync ?? defaultExistsSync
  const run = options.execFile ?? defaultExecFile
  const childEnv = probeEnv(platform, env)

  let foundBinary = false
  for (const binary of tailscaleBinaryCandidates(platform, env)) {
    if (isAbsoluteBinary(binary) && !exists(binary)) continue
    const probe = await probeTailscaleBinary(binary, run, childEnv)
    if (probe.kind === 'ip') {
      return { installed: true, connected: true, ipv4: probe.ipv4 }
    }
    if (probe.kind === 'present') foundBinary = true
  }

  const installed = foundBinary || installedMarkerPaths(platform, env).some((path) => exists(path))
  return { installed, connected: false, ipv4: null }
}
