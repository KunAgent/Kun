import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Stats } from 'node:fs'

/** Keep integrity work bounded while still detecting edits to complete segments. */
export const USAGE_INDEX_HASH_SEGMENT_BYTES = 64 * 1024
export const USAGE_INDEX_HASH_TAIL_BYTES = 64 * 1024

export type UsageIndexHashState = {
  segments: string[]
  tailDigest: string
}

/** The fields distinguish append/truncate/replace operations without reading file data. */
export function usageIndexStatSignature(info: Stats): string {
  return [info.size, info.mtimeMs, info.ctimeMs, info.dev, info.ino].join(':')
}

export async function hashUsageIndexFile(path: string, size: number): Promise<UsageIndexHashState> {
  return hashRanges(path, segmentRanges(size), size)
}

/** Hash only the segment containing the old end and segments added after it. */
export async function appendUsageIndexHashes(
  path: string,
  previous: UsageIndexHashState,
  previousSize: number,
  size: number
): Promise<UsageIndexHashState> {
  if (size < previousSize) throw new Error('usage index shrank while appending')
  const firstSegment = Math.floor(previousSize / USAGE_INDEX_HASH_SEGMENT_BYTES)
  const segments = previous.segments.slice(0, firstSegment)
  const ranges = segmentRanges(size).slice(firstSegment)
  const refreshed = await hashRanges(path, ranges, size)
  segments.splice(firstSegment, refreshed.segments.length, ...refreshed.segments)
  return { segments, tailDigest: refreshed.tailDigest }
}

/** Verify the persisted prefix around the append boundary, not the complete index. */
export async function verifyUsageIndexTail(
  path: string,
  indexedBytes: number,
  expectedTailDigest: string
): Promise<boolean> {
  const start = Math.max(0, indexedBytes - USAGE_INDEX_HASH_TAIL_BYTES)
  const actual = await digestRange(path, start, indexedBytes)
  return actual === expectedTailDigest
}

export async function verifyUsageIndexHashes(
  path: string,
  size: number,
  expected: UsageIndexHashState
): Promise<boolean> {
  const actual = await hashUsageIndexFile(path, size)
  return actual.tailDigest === expected.tailDigest && sameStrings(actual.segments, expected.segments)
}

function segmentRanges(size: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (let start = 0; start < size; start += USAGE_INDEX_HASH_SEGMENT_BYTES) {
    ranges.push({ start, end: Math.min(size, start + USAGE_INDEX_HASH_SEGMENT_BYTES) })
  }
  return ranges
}

async function hashRanges(
  path: string,
  ranges: Array<{ start: number; end: number }>,
  size: number
): Promise<UsageIndexHashState> {
  const segments: string[] = []
  for (const range of ranges) segments.push(await digestRange(path, range.start, range.end))
  return {
    segments,
    tailDigest: await digestRange(path, Math.max(0, size - USAGE_INDEX_HASH_TAIL_BYTES), size)
  }
}

async function digestRange(path: string, start: number, end: number): Promise<string> {
  const hash = createHash('sha256')
  if (end <= start) return hash.digest('hex')
  const stream = createReadStream(path, { start, end: end - 1 })
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
