export function usageRequestError(
  label: string,
  status: number,
  body: string
): Error {
  const fallback = `${label} request failed: ${status}`
  if (!body.trim()) return new Error(fallback)
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown }
    const code = typeof parsed.code === 'string' ? parsed.code.trim() : ''
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
    if (code && message) return new Error(`${fallback} (${code}: ${message})`)
    if (code) return new Error(`${fallback} (${code})`)
    if (message) return new Error(`${fallback} (${message})`)
  } catch {
    // Preserve the stable status-only fallback for non-JSON error bodies.
  }
  return new Error(fallback)
}

export function parseUsageResponse<T>(body: string, label: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(`${label} response was not valid JSON`)
  }
}
