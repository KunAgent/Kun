import { withManagerDataMutex } from '../manager/data-mutex.js'
import { protectLegacyRegistryHeaders, retireLegacyHeaderJournal } from './provider-legacy-header-migration.js'
import { randomUUID } from 'node:crypto'
import { CustomHeadersSchema } from '../contracts/custom-headers.js'
import { type ModelConnectionRegistry, type StoredProfile, emptyDocument,
  appendCredentialRefs, credentialReferenceIsLive } from './model-connection-registry-core.js'

export type PreparedProviderHeaders = { reference?: string; names: string[]; retired: Set<string> }

/** Journal the encrypted orphan before writing it; a dead writer can be safely collected. */
export async function prepareProviderHeaders(registry: ModelConnectionRegistry,
  headers: Record<string, string> | undefined): Promise<PreparedProviderHeaders | undefined> {
  if (headers === undefined) return undefined
  const parsed = CustomHeadersSchema.parse(headers)
  const names = Object.keys(parsed)
  if (!names.length) return { names, retired: new Set() }
  const reference = `cred_headers-${randomUUID()}`
  const prepared: PreparedProviderHeaders = { reference, names, retired: new Set() }
  await registry['file'].update(emptyDocument, (current) => ({ ...current,
    credentialRefCleanup: appendCredentialRefs(current.credentialRefCleanup, Date.now(), reference,
      registry['registryInstanceId'], process.pid) }))
  try { await registry['options'].credentials.set(reference, { apiKey: JSON.stringify(parsed) }) }
  catch (error) { await settleProviderHeaders(registry, prepared); throw error }
  return prepared
}

export function providerHeadersPatch(previous: Pick<StoredProfile, 'customHeadersRef'> | undefined,
  prepared: PreparedProviderHeaders | undefined): Partial<StoredProfile> {
  if (!prepared) return {}
  if (previous?.customHeadersRef) prepared.retired.add(previous.customHeadersRef)
  return { customHeaders: undefined, customHeadersRef: prepared.reference, customHeaderNames: prepared.names }
}

export async function settleProviderHeaders(registry: ModelConnectionRegistry,
  prepared: PreparedProviderHeaders | undefined): Promise<void> {
  if (!prepared) return
  try {
    await registry['file'].update(emptyDocument, (current) => {
      const cleanup = { ...current.credentialRefCleanup }
      for (const reference of [...prepared.retired, ...(prepared.reference ? [prepared.reference] : [])]) {
        if (credentialReferenceIsLive(current, reference)) { delete cleanup[reference]; continue }
        cleanup[reference] = { reference, enqueuedAt: Date.now() }
      }
      return { ...current, credentialRefCleanup: cleanup }
    })
    await registry['drainCredentialRefCleanup']()
  } catch { /* Keep the durable orphan journal for recovery. */ }
}

export async function readProviderHeaders(registry: ModelConnectionRegistry, profile: StoredProfile): Promise<Record<string, string>> {
  if (!profile.customHeadersRef) return { ...(profile.customHeaders ?? {}) }
  const stored = await registry['options'].credentials.get(profile.customHeadersRef)
  if (!stored?.apiKey) throw new Error('Provider request headers are unavailable; replace the connection headers')
  try { return CustomHeadersSchema.parse(JSON.parse(stored.apiKey)) }
  catch { throw new Error('Provider request headers are unreadable; replace the connection headers') }
}

export async function migrateProviderHeaders(registry: ModelConnectionRegistry): Promise<void> {
  await withManagerDataMutex(`provider-header-migration:${registry['options'].dataDir}`, async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const document = await registry['file'].read(emptyDocument)
      if (!Object.values(document.profiles).some((profile) => profile.headers !== undefined || profile.customHeaders !== undefined)) {
        await retireLegacyHeaderJournal(registry['options'].dataDir, registry['file'], emptyDocument)
        return
      }
      // A separate secret-free journal protects existing v2 too; no prepared-ref write republishes raw headers.
      const protectedDocument = await protectLegacyRegistryHeaders(registry['options'].dataDir, document, registry['options'].credentials)
      let applied = false
      await registry['file'].update(emptyDocument, (current) => {
        if (current.revision !== document.revision || JSON.stringify(current.profiles) !== JSON.stringify(document.profiles)) return current
        applied = true
        return { ...current, profiles: protectedDocument.profiles, credentialRefCleanup: { ...current.credentialRefCleanup,
          ...Object.fromEntries(Object.entries(protectedDocument.credentialRefCleanup).filter(([reference]) => !document.credentialRefCleanup[reference])) }, revision: current.revision + 1 }
      })
      if (applied) {
        await retireLegacyHeaderJournal(registry['options'].dataDir, registry['file'], emptyDocument)
        return
      }
    }
    throw new Error('Provider headers changed during protected migration; retry after configuration edits finish')
  })
}

export async function readProviderGeneratedHeaders(registry: ModelConnectionRegistry, profile: StoredProfile): Promise<Record<string, string>> {
  if (!profile.headersRef) return { ...(profile.headers ?? {}) }
  const stored = await registry['options'].credentials.get(profile.headersRef)
  if (!stored?.apiKey) throw new Error('Provider adapter headers are unavailable; reauthenticate this account')
  try { return CustomHeadersSchema.parse(JSON.parse(stored.apiKey)) }
  catch { throw new Error('Provider adapter headers are unreadable; reauthenticate this account') }
}
