/**
 * What to log when one of the app's local HTTP servers cannot bind its configured port. The port is a user
 * setting that other programs (a webhook sender, the schedule MCP bridge) are pointed at, so it is never moved
 * silently; the log says which setting to change instead.
 */
export function describeLocalListenError(error: unknown, port: number, setting: string): {
  message: string
  code?: string
  port: number
} {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string'
    ? (error as { code: string }).code
    : undefined
  const raw = error instanceof Error ? error.message : String(error)
  if (code === 'EADDRINUSE') {
    return {
      message: `127.0.0.1:${port} is already in use, by another Kun instance or another program. Choose a free port in ${setting}.`,
      code,
      port
    }
  }
  return { message: raw, ...(code ? { code } : {}), port }
}
