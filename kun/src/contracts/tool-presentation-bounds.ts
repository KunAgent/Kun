import type { ToolPresentation, ToolPresentationDiff } from './tool-presentation.js'

export const TOOL_PRESENTATION_MAX_BYTES = 256 * 1024
export const TOOL_PRESENTATION_MAX_TEXT = 64 * 1024
export const TOOL_PRESENTATION_MAX_ENTRIES = 200

/** The whole display document has one budget, including derived semantic fields. */
export function boundToolPresentation<T extends object>(value: T): T & { truncated?: boolean } {
  // Reserve room for the truncation marker and JSON framing.
  let remaining = TOOL_PRESENTATION_MAX_BYTES - 1_024
  let truncated = false
  const ancestors = new Set<object>()
  const encoder = new TextEncoder()
  const visit = (candidate: unknown, key = '', depth = 0): unknown => {
    if (candidate === undefined) return undefined
    if (remaining < 16 || depth > 10) { truncated = true; return undefined }
    if (typeof candidate === 'string') {
      const binary = ['data', 'blob', 'path', 'filePath', 'url', 'uri', 'patch'].includes(key)
      const maximum = binary ? remaining - 4 : Math.min(TOOL_PRESENTATION_MAX_TEXT, remaining - 4)
      if (binary && candidate.length > maximum) { truncated = true; return undefined }
      let result = candidate.slice(0, maximum)
      let bytes = encoder.encode(JSON.stringify(result)).byteLength
      while (bytes > remaining && result.length > 0) {
        result = result.slice(0, Math.max(0, Math.floor(result.length * (remaining - 4) / bytes)))
        bytes = encoder.encode(JSON.stringify(result)).byteLength
      }
      if (result.length !== candidate.length) {
        truncated = true
        if (binary) return undefined
      }
      remaining -= bytes
      return result
    }
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') {
      remaining -= String(candidate).length + 1
      return candidate
    }
    if (typeof candidate !== 'object' || ancestors.has(candidate)) { truncated = true; return undefined }
    ancestors.add(candidate)
    remaining -= 2
    let result: unknown
    if (Array.isArray(candidate)) {
      const entries: unknown[] = []
      if (candidate.length > TOOL_PRESENTATION_MAX_ENTRIES) truncated = true
      for (const entry of candidate.slice(0, TOOL_PRESENTATION_MAX_ENTRIES)) {
        if (key === 'diffs') {
          const diff = entry as Partial<ToolPresentationDiff> | null
          if (!diff || typeof diff !== 'object' || typeof diff.path !== 'string' || typeof diff.newText !== 'string' ||
            (diff.oldText !== null && typeof diff.oldText !== 'string')) { truncated = true; continue }
          if (diff.path.length + diff.newText.length + (diff.oldText?.length ?? 0) > remaining) { truncated = true; continue }
          const whole = { path: diff.path, oldText: diff.oldText, newText: diff.newText }
          const bytes = encoder.encode(JSON.stringify(whole)).byteLength + 1
          if (bytes > remaining) { truncated = true; continue }
          remaining -= bytes
          entries.push(whole)
          continue
        }
        const before = remaining
        const child = visit(entry, '', depth + 1)
        const record = child && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : undefined
        if ((key === 'terminals' && (!record || typeof record.terminalId !== 'string' || typeof record.output !== 'string')) ||
          (key === 'locations' && (!record || typeof record.path !== 'string')) ||
          (key === 'content' && (!record || typeof record.type !== 'string'))) {
          remaining = before; truncated = true; continue
        }
        if (key === 'terminals' && record && typeof entry === 'object' && entry &&
          record.output !== (entry as Record<string, unknown>).output) {
          record.truncated = true
          remaining -= 18
        }
        if (child !== undefined && remaining >= 1) entries.push(child)
        else if (child !== undefined) { remaining = before; truncated = true }
        remaining -= 1
      }
      result = entries
    } else {
      const record: Record<string, unknown> = {}
      for (const [name, entry] of Object.entries(candidate)) {
        if (entry === undefined) continue
        const overhead = encoder.encode(JSON.stringify(name)).byteLength + 2
        if (remaining < overhead + 16) { truncated = true; break }
        remaining -= overhead
        const child = visit(entry, name, depth + 1)
        if (child !== undefined) record[name] = child
        else if ((name === 'data' || name === 'blob') && typeof entry === 'string') {
          record.omitted = true
        }
      }
      result = record
    }
    ancestors.delete(candidate)
    return result
  }
  const result = visit(value) as T & { truncated?: boolean }
  for (const key of ['input', 'output']) {
    if (Object.prototype.hasOwnProperty.call(value, key) &&
      (value as Record<string, unknown>)[key] !== undefined &&
      (result as Record<string, unknown>)[key] === undefined) {
      Object.assign(result, { [key]: { omitted: true, truncated: true } })
    }
  }
  if (truncated) result.truncated = true
  return result
}

/** Identity and all targets precede potentially large input/output payloads. */
export function boundCompleteToolPresentation(value: ToolPresentation): ToolPresentation {
  const { version, kind, state, canCancel, source, title, name, server, locations,
    filePath, line, command, cwd, query, url, statusCode, offset, limit,
    startedAt, finishedAt, durationMs, input, output, ...rest } = value
  return boundToolPresentation({ version, kind, state, canCancel, source, title, name, server,
    locations, filePath, line, command, cwd, query, url, statusCode, offset, limit,
    startedAt, finishedAt, durationMs, input, output, ...rest })
}
