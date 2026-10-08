/**
 * Antigravity readiness: `agy models` lists the signed-in account's models
 * without sending a prompt. agy 1.3 starts a language server (~4 s), fetches
 * the catalog, then waits for that server's shutdown (up to ~5 s more), so a
 * healthy run takes 7-13 s and more on a busy machine. The list comes from
 * stdout lines `<id>\t<display name>`.
 */
import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import { redactApprovalSensitiveText } from '../domain/approval.js'
import type { SpawnCaptured } from './harness-detector.js'

export const AGY_MODELS_TIMEOUT_MS = 30_000
const MODEL_ID = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+$/i

/** Model ids from `agy models`; the first column when the output is tabular. */
export function agyModelIds(stdout: string): string[] {
  const rows = stdout.split('\n').map((line) => line.split('\t')[0]!.trim()).filter((id) => MODEL_ID.test(id))
  if (rows.length) return [...new Set(rows)]
  return [...new Set(stdout.match(/\b[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+\b/gi) ?? [])]
}

type Result = Awaited<ReturnType<SpawnCaptured>>

export function agyModelsHandshake(result: Result, timeoutMs = AGY_MODELS_TIMEOUT_MS): Omit<HarnessTestHandshake, 'durationMs'> {
  const models = agyModelIds(result.stdout)
  // A complete list printed before agy finished its own shutdown still counts.
  const ok = models.length > 0 && (result.exitCode === 0 || result.timedOut)
  const stderr = redactApprovalSensitiveText(result.stderr).replace(/\s+/g, ' ').trim().slice(-240)
  const detail = ok ? 'Local agy models check; no model prompt sent'
    : result.timedOut
      ? `agy models did not finish within ${Math.round(timeoutMs / 1000)}s. Run \`agy models\` in a terminal: it should list your models; if it waits, check sign-in and network or proxy access.`
      : result.exitCode !== 0
        ? `agy models exited with code ${result.exitCode ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`
        : 'agy models listed no models. Sign in with agy (or check your plan), then check again.'
  return { ok, supported: true, models, protocol: 'antigravity-models', detail }
}
