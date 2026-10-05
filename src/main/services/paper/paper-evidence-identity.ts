import { randomUUID } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { z } from 'zod'
import { paperCiteKey } from '../../../shared/paper/paper-bibtex'
import type { PaperUnitMetaV2 } from '../../../shared/paper/paper-meta-v2'
import { canonicalPath, resolveTargetPathWithinWorkspace } from '../workspace-paths'
import { PaperEvidenceError } from './paper-evidence-store'

export const PAPER_EVIDENCE_IDENTITY_FILE = '.kun-paper-identity.json'
const schema = z.object({ version: z.literal(1), localId: z.string().uuid(), citeKey: z.string().min(1).max(300) }).strict()
type Identity = z.infer<typeof schema>
const pending = new Map<string, Promise<Identity>>()

async function readIdentity(path: string): Promise<Identity | null> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try { return schema.parse(JSON.parse(text)) } catch {
    throw new PaperEvidenceError('corrupt-identity', 'The paper identity file is malformed. It has not been overwritten.')
  }
}

/** Created on first evidence use, carried with the unit, and never regenerated from edited metadata. */
export async function ensurePaperEvidenceIdentity(unitDirAbs: string, meta: PaperUnitMetaV2, declaredKey?: string): Promise<Identity> {
  const root = await canonicalPath(unitDirAbs)
  const existingOperation = pending.get(root)
  if (existingOperation) return existingOperation
  const operation = (async () => {
    const path = await resolveTargetPathWithinWorkspace(PAPER_EVIDENCE_IDENTITY_FILE, root)
    const existing = await readIdentity(path)
    if (existing) return existing
    const localId = randomUUID()
    const identity = schema.parse({ version: 1, localId,
      citeKey: declaredKey || `${paperCiteKey(meta, new Set())}-${localId.slice(0, 8)}` })
    // Exclusive creation preserves a concurrently established identity. A crash
    // during this small write surfaces corruption rather than inventing a new ID.
    let handle
    try { handle = await open(path, 'wx', 0o600) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const winner = await readIdentity(path)
      if (!winner) throw new PaperEvidenceError('identity-conflict', 'Paper identity changed during creation. Retry.')
      return winner
    }
    try { await handle.writeFile(`${JSON.stringify(identity, null, 2)}\n`); await handle.sync() }
    finally { await handle.close() }
    return identity
  })()
  pending.set(root, operation)
  try { return await operation } finally { if (pending.get(root) === operation) pending.delete(root) }
}
