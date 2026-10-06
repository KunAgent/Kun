import { createHash, randomUUID, scryptSync } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  ExtensionAccountProjection,
  ExtensionAccountRecord,
  ExtensionProviderAuthType,
  ExtensionProviderBinding,
  ExtensionProviderBindingRecord,
  ExtensionProviderDataCategory,
  ExtensionProviderDefinition
} from '../contracts/extension-providers.js'
import {
  ExtensionAccountStoreDocumentSchema,
  ExtensionProviderBindingSchema,
  ExtensionProviderBindingStoreDocumentSchema,
  ExtensionProviderDefinitionSchema,
  ExtensionProviderStoreDocumentSchema
} from '../contracts/extension-providers.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { AtomicJsonFile } from '../extensions/atomic-json.js'

type ProviderDocument = ReturnType<typeof ExtensionProviderStoreDocumentSchema.parse>
type AccountDocument = ReturnType<typeof ExtensionAccountStoreDocumentSchema.parse>
type BindingDocument = ReturnType<typeof ExtensionProviderBindingStoreDocumentSchema.parse>
const PREVIOUS_PROVIDER_STATUS_METADATA_KEY = '__kunProviderPreviousStatus'

export type RegisterExtensionProviderInput = Omit<
  ExtensionProviderDefinition,
  | 'id'
  | 'ownerExtensionId'
  | 'ownerExtensionVersion'
  | 'createdAt'
  | 'updatedAt'
  | 'credentialHosts'
  | 'authenticationScopes'
> & { id: string; credentialHosts?: string[]; authenticationScopes?: string[] }

export class ExtensionProviderAccountStore {
  private readonly providers: AtomicJsonFile<ProviderDocument>
  private readonly accounts: AtomicJsonFile<AccountDocument>
  private readonly bindings: AtomicJsonFile<BindingDocument>
  private readonly nowIso: () => string

  constructor(options: { dataDir: string; nowIso?: () => string }) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.providers = new AtomicJsonFile(
      join(options.dataDir, 'extensions', 'providers.json'),
      (value) => ExtensionProviderStoreDocumentSchema.parse(value)
    )
    this.accounts = new AtomicJsonFile(
      join(options.dataDir, 'extensions', 'accounts.json'),
      (value) => ExtensionAccountStoreDocumentSchema.parse(value)
    )
    this.bindings = new AtomicJsonFile(
      join(options.dataDir, 'extensions', 'provider-bindings.json'),
      (value) => ExtensionProviderBindingStoreDocumentSchema.parse(value)
    )
  }

  async registerProvider(
    principal: ExtensionPrincipal,
    input: RegisterExtensionProviderInput
  ): Promise<ExtensionProviderDefinition> {
    if (!principal.permissions.includes('providers.register')) throw new Error('Missing permission: providers.register')
    const id = extensionProviderId(principal.extensionId, input.id)
    const now = this.nowIso()
    const definition = ExtensionProviderDefinitionSchema.parse({
      ...input,
      id,
      ownerExtensionId: principal.extensionId,
      ownerExtensionVersion: principal.extensionVersion,
      createdAt: now,
      updatedAt: now
    })
    await this.providers.update(emptyProviders, (document) => {
      const existing = document.providers[id]
      if (existing && existing.ownerExtensionId !== principal.extensionId) throw new Error(`provider identity is owned by another extension: ${id}`)
      return {
        ...document,
        revision: document.revision + 1,
        providers: {
          ...document.providers,
          [id]: { ...definition, createdAt: existing?.createdAt ?? definition.createdAt }
        }
      }
    })
    await this.restoreProviderAccounts(id)
    return definition
  }

  async unregisterProvider(principal: ExtensionPrincipal, providerId: string): Promise<boolean> {
    let removed = false
    await this.providers.update(emptyProviders, (document) => {
      const provider = document.providers[providerId]
      if (!provider) return document
      if (provider.ownerExtensionId !== principal.extensionId) throw opaqueProviderError()
      const providers = { ...document.providers }
      delete providers[providerId]
      removed = true
      return { ...document, revision: document.revision + 1, providers }
    })
    if (removed) await this.markProviderAccountsUnavailable(providerId)
    return removed
  }

  async upsertCoreProvider(input: {
    id: string
    displayName: string
    description?: string
  }): Promise<ExtensionProviderDefinition> {
    const now = this.nowIso()
    const definition = ExtensionProviderDefinitionSchema.parse({
      id: input.id,
      ownerExtensionId: 'kun.core',
      ownerExtensionVersion: '1',
      displayName: input.displayName,
      ...(input.description ? { description: input.description } : {}),
      authTypes: ['api-key'],
      apiKey: { headerName: 'Authorization', prefix: 'Bearer ' },
      capabilities: {
        streaming: true,
        toolCalls: true,
        reasoning: true,
        images: true,
        documents: true,
        tokenCounting: false
      },
      createdAt: now,
      updatedAt: now
    })
    await this.providers.update(emptyProviders, (document) => {
      const existing = document.providers[input.id]
      if (existing && existing.ownerExtensionId !== 'kun.core') {
        throw new Error(`core provider id conflicts with extension provider: ${input.id}`)
      }
      return {
        ...document,
        revision: document.revision + 1,
        providers: {
          ...document.providers,
          [input.id]: { ...definition, createdAt: existing?.createdAt ?? definition.createdAt }
        }
      }
    })
    await this.restoreProviderAccounts(input.id)
    return definition
  }

  async getProvider(providerId: string): Promise<ExtensionProviderDefinition | null> {
    return (await this.providers.read(emptyProviders)).providers[providerId] ?? null
  }

  async listProviders(): Promise<ExtensionProviderDefinition[]> {
    return Object.values((await this.providers.read(emptyProviders)).providers)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  async createAccount(input: {
    principal: ExtensionPrincipal
    providerId: string
    label: string
    authType: ExtensionProviderAuthType
    credentialRef: string
    metadata?: ExtensionAccountRecord['metadata']
    expiresAt?: string
  }): Promise<ExtensionAccountProjection> {
    const provider = await this.requireOwnedProvider(input.principal, input.providerId)
    if (!provider.authTypes.includes(input.authType)) throw new Error(`provider does not support ${input.authType}`)
    const now = this.nowIso()
    const account: ExtensionAccountRecord = {
      id: `account_${randomUUID()}`,
      providerId: provider.id,
      ownerExtensionId: input.principal.extensionId,
      label: input.label.trim(),
      authType: input.authType,
      status: 'connected',
      credentialRef: input.credentialRef,
      metadata: { ...(input.metadata ?? {}) },
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      createdAt: now,
      updatedAt: now
    }
    await this.accounts.update(emptyAccounts, (document) => ({
      ...document,
      revision: document.revision + 1,
      accounts: { ...document.accounts, [account.id]: account }
    }))
    return projectExtensionAccount(account)
  }

  async getAccount(accountId: string): Promise<ExtensionAccountRecord | null> {
    return (await this.accounts.read(emptyAccounts)).accounts[accountId] ?? null
  }

  async listAccounts(principal: ExtensionPrincipal, providerId?: string): Promise<ExtensionAccountProjection[]> {
    if (!principal.permissions.includes('accounts.read')) throw new Error('Missing permission: accounts.read')
    return Object.values((await this.accounts.read(emptyAccounts)).accounts)
      .filter((account) => account.ownerExtensionId === principal.extensionId)
      .filter((account) => !providerId || account.providerId === providerId)
      .map(projectExtensionAccount)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  }

  /** Admin view (no credential references) used to pick the account a gateway export uses. */
  async listProviderAccounts(providerId: string): Promise<ExtensionAccountProjection[]> {
    return Object.values((await this.accounts.read(emptyAccounts)).accounts)
      .filter((account) => account.providerId === providerId)
      .map(projectExtensionAccount)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  }

  async updateAccount(accountId: string, patch: Partial<Pick<
    ExtensionAccountRecord,
    'label' | 'status' | 'metadata' | 'expiresAt' | 'credentialRef'
  >>): Promise<ExtensionAccountRecord> {
    let updated: ExtensionAccountRecord | undefined
    await this.accounts.update(emptyAccounts, (document) => {
      const current = document.accounts[accountId]
      if (!current) throw new Error('account not found')
      updated = {
        ...current,
        ...patch,
        ...(patch.metadata ? { metadata: { ...patch.metadata } } : {}),
        updatedAt: this.nowIso()
      }
      return {
        ...document,
        revision: document.revision + 1,
        accounts: { ...document.accounts, [accountId]: updated! }
      }
    })
    return updated!
  }

  async updateAccountIfCurrent(
    accountId: string,
    expected: Pick<ExtensionAccountRecord, 'status' | 'credentialRef'>,
    patch: Partial<Pick<
      ExtensionAccountRecord,
      'label' | 'status' | 'metadata' | 'expiresAt' | 'credentialRef'
    >>
  ): Promise<ExtensionAccountRecord | null> {
    let updated: ExtensionAccountRecord | null = null
    await this.accounts.update(emptyAccounts, (document) => {
      const current = document.accounts[accountId]
      if (
        !current ||
        current.status !== expected.status ||
        current.credentialRef !== expected.credentialRef
      ) return document
      updated = {
        ...current,
        ...patch,
        ...(patch.metadata ? { metadata: { ...patch.metadata } } : {}),
        updatedAt: this.nowIso()
      }
      return {
        ...document,
        revision: document.revision + 1,
        accounts: { ...document.accounts, [accountId]: updated! }
      }
    })
    return updated
  }

  async deleteAccount(principal: ExtensionPrincipal, accountId: string): Promise<ExtensionAccountRecord | null> {
    let removed: ExtensionAccountRecord | null = null
    await this.accounts.update(emptyAccounts, (document) => {
      const account = document.accounts[accountId]
      if (!account) return document
      if (account.ownerExtensionId !== principal.extensionId) throw opaqueAccountError()
      const accounts = { ...document.accounts }
      delete accounts[accountId]
      removed = account
      return { ...document, revision: document.revision + 1, accounts }
    })
    return removed
  }

  async validateBinding(bindingInput: ExtensionProviderBinding): Promise<ExtensionProviderBinding> {
    const binding = ExtensionProviderBindingSchema.parse(bindingInput)
    const provider = await this.getProvider(binding.providerId)
    if (!provider) throw new Error(`provider is unavailable: ${binding.providerId}`)
    if (binding.accountId) {
      const account = await this.getAccount(binding.accountId)
      if (!account || account.status !== 'connected') {
        throw new Error(`connected account is required: ${binding.accountId}`)
      }
      if (account.providerId !== binding.providerId) throw new Error('provider binding references an account from another provider')
    }
    return binding
  }

  async listBindings(scopeKey: string): Promise<ExtensionProviderBindingRecord[]> {
    const normalizedScope = normalizeBindingScope(scopeKey)
    return Object.values((await this.bindings.read(emptyBindings)).bindings)
      .filter((record) => record.scopeKey === normalizedScope)
      .sort((left, right) => left.binding.providerId.localeCompare(right.binding.providerId))
      .map((record) => structuredClone(record))
  }

  async getBinding(
    scopeKey: string,
    providerId: string
  ): Promise<ExtensionProviderBindingRecord | null> {
    const normalizedScope = normalizeBindingScope(scopeKey)
    const document = await this.bindings.read(emptyBindings)
    const key = providerBindingKey(normalizedScope, providerId)
    const record = document.bindings[key] ?? findBindingRecord(document, normalizedScope, providerId)
    return record ? structuredClone(record) : null
  }

  async setBinding(input: {
    scopeKey: string
    ownerExtensionId: string
    ownerExtensionVersion: string
    binding: ExtensionProviderBinding & { accountId: string }
    dataAccessDigest: string
    dataCategories: ExtensionProviderDataCategory[]
  }): Promise<ExtensionProviderBindingRecord> {
    const binding = await this.validateBinding(input.binding)
    if (!binding.accountId) throw new Error('provider binding requires an account')
    const provider = await this.getProvider(binding.providerId)
    if (
      !provider ||
      provider.ownerExtensionId !== input.ownerExtensionId ||
      provider.ownerExtensionVersion !== input.ownerExtensionVersion
    ) {
      throw new Error('provider binding owner/version does not match the active provider')
    }
    const scopeKey = normalizeBindingScope(input.scopeKey)
    const now = this.nowIso()
    const record: ExtensionProviderBindingRecord = {
      scopeKey,
      ownerExtensionId: input.ownerExtensionId,
      ownerExtensionVersion: input.ownerExtensionVersion,
      binding: { ...binding, accountId: binding.accountId },
      dataAccessDigest: input.dataAccessDigest,
      dataCategories: [...new Set(input.dataCategories)],
      acknowledgedAt: now,
      updatedAt: now
    }
    const key = providerBindingKey(scopeKey, binding.providerId)
    await this.bindings.update(emptyBindings, (document) => ({
      ...document,
      revision: document.revision + 1,
      bindings: {
        ...removeMatchingBindingRecords(document.bindings, scopeKey, binding.providerId),
        [key]: record
      }
    }))
    return structuredClone(record)
  }

  async clearBinding(scopeKey: string, providerId: string): Promise<boolean> {
    const normalizedScope = normalizeBindingScope(scopeKey)
    let removed = false
    await this.bindings.update(emptyBindings, (document) => {
      const bindings = removeMatchingBindingRecords(document.bindings, normalizedScope, providerId)
      if (Object.keys(bindings).length === Object.keys(document.bindings).length) return document
      removed = true
      return { ...document, revision: document.revision + 1, bindings }
    })
    return removed
  }

  async requireOwnedProvider(
    principal: ExtensionPrincipal,
    providerId: string
  ): Promise<ExtensionProviderDefinition> {
    const provider = await this.getProvider(providerId)
    if (!provider || provider.ownerExtensionId !== principal.extensionId) throw opaqueProviderError()
    return provider
  }

  private async markProviderAccountsUnavailable(providerId: string): Promise<void> {
    await this.accounts.update(emptyAccounts, (document) => ({
      ...document,
      revision: document.revision + 1,
      accounts: Object.fromEntries(Object.entries(document.accounts).map(([id, account]) => [
        id,
        account.providerId === providerId
          ? {
              ...account,
              status: 'unavailable' as const,
              metadata: {
                ...account.metadata,
                ...(
                  account.status === 'unavailable' ||
                  PREVIOUS_PROVIDER_STATUS_METADATA_KEY in account.metadata
                    ? {}
                    : { [PREVIOUS_PROVIDER_STATUS_METADATA_KEY]: account.status }
                )
              },
              updatedAt: this.nowIso()
            }
          : account
      ]))
    }))
  }

  private async restoreProviderAccounts(providerId: string): Promise<void> {
    await this.accounts.update(emptyAccounts, (document) => ({
      ...document,
      revision: document.revision + 1,
      accounts: Object.fromEntries(Object.entries(document.accounts).map(([id, account]) => {
        if (account.providerId !== providerId || account.status !== 'unavailable') return [id, account]
        const previous = account.metadata[PREVIOUS_PROVIDER_STATUS_METADATA_KEY]
        if (
          previous !== 'connected' &&
          previous !== 'expired' &&
          previous !== 'interaction-required' &&
          previous !== 'error'
        ) return [id, account]
        const metadata = { ...account.metadata }
        delete metadata[PREVIOUS_PROVIDER_STATUS_METADATA_KEY]
        return [id, { ...account, status: previous, metadata, updatedAt: this.nowIso() }]
      }))
    }))
  }
}

export function extensionProviderId(extensionId: string, localId: string): string {
  const normalized = localId.trim().replace(/^extension:/, '').replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!normalized) throw new Error('provider local id is required')
  const namespace = createHash('sha256').update(extensionId).digest('hex').slice(0, 16)
  return `ext-${namespace}-${normalized.slice(0, 64)}`
}

export function extensionProviderBindingScope(workspaceRoot?: string): string {
  if (!workspaceRoot) return 'global'
  if (!isAbsolute(workspaceRoot)) throw new Error('provider binding workspace must be absolute')
  return `workspace:${createHash('sha256').update(resolve(workspaceRoot)).digest('hex')}`
}

export function projectExtensionAccount(account: ExtensionAccountRecord): ExtensionAccountProjection {
  const { credentialRef: _credentialRef, ...projection } = account
  const metadata = Object.fromEntries(
    Object.entries(projection.metadata).filter(([key]) => !key.startsWith('__kun'))
  )
  return structuredClone({ ...projection, metadata })
}

function emptyProviders(): ProviderDocument {
  return { schemaVersion: 1, revision: 0, providers: {} }
}

function emptyAccounts(): AccountDocument {
  return { schemaVersion: 1, revision: 0, accounts: {} }
}

function emptyBindings(): BindingDocument {
  return { schemaVersion: 1, revision: 0, bindings: {} }
}

function normalizeBindingScope(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) throw new Error('provider binding scope is invalid')
  return normalized
}

function providerBindingKey(scopeKey: string, providerId: string): string {
  return scryptSync(`${scopeKey}\0${providerId}`, 'kun-provider-binding-key-v1', 32).toString('hex')
}

function findBindingRecord(
  document: BindingDocument,
  scopeKey: string,
  providerId: string
): ExtensionProviderBindingRecord | undefined {
  return Object.values(document.bindings).find((record) =>
    record.scopeKey === scopeKey && record.binding.providerId === providerId
  )
}

function removeMatchingBindingRecords(
  bindings: BindingDocument['bindings'],
  scopeKey: string,
  providerId: string
): BindingDocument['bindings'] {
  return Object.fromEntries(Object.entries(bindings).filter(([, record]) =>
    record.scopeKey !== scopeKey || record.binding.providerId !== providerId
  ))
}

function opaqueProviderError(): Error {
  return new Error('provider not found')
}

function opaqueAccountError(): Error {
  return new Error('account not found')
}
