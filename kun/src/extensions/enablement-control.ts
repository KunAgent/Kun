import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ExtensionRegistryEntry } from './types.js'
export const EnablementProofSchema = z.object({ requestId: z.string().regex(/^mobile-[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), enabled: z.boolean(), revision: z.string().regex(/^plugin-v1:[a-f0-9]{64}$/) }).strict()
export type EnablementProof = z.infer<typeof EnablementProofSchema>
export type EnablementControl = { requestId: string; fingerprint: string; expectedRevision: string }
/** Only a pure precheck rejection is definitive; a lifecycle callback may already have stopped work. */
export class EnablementRejected extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'REVISION_CONFLICT' | 'INVALID_REQUEST', readonly definitive = true) { super(code) }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
export function enablementBusiness(entry: ExtensionRegistryEntry) {
  const { enablementProofs: _proofs, controlRevision: _revision, ...business } = entry
  return JSON.stringify(canonical(business))
}
export function pluginRevision(entry: ExtensionRegistryEntry) {
  return 'plugin-v1:' + createHash('sha256').update(enablementBusiness(entry)).update(':' + (entry.controlRevision ?? 0)).digest('hex')
}
export function enablementProof(entry: ExtensionRegistryEntry, control: EnablementControl, enabled: boolean) {
  const proof = entry.enablementProofs?.find((item) => item.requestId === control.requestId)
  if (proof && (proof.fingerprint !== control.fingerprint || proof.enabled !== enabled)) throw new EnablementRejected('INVALID_REQUEST')
  return proof
}
export function checkEnablement(entry: ExtensionRegistryEntry | undefined, control: EnablementControl, enabled: boolean) {
  if (!entry) throw new EnablementRejected('NOT_FOUND')
  if (enablementProof(entry, control, enabled)) return
  if (pluginRevision(entry) !== control.expectedRevision) throw new EnablementRejected('REVISION_CONFLICT')
}
export function validateEnablementMetadata(entry: unknown) {
  const value = entry as ExtensionRegistryEntry
  if (value.controlRevision !== undefined && (!Number.isSafeInteger(value.controlRevision) || value.controlRevision < 0)) throw new Error('EXTENSION_REGISTRY_INVALID')
  if (value.enablementProofs !== undefined) z.array(EnablementProofSchema).max(64).parse(value.enablementProofs)
}
