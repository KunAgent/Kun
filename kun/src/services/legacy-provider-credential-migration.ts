import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  codexCliRequestHeaders,
  codexCliUserAgent,
  grokCliProxyHeaders
} from '../adapters/model/provider-cli-identity.js'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'
import type { ExtensionProviderAccountStore } from './extension-provider-account-store.js'
import {
  GeminiCodeAssistCredentialSchema,
  type GeminiCodeAssistCredential
} from '../contracts/gemini-code-assist.js'

export { codexCliUserAgent }

const MigrationRollbackSchema = z.object({
  accountId: z.string().min(1),
  credentialRef: z.string().min(1),
  salt: z.string().min(1),
  secretDigest: z.string().min(1),
  migratedAt: z.string(),
  settingsCommittedAt: z.string().optional(),
  modelId: z.string().optional()
})

const MigrationEntrySchema = z.object({
  sourceId: z.string().min(1),
  providerId: z.string().min(1),
  accountId: z.string().min(1),
  salt: z.string().min(1),
  secretDigest: z.string().min(1),
  migratedAt: z.string(),
  modelId: z.string().optional(),
  phase: z.enum(['secure-committed', 'settings-committed']).default('secure-committed'),
  settingsCommittedAt: z.string().optional(),
  pendingAccountCreated: z.boolean().optional(),
  rollback: MigrationRollbackSchema.optional()
})
type MigrationEntry = z.infer<typeof MigrationEntrySchema>

const MigrationDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.record(z.string(), MigrationEntrySchema)
})
type MigrationDocument = z.infer<typeof MigrationDocumentSchema>

export type LegacyProviderCredentialSource = {
  sourceId: string
  providerId: string
  providerName: string
  label: string
  apiKey: string
  modelId?: string
}

export type LegacyProviderCredentialMigration = {
  sourceId: string
  providerId: string
  accountId: string
  modelId?: string
  removePlaintext: true
  reused: boolean
  /** A committed secure value won over plaintext restored from an old backup. */
  ignoredStalePlaintext: boolean
  settingsCommitted: boolean
}

export type LegacyProviderCredentialBinding = {
  sourceId: string
  providerId: string
  accountId: string
  modelId?: string
  phase: 'secure-committed' | 'settings-committed'
  migratedAt: string
  settingsCommittedAt?: string
}

export type LegacyProviderCredentialMaterial = {
  apiKey: string
  headers?: Record<string, string>
  geminiAuth?: GeminiCodeAssistCredential
}

/** Reconstructs credential-derived request material without persisting it. */
export function materializeLegacyProviderCredential(rawApiKey: string): LegacyProviderCredentialMaterial {
  const apiKey = rawApiKey.trim()
  if (!apiKey.startsWith('{')) return { apiKey }
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : ''
    if (parsed.kind === 'codex-oauth') {
      const accountId = typeof parsed.accountId === 'string' ? parsed.accountId.trim() : ''
      if (!accessToken || !accountId) return { apiKey }
      return {
        apiKey: accessToken,
        headers: codexCliRequestHeaders({
          accountId,
          sessionId: randomUUID()
        })
      }
    }
    if (parsed.kind === 'grok-oauth') {
      if (!accessToken) return { apiKey }
      return {
        apiKey: accessToken,
        headers: grokCliProxyHeaders()
      }
    }
    if (parsed.kind === 'gemini-oauth') {
      const credential = GeminiCodeAssistCredentialSchema.safeParse(parsed)
      if (!credential.success) return { apiKey }
      return {
        apiKey: credential.data.accessToken,
        geminiAuth: credential.data
      }
    }
    return { apiKey }
  } catch {
    return { apiKey }
  }
}

/**
 * Secret-first migration coordinator.
 *
 * `migrate` commits the credential, account and account-reference binding but
 * deliberately leaves the binding in `secure-committed`. The owner of the
 * ordinary settings file must atomically remove plaintext and then call
 * `markSettingsCommitted`. If that write fails it calls `rollbackPending`, so
 * the old readable settings and the previously committed credential remain
 * authoritative. A crash between either step is recoverable from the phase
 * and rollback metadata, which contain opaque references and salted digests
 * only.
 */
export class LegacyProviderCredentialMigrationService {
  private readonly markers: AtomicJsonFile<MigrationDocument>
  private readonly nowIso: () => string

  constructor(private readonly options: {
    dataDir: string
    accounts: ExtensionProviderAccountStore
    credentials: ExtensionCredentialStore
    nowIso?: () => string
  }) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.markers = new AtomicJsonFile(
      join(options.dataDir, 'extensions', 'legacy-credential-migrations.json'),
      (value) => MigrationDocumentSchema.parse(value)
    )
  }

  async migrate(
    sources: readonly LegacyProviderCredentialSource[],
    options: { replaceCommitted?: boolean } = {}
  ): Promise<LegacyProviderCredentialMigration[]> {
    const results: LegacyProviderCredentialMigration[] = []
    try {
      for (const source of sources) {
        const apiKey = source.apiKey.trim()
        if (!apiKey) continue
        if (!source.sourceId.trim() || !source.providerId.trim()) {
          throw new Error('legacy credential source identity is required')
        }
        results.push(await this.migrateOne(source, apiKey, options.replaceCommitted === true))
      }
      return results
    } catch (error) {
      await this.rollbackPending(results.map((entry) => entry.sourceId)).catch(() => undefined)
      throw error
    }
  }

  async listBindings(): Promise<LegacyProviderCredentialBinding[]> {
    const document = await this.markers.read(emptyDocument)
    return Object.values(document.entries)
      .map((entry) => ({
        sourceId: entry.sourceId,
        providerId: entry.providerId,
        accountId: entry.accountId,
        ...(entry.modelId ? { modelId: entry.modelId } : {}),
        phase: entry.phase,
        migratedAt: entry.migratedAt,
        ...(entry.settingsCommittedAt ? { settingsCommittedAt: entry.settingsCommittedAt } : {})
      }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  }

  async resolveApiKey(
    sourceId: string,
    options: { includeUnavailable?: boolean } = {}
  ): Promise<{ providerId: string; accountId: string; modelId?: string; apiKey: string } | null> {
    const entry = (await this.markers.read(emptyDocument)).entries[sourceId]
    if (!entry) return null
    const account = await this.options.accounts.getAccount(entry.accountId)
    if (!account || account.providerId !== entry.providerId) return null
    if (account.status !== 'connected' && !(options.includeUnavailable && account.status === 'unavailable')) {
      return null
    }
    const credential = await this.options.credentials.get(account.credentialRef)
    const apiKey = credential?.apiKey?.trim() ?? ''
    if (!apiKey) return null
    return {
      providerId: entry.providerId,
      accountId: entry.accountId,
      ...(entry.modelId ? { modelId: entry.modelId } : {}),
      apiKey
    }
  }

  /**
   * Replaces the protected value behind an existing source binding without
   * changing its account or ordinary-settings migration marker. OAuth refresh
   * uses this path so a stale in-memory settings snapshot still matches the
   * marker and cannot overwrite the newly rotated token on the next save.
   */
  async updateResolvedApiKey(
    sourceId: string,
    expectedApiKey: string,
    apiKey: string
  ): Promise<boolean> {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('updated provider credential is empty')
    const entry = (await this.markers.read(emptyDocument)).entries[sourceId]
    if (!entry) return false
    const account = await this.options.accounts.getAccount(entry.accountId)
    if (!account || account.providerId !== entry.providerId || account.status !== 'connected') {
      return false
    }
    return this.options.credentials.compareAndSetApiKey(
      account.credentialRef,
      expectedApiKey,
      trimmed
    )
  }

  async markSettingsCommitted(sourceIds: readonly string[]): Promise<void> {
    const uniqueIds = [...new Set(sourceIds.map((value) => value.trim()).filter(Boolean))]
    if (uniqueIds.length === 0) return
    const obsoleteCredentials: string[] = []
    await this.markers.update(emptyDocument, (document) => {
      let changed = false
      const entries = { ...document.entries }
      for (const sourceId of uniqueIds) {
        const entry = entries[sourceId]
        if (!entry || entry.phase === 'settings-committed') continue
        if (entry.rollback) obsoleteCredentials.push(entry.rollback.credentialRef)
        entries[sourceId] = {
          ...entry,
          phase: 'settings-committed',
          settingsCommittedAt: this.nowIso(),
          rollback: undefined
        }
        changed = true
      }
      return changed
        ? { ...document, revision: document.revision + 1, entries }
        : document
    })
    for (const reference of obsoleteCredentials) {
      await this.options.credentials.delete(reference).catch(() => undefined)
    }
  }

  async rollbackPending(sourceIds: readonly string[]): Promise<void> {
    for (const sourceId of [...new Set(sourceIds.map((value) => value.trim()).filter(Boolean))]) {
      await this.rollbackOne(sourceId)
    }
  }

  /**
   * Permanently drop migration markers for sources whose plaintext was
   * intentionally cleared (for example OAuth disconnect). Unlike
   * {@link rollbackPending}, this works for both `secure-committed` and
   * `settings-committed` phases so a later hydrate cannot resurrect the key.
   */
  async forgetSources(sourceIds: readonly string[]): Promise<void> {
    for (const sourceId of [...new Set(sourceIds.map((value) => value.trim()).filter(Boolean))]) {
      await this.forgetOne(sourceId)
    }
  }

  /** Remove one compatibility binding and the protected credential it owns. */
  async remove(sourceId: string): Promise<boolean> {
    const normalized = sourceId.trim()
    if (!normalized) return false
    const document = await this.markers.read(emptyDocument)
    if (!document.entries[normalized]) return false
    await this.forgetOne(normalized)
    return true
  }

  private async migrateOne(
    source: LegacyProviderCredentialSource,
    apiKey: string,
    replaceCommitted: boolean
  ): Promise<LegacyProviderCredentialMigration> {
    await this.options.accounts.upsertCoreProvider({
      id: source.providerId,
      displayName: source.providerName,
      description: 'Migrated built-in model provider account.'
    })
    let document = await this.markers.read(emptyDocument)
    let marker = document.entries[source.sourceId]

    // A stable source id (the runtime override) follows the active provider.
    // Its old account belongs to the previous provider and cannot be bound to
    // the new one, so drop that marker and migrate under the new provider.
    if (marker && marker.providerId !== source.providerId) {
      await this.forgetOne(source.sourceId)
      document = await this.markers.read(emptyDocument)
      marker = document.entries[source.sourceId]
    }

    if (marker?.phase === 'secure-committed' &&
      marker.secretDigest !== digestSecret(apiKey, marker.salt)) {
      await this.rollbackOne(source.sourceId)
      document = await this.markers.read(emptyDocument)
      marker = document.entries[source.sourceId]
    }

    if (marker) {
      const account = await this.options.accounts.getAccount(marker.accountId)
      const credential = account
        ? await this.options.credentials.get(account.credentialRef).catch(() => null)
        : null
      const usable = Boolean(account && credential?.apiKey?.trim())
      const digestMatches = marker.secretDigest === digestSecret(apiKey, marker.salt)
      if (usable && (digestMatches || (marker.phase === 'settings-committed' && !replaceCommitted))) {
        await this.persistAccountBinding({
          ...source,
          modelId: marker.modelId ?? source.modelId
        }, marker.accountId)
        return migrationProjection(marker, true, !digestMatches)
      }
      if (usable && marker.phase === 'settings-committed' && replaceCommitted) {
        return this.replaceCommittedCredential(source, marker, account!.credentialRef, apiKey)
      }
    }

    const reusable = await this.findReusableAccount(document, source.providerId, apiKey)
    if (reusable) {
      const next = createEntry(source, reusable.accountId, apiKey, this.nowIso(), false)
      try {
        await this.persistAccountBinding(source, reusable.accountId)
        await this.writeEntry(source.sourceId, next)
        return migrationProjection(next, true, false)
      } catch (error) {
        await this.options.accounts.clearBinding(
          bindingScope(source.sourceId),
          source.providerId
        ).catch(() => undefined)
        throw error
      }
    }

    const principal = corePrincipal(source.providerId)
    let credentialRef: string | undefined
    let accountId: string | undefined
    try {
      credentialRef = await this.options.credentials.create({ apiKey })
      const account = await this.options.accounts.createAccount({
        principal,
        providerId: source.providerId,
        label: source.label,
        authType: 'api-key',
        credentialRef,
        metadata: {
          migratedFrom: source.sourceId,
          ...(source.modelId ? { modelId: source.modelId } : {})
        }
      })
      accountId = account.id
      const next = createEntry(source, account.id, apiKey, this.nowIso(), true)
      await this.persistAccountBinding(source, account.id)
      await this.writeEntry(source.sourceId, next)
      return migrationProjection(next, false, false)
    } catch (error) {
      if (accountId) await this.options.accounts.deleteAccount(principal, accountId).catch(() => undefined)
      if (credentialRef) await this.options.credentials.delete(credentialRef).catch(() => undefined)
      await this.options.accounts.clearBinding(bindingScope(source.sourceId), source.providerId).catch(() => undefined)
      throw error
    }
  }

  private async replaceCommittedCredential(
    source: LegacyProviderCredentialSource,
    marker: MigrationEntry,
    previousCredentialRef: string,
    apiKey: string
  ): Promise<LegacyProviderCredentialMigration> {
    const nextCredentialRef = await this.options.credentials.create({ apiKey })
    const salt = randomBytes(16).toString('base64url')
    const next: MigrationEntry = {
      sourceId: source.sourceId,
      providerId: source.providerId,
      accountId: marker.accountId,
      ...(source.modelId ? { modelId: source.modelId } : {}),
      salt,
      secretDigest: digestSecret(apiKey, salt),
      migratedAt: this.nowIso(),
      phase: 'secure-committed',
      rollback: {
        accountId: marker.accountId,
        credentialRef: previousCredentialRef,
        salt: marker.salt,
        secretDigest: marker.secretDigest,
        migratedAt: marker.migratedAt,
        ...(marker.settingsCommittedAt ? { settingsCommittedAt: marker.settingsCommittedAt } : {}),
        ...(marker.modelId ? { modelId: marker.modelId } : {})
      }
    }
    try {
      await this.options.accounts.updateAccount(marker.accountId, {
        credentialRef: nextCredentialRef,
        metadata: {
          migratedFrom: source.sourceId,
          ...(source.modelId ? { modelId: source.modelId } : {})
        },
        status: 'connected'
      })
      await this.persistAccountBinding(source, marker.accountId)
      await this.writeEntry(source.sourceId, next)
      return migrationProjection(next, true, false)
    } catch (error) {
      await this.options.accounts.updateAccount(marker.accountId, {
        credentialRef: previousCredentialRef
      }).catch(() => undefined)
      await this.options.credentials.delete(nextCredentialRef).catch(() => undefined)
      await this.persistAccountBinding({
        ...source,
        ...(marker.modelId ? { modelId: marker.modelId } : {})
      }, marker.accountId).catch(() => undefined)
      throw error
    }
  }

  private async forgetOne(sourceId: string): Promise<void> {
    const document = await this.markers.read(emptyDocument)
    const entry = document.entries[sourceId]
    if (!entry) return
    const account = await this.options.accounts.getAccount(entry.accountId)
    const accountId = entry.accountId
    const credentialRefs = new Set<string>()
    if (account?.credentialRef) credentialRefs.add(account.credentialRef)
    if (entry.rollback?.credentialRef) credentialRefs.add(entry.rollback.credentialRef)

    await this.options.accounts.clearBinding(bindingScope(sourceId), entry.providerId).catch(() => undefined)
    await this.markers.update(emptyDocument, (current) => {
      if (!current.entries[sourceId]) return current
      const entries = { ...current.entries }
      delete entries[sourceId]
      return { ...current, revision: current.revision + 1, entries }
    })

    const remaining = await this.markers.read(emptyDocument)
    const stillReferenced = Object.values(remaining.entries).some((candidate) =>
      candidate.accountId === accountId || candidate.rollback?.accountId === accountId
    )
    if (stillReferenced) return

    const principal = corePrincipal(entry.providerId)
    if (account) {
      await this.options.accounts.deleteAccount(principal, accountId).catch(() => undefined)
    }
    for (const credentialRef of credentialRefs) {
      await this.options.credentials.delete(credentialRef).catch(() => undefined)
    }
  }

  private async rollbackOne(sourceId: string): Promise<void> {
    const document = await this.markers.read(emptyDocument)
    const entry = document.entries[sourceId]
    if (!entry || entry.phase !== 'secure-committed') return
    const account = await this.options.accounts.getAccount(entry.accountId)

    if (entry.rollback) {
      const activeCredentialRef = account?.credentialRef
      if (account) {
        await this.options.accounts.updateAccount(account.id, {
          credentialRef: entry.rollback.credentialRef,
          metadata: {
            migratedFrom: sourceId,
            ...(entry.rollback.modelId ? { modelId: entry.rollback.modelId } : {})
          },
          status: 'connected'
        })
      }
      const restored: MigrationEntry = {
        sourceId,
        providerId: entry.providerId,
        accountId: entry.rollback.accountId,
        ...(entry.rollback.modelId ? { modelId: entry.rollback.modelId } : {}),
        salt: entry.rollback.salt,
        secretDigest: entry.rollback.secretDigest,
        migratedAt: entry.rollback.migratedAt,
        phase: 'settings-committed',
        ...(entry.rollback.settingsCommittedAt
          ? { settingsCommittedAt: entry.rollback.settingsCommittedAt }
          : {})
      }
      await this.writeEntry(sourceId, restored)
      await this.persistAccountBinding({
        sourceId,
        providerId: entry.providerId,
        providerName: entry.providerId,
        label: sourceId,
        apiKey: '',
        ...(entry.rollback.modelId ? { modelId: entry.rollback.modelId } : {})
      }, entry.rollback.accountId)
      if (activeCredentialRef && activeCredentialRef !== entry.rollback.credentialRef) {
        await this.options.credentials.delete(activeCredentialRef).catch(() => undefined)
      }
      return
    }

    if (entry.pendingAccountCreated !== false) {
      const principal = corePrincipal(entry.providerId)
      const credentialRef = account?.credentialRef
      if (account) await this.options.accounts.deleteAccount(principal, account.id).catch(() => undefined)
      if (credentialRef) await this.options.credentials.delete(credentialRef).catch(() => undefined)
    }
    await this.options.accounts.clearBinding(bindingScope(sourceId), entry.providerId).catch(() => undefined)
    await this.markers.update(emptyDocument, (current) => {
      if (!current.entries[sourceId]) return current
      const entries = { ...current.entries }
      delete entries[sourceId]
      return { ...current, revision: current.revision + 1, entries }
    })
  }

  private async findReusableAccount(
    document: MigrationDocument,
    providerId: string,
    apiKey: string
  ): Promise<{ accountId: string } | null> {
    for (const entry of Object.values(document.entries)) {
      if (entry.providerId !== providerId) continue
      const account = await this.options.accounts.getAccount(entry.accountId)
      if (!account) continue
      const credential = await this.options.credentials.get(account.credentialRef).catch(() => null)
      if (credential?.apiKey?.trim() === apiKey) return { accountId: account.id }
    }
    return null
  }

  private async writeEntry(sourceId: string, entry: MigrationEntry): Promise<void> {
    await this.markers.update(emptyDocument, (document) => ({
      ...document,
      revision: document.revision + 1,
      entries: { ...document.entries, [sourceId]: entry }
    }))
  }

  private async persistAccountBinding(
    source: LegacyProviderCredentialSource,
    accountId: string
  ): Promise<void> {
    const modelId = source.modelId?.trim() || 'legacy-model'
    await this.options.accounts.setBinding({
      scopeKey: bindingScope(source.sourceId),
      ownerExtensionId: 'kun.core',
      ownerExtensionVersion: '1',
      binding: {
        providerId: source.providerId,
        accountId,
        modelId
      },
      dataAccessDigest: scryptSync(
        `legacy-provider-binding\0${source.sourceId}\0${source.providerId}\0${modelId}`,
        'kun-legacy-provider-binding-v1',
        32
      ).toString('hex'),
      dataCategories: [
        'conversation-history',
        'system-and-mode-instructions',
        'attachments',
        'tool-schemas'
      ]
    })
  }
}

function createEntry(
  source: LegacyProviderCredentialSource,
  accountId: string,
  apiKey: string,
  migratedAt: string,
  pendingAccountCreated: boolean
): MigrationEntry {
  const salt = randomBytes(16).toString('base64url')
  return {
    sourceId: source.sourceId,
    providerId: source.providerId,
    accountId,
    ...(source.modelId ? { modelId: source.modelId } : {}),
    salt,
    secretDigest: digestSecret(apiKey, salt),
    migratedAt,
    phase: 'secure-committed',
    pendingAccountCreated
  }
}

function migrationProjection(
  entry: MigrationEntry,
  reused: boolean,
  ignoredStalePlaintext: boolean
): LegacyProviderCredentialMigration {
  return {
    sourceId: entry.sourceId,
    providerId: entry.providerId,
    accountId: entry.accountId,
    ...(entry.modelId ? { modelId: entry.modelId } : {}),
    removePlaintext: true,
    reused,
    ignoredStalePlaintext,
    settingsCommitted: entry.phase === 'settings-committed'
  }
}

function corePrincipal(providerId: string): ExtensionPrincipal {
  return {
    extensionId: 'kun.core',
    extensionVersion: '1',
    permissions: [
      'providers.register',
      'accounts.read',
      `accounts.manage:${providerId}`,
      `accounts.use:${providerId}`
    ],
    workspaceRoots: [],
    workspaceTrusted: true
  }
}

function digestSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, 32).toString('hex')
}

function bindingScope(sourceId: string): string {
  return `legacy:${sourceId}`
}

function emptyDocument(): MigrationDocument {
  return { schemaVersion: 1, revision: 0, entries: {} }
}
