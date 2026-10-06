import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { CustomHeadersSchema } from '../contracts/custom-headers.js'
import type { RegistryDocument } from './model-connection-registry-core.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'

const Journal = z.object({ schemaVersion: z.literal(1), headers: z.record(z.string(), z.string()) }).strict()
const empty = () => ({ schemaVersion: 1 as const, headers: {} as Record<string, string> })

/** A crash-recoverable secret journal precedes publication; v2 never receives v1's plaintext header values. */
export async function protectLegacyRegistryHeaders(dataDir: string, document: RegistryDocument,
  credentials: Pick<ExtensionCredentialStore, 'set'>): Promise<RegistryDocument> {
  const next = structuredClone(document)
  const journal = new AtomicJsonFile(join(dataDir, 'provider-header-migration.v1.json'), (value) => Journal.parse(value), false)
  for (const profile of Object.values(next.profiles)) {
    if (profile.customHeaders === undefined) continue
    const headers = CustomHeadersSchema.parse(profile.customHeaders)
    delete profile.customHeaders
    const names = Object.keys(headers)
    if (!names.length) continue
    const value = JSON.stringify(headers)
    const digest = createHash('sha256').update(`${profile.id}\0${value}`).digest('hex')
    const prepared = await journal.update(empty, (state) => ({ ...state,
      headers: { ...state.headers, [digest]: state.headers[digest] ?? `cred_headers-${randomUUID()}` } }))
    const reference = prepared.headers[digest]!
    await credentials.set(reference, { apiKey: value })
    profile.customHeadersRef = reference; profile.customHeaderNames = names
  }
  return next
}

/** Preserve orphan references in the Registry's existing recovery queue before retiring the journal. */
export async function retireLegacyHeaderJournal(dataDir: string, file: AtomicJsonFile<RegistryDocument>,
  fallback: () => RegistryDocument): Promise<void> {
  const journal = new AtomicJsonFile(join(dataDir, 'provider-header-migration.v1.json'), (value) => Journal.parse(value), false)
  const prepared = await journal.read(empty)
  const references = Object.values(prepared.headers)
  if (!references.length) return
  await file.update(fallback, (document) => {
    const live = new Set(Object.values(document.profiles).map((profile) => profile.customHeadersRef))
    for (const reference of references) if (!live.has(reference)) {
      document.credentialRefCleanup[reference] = { reference, enqueuedAt: Date.now() }
    }
    return document
  })
  await journal.delete()
}
