import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { HarnessRoute } from '../contracts/harness.js'
import { HarnessReadinessSchema, type HarnessReadiness } from '../contracts/harness-test.js'

/**
 * Display-only readiness evidence kept across Runtime restarts. Identities are
 * sha256 fingerprints, routes carry ids only and `readiness` is the check
 * summary already shown to clients, so the file holds no secrets.
 */
export type PersistedReadinessProof = {
  route: HarnessRoute
  identity: string
  command?: string
  displayExpires: number
  readiness?: HarnessReadiness
}

const PersistedProofSchema = z.object({
  route: z.object({ harnessId: z.string().min(1) }).passthrough(),
  identity: z.string().regex(/^[a-f0-9]{64}$/u),
  command: z.string().min(1).max(4_096).optional(),
  displayExpires: z.number().finite(),
  // An unreadable summary drops only itself; the proof still repaints the picker.
  readiness: HarnessReadinessSchema.optional().catch(undefined)
})
const ProofFileSchema = z.object({
  version: z.literal(1),
  proofs: z.array(z.unknown()).max(256)
})
const SAVE_DEBOUNCE_MS = 1_000

export class HarnessReadinessProofFile {
  private pending: PersistedReadinessProof[] | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<PersistedReadinessProof[]> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch {
      return []
    }
    try {
      const file = ProofFileSchema.safeParse(JSON.parse(raw))
      if (!file.success) return []
      return file.data.proofs.flatMap((entry) => {
        const parsed = PersistedProofSchema.safeParse(entry)
        return parsed.success ? [parsed.data as PersistedReadinessProof] : []
      })
    } catch {
      return []
    }
  }

  /** Debounced write; proofs change in bursts when several Agents finish checking. */
  schedule(proofs: PersistedReadinessProof[]): void {
    this.pending = proofs
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const next = this.pending
      this.pending = undefined
      if (!next) return
      this.writing = this.writing.then(() => this.write(next), () => this.write(next))
    }, SAVE_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  private async write(proofs: PersistedReadinessProof[]): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await atomicWriteFile(this.path, `${JSON.stringify({ version: 1, proofs })}\n`)
    } catch {
      // Losing the cache only costs one extra check after the next restart.
    }
  }
}
