/**
 * Locating the built speech worker.
 *
 * Kept separate from the service so it can be tested without loading the
 * worker, ONNX Runtime, or Electron.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const KOKORO_WORKER_ENTRY_FILE = 'local-kokoro-worker-entry.js'

/**
 * Resolve the worker entry as seen from `fromModuleUrl`.
 *
 * The calling module is bundled either beside the entry or one level down in a
 * shared chunk directory; running from source it is under `out/main`; and a
 * packaged build serves the entry from the unpacked directory rather than the
 * archive, because the worker loader needs a real file. All of those are
 * checked instead of assuming one layout.
 */
export function resolveKokoroWorkerEntry(
  fromModuleUrl: string,
  exists: (path: string) => boolean = existsSync
): string {
  const nearby = [
    new URL(`./${KOKORO_WORKER_ENTRY_FILE}`, fromModuleUrl),
    new URL(`../${KOKORO_WORKER_ENTRY_FILE}`, fromModuleUrl),
    // Running from source, as the integration test does: the worker only
    // exists once it has been built.
    new URL(`../../../out/main/${KOKORO_WORKER_ENTRY_FILE}`, fromModuleUrl)
  ]
  const candidates = [
    ...nearby.map((url) => new URL(url.href.replace('/app.asar/', '/app.asar.unpacked/'))),
    ...nearby
  ]
  for (const candidate of candidates) {
    if (exists(fileURLToPath(candidate))) return candidate.href
  }
  throw new Error(
    `Kokoro speech worker is missing; looked for ${KOKORO_WORKER_ENTRY_FILE} near ${fromModuleUrl}`
  )
}
