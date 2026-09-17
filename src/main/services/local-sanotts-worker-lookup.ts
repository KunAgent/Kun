/**
 * Locating the built speech worker.
 *
 * Kept separate from the service so it can be tested without loading the
 * worker, WASM, or Electron.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SANOTTS_WORKER_ENTRY_FILE = 'local-sanotts-worker-entry.js'

/**
 * Resolve the worker entry as seen from `fromModuleUrl`.
 *
 * The calling module is bundled either beside the entry or one level down in a
 * shared chunk directory; running from source it is under `out/main`; and a
 * packaged build serves the entry from the unpacked directory rather than the
 * archive, because the worker loader needs a real file. All of those are
 * checked instead of assuming one layout.
 */
export function resolveSanottsWorkerEntry(
  fromModuleUrl: string,
  exists: (path: string) => boolean = existsSync
): string {
  const nearby = [
    new URL(`./${SANOTTS_WORKER_ENTRY_FILE}`, fromModuleUrl),
    new URL(`../${SANOTTS_WORKER_ENTRY_FILE}`, fromModuleUrl),
    new URL(`../../../out/main/${SANOTTS_WORKER_ENTRY_FILE}`, fromModuleUrl)
  ]
  const candidates = [
    ...nearby.map((url) => new URL(url.href.replace('/app.asar/', '/app.asar.unpacked/'))),
    ...nearby
  ]
  for (const candidate of candidates) {
    if (exists(fileURLToPath(candidate))) return candidate.href
  }
  throw new Error(
    `sanoTTS speech worker is missing; looked for ${SANOTTS_WORKER_ENTRY_FILE} near ${fromModuleUrl}`
  )
}
