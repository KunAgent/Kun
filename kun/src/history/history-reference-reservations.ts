import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { managerAtomicJsonConfig } from '../extensions/atomic-json.js'

const KeySchema = z.string().regex(/^[a-f0-9]{64}$/u)

/** Names only; the Manager remains the physical owner of canonical JSON files. */
export async function listHistoryReservationKeys(dataDir: string): Promise<string[]> {
  const directory = join(resolve(dataDir), 'history-references', 'requests')
  const manager = managerAtomicJsonConfig(join(directory, 'lookup.json'))
  if (manager) {
    const response = await fetch(`${manager.baseUrl}/v1/data/history-reference-reservations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${manager.token}` },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`History reservation lookup failed: ${response.status}`)
    return z.object({ keys: KeySchema.array() }).strict().parse(await response.json()).keys
  }
  return readHistoryReservationKeys(dataDir)
}

/** Called only by the Manager or by stores with no configured Manager. */
export async function readHistoryReservationKeys(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(resolve(dataDir), 'history-references', 'requests'), {
      withFileTypes: true
    })
    return entries.filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
