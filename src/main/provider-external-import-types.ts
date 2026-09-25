import { createHash } from 'node:crypto'
import type { ModelEndpointFormat, ModelProviderEndpointsV1 } from '../shared/app-settings'

export type RawEntry = {
  ref: string
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  endpoints?: ModelProviderEndpointsV1
  models: string[]
  apiKey: string
  needsKey: boolean
}

/** A source record that cannot become a provider (unsupported app, no URL). */
export type SkippedEntry = {
  ref: string
  name: string
  reason: string
}

export type SourceRead = {
  entries: RawEntry[]
  skipped: SkippedEntry[]
}

export const MAX_ENTRIES = 200
export const MAX_MODELS = 200

export function isSkippedEntry(read: RawEntry | SkippedEntry): read is SkippedEntry {
  return 'reason' in read
}

export function sha256Key(key: string): string | undefined {
  const trimmed = key.trim()
  return trimmed ? createHash('sha256').update(trimmed, 'utf8').digest('hex') : undefined
}
