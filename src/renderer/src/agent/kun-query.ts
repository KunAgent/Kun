export function buildQuery(options: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
