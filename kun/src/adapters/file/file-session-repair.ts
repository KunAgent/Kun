import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

export const LEGACY_REPAIR_DISK_RESERVE_BYTES = 512 * 1024 * 1024

export async function assertLegacyRepairDiskSpace(
  sourcePath: string,
  sourceBytes: number
): Promise<void> {
  const volume = await statfs(dirname(sourcePath))
  const availableBytes = Number(volume.bavail) * Number(volume.bsize)
  const requiredBytes = sourceBytes + LEGACY_REPAIR_DISK_RESERVE_BYTES
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
    throw new Error(
      `legacy history repair requires ${requiredBytes} free bytes; ${availableBytes} available`
    )
  }
}

export function shouldRepairLegacyHistory(input: {
  sourceBytes: number
  canonicalBytes: number
  rawCount: number
  uniqueCount: number
  minimumBytes: number
}): boolean {
  return input.rawCount > Math.max(1, input.uniqueCount) * 4 || (
    input.sourceBytes >= input.minimumBytes &&
    input.sourceBytes > Math.max(1, input.canonicalBytes) * 4
  )
}
