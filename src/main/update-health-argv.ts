export const UPDATE_HEALTH_PATH_ARG = '--kun-update-health-check='
export const UPDATE_HEALTH_TOKEN_ARG = '--kun-update-health-token='
export const UPDATE_HEALTH_TARGET_ARG = '--kun-update-target='

export function updateHealthCheckRequested(argv = process.argv): boolean {
  return argv.some((value) => value.includes(UPDATE_HEALTH_PATH_ARG))
}

export function updateHealthArgumentValue(
  prefix: string,
  argv = process.argv
): string {
  for (const argument of argv) {
    const offset = argument.indexOf(prefix)
    if (offset < 0) continue
    const remainder = argument.slice(offset + prefix.length).trimStart()
    if (!remainder) return ''
    const quote = remainder[0] === '"' || remainder[0] === "'" ? remainder[0] : ''
    if (quote) {
      const end = remainder.indexOf(quote, 1)
      return (end < 0 ? remainder.slice(1) : remainder.slice(1, end)).trim()
    }
    const nextFlag = remainder.search(/\s+--[A-Za-z0-9-]+=/u)
    return (nextFlag < 0 ? remainder : remainder.slice(0, nextFlag)).trim()
  }
  return ''
}
