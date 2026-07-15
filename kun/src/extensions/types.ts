import type {
  CompatibilityReport,
  ExtensionManifest as PublicExtensionManifest
} from '@kun/extension-api'

// Re-export seam contract types for backward compatibility
export type {
  KunExtension,
  LoopHookName,
  LoopHookContext,
  LoopHookFn,
  LoopHookBus,
  ExtensionRuntimeServices,
  RouteRegistrar
} from '../seam/types.js'
export { LOOP_HOOK_NAMES } from '../seam/types.js'

export const EXTENSION_REGISTRY_SCHEMA_VERSION = 1 as const
export const EXTENSION_INDEX_SCHEMA_VERSION = 1 as const
export const EXTENSION_RPC_VERSION = 1 as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ExtensionManifest = PublicExtensionManifest

export type ExtensionCompatibility = {
  kunVersion: string
  supportedManifestVersions: readonly number[]
  supportedApiVersions: readonly string[]
  capabilitiesByApiVersion?: Readonly<Record<string, readonly string[]>>
  requiredApiCapabilities?: readonly string[]
  supportedRpcVersions?: readonly number[]
}

export type ExtensionAdmission = CompatibilityReport

export type ExtensionSource =
  | { type: 'local'; locator: string }
  | { type: 'index'; locator: string; indexUrl: string }
  | { type: 'development'; locator: string }

export type ExtensionSignatureStatus = 'unsigned' | 'present-unverified' | 'verified'

export type ExtensionIntegrityManifest = {
  algorithm: 'sha256'
  files: Record<string, string>
}

export type InstalledExtensionVersion = {
  version: string
  packagePath: string
  archiveSha256: string
  integrity: ExtensionIntegrityManifest
  source: ExtensionSource
  signatureStatus: ExtensionSignatureStatus
  requestedPermissions: string[]
  grantedPermissions: string[]
  installedAt: string
  manifest: ExtensionManifest
  mutable: false
}

export type DevelopmentExtensionRecord = {
  path: string
  source: ExtensionSource & { type: 'development' }
  digest: string
  manifest: ExtensionManifest
  requestedPermissions: string[]
  grantedPermissions: string[]
  registeredAt: string
  reloadedAt: string
  generation: number
  mutable: true
}

export type ExtensionRegistryEntry = {
  id: string
  selectedVersion?: string
  previousSelectedVersion?: string
  globallyEnabled: boolean
  workspaceEnablement: Record<string, boolean>
  workspacePermissionGrants: Record<string, string[]>
  versions: Record<string, InstalledExtensionVersion>
  development?: DevelopmentExtensionRecord
  useDevelopment: boolean
}

export type ExtensionRegistryDocument = {
  schemaVersion: typeof EXTENSION_REGISTRY_SCHEMA_VERSION
  revision: number
  updatedAt: string
  extensions: Record<string, ExtensionRegistryEntry>
}

export type ResolvedExtension = {
  id: string
  version: string
  packagePath: string
  manifest: ExtensionManifest
  requestedPermissions: string[]
  grantedPermissions: string[]
  source: ExtensionSource
  development: boolean
  generation?: number
}

export type ExtensionIndexVersion = {
  version: string
  url: string
  sha256: string
  engines: { kun: string }
  apiVersion: string
  permissions: string[]
  signature?: NonNullable<ExtensionManifest['signature']>
}

export type ExtensionIndexEntry = {
  id: string
  name: string
  description?: string
  publisher: string
  versions: ExtensionIndexVersion[]
}

export type ExtensionIndexDocument = {
  schemaVersion: typeof EXTENSION_INDEX_SCHEMA_VERSION
  extensions: ExtensionIndexEntry[]
}
