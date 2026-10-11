export function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

export function nonnegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized >= 0 ? normalized : undefined
}
