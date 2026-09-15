import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { RemoteTailscaleInfo } from '../../shared/remote-access'

const TAILSCALE_IPV4 = /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}\s*$/m
const DETECT_TIMEOUT_MS = 4_000

/** CLI locations tried in order: PATH first, then the macOS app bundle's embedded CLI. */
const TAILSCALE_BINARIES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']

const MACOS_APP_PATH = '/Applications/Tailscale.app'

type TailscaleProbe = { kind: 'ip'; ipv4: string } | { kind: 'present' } | { kind: 'missing' }

function probeTailscaleBinary(binary: string): Promise<TailscaleProbe> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['ip', '-4'],
      { timeout: DETECT_TIMEOUT_MS, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (!error && typeof stdout === 'string') {
          const match = stdout.match(TAILSCALE_IPV4)
          if (match) {
            resolve({ kind: 'ip', ipv4: match[0].trim() })
            return
          }
        }
        resolve(error && (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? { kind: 'missing' }
          : { kind: 'present' })
      }
    )
  })
}

/**
 * Probe whether Tailscale is installed and connected on this host, and return
 * the tailnet IPv4 when it is. Used by the Remote panel's "detect Tailscale"
 * action; deliberately read-only and bounded by a short timeout.
 */
export async function detectTailscaleAccess(): Promise<RemoteTailscaleInfo> {
  let foundBinary = false
  for (const binary of TAILSCALE_BINARIES) {
    if (binary.includes('/') && !existsSync(binary)) continue
    const probe = await probeTailscaleBinary(binary)
    if (probe.kind === 'ip') {
      return { installed: true, connected: true, ipv4: probe.ipv4 }
    }
    if (probe.kind === 'present') foundBinary = true
  }
  const installed = foundBinary || existsSync(MACOS_APP_PATH)
  return { installed, connected: false, ipv4: null }
}
