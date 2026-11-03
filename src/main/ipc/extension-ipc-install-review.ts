import {
  ExtensionManifestSchema,
  PermissionSchema
} from '@kun/extension-api'
import {
  shell
} from 'electron'
import {
  readFile
} from 'node:fs/promises'
import {
  join
} from 'node:path'
import {
  extensionIdSchema,
  MAX_EXTENSION_IPC_BODY_BYTES
} from './app-ipc-schemas/extensions'
import type { RuntimeRequest } from './extension-ipc-handler-options'
import { isRecord, runtimeResultError, safeJsonParse } from './extension-ipc-common'

export async function resolveInstallIdentity(
  request:
    | { source: 'archive'; path: string }
    | { source: 'development'; path: string }
    | { source: 'index'; indexUrl: string; extensionId: string; version: string },
  runtimeRequest: RuntimeRequest
): Promise<ExtensionInstallReview> {
  if (request.source === 'index') {
    return readIndexInstallReview(request.indexUrl, request.extensionId, request.version)
  }
  if (request.source === 'archive') {
    const inspection = await runtimeRequest(
      '/v1/extensions/inspect',
      'POST',
      JSON.stringify({ path: request.path })
    )
    if (!inspection.ok) throw runtimeResultError(inspection)
    const parsed = safeJsonParse(inspection.body)
    const record = isRecord(parsed) && isRecord(parsed.inspection) ? parsed.inspection : undefined
    if (!record || typeof record.id !== 'string' || typeof record.version !== 'string') {
      throw new Error('Extension inspection did not return package identity.')
    }
    const manifest = ExtensionManifestSchema.safeParse(record.manifest)
    if (!manifest.success) throw new Error('Extension inspection did not return a valid manifest.')
    const archiveSha256 = typeof record.archiveSha256 === 'string' && /^[a-f0-9]{64}$/.test(record.archiveSha256)
      ? record.archiveSha256
      : undefined
    const signatureStatus = parseSignatureStatus(record.signatureStatus)
    return {
      extensionId: extensionIdSchema.parse(record.id),
      extensionVersion: String(record.version),
      requestedPermissions: [...manifest.data.permissions],
      sourceKind: 'Local .kunx archive',
      sourceLabel: request.path,
      mutable: false,
      ...(archiveSha256 ? { archiveSha256 } : {}),
      signatureStatus,
      contributionRisks: contributionRiskLabels(manifest.data)
    }
  }
  const manifest = ExtensionManifestSchema.parse(
    JSON.parse(await readFile(join(request.path, 'kun-extension.json'), 'utf8'))
  )
  return {
    extensionId: `${manifest.publisher}.${manifest.name}`,
    extensionVersion: manifest.version,
    requestedPermissions: [...manifest.permissions],
    sourceKind: 'Development directory',
    sourceLabel: request.path,
    mutable: true,
    signatureStatus: manifest.signature ? 'present-unverified' : 'unsigned',
    contributionRisks: contributionRiskLabels(manifest)
  }
}

type ExtensionInstallReview = {
  extensionId: string
  extensionVersion: string
  requestedPermissions: string[]
  sourceKind: string
  sourceLabel: string
  mutable: boolean
  archiveSha256?: string
  signatureStatus: 'unsigned' | 'present-unverified' | 'verified'
  contributionRisks: string[]
}

async function readIndexInstallReview(
  indexUrl: string,
  extensionId: string,
  version: string
): Promise<ExtensionInstallReview> {
  const response = await fetch(indexUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok || new URL(response.url).protocol !== 'https:') {
    throw new Error('Could not load the HTTPS extension index for permission review.')
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EXTENSION_IPC_BODY_BYTES) {
    throw new Error('Extension index is too large.')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_EXTENSION_IPC_BODY_BYTES) throw new Error('Extension index is too large.')
  const document = safeJsonParse(text)
  if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.extensions)) {
    throw new Error('Extension index is invalid.')
  }
  const extension = document.extensions.find(
    (candidate) => isRecord(candidate) && candidate.id === extensionId
  )
  if (!isRecord(extension) || !Array.isArray(extension.versions)) {
    throw new Error('Extension is not present in the selected index.')
  }
  const selected = extension.versions.find(
    (candidate) => isRecord(candidate) && candidate.version === version
  )
  if (!isRecord(selected) || !Array.isArray(selected.permissions)) {
    throw new Error('Exact extension version is not present in the selected index.')
  }
  const requestedPermissions = selected.permissions.map((permission) => PermissionSchema.parse(permission))
  const archiveSha256 = typeof selected.sha256 === 'string' && /^[a-f0-9]{64}$/.test(selected.sha256)
    ? selected.sha256
    : undefined
  if (!archiveSha256) throw new Error('The selected Index version has no valid SHA-256 digest.')
  const packageUrl = typeof selected.url === 'string' ? new URL(selected.url) : undefined
  if (!packageUrl || packageUrl.protocol !== 'https:') {
    throw new Error('The selected Index package URL must use HTTPS.')
  }
  return {
    extensionId: extensionIdSchema.parse(extensionId),
    extensionVersion: version,
    requestedPermissions,
    sourceKind: 'Custom HTTPS Index',
    sourceLabel: `${indexUrl} -> ${packageUrl.toString()}`,
    mutable: false,
    archiveSha256,
    signatureStatus: isRecord(selected.signature) ? 'present-unverified' : 'unsigned',
    contributionRisks: permissionRiskLabels(requestedPermissions)
  }
}

function parseSignatureStatus(value: unknown): ExtensionInstallReview['signatureStatus'] {
  return value === 'verified' || value === 'present-unverified' ? value : 'unsigned'
}

function contributionRiskLabels(manifest: ReturnType<typeof ExtensionManifestSchema.parse>): string[] {
  const labels = permissionRiskLabels(manifest.permissions)
  if (manifest.main && !labels.includes('Runs Node code with your operating-system user privileges.')) {
    labels.unshift('Runs Node code with your operating-system user privileges.')
  }
  if (manifest.contributes.hostContentScripts.length > 0) {
    labels.push(`Direct DOM: can read or change visible Kun workbench content (${manifest.contributes.hostContentScripts.length} contribution(s)).`)
  }
  if (manifest.contributes.modelProviders.length > 0) {
    labels.push(`Model provider: receives complete model-visible prompts, attachments, and tool definitions when selected (${manifest.contributes.modelProviders.length} provider(s)).`)
  }
  const viewCount = manifest.contributes['views.leftSidebar'].length +
    manifest.contributes['views.rightSidebar'].length +
    manifest.contributes['views.auxiliaryPanel'].length +
    manifest.contributes['views.editorTab'].length +
    manifest.contributes['views.fullPage'].length
  if (viewCount > 0 || manifest.browser) {
    labels.push('Includes sandboxed extension UI; its brokered capabilities still depend on the grants below.')
  }
  return [...new Set(labels)]
}

function permissionRiskLabels(permissions: readonly string[]): string[] {
  const labels = ['Runs Node code with your operating-system user privileges.']
  if (permissions.some((permission) => permission === 'workspace.read' || permission === 'storage.workspace')) {
    labels.push('Workspace read permission can expose files and extension state from the approved workspace.')
  }
  if (permissions.some((permission) => permission === 'workspace.write')) {
    labels.push('Workspace write permission can create or modify files in the approved workspace.')
  }
  if (permissions.some((permission) => permission === 'media.read')) {
    labels.push('Media read permission can inspect user-selected local media through opaque grants.')
  }
  if (permissions.some((permission) => permission === 'media.process' || permission === 'jobs.manage')) {
    labels.push('Media processing and job permissions can run and manage durable local work.')
  }
  if (permissions.some((permission) => permission === 'media.export')) {
    labels.push('Media export permission can write to user-approved output targets.')
  }
  if (permissions.some((permission) => permission === 'agent.run' || permission === 'tools.register')) {
    labels.push('Agent and tool permissions can start private Agent runs and expose declared tools to Kun.')
  }
  if (permissions.some((permission) => permission === 'hostDom')) {
    labels.push('Direct DOM permission can read and alter visible workbench content and may imitate ordinary UI.')
  }
  if (permissions.some((permission) => permission === 'webview.external')) {
    labels.push('External Webview permission can display approved remote websites inside an isolated browser session.')
  }
  if (permissions.some((permission) => permission === 'agents.register')) {
    labels.push('Agent permission can add local command-line Agents that Kun starts only after you enable them in the Agent Center.')
  }
  if (permissions.some((permission) => permission === 'providers.register')) {
    labels.push('Provider permission can receive full model inputs when the user explicitly selects that provider.')
  }
  if (permissions.some((permission) => permission.startsWith('accounts.secrets.read:'))) {
    labels.push('Secret-read permission can reveal a selected raw account secret to this extension\'s Node host after a separate allow-once decision.')
  }
  if (permissions.some((permission) => permission.startsWith('network:'))) {
    labels.push('Network permission can send brokered data to the declared destination hosts.')
  }
  if (permissions.some((permission) => permission === 'shell')) {
    labels.push('Shell permission can start external processes after applicable host policy and consent checks.')
  }
  return labels
}

export function formatPermissionChangeReviewDetail(
  currentPermissions: readonly string[],
  nextPermissions: readonly string[]
): string {
  const current = new Set(currentPermissions)
  const next = new Set(nextPermissions)
  const added = [...next].filter((permission) => !current.has(permission)).sort()
  const removed = [...current].filter((permission) => !next.has(permission)).sort()
  const resulting = [...next].sort()
  const list = (values: readonly string[]): string => values.length > 0
    ? boundedReviewList(values, 40)
    : '• none'
  return [
    'This permission change applies only to the selected workspace.',
    `Added broker permissions:\n${list(added)}`,
    `Removed broker permissions:\n${list(removed)}`,
    `Resulting broker permissions:\n${list(resulting)}`,
    `Host-authored risk summary:\n${boundedReviewList(permissionRiskLabels(resulting), 12)}`,
    'Broker permissions are capability gates; the extension Node host itself is not an operating-system sandbox.'
  ].join('\n\n').slice(0, 16_384)
}

export function formatInstallReviewDetail(review: ExtensionInstallReview): string {
  const signature = review.signatureStatus === 'verified'
    ? 'verified'
    : review.signatureStatus === 'present-unverified'
      ? 'signature present, but not verified by Kun'
      : 'unsigned'
  const permissions = boundedReviewList(review.requestedPermissions, 40)
  const risks = boundedReviewList(review.contributionRisks, 12)
  return [
    'Extensions with Node entrypoints execute with your operating-system user privileges. Broker permissions are not an OS sandbox.',
    `Source: ${safeReviewText(review.sourceKind, 120)}\n${safeReviewText(review.sourceLabel, 1_024)}`,
    review.mutable
      ? 'Package identity: mutable development directory (files can change without reinstalling).'
      : `Package SHA-256: ${review.archiveSha256 ?? 'not available before validation'}`,
    `Signature: ${signature}.`,
    risks.length > 0 ? `Host-authored risk summary:\n${risks}` : 'Host-authored risk summary: no additional high-risk contribution detected.',
    permissions.length > 0
      ? `Requested broker permissions:\n${permissions}`
      : 'This package requests no broker permissions.',
    review.sourceKind === 'Custom HTTPS Index'
      ? 'Kun will download this exact version, verify the displayed SHA-256, then revalidate the package manifest, integrity, compatibility, and permission metadata before activation.'
      : 'Kun will revalidate package integrity, compatibility, and declared resources before activation.'
  ].join('\n\n').slice(0, 16_384)
}

function boundedReviewList(values: readonly string[], maximum: number): string {
  const selected = values.slice(0, maximum).map((value) => `• ${safeReviewText(value, 512)}`)
  if (values.length > maximum) selected.push(`• …and ${values.length - maximum} more`)
  return selected.join('\n')
}

function safeReviewText(value: string, maximum: number): string {
  return value.replace(/\p{Cc}+/gu, ' ').trim().slice(0, maximum)
}
