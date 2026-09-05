import { describeSqliteAbiMismatch } from './hybrid-thread-support.js'

export class HybridMemoryDegradedState {
  private reason: string | undefined

  fail(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const abi = describeSqliteAbiMismatch(message)
    this.reason = sanitizeMemoryDegradedReason(`${action}: ${message}${abi ? ` (${abi})` : ''}`)
    console.warn(`[kun] memory index ${this.reason}; using canonical filesystem fallback`)
  }

  recover(): void {
    if (this.reason) console.warn('[kun] memory index recovered; leaving filesystem fallback')
    this.reason = undefined
  }

  degradedReason(): string | undefined {
    return this.reason
  }
}

export function sanitizeMemoryDegradedReason(value: string): string {
  return value
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/giu, '$1=[redacted]')
    .replace(/file:\/\/\/?(?:[a-z]:)?[^\s"'<>]+/giu, redactLocalPath)
    .replace(/(?:\\\\\?\\)?[a-z]:\\[^\r\n"'<>|]*?\.(?:node|dll|so|dylib|sqlite3?|db)\b/giu, redactLocalPath)
    .replace(/(?:\\\\\?\\)?[a-z]:\\[^\s"'<>|,;)]*/giu, redactLocalPath)
    .replace(/\\\\(?:\?\\UNC\\)?[^\\\s]+\\[^\r\n"'<>|]*?\.(?:node|dll|so|dylib|sqlite3?|db)\b/giu, redactLocalPath)
    .replace(/\\\\(?:\?\\UNC\\)?[^\\\s]+\\[^\s"'<>|,;)]*/giu, redactLocalPath)
    .replace(/(^|[\s("'=])((?:\/(?!\/)[^/\s"'<>]+){2,})/gu, (_match, prefix: string, path: string) => (
      `${prefix}${redactLocalPath(path)}`
    ))
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 512)
}

function redactLocalPath(value: string): string {
  const normalized = value.replace(/[),.;:]+$/u, '')
  const basename = normalized.split(/[\\/]/u).filter(Boolean).at(-1)
  return basename && /\.(?:node|dll|so|dylib|sqlite3?|db)$/iu.test(basename)
    ? `[local-path]/${basename}`
    : '[local-path]'
}
