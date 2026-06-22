/**
 * Base URL resolution for the Kun local HTTP server. The
 * server is always bound to localhost; the GUI reads the port from
 * settings (default 18899).
 */
export function getKunBaseUrl(port: number, host = '127.0.0.1'): string {
  const normalizedHost = normalizeLocalKunHost(host)
  return `http://${formatHostForUrl(normalizedHost)}:${port}`
}

export function normalizeLocalKunHost(host: string): string {
  const normalized = host.trim().toLowerCase()
  if (normalized === 'localhost') return 'localhost'
  if (normalized === '127.0.0.1') return '127.0.0.1'
  if (normalized === '::1' || normalized === '[::1]') return '::1'
  throw new Error(`Kun local host must be localhost, 127.0.0.1, or ::1; got "${host}".`)
}

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}
