import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import { getModelProviderSettings, projectExecutableModelRoutePools } from '@shared/app-settings-provider-core'
import { projectFailoverGroupsForRuntime } from '@shared/app-settings-provider-failover'
import type { AdeCollaborationSettingsSnapshot } from '@shared/ade-collaboration-settings'
import { mutateAdeProjectDefaults, type AdeProjectDefaultsSnapshot } from '@shared/ade-project-defaults'
import type { KunGuiApi, KunProjectConfigFileResult, RuntimeRequestResult } from '@shared/kun-gui-api'
import type { GoogleWorkspaceStatus } from '@shared/google-workspace'
import type { DataMigrationEstimate, DataMigrationOperationStatus } from '@shared/data-migration'
import type { StorageRelocationStatus } from '@shared/storage-relocation'
import type { UninstallStatus } from '@shared/uninstall'
import { localWhisperModelById } from '@shared/local-whisper'
import { LOCAL_SANOTTS_RUNTIME_SIZE_BYTES, type LocalSanottsRuntimeStatus } from '@shared/local-sanotts'
import { localSanottsVoiceById, resolveLocalSanottsVoiceId } from '@shared/local-sanotts-voices'
import type { CoreMemoryDiagnosticsJson, CoreRuntimeInfoJson, CoreRuntimeToolDiagnosticsJson } from '../agent/kun-contract'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { sharedCapabilitiesFromProvider } from './settings-section-providers-shared-payloads'
import { createAgentEnablementSmokeRuntime } from './ade/agent-enablement-smoke-runtime'
import { mergeSettings } from './settings-utils'

export type SettingsSmokeCall = { name: string; args: unknown[] }

const STAMP = '2026-01-01T12:00:00.000Z'
const HOME = 'C:\\Users\\smoke'
const OFFLINE = 'Unavailable in the offline Settings UI fixture.'
const clone = <T>(value: T): T => structuredClone(value)
const response = (value: unknown, status = 200): RuntimeRequestResult => ({
  ok: status >= 200 && status < 300, status, body: JSON.stringify(value)
})

/** Synthetic renderer-only bridge. Never wraps or falls back to the real preload. */
export function installSettingsSmokeHost(initialSettings: AppSettingsV1): {
  calls: SettingsSmokeCall[]
  harnessRuntime: ReturnType<typeof createAgentEnablementSmokeRuntime>
  setBusy(name: string, busy: boolean): void
  setSettings(next: AppSettingsV1): void
  readonly settings: AppSettingsV1
} {
  let settings = clone(initialSettings)
  let revision = 1
  const calls: SettingsSmokeCall[] = []
  const busy = new Set<string>()
  const waiters = new Map<string, Set<() => void>>()
  const subscriptions = new Map<string, Set<(value: unknown) => void>>()
  const runtimeCancellations = new Map<string, () => void>()
  const harnessRuntime = createAgentEnablementSmokeRuntime(() => getKunRuntimeSettings(settings).harnesses)
  let mcpContent = '{\n  "mcp": { "servers": {} }\n}\n'
  const projectConfigs = new Map<string, KunProjectConfigFileResult>()
  const projects = new Map<string, AdeProjectDefaultsSnapshot>()
  const ade = getKunRuntimeSettings(settings).ade ?? defaultKunAdeSettings()
  let collaboration: AdeCollaborationSettingsSnapshot = {
    revision: 'smoke-1',
    value: {
      enabled: ade.enabled, managerModel: ade.managerModel,
      managerMayApprove: ade.managerMayApprove,
      allowUnattendedFullAccess: ade.allowUnattendedFullAccess,
      limits: clone(ade.limits), budget: clone(ade.budget),
      hibernation: clone(ade.hibernation), stall: clone(ade.stall)
    }
  }

  // Keep potentially pasted secrets out of the inspectable call ledger.
  function record(name: string, args: unknown[]): void {
    const redact = (value: unknown, key = ''): unknown => {
      if (/api.?key|token|passphrase|password|credential|secret|authorization/i.test(key)) return '[redacted]'
      if (typeof value === 'function') return '[handler]'
      if (Array.isArray(value)) return value.map((entry) => redact(entry))
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
      }
      if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
        try { return JSON.stringify(redact(JSON.parse(value))) } catch { /* Plain text. */ }
      }
      return value
    }
    calls.push({ name, args: args.map((value) => redact(value)) })
  }
  const gate = async (name: string): Promise<void> => {
    while (busy.has(name)) await new Promise<void>((resolve) => {
      const pending = waiters.get(name) ?? new Set<() => void>()
      pending.add(resolve)
      waiters.set(name, pending)
    })
  }
  function stub<A extends unknown[], R>(name: string, run: (...args: A) => R) {
    return async (...args: A): Promise<Awaited<R>> => {
      record(name, args)
      await gate(name)
      return await run(...args)
    }
  }
  const blocked = (name: string) => stub(name, (..._args: unknown[]): never => { throw new Error(OFFLINE) })
  const subscribe = <T>(name: string) => (handler: (value: T) => void): (() => void) => {
    record(name, [handler])
    const listeners = subscriptions.get(name) ?? new Set<(value: unknown) => void>()
    const listener = handler as (value: unknown) => void
    listeners.add(listener)
    subscriptions.set(name, listeners)
    return () => { listeners.delete(listener) }
  }
  const emit = (name: string, value: unknown): void => {
    for (const listener of subscriptions.get(name) ?? []) listener(clone(value))
  }
  const syncStatus = () => ({ state: 'synced' as const, generation: revision, at: STAMP })
  const patchSettings = (patch: AppSettingsPatch): AppSettingsV1 => {
    settings = mergeSettings(settings, patch)
    revision += 1
    emit('onRuntimeSettingsSyncStatus', syncStatus())
    return clone(settings)
  }
  const projectSnapshot = (projectPath: string): AdeProjectDefaultsSnapshot => {
    if (!projects.has(projectPath)) projects.set(projectPath, {
      project: { key: projectPath, sourcePath: projectPath, kind: 'directory' },
      value: {}, revision: 'smoke-project-1'
    })
    return clone(projects.get(projectPath)!)
  }
  const projectConfig = (workspaceRoot: string): KunProjectConfigFileResult => clone(
    projectConfigs.get(workspaceRoot) ?? {
      workspaceRoot, path: `${workspaceRoot}/.kun/project.json`, exists: false,
      content: '', status: 'missing', trust: 'untrusted', serverSummaries: [],
      skillRootCount: 0, disabledSkillCount: 0
    }
  )
  const memory: CoreMemoryDiagnosticsJson = {
    enabled: true, rootDir: `${HOME}\\.kun\\memory`, activeCount: 0, tombstoneCount: 0,
    canonicalCount: 0, malformedCount: 0, indexState: 'ready', indexedCount: 0, staleCount: 0,
    feedback: {
      enabled: true, state: 'ready', projection: 'ready', eventCount: 0,
      aggregateCount: 0, duplicateCount: 0, malformedCount: 0
    }
  }
  const capability = { enabled: true, available: true, status: 'available' as const }
  const unavailable = { enabled: false, available: false, status: 'disabled' as const, reason: OFFLINE }
  const runtimeInfo = (): CoreRuntimeInfoJson => ({
    host: '127.0.0.1', port: getKunRuntimeSettings(settings).port,
    dataDir: `${HOME}\\.kun`, startedAt: STAMP, model: getKunRuntimeSettings(settings).model,
    capabilities: {
      contractVersion: 1,
      model: { id: getKunRuntimeSettings(settings).model, inputModalities: ['text'],
        outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'] },
      cli: { serve: capability, run: capability, chat: capability, exec: capability },
      mcp: { ...capability, configuredServers: 0, connectedServers: 0, toolCount: 0 },
      web: { ...unavailable, fetch: unavailable, search: unavailable },
      skills: { ...capability, configuredRoots: 1, discoveredSkills: 0 },
      subagents: { ...capability, maxParallel: 4, profiles: [] },
      attachments: { ...capability, maxImageBytes: 20_000_000, maxImageDimension: 4096, allowedMimeTypes: ['image/png'] },
      memory: { ...capability, scopes: ['user', 'workspace', 'project'], maxInjectedRecords: 20 },
      computerUse: { ...unavailable, mode: 'off' }, browserUse: { ...unavailable, mode: 'public' }
    }
  })
  const tools: CoreRuntimeToolDiagnosticsJson = {
    providers: [], mcpServers: [], mcpOAuth: [], webProviders: [],
    skills: { enabled: true, roots: [], skills: [], validationErrors: [], lastActivations: [] },
    instructions: { enabled: true, readErrors: [], lastInjection: { sources: [], injectedBytes: 0 } },
    memory, subagents: { enabled: true, active: 0, childRuns: [] }
  }
  const connections = () => {
    const provider = getModelProviderSettings(settings)
    const kun = getKunRuntimeSettings(settings)
    return {
      schemaVersion: 1, proxyRoutingVersion: 1, revision,
      providers: provider.providers.map((item) => ({
        id: item.id, accountId: `smoke-${item.id}`, name: item.name,
        kind: item.kind ?? 'http', authType: item.kind && item.kind !== 'http' ? 'subscription' : 'api-key', baseUrl: item.baseUrl,
        endpointFormat: item.endpointFormat, endpoints: item.endpoints, useProxy: item.useProxy,
        configured: false, credentialStatus: 'missing', models: item.models,
        modelCapabilities: sharedCapabilitiesFromProvider(item),
        selectedModel: item.id === kun.providerId ? kun.model : item.models[0]
      })),
      defaultProviderId: kun.providerId, defaultModel: kun.model, proxy: provider.proxy,
      routePools: provider.routePools, failover: projectFailoverGroupsForRuntime(provider),
      localModelGateway: provider.localGateway
    }
  }
  const runtimeRequest: KunGuiApi['runtimeRequest'] = stub('runtimeRequest', async (path, method = 'GET', body, options) => {
    const url = new URL(path, 'http://smoke.invalid')
    await gate(`runtimeRequest:${url.pathname}`)
    const harnessResponse = await harnessRuntime.request(path, method, body)
    if (harnessResponse) return harnessResponse
    if (method !== 'GET') return response({ code: 'offline_fixture', message: OFFLINE }, 501)
    if (url.pathname === '/v1/model-connections/events') {
      // Respect long-poll semantics so the provider watcher cannot spin the UI.
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          if (options?.requestId) runtimeCancellations.delete(options.requestId)
          resolve()
        }
        const timer = setTimeout(finish, 25_000)
        if (options?.requestId) runtimeCancellations.set(options.requestId, finish)
      })
      return response({ snapshot: connections() })
    }
    if (url.pathname === '/v1/model-connections') return response(connections())
    if (url.pathname === '/v1/model-routes') {
      const provider = getModelProviderSettings(settings)
      return response({
        localGateway: { ...provider.localGateway, credential: { configured: false } },
        pools: projectExecutableModelRoutePools(provider), configuredPools: provider.routePools,
        metrics: {}, events: [], tests: []
      })
    }
    const routes: Record<string, unknown> = {
      '/health': { ok: true }, '/v1/runtime/info': runtimeInfo(), '/v1/runtime/tools': tools,
      '/v1/memory': { memories: [] }, '/v1/memory/diagnostics': memory,
      '/v1/memory/distillation': { candidates: [] }, '/v1/debug/llm-rounds': { rounds: [] },
      '/v1/usage': { summary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, entries: [] },
      '/v1/task-workspaces/preserved-branches': { branches: [] },
      '/v1/threads': { threads: [] }, '/v1/harnesses': { harnesses: [] },
      '/v1/delegation/profiles': { profiles: [] },
      '/v1/runtime/skills': { enabled: true, roots: [], skills: [], validationErrors: [] },
      '/v1/mcp/oauth': { servers: [] }
    }
    return Object.prototype.hasOwnProperty.call(routes, url.pathname)
      ? response(routes[url.pathname])
      : response({ code: 'offline_fixture', message: `${OFFLINE} ${method} ${url.pathname}` }, 501)
  })

  const migrationStatus: DataMigrationOperationStatus = {
    featureEnabled: true, recoverable: [], recentReports: []
  }
  const estimate: DataMigrationEstimate = {
    workspaces: [{ workspaceId: 'smoke-workspace', displayName: 'Settings demo project',
      sourcePathDisplay: settings.workspaceRoot, sourcePlatform: 'windows',
      fileCount: 12, logicalBytes: 262_144, relatedThreadIds: [], capabilities: ['code'] }],
    threadCount: 0, attachmentCount: 0, artifactCount: 0, memoryCount: 0,
    logicalBytes: 262_144, estimatedPackageBytes: 131_072, sensitiveFindings: [], exclusions: []
  }
  const storage: StorageRelocationStatus = {
    supported: true, enabled: true, platform: 'win32', state: 'default', recoveryRequired: false,
    totalUniqueBytes: 1_048_576,
    roots: ['.kun', '.deepseekgui'].map((name) => ({
      name: name as '.kun' | '.deepseekgui', logicalPath: `${HOME}\\${name}`,
      physicalPath: `${HOME}\\${name}`, exists: true, junction: false, appOwned: true,
      files: 24, directories: 6, links: 0, bytes: 524_288
    }))
  }
  const uninstall: UninstallStatus = {
    schemaVersion: 1, platform: 'win32', isPackaged: true, canRemoveApp: true,
    removeAppMode: 'uninstaller', appInstallPath: 'C:\\Program Files\\Kun',
    paths: [{ kind: 'kunData', path: `${HOME}\\.kun`, exists: true },
      { kind: 'userData', path: `${HOME}\\.deepseekgui`, exists: true }]
  }
  const google: GoogleWorkspaceStatus = {
    experimental: true, binary: { available: true, version: '0.22.5 (fixture)' },
    auth: { state: 'disconnected', scopes: [] },
    services: { gmail: { state: 'unknown' }, calendar: { state: 'unknown' }, drive: { state: 'unknown' } }
  }
  const sanotts: LocalSanottsRuntimeStatus = {
    runtimeId: 'sanotts-runtime', label: 'sanoTTS runtime', source: 'ampixa/sanoTTS',
    license: 'GPL-3.0 (G2P) / MIT (neural runtime)', sizeBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
    state: 'not_downloaded'
  }
  const pick = () => ({ canceled: true, path: null })
  const open = () => ({ ok: true as const })
  const permission = () => ({ platform: 'win32', supported: false, needsPermission: false,
    accessibility: 'unknown' as const, screenRecording: 'unknown' as const, accessibilityNeedsRestart: false })
  const cliStatus = () => ({ state: 'not-installed' as const, commandPath: `${HOME}\\.local\\bin\\kun.cmd` })
  const updateInfo = (channel = settings.guiUpdate.channel) => ({
    ok: true as const, currentVersion: '0.1.0', latestVersion: '0.1.0', hasUpdate: false,
    releaseUrl: 'https://example.invalid/offline-settings-fixture', channel
  })
  let extensionRevision = 1
  const extensionValues: Record<string, Record<string, unknown>> = {}
  const bridge: Partial<KunGuiApi> = {
    platform: 'win32', homeDir: HOME, desktopTitleBarMode: 'custom',
    appEnvironment: { flavor: 'production', runtimeFlavor: 'production', appName: 'Kun',
      appId: 'com.example.kun.settings-smoke', profilePath: `${HOME}\\.deepseekgui`, isPackaged: true },
    getSettings: stub('getSettings', () => clone(settings)),
    fetchUpstreamModels: stub('fetchUpstreamModels', () => {
      const provider = getModelProviderSettings(settings)
      const kun = getKunRuntimeSettings(settings)
      return {
        ok: true as const,
        modelIds: [...new Set(provider.providers.flatMap((item) => item.models))],
        defaultModelId: kun.model,
        defaultModel: { providerId: kun.providerId, modelId: kun.model },
        modelGroups: provider.providers.map((item) => ({
          providerId: item.id, kind: item.kind, presetSource: item.presetSource?.presetId,
          label: item.name, modelIds: [...item.models], modelProfiles: clone(item.modelProfiles)
        }))
      }
    }),
    probeModelProvider: stub('probeModelProvider', () => ({ ok: false as const, message: OFFLINE })),
    setSettings: stub('setSettings', patchSettings),
    saveSettingsSilent: stub('saveSettingsSilent', patchSettings),
    runtimeRequest,
    cancelRuntimeRequest: stub('cancelRuntimeRequest', (requestId: string) => {
      runtimeCancellations.get(requestId)?.()
      return true
    }),
    getRuntimeSettingsSyncStatus: stub('getRuntimeSettingsSyncStatus', syncStatus),
    onRuntimeSettingsSyncStatus: subscribe('onRuntimeSettingsSyncStatus'),
    getAppVersion: stub('getAppVersion', () => '0.1.0-smoke'),
    getLogPath: stub('getLogPath', () => `${HOME}\\.deepseekgui\\logs\\kun.log`),
    logError: stub('logError', () => undefined),
    openLogDir: stub('openLogDir', open), openExternal: stub('openExternal', () => undefined),
    openSettingsConfigFile: stub('openSettingsConfigFile', open),
    pickWorkspaceDirectory: stub('pickWorkspaceDirectory', pick),
    workspaceDirectoryExists: stub('workspaceDirectoryExists', () => true),
    confirmDialog: stub('confirmDialog', () => false), alertDialog: stub('alertDialog', () => undefined),
    getComputerUsePermissions: stub('getComputerUsePermissions', permission),
    requestComputerUsePermission: stub('requestComputerUsePermission', permission),
    cliInstallStatus: stub('cliInstallStatus', cliStatus),
    cliInstallAction: stub('cliInstallAction', () => ({ ok: false, status: cliStatus(), message: OFFLINE })),
    getGuiUpdateState: stub('getGuiUpdateState', () => ({ status: 'idle' as const })),
    checkGuiUpdate: stub('checkGuiUpdate', updateInfo), onGuiUpdateState: subscribe('onGuiUpdateState'),
    downloadGuiUpdate: stub('downloadGuiUpdate', () => ({ ok: false as const, currentVersion: '0.1.0', message: OFFLINE })),
    installGuiUpdate: stub('installGuiUpdate', () => ({ ok: false as const, currentVersion: '0.1.0', message: OFFLINE })),
    listWriteInlineCompletionDebugEntries: stub('listWriteInlineCompletionDebugEntries', () => []),
    clearWriteInlineCompletionDebugEntries: stub('clearWriteInlineCompletionDebugEntries', () => true),
    listRemoteSshHosts: stub('listRemoteSshHosts', () => []),
    pickRemoteSshIdentityFile: stub('pickRemoteSshIdentityFile', () => null),
    createRemoteSshHost: blocked('createRemoteSshHost'), updateRemoteSshHost: blocked('updateRemoteSshHost'),
    removeRemoteSshHost: blocked('removeRemoteSshHost'), connectRemoteSshHost: blocked('connectRemoteSshHost'),
    listGitBranchWorktrees: stub('listGitBranchWorktrees', (input) => ({
      ok: true as const, repositoryRoot: input.projectPath,
      worktreeRoot: input.worktreeRoot ?? `${HOME}\\.kun\\worktrees`, worktrees: []
    })),
    removeGitBranchWorktree: blocked('removeGitBranchWorktree'),
    detectLegacySessions: stub('detectLegacySessions', () => ({ destDir: `${HOME}\\.kun\\threads`, sources: [] })),
    pickLegacySessionDir: stub('pickLegacySessionDir', pick), importLegacySessions: blocked('importLegacySessions'),
    listSkillRoots: stub('listSkillRoots', () => ({ ok: true as const, roots: [{
      id: 'smoke-global', disableKey: `${HOME}\\.kun\\skills`, path: `${HOME}\\.kun\\skills`,
      scope: 'global' as const, source: 'common' as const, exists: true, enabled: true, skillCount: 0
    }] })),
    openSkillRoot: stub('openSkillRoot', open),
    getKunConfigFile: stub('getKunConfigFile', () => ({ path: `${HOME}\\.kun\\mcp.json`, content: mcpContent, exists: true })),
    setKunConfigFile: stub('setKunConfigFile', (content: string) => {
      mcpContent = content
      return { ok: true as const, path: `${HOME}\\.kun\\mcp.json` }
    }),
    openKunConfigDir: stub('openKunConfigDir', open),
    getKunProjectConfigFile: stub('getKunProjectConfigFile', projectConfig),
    setKunProjectConfigFile: stub('setKunProjectConfigFile', (workspaceRoot: string, content: string) => {
      const next = { ...projectConfig(workspaceRoot), content, exists: true, status: 'valid' as const }
      JSON.parse(content)
      projectConfigs.set(workspaceRoot, next)
      return clone(next)
    }),
    setKunProjectConfigTrust: blocked('setKunProjectConfigTrust'),
    openKunProjectConfigDir: stub('openKunProjectConfigDir', open),
    getAdeCollaborationSettings: stub('getAdeCollaborationSettings', () => clone(collaboration)),
    saveAdeCollaborationSettings: stub('saveAdeCollaborationSettings', (request) => {
      if (request.expectedRevision !== collaboration.revision) return { ok: false as const, kind: 'conflict' as const, ...clone(collaboration) }
      patchSettings({ agents: { kun: { ade: request.value } } })
      collaboration = { value: clone(request.value), revision: `smoke-${revision}` }
      return { ok: true as const, generation: revision, ...clone(collaboration) }
    }),
    getAdeProjectDefaults: stub('getAdeProjectDefaults', ({ projectPath }) => projectSnapshot(projectPath)),
    saveAdeProjectDefaults: stub('saveAdeProjectDefaults', (request) => {
      const current = projectSnapshot(request.projectPath)
      if (request.expectedRevision !== current.revision) return { ok: false as const, kind: 'conflict' as const, ...current }
      revision += 1
      const next = { ...current, value: mutateAdeProjectDefaults(current.value, request), revision: `smoke-project-${revision}` }
      projects.set(request.projectPath, next)
      emit('onRuntimeSettingsSyncStatus', syncStatus())
      return { ok: true as const, generation: revision, ...clone(next) }
    }),
    gatewayCredential: stub('gatewayCredential', (action) => ({ ok: action === 'status', status: action === 'status' ? 200 : 501, credential: { configured: false } })),
    revealModelProviderCredential: stub('revealModelProviderCredential', (providerId: string) => ({ providerId, credential: '' })),
    onProviderImportLink: subscribe('onProviderImportLink'),
    onProviderMutationFlushRequest: subscribe('onProviderMutationFlushRequest'),
    claudeSubscriptionStatus: stub('claudeSubscriptionStatus', () => ({ loggedIn: false, source: 'none' as const })),
    claudeSubscriptionSdkStatus: stub('claudeSubscriptionSdkStatus', () => ({ installed: false })),
    claudeSubscriptionModels: stub('claudeSubscriptionModels', () => []),
    onClaudeSubscriptionSdkProgress: subscribe('onClaudeSubscriptionSdkProgress'),
    geminiSubscriptionCliStatus: stub('geminiSubscriptionCliStatus', () => ({ installed: false })),
    onGeminiSubscriptionCliProgress: subscribe('onGeminiSubscriptionCliProgress'),
    geminiCliSubscriptionStatus: stub('geminiCliSubscriptionStatus', () => ({ installed: false, authenticated: false })),
    geminiCliSubscriptionModels: stub('geminiCliSubscriptionModels', () => []),
    getLocalWhisperModelStatus: stub('getLocalWhisperModelStatus', (id) => ({ ...localWhisperModelById(id), modelId: localWhisperModelById(id).id, state: 'not_downloaded' as const })),
    checkLocalWhisperDownloadSources: stub('checkLocalWhisperDownloadSources', (input) => ({ modelId: localWhisperModelById(input?.modelId).id, sources: [] })),
    onLocalWhisperModelProgress: subscribe('onLocalWhisperModelProgress'),
    downloadLocalWhisperModel: blocked('downloadLocalWhisperModel'),
    cancelLocalWhisperModel: blocked('cancelLocalWhisperModel'), deleteLocalWhisperModel: blocked('deleteLocalWhisperModel'),
    getLocalSanottsRuntimeStatus: stub('getLocalSanottsRuntimeStatus', () => clone(sanotts)),
    getLocalSanottsVoiceStatus: stub('getLocalSanottsVoiceStatus', (id) => ({
      voiceId: localSanottsVoiceById(id ?? resolveLocalSanottsVoiceId('auto', 'en')).id,
      sizeBytes: 0, state: 'not_downloaded' as const
    })),
    listDownloadedLocalSanottsVoices: stub('listDownloadedLocalSanottsVoices', () => []),
    checkLocalSanottsDownloadSources: stub('checkLocalSanottsDownloadSources', () => ({ sources: [] })),
    onLocalSanottsAssetProgress: subscribe('onLocalSanottsAssetProgress'),
    getLocalSanottsTrackUsage: stub('getLocalSanottsTrackUsage', () => ({ count: 0, totalBytes: 0 })),
    listLocalSanottsTrackKeys: stub('listLocalSanottsTrackKeys', () => []),
    clearLocalSanottsTracks: stub('clearLocalSanottsTracks', () => ({ count: 0, totalBytes: 0 })),
    downloadLocalSanottsRuntime: blocked('downloadLocalSanottsRuntime'),
    cancelLocalSanottsRuntime: blocked('cancelLocalSanottsRuntime'), deleteLocalSanottsRuntime: blocked('deleteLocalSanottsRuntime'),
    downloadLocalSanottsVoice: blocked('downloadLocalSanottsVoice'),
    googleWorkspace: {
      status: stub('googleWorkspace.status', () => clone(google)),
      login: blocked('googleWorkspace.login'), setup: blocked('googleWorkspace.setup'),
      test: stub('googleWorkspace.test', () => clone(google)),
      logout: stub('googleWorkspace.logout', () => clone(google)),
      cancel: stub('googleWorkspace.cancel', () => clone(google)),
      openAuthorization: stub('googleWorkspace.openAuthorization', () => ({ opened: false }))
    },
    dataMigration: {
      getStatus: stub('dataMigration.getStatus', () => clone(migrationStatus)),
      estimateExport: stub('dataMigration.estimateExport', () => clone(estimate)),
      listReports: stub('dataMigration.listReports', () => []), getReport: blocked('dataMigration.getReport'),
      pickExportPackage: stub('dataMigration.pickExportPackage', pick),
      pickImportPackage: stub('dataMigration.pickImportPackage', pick),
      pickDestinationDirectory: stub('dataMigration.pickDestinationDirectory', pick),
      inspectPackage: blocked('dataMigration.inspectPackage'), planImport: blocked('dataMigration.planImport'),
      startExport: blocked('dataMigration.startExport'), startImport: blocked('dataMigration.startImport'),
      deleteReport: blocked('dataMigration.deleteReport'), recover: blocked('dataMigration.recover'),
      cancel: stub('dataMigration.cancel', () => clone(migrationStatus)),
      onProgress: subscribe('dataMigration.onProgress'), onRendererRequest: subscribe('dataMigration.onRendererRequest'),
      respondRendererRequest: stub('dataMigration.respondRendererRequest', () => undefined)
    },
    storageRelocation: {
      getStatus: stub('storageRelocation.getStatus', () => clone(storage)),
      pickDestination: stub('storageRelocation.pickDestination', pick),
      preflight: blocked('storageRelocation.preflight'), schedule: blocked('storageRelocation.schedule'),
      restoreDefault: blocked('storageRelocation.restoreDefault'), retry: blocked('storageRelocation.retry'),
      rollback: blocked('storageRelocation.rollback'), cancel: stub('storageRelocation.cancel', () => clone(storage)),
      onProgress: subscribe('storageRelocation.onProgress')
    },
    uninstall: { getStatus: stub('uninstall.getStatus', () => clone(uninstall)), perform: blocked('uninstall.perform') },
    extensionGetWorkbench: stub('extensionGetWorkbench', () => response({ schemaVersion: 1, revision: 1, extensions: [] })),
    extensionList: stub('extensionList', () => response({ extensions: [] })),
    extensionDiagnostics: stub('extensionDiagnostics', () => response({ hosts: [] })),
    extensionListModelProviders: stub('extensionListModelProviders', () => response({ providers: [] })),
    extensionLoadConfiguration: stub('extensionLoadConfiguration', () => response({ schemaVersion: 1, revision: extensionRevision, values: extensionValues })),
    extensionUpdateConfiguration: stub('extensionUpdateConfiguration', (request) => {
      if (request.expectedRevision !== extensionRevision) return response({ message: 'Fixture settings changed.' }, 409)
      extensionValues[request.contributionId] = { ...extensionValues[request.contributionId], [request.key]: request.value }
      return response({ schemaVersion: 1, revision: ++extensionRevision, values: extensionValues })
    }),
    onExtensionViewEvent: subscribe('onExtensionViewEvent'),
    onSseEvent: subscribe('onSseEvent'), onSseOpen: subscribe('onSseOpen'),
    onSseEnd: subscribe('onSseEnd'), onSseError: subscribe('onSseError')
  }
  // No Proxy: absent optional methods remain absent instead of inventing capabilities.
  Object.defineProperty(window, 'kunGui', { configurable: true, writable: true, value: bridge as KunGuiApi })
  rendererRuntimeClient.invalidateSettings()
  return {
    calls, harnessRuntime,
    get settings() { return clone(settings) },
    setSettings(next) {
      settings = clone(next)
      revision += 1
      rendererRuntimeClient.invalidateSettings()
      emitRendererSettingsChanged(clone(settings))
    },
    setBusy(name, value) {
      if (value) { busy.add(name); return }
      busy.delete(name)
      const pending = waiters.get(name)
      waiters.delete(name)
      for (const resolve of pending ?? []) resolve()
    }
  }
}
