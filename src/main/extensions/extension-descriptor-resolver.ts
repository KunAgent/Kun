import { ExtensionManifestSchema, type ExtensionManifest } from '@kun/extension-api'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { ExtensionRuntimeRequestResult, ExtensionHostSurface } from '../../shared/extension-ipc'
import type { ExtensionResourceDescriptor } from './extension-resource-protocol'

const RuntimeVersionSchema = z.object({
  version: z.string(),
  path: z.string(),
  grantedPermissions: z.array(z.string()).default([])
})
const RuntimeDevelopmentSchema = RuntimeVersionSchema.extend({ mutable: z.literal(true).optional() })
const RuntimeExtensionSchema = z.object({
  id: z.string(),
  selectedVersion: z.string().optional(),
  globallyEnabled: z.boolean(),
  workspaceEnablement: z.record(z.string(), z.boolean()).default({}),
  workspacePermissionGrants: z.record(z.string(), z.array(z.string())).default({}),
  useDevelopment: z.boolean(),
  versions: z.array(RuntimeVersionSchema),
  development: RuntimeDevelopmentSchema.optional()
})
const RuntimeExtensionResponseSchema = z.object({ extension: RuntimeExtensionSchema })

type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string
) => Promise<ExtensionRuntimeRequestResult>

export type ResolvedExtensionPackage = {
  extensionId: string
  extensionVersion: string
  packageRoot: string
  manifest: ExtensionManifest
  grantedPermissions: string[]
  enabled: boolean
  workspaceTrusted: boolean
}

export type ResolvedExtensionView = ResolvedExtensionPackage & {
  contributionId: string
  entry: string
  localResourceRoots: string[]
  multiple: boolean
}

export type ResolvedHostContentScript = ResolvedExtensionPackage & {
  contributionId: string
  scripts: string[]
  styles: string[]
  runAt: 'documentStart' | 'documentEnd'
}

export class ExtensionDescriptorResolver {
  constructor(private readonly runtimeRequest: RuntimeRequest) {}

  async resolvePackage(extensionId: string, workspaceRoot?: string): Promise<ResolvedExtensionPackage> {
    const response = await this.runtimeRequest(`/v1/extensions/${encodeURIComponent(extensionId)}`, 'GET')
    if (!response.ok) throw new Error('Extension is not available.')
    const payload = RuntimeExtensionResponseSchema.parse(JSON.parse(response.body))
    const extension = payload.extension
    if (extension.id !== extensionId) throw new Error('Extension identity mismatch.')
    const active = extension.useDevelopment
      ? extension.development
      : extension.versions.find((version) => version.version === extension.selectedVersion)
    if (!active) throw new Error('Extension has no selected package.')
    const manifestValue = JSON.parse(await readFile(join(active.path, 'kun-extension.json'), 'utf8')) as unknown
    const manifest = ExtensionManifestSchema.parse(manifestValue)
    if (`${manifest.publisher}.${manifest.name}` !== extensionId || manifest.version !== active.version) {
      throw new Error('Selected extension manifest does not match the registry.')
    }
    const workspaceKey = workspaceRoot === undefined
      ? undefined
      : createHash('sha256').update(resolve(workspaceRoot)).digest('hex')
    const enabled = workspaceKey !== undefined && workspaceKey in extension.workspaceEnablement
      ? extension.workspaceEnablement[workspaceKey]!
      : extension.globallyEnabled
    const workspaceTrusted = workspaceKey === undefined || Object.prototype.hasOwnProperty.call(
      extension.workspacePermissionGrants,
      workspaceKey
    )
    const grantedPermissions = workspaceKey === undefined
      ? active.grantedPermissions
      : workspaceTrusted ? extension.workspacePermissionGrants[workspaceKey]! : []
    return {
      extensionId,
      extensionVersion: active.version,
      packageRoot: resolve(active.path),
      manifest,
      grantedPermissions: [...grantedPermissions],
      enabled,
      workspaceTrusted
    }
  }

  async resolveResourceDescriptor(extensionId: string): Promise<ExtensionResourceDescriptor | undefined> {
    let extension: ResolvedExtensionPackage
    try {
      extension = await this.resolvePackage(extensionId)
    } catch {
      return undefined
    }
    const exactFiles = new Set<string>()
    const hostIconFiles = new Set<string>()
    const localResourceRoots = new Set<string>()
    if (extension.manifest.browser) exactFiles.add(extension.manifest.browser)
    const addIcon = (icon: string | undefined): void => {
      if (!icon) return
      exactFiles.add(icon)
      hostIconFiles.add(icon)
    }
    addIcon(extension.manifest.icon)
    for (const command of extension.manifest.contributes.commands) addIcon(command.icon)
    for (const container of extension.manifest.contributes['views.containers']) {
      addIcon(container.icon)
    }
    for (const key of [
      'views.leftSidebar',
      'views.rightSidebar',
      'views.auxiliaryPanel',
      'views.editorTab',
      'views.fullPage'
    ] as const) {
      for (const view of extension.manifest.contributes[key]) {
        exactFiles.add(view.entry)
        addIcon(view.icon)
        for (const root of view.localResourceRoots) localResourceRoots.add(root)
      }
    }
    for (const actionKey of ['actions.topBar', 'actions.composer', 'actions.message'] as const) {
      for (const action of extension.manifest.contributes[actionKey]) {
        addIcon(action.icon)
      }
    }
    for (const preview of extension.manifest.contributes['message.resultPreviews']) {
      exactFiles.add(preview.entry)
      for (const root of preview.localResourceRoots) localResourceRoots.add(root)
    }
    return {
      extensionId,
      extensionVersion: extension.extensionVersion,
      packageRoot: extension.packageRoot,
      exactFiles: [...exactFiles].sort(),
      localResourceRoots: [...localResourceRoots].sort(),
      hostIconFiles: [...hostIconFiles].sort(),
      allowExternalWebview: extension.grantedPermissions.includes('webview.external')
    }
  }

  async resolveView(
    extensionId: string,
    contributionId: string,
    workspaceRoot?: string
  ): Promise<ResolvedExtensionView> {
    const extension = await this.resolvePackage(extensionId, workspaceRoot)
    if (!extension.enabled) throw new Error('Extension is disabled for this workspace.')
    if (!extension.workspaceTrusted) throw new Error('Extension is not trusted for this workspace.')
    if (!extension.grantedPermissions.includes('webview') || !extension.grantedPermissions.includes('ui.views')) {
      throw new Error('Extension View permissions are not granted.')
    }
    for (const key of [
      'views.leftSidebar',
      'views.rightSidebar',
      'views.auxiliaryPanel',
      'views.editorTab',
      'views.fullPage'
    ] as const) {
      const view = extension.manifest.contributes[key].find((candidate) => candidate.id === contributionId)
      if (view) {
        return {
          ...extension,
          contributionId,
          entry: view.entry,
          localResourceRoots: [...view.localResourceRoots],
          multiple: view.multiple
        }
      }
    }
    throw new Error('Extension View contribution is not declared.')
  }

  async resolveHostContentScript(
    extensionId: string,
    contributionId: string,
    surface: ExtensionHostSurface,
    workspaceRoot?: string
  ): Promise<ResolvedHostContentScript> {
    const extension = await this.resolvePackage(extensionId, workspaceRoot)
    if (!extension.enabled) throw new Error('Extension is disabled for this workspace.')
    if (!extension.workspaceTrusted) throw new Error('Extension is not trusted for this workspace.')
    if (!extension.grantedPermissions.includes('hostDom')) {
      throw new Error('Direct DOM permission is not granted.')
    }
    const contribution = extension.manifest.contributes.hostContentScripts.find(
      (candidate) => candidate.id === contributionId
    )
    if (!contribution) throw new Error('Host content script is not declared.')
    if (!contribution.matches.includes('workbench:*') && !contribution.matches.includes(surface)) {
      throw new Error('Host content script does not match this workbench surface.')
    }
    for (const path of [...contribution.scripts, ...contribution.styles]) {
      if (resolve(extension.packageRoot, path) === extension.packageRoot || path.startsWith('../')) {
        throw new Error('Host content script path is invalid.')
      }
    }
    return {
      ...extension,
      contributionId,
      scripts: [...contribution.scripts],
      styles: [...contribution.styles],
      runAt: contribution.runAt
    }
  }
}

export function viewEntryDirectory(entry: string): string {
  const directory = dirname(entry).replace(/\\/g, '/')
  return directory === '.' ? '' : directory
}
