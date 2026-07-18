import { posix } from 'node:path'
import {
  CompatibilityReportSchema,
  ExtensionManifestSchema as PublicExtensionManifestSchema,
  negotiateApiVersion,
  type CompatibilityDiagnostic,
  type CompatibilityReport
} from '@kun/extension-api'
import semver from 'semver'
import { extensionError } from './errors.js'
import { extensionIdentity } from './paths.js'
import {
  EXTENSION_RPC_VERSION,
  type ExtensionCompatibility,
  type ExtensionManifest
} from './types.js'

export type ManifestAdapter = {
  parse(value: unknown): ExtensionManifest
  assertCompatible(manifest: ExtensionManifest, compatibility: ExtensionCompatibility): void
}

export const defaultManifestAdapter: ManifestAdapter = {
  parse: parseExtensionManifest,
  assertCompatible: assertManifestCompatible
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  const result = PublicExtensionManifestSchema.safeParse(value)
  if (!result.success) {
    throw extensionError('EXTENSION_MANIFEST_INVALID', 'Extension manifest is invalid', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    })
  }
  const manifest = result.data
  extensionIdentity(manifest.publisher, manifest.name)
  if (!semver.valid(manifest.version)) {
    throw extensionError('EXTENSION_VERSION_INVALID', 'Extension version must be valid SemVer', {
      value: manifest.version
    })
  }
  if (!semver.valid(manifest.apiVersion)) {
    throw extensionError('EXTENSION_API_VERSION_INVALID', 'apiVersion must be valid SemVer', {
      value: manifest.apiVersion
    })
  }
  if (semver.validRange(manifest.engines.kun) === null) {
    throw extensionError('EXTENSION_ENGINE_RANGE_INVALID', 'engines.kun must be a valid SemVer range', {
      value: manifest.engines.kun
    })
  }
  if (new Set(manifest.permissions).size !== manifest.permissions.length) {
    throw extensionError('EXTENSION_PERMISSION_DUPLICATE', 'Manifest permissions must be unique')
  }
  if (new Set(manifest.activationEvents).size !== manifest.activationEvents.length) {
    throw extensionError('EXTENSION_ACTIVATION_EVENT_DUPLICATE', 'Activation events must be unique')
  }
  for (const path of manifestReferencedFiles(manifest)) assertCanonicalPackagePath(path, false)
  for (const path of manifestLocalResourceRoots(manifest)) assertCanonicalPackagePath(path, true)
  return manifest
}

export function assertManifestCompatible(
  manifest: ExtensionManifest,
  compatibility: ExtensionCompatibility
): CompatibilityReport {
  const report = manifestCompatibilityReport(manifest, compatibility)
  if (!compatibility.supportedManifestVersions.includes(manifest.manifestVersion)) {
    throw extensionError('EXTENSION_MANIFEST_VERSION_UNSUPPORTED', 'Unsupported manifestVersion', {
      declared: manifest.manifestVersion,
      supported: compatibility.supportedManifestVersions,
      compatibility: report
    })
  }
  if (!report.api.compatible) {
    const code = report.api.code === 'API_MAJOR_UNSUPPORTED'
      ? 'EXTENSION_API_VERSION_UNSUPPORTED'
      : report.api.code === 'API_MINOR_UNSUPPORTED'
        ? 'EXTENSION_API_MINOR_UNSUPPORTED'
        : 'EXTENSION_API_CAPABILITY_REQUIRED'
    throw extensionError(code, report.api.message, {
      declared: manifest.apiVersion,
      supportedVersions: compatibility.supportedApiVersions,
      supportedMajors: report.api.supportedMajors,
      ...(report.api.missingCapabilities === undefined
        ? {}
        : { missingCapabilities: report.api.missingCapabilities }),
      compatibility: report
    })
  }
  if (!report.kunEngine.compatible) {
    throw extensionError('EXTENSION_ENGINE_INCOMPATIBLE', 'Running Kun version is outside engines.kun', {
      running: compatibility.kunVersion,
      declared: manifest.engines.kun,
      compatibility: report
    })
  }
  if (!report.rpc.compatible) {
    throw extensionError('EXTENSION_RPC_VERSION_UNSUPPORTED', 'Extension Host RPC version is unsupported', {
      declared: report.rpc.declared,
      supported: compatibility.supportedRpcVersions ?? [EXTENSION_RPC_VERSION],
      compatibility: report
    })
  }
  return report
}

export function manifestCompatibilityReport(
  manifest: ExtensionManifest,
  compatibility: ExtensionCompatibility,
  handshake: { declaredRpcVersion?: number; negotiatedRpcVersion?: number } = {}
): CompatibilityReport {
  const supportedApiVersions = [...compatibility.supportedApiVersions]
  const capabilitiesByVersion = Object.fromEntries(
    Object.entries(compatibility.capabilitiesByApiVersion ?? {}).map(([version, capabilities]) => [
      version,
      [...capabilities]
    ])
  )
  const api = negotiateApiVersion({
    declaredApiVersion: manifest.apiVersion,
    supportedApiVersions,
    requiredCapabilities: [...(compatibility.requiredApiCapabilities ?? [])],
    capabilitiesByVersion
  })
  const manifestCompatible = compatibility.supportedManifestVersions.includes(manifest.manifestVersion)
  const engineCompatible = semver.satisfies(compatibility.kunVersion, manifest.engines.kun, {
    includePrerelease: true
  })
  const supportedRpcVersions = [...(compatibility.supportedRpcVersions ?? [EXTENSION_RPC_VERSION])]
  const declaredRpcVersion = handshake.declaredRpcVersion ?? EXTENSION_RPC_VERSION
  const negotiatedRpcVersion = handshake.negotiatedRpcVersion ?? (
    supportedRpcVersions.includes(declaredRpcVersion) ? declaredRpcVersion : undefined
  )
  const rpcCompatible = negotiatedRpcVersion !== undefined &&
    supportedRpcVersions.includes(negotiatedRpcVersion) &&
    negotiatedRpcVersion === declaredRpcVersion
  const diagnostics: CompatibilityDiagnostic[] = []

  if (!manifestCompatible) {
    diagnostics.push({
      compatible: false,
      dimension: 'manifest',
      declared: String(manifest.manifestVersion),
      supported: compatibility.supportedManifestVersions.join(', '),
      code: 'EXTENSION_MANIFEST_VERSION_UNSUPPORTED',
      message: `Manifest version ${manifest.manifestVersion} is unsupported`
    })
  }
  if (!api.compatible) {
    diagnostics.push({
      compatible: false,
      dimension: 'api',
      declared: manifest.apiVersion,
      supported: supportedApiVersions.join(', '),
      code: api.code,
      message: api.message
    })
  }
  if (!engineCompatible) {
    diagnostics.push({
      compatible: false,
      dimension: 'engine',
      declared: manifest.engines.kun,
      supported: compatibility.kunVersion,
      code: 'EXTENSION_ENGINE_INCOMPATIBLE',
      message: `Running Kun ${compatibility.kunVersion} is outside ${manifest.engines.kun}`
    })
  }
  if (!rpcCompatible) {
    diagnostics.push({
      compatible: false,
      dimension: 'rpc',
      declared: String(declaredRpcVersion),
      supported: supportedRpcVersions.join(', '),
      code: 'EXTENSION_RPC_VERSION_UNSUPPORTED',
      message: `Extension Host RPC ${declaredRpcVersion} is unsupported`
    })
  }

  return CompatibilityReportSchema.parse({
    extensionVersion: manifest.version,
    manifestVersion: manifest.manifestVersion,
    api,
    kunEngine: {
      declared: manifest.engines.kun,
      running: compatibility.kunVersion,
      compatible: engineCompatible
    },
    rpc: {
      declared: declaredRpcVersion,
      ...(negotiatedRpcVersion === undefined ? {} : { negotiated: negotiatedRpcVersion }),
      compatible: rpcCompatible
    },
    stateSchemaVersion: manifest.stateSchemaVersion,
    diagnostics
  })
}

export function assertCanonicalPackagePath(value: string, allowDirectory: boolean): string {
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_INVALID', 'Package path is not a safe relative path', {
      path: value
    })
  }
  const withoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value
  if (withoutTrailingSlash.length === 0 || (!allowDirectory && value.endsWith('/'))) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_INVALID', 'Package path has an invalid type', {
      path: value
    })
  }
  const normalized = posix.normalize(withoutTrailingSlash)
  const segments = normalized.split('/')
  if (
    value.length > 1024 ||
    normalized !== withoutTrailingSlash ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    segments.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw extensionError('EXTENSION_ARCHIVE_PATH_INVALID', 'Package path is not canonical', {
      path: value
    })
  }
  for (const segment of segments) {
    const deviceName = segment.split('.')[0]!.toUpperCase()
    if (
      segment.length > 255 ||
      containsUnsafePortablePathChar(segment) ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceName)
    ) {
      throw extensionError(
        'EXTENSION_ARCHIVE_PATH_INVALID',
        'Package path is not portable across supported platforms',
        { path: value, segment }
      )
    }
  }
  return normalized
}

function containsUnsafePortablePathChar(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || '<>:"|?*'.includes(character)) return true
  }
  return false
}

export function manifestId(manifest: ExtensionManifest): string {
  return extensionIdentity(manifest.publisher, manifest.name)
}

export function manifestReferencedFiles(manifest: ExtensionManifest): string[] {
  const paths = new Set<string>()
  if (manifest.main) paths.add(manifest.main)
  if (manifest.browser) paths.add(manifest.browser)
  if (manifest.icon) paths.add(manifest.icon)
  for (const command of manifest.contributes.commands) if (command.icon) paths.add(command.icon)
  for (const container of manifest.contributes['views.containers']) {
    if (container.icon) paths.add(container.icon)
  }
  for (const key of [
    'views.leftSidebar',
    'views.rightSidebar',
    'views.auxiliaryPanel',
    'views.editorTab',
    'views.fullPage'
  ] as const) {
    for (const view of manifest.contributes[key]) {
      paths.add(view.entry)
      if (view.icon) paths.add(view.icon)
    }
  }
  for (const key of ['actions.topBar', 'actions.composer', 'actions.message'] as const) {
    for (const action of manifest.contributes[key]) if (action.icon) paths.add(action.icon)
  }
  for (const preview of manifest.contributes['message.resultPreviews']) paths.add(preview.entry)
  for (const contentScript of manifest.contributes.hostContentScripts) {
    for (const script of contentScript.scripts) paths.add(script)
    for (const style of contentScript.styles) paths.add(style)
  }
  return [...paths].sort()
}

export function manifestLocalResourceRoots(manifest: ExtensionManifest): string[] {
  const paths = new Set<string>()
  for (const key of [
    'views.leftSidebar',
    'views.rightSidebar',
    'views.auxiliaryPanel',
    'views.editorTab',
    'views.fullPage'
  ] as const) {
    for (const view of manifest.contributes[key]) {
      for (const root of view.localResourceRoots) paths.add(root)
    }
  }
  for (const preview of manifest.contributes['message.resultPreviews']) {
    for (const root of preview.localResourceRoots) paths.add(root)
  }
  return [...paths].sort()
}
