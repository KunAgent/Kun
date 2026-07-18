import type {
  ExtensionManifest,
  JsonObject,
  JsonValue,
  SettingsContribution
} from '@kun/extension-api'
import { JsonValueSchema } from '@kun/extension-api'
import type { ExtensionStateStore } from '../extensions/state-store.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'

const CONFIGURATION_STATE_KEY = '__kun_configuration_document_v1'
const MAX_SETTING_VALUE_BYTES = 16 * 1024
const MAX_CONFIGURATION_DOCUMENT_BYTES = 1024 * 1024

type ConfigurationValues = Record<string, Record<string, JsonValue>>

type ConfigurationDocument = {
  schemaVersion: 1
  revision: number
  global: ConfigurationValues
  workspaces: Record<string, ConfigurationValues>
}

export type ExtensionConfigurationSnapshot = {
  schemaVersion: 1
  revision: number
  values: Record<string, Record<string, JsonValue>>
}

type ExtensionConfigurationChangeBase = {
  extensionId: string
  extensionVersion: string
  sectionId: string
  key: string
  value: JsonValue
  revision: number
}

export type ExtensionConfigurationChange = ExtensionConfigurationChangeBase & (
  | { scope: 'global' }
  | { scope: 'workspace'; workspaceKey: string }
)

/** Host-owned, revisioned storage for declarative extension settings. */
export class ExtensionConfigurationService {
  private readonly operations = new Map<string, Promise<void>>()
  private readonly listeners = new Set<(change: ExtensionConfigurationChange) => void | Promise<void>>()

  constructor(private readonly state: ExtensionStateStore) {}

  async snapshot(input: {
    extensionId: string
    manifest: ExtensionManifest
    contributionIds?: readonly string[]
    workspaceKey?: string
  }): Promise<ExtensionConfigurationSnapshot> {
    const document = await this.readDocument(input.extensionId)
    const selected = input.contributionIds ? new Set(input.contributionIds) : undefined
    const values: Record<string, Record<string, JsonValue>> = {}
    for (const section of input.manifest.contributes.settings) {
      const qualifiedId = `extension:${input.extensionId}/${section.id}`
      if (selected && !selected.has(qualifiedId)) continue
      const stored = section.scope === 'global'
        ? document.global[section.id]
        : input.workspaceKey ? document.workspaces[input.workspaceKey]?.[section.id] : undefined
      values[qualifiedId] = projectDeclaredValues(section, stored)
    }
    return { schemaVersion: 1, revision: document.revision, values }
  }

  async get(input: {
    principal: ExtensionPrincipal
    manifest: ExtensionManifest
    sectionId: string
    key: string
  }): Promise<JsonValue | undefined> {
    const section = requireSection(input.manifest, input.sectionId)
    const property = requireProperty(section, input.key)
    rejectSecretLikeKey(input.key)
    const workspaceKey = section.scope === 'workspace' ? requiredWorkspaceKey(this.state, input.principal) : undefined
    const document = await this.readDocument(input.principal.extensionId)
    const stored = section.scope === 'global'
      ? document.global[section.id]?.[input.key]
      : document.workspaces[workspaceKey!]?.[section.id]?.[input.key]
    if (stored !== undefined) return structuredClone(stored)
    const fallback = property.default
    return fallback === undefined ? undefined : validateSettingValue(property, fallback)
  }

  async keys(input: {
    manifest: ExtensionManifest
    sectionId: string
  }): Promise<string[]> {
    return Object.keys(requireSection(input.manifest, input.sectionId).properties)
      .filter((key) => !isSecretLikeKey(key))
      .sort()
  }

  async update(input: {
    principal: ExtensionPrincipal
    manifest: ExtensionManifest
    sectionId: string
    key: string
    value: JsonValue
    expectedRevision?: number
  }): Promise<ExtensionConfigurationSnapshot> {
    const section = requireSection(input.manifest, input.sectionId)
    const property = requireProperty(section, input.key)
    rejectSecretLikeKey(input.key)
    const value = validateSettingValue(property, input.value)
    const workspaceKey = section.scope === 'workspace'
      ? requiredWorkspaceKey(this.state, input.principal)
      : undefined
    return this.serialize(input.principal.extensionId, async () => {
      const document = await this.readDocument(input.principal.extensionId)
      if (input.expectedRevision !== undefined && input.expectedRevision !== document.revision) {
        throw new ExtensionConfigurationConflictError(document.revision)
      }
      const scoped = section.scope === 'global'
        ? document.global
        : (document.workspaces[workspaceKey!] ??= {})
      scoped[section.id] = {
        ...(scoped[section.id] ?? {}),
        [input.key]: structuredClone(value)
      }
      document.revision += 1
      enforceDocumentQuota(document)
      await this.state.setGlobal(input.principal.extensionId, CONFIGURATION_STATE_KEY, document as unknown as JsonValue)
      const change: ExtensionConfigurationChange = {
        extensionId: input.principal.extensionId,
        extensionVersion: input.principal.extensionVersion,
        sectionId: section.id,
        key: input.key,
        value: structuredClone(value),
        revision: document.revision,
        ...(section.scope === 'workspace'
          ? { scope: 'workspace' as const, workspaceKey: workspaceKey! }
          : { scope: 'global' as const })
      }
      for (const listener of this.listeners) {
        try {
          await listener(structuredClone(change))
        } catch {
          // A notification failure never rolls back an already committed value.
        }
      }
      return this.snapshot({
        extensionId: input.principal.extensionId,
        manifest: input.manifest,
        ...(workspaceKey ? { workspaceKey } : {})
      })
    })
  }

  onDidChange(listener: (change: ExtensionConfigurationChange) => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async readDocument(extensionId: string): Promise<ConfigurationDocument> {
    const value = await this.state.getGlobal(extensionId, CONFIGURATION_STATE_KEY)
    return parseDocument(value)
  }

  private serialize<T>(extensionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(extensionId) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const settled = run.then(() => undefined, () => undefined)
    this.operations.set(extensionId, settled)
    void settled.finally(() => {
      if (this.operations.get(extensionId) === settled) this.operations.delete(extensionId)
    })
    return run
  }
}

export class ExtensionConfigurationConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('Extension configuration changed; reload it before saving again')
  }
}

export function validateSettingValue(property: JsonObject, input: unknown): JsonValue {
  const value = JsonValueSchema.parse(input)
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_SETTING_VALUE_BYTES) {
    throw new Error('Extension setting value exceeds the 16 KiB limit')
  }
  const type = property.type
  if (typeof type === 'string' && !matchesJsonType(type, value)) {
    throw new Error(`Extension setting must be ${type}`)
  }
  if (Array.isArray(property.enum) && !property.enum.some((candidate) => sameJson(candidate, value))) {
    throw new Error('Extension setting value is not one of the declared choices')
  }
  if (typeof value === 'number') {
    if (typeof property.minimum === 'number' && value < property.minimum) {
      throw new Error(`Extension setting must be at least ${property.minimum}`)
    }
    if (typeof property.maximum === 'number' && value > property.maximum) {
      throw new Error(`Extension setting must be at most ${property.maximum}`)
    }
  }
  if (typeof value === 'string') {
    if (typeof property.minLength === 'number' && value.length < property.minLength) {
      throw new Error(`Extension setting must contain at least ${property.minLength} characters`)
    }
    if (typeof property.maxLength === 'number' && value.length > property.maxLength) {
      throw new Error(`Extension setting must contain at most ${property.maxLength} characters`)
    }
  }
  return structuredClone(value)
}

function requireSection(manifest: ExtensionManifest, sectionId: string): SettingsContribution {
  const section = manifest.contributes.settings.find((candidate) => candidate.id === sectionId)
  if (!section) throw new Error(`Extension configuration section is not declared: ${sectionId}`)
  return section
}

function requireProperty(section: SettingsContribution, key: string): JsonObject {
  const property = section.properties[key]
  if (!property) throw new Error(`Extension configuration property is not declared: ${key}`)
  return property
}

function requiredWorkspaceKey(state: ExtensionStateStore, principal: ExtensionPrincipal): string {
  if (!principal.workspaceTrusted || principal.workspaceRoots.length !== 1) {
    throw new Error('Workspace configuration requires one explicitly trusted workspace')
  }
  return state.paths.workspaceKey(principal.workspaceRoots[0]!)
}

function projectDeclaredValues(
  section: SettingsContribution,
  stored: Record<string, JsonValue> | undefined
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {}
  for (const [key, property] of Object.entries(section.properties)) {
    if (isSecretLikeKey(key)) continue
    const candidate = stored?.[key] ?? property.default
    if (candidate === undefined) continue
    try {
      values[key] = validateSettingValue(property, candidate)
    } catch {
      // Invalid values from an older manifest revision are ignored safely.
    }
  }
  return values
}

function parseDocument(value: JsonValue | undefined): ConfigurationDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision)) {
    return emptyDocument()
  }
  const document: ConfigurationDocument = {
    schemaVersion: 1,
    revision: Number(value.revision),
    global: sanitizeValues(value.global),
    workspaces: {}
  }
  if (isRecord(value.workspaces)) {
    for (const [workspaceKey, scoped] of Object.entries(value.workspaces)) {
      if (/^[a-f0-9]{64}$/.test(workspaceKey)) document.workspaces[workspaceKey] = sanitizeValues(scoped)
    }
  }
  return document
}

function sanitizeValues(value: unknown): ConfigurationValues {
  if (!isRecord(value)) return {}
  const result: ConfigurationValues = {}
  for (const [sectionId, section] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(sectionId) || !isRecord(section)) continue
    const values: Record<string, JsonValue> = {}
    for (const [key, candidate] of Object.entries(section)) {
      if (isSecretLikeKey(key)) continue
      const parsed = JsonValueSchema.safeParse(candidate)
      if (parsed.success && Buffer.byteLength(JSON.stringify(parsed.data)) <= MAX_SETTING_VALUE_BYTES) {
        values[key] = parsed.data
      }
    }
    result[sectionId] = values
  }
  return result
}

function emptyDocument(): ConfigurationDocument {
  return { schemaVersion: 1, revision: 0, global: {}, workspaces: {} }
}

function enforceDocumentQuota(document: ConfigurationDocument): void {
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_CONFIGURATION_DOCUMENT_BYTES) {
    throw new Error('Extension configuration quota exceeded')
  }
}

function matchesJsonType(type: string, value: JsonValue): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isRecord(value)
  if (type === 'null') return value === null
  return typeof value === type
}

function sameJson(left: unknown, right: JsonValue): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
  return /(?:^|_)(?:api_?key|secret|password|passphrase|credential|authorization|cookie|(?:access|refresh|id|auth|bearer)_token|private_?key)(?:_|$)/.test(normalized)
}

function rejectSecretLikeKey(key: string): void {
  if (isSecretLikeKey(key)) {
    throw new Error('Credentials must use the protected Account API, not extension configuration')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
