import type { RemoteAccessBindMode } from './app-settings-remote'

export type RemoteAccessUrls = {
  /** Loopback URL usable on the host itself. */
  local: string
  /** LAN URLs (best first) when bound to 0.0.0.0. */
  lan: string[]
  /** Preferred URL shown in the UI. */
  primary: string
  /** Raw listen URL derived from the bind address. */
  listen: string
}

export type RemoteAccessClientInfo = {
  id: string
  connectedAt: string
  remoteAddress: string
  userAgent: string
}

export type RemoteAccessStatus = {
  enabled: boolean
  running: boolean
  bind: RemoteAccessBindMode
  port: number
  urls: RemoteAccessUrls
  passwordSet: boolean
  clients: RemoteAccessClientInfo[]
  lastError: string
  /** True when the renderer is proxied from the dev server instead of the bundled build. */
  devMode: boolean
}

export type RemoteAccessConfigPatch = {
  enabled?: boolean
  bind?: RemoteAccessBindMode
  port?: number
}

/** Result of the host-side Tailscale probe used by the Remote panel. */
export type RemoteTailscaleInfo = {
  /** A Tailscale CLI/app was found on this host. */
  installed: boolean
  /** The tailnet is up and a 100.x IPv4 address is assigned. */
  connected: boolean
  /** Host's Tailscale IPv4 (e.g. 100.111.83.99) when connected. */
  ipv4: string | null
}

export const REMOTE_ACCESS_STATUS_CHANNEL = 'remote:status-changed'
