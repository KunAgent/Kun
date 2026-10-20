import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AnalyticsEvent, ANALYTICS_LIMITS } from '../../shared/product-analytics'
import { settingsReadCandidates } from '../settings-file-paths'

export type Installation = 'existing' | 'fresh' | 'unknown'
let installation: Installation = 'unknown'
/** Call before migrations/default settings create files. Read errors are never evidence of a fresh install. */
export async function detectAnalyticsInstallation(userData: string, runtimeDir: string): Promise<void> {
  try {
    for (const path of [...settingsReadCandidates(userData), runtimeDir,
      join(userData, 'kun-account'), join(userData, 'Local Storage')]) {
      try { await access(path); installation = 'existing'; return }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    installation = 'fresh'
  } catch { installation = 'unknown' }
}
export const AnalyticsDiskState = z.object({
  version: z.literal(1), enabled: z.boolean(), installation: z.enum(['existing', 'fresh', 'unknown']),
  installationId: z.string().uuid().nullable(), epoch: z.string().uuid(), actor: z.string().nullable(),
  pendingRuntimeClear: z.string().uuid().nullable().default(null),
  events: z.array(AnalyticsEvent).max(1000)
}).strict()
export type AnalyticsDiskState = z.infer<typeof AnalyticsDiskState>
export function emptyAnalyticsState(): AnalyticsDiskState {
  return { version: 1, enabled: false, installation, installationId: null, epoch: randomUUID(), actor: null, pendingRuntimeClear: null, events: [] }
}
export interface AnalyticsStorage { read(): Promise<AnalyticsDiskState>; write(state: AnalyticsDiskState): Promise<void> }
export function analyticsStorage(path: string): AnalyticsStorage {
  return {
    async read() {
      try {
        const raw = await readFile(path, 'utf8')
        if (Buffer.byteLength(raw) > ANALYTICS_LIMITS.bytes) return emptyAnalyticsState()
        return AnalyticsDiskState.parse(JSON.parse(raw))
      } catch { return emptyAnalyticsState() }
    },
    async write(state) {
      const text = JSON.stringify(state)
      if (Buffer.byteLength(text) > ANALYTICS_LIMITS.bytes) throw new Error('analytics_queue_limit')
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temp = path + '.' + randomUUID()
      await writeFile(temp, text, { mode: 0o600 }); await rename(temp, path)
    }
  }
}
