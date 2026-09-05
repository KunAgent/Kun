import {
  basename,
  isAbsolute,
  join,
  KUN_VERSION,
  type ToolHostContext,
  CURRENT_MANIFEST_VERSION,
  SUPPORTED_EXTENSION_API_VERSIONS,
  type ExtensionManifest,
  ExtensionIndexClient,
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  ExtensionStateMigrationCoordinator,
  ExtensionStateStore,
  seedBundledExtensions,
  type BundledExtensionSeedResult,
  ExtensionHostBroker,
  requiredExtensionBrokerPermission,
  ExtensionViewSessionService,
  ExtensionViewHostGenerationTracker,
  ExtensionSecretRevealConsentService,
  ExtensionConfigurationService,
  ExtensionJobStore,
  ExtensionJobService,
  type ExtensionJobDiagnostic,
  ExtensionMediaHandleService,
  ExtensionMediaProcessService,
  ExtensionMediaFfmpegService,
  ExtensionArtifactService,
  ExtensionMediaJobService,
  ExtensionAudioAnalysisJobService,
  ExtensionMediaArchiveService,
  ExtensionMediaArchiveJobService,
  ExtensionVisualAnalysisService
} from './runtime-factory-dependencies.js'
import type { createRuntimeAgentComposition } from './runtime-composition-agent.js'

export async function createRuntimeExtensionComposition(
  agent: Awaited<ReturnType<typeof createRuntimeAgentComposition>>
) {
  const { registryComposition } = agent
  const { services } = registryComposition
  const { model } = services
  const { core } = model
  const {
    extensionProviderAccounts,
    extensionCredentials,
    extensionAccounts,
    extensionModelProviders
  } = model
  const { backgroundShellRuntime } = services
  const { delegationRuntime } = registryComposition
	  const extensionPaths = new ExtensionPaths({
	    packageRoot: join(core.activeOptions.dataDir, 'extensions'),
	    dataRoot: join(core.activeOptions.dataDir, 'extension-data')
	  })
	  const extensionRegistry = new ExtensionRegistry(extensionPaths)
	  const extensionApiCapabilities = [
	    'commands', 'storage', 'secrets', 'configuration', 'network', 'ui', 'agent', 'threads', 'tools',
	    'modelProviders', 'authentication', 'workspace', 'media', 'jobs'
	  ]
	  const legacyExtensionApiCapabilities = extensionApiCapabilities.filter((capability) =>
	    capability !== 'media' && capability !== 'jobs')
	  const extensionValidation = {
	    compatibility: {
	      kunVersion: KUN_VERSION,
	      supportedManifestVersions: [CURRENT_MANIFEST_VERSION],
	      supportedApiVersions: SUPPORTED_EXTENSION_API_VERSIONS,
	      capabilitiesByApiVersion: Object.fromEntries(
	        SUPPORTED_EXTENSION_API_VERSIONS.map((version) => [
	          version,
	          version === '1.3.0'
	            ? extensionApiCapabilities
	            : version === '1.0.0'
	              ? legacyExtensionApiCapabilities.filter((capability) => capability !== 'secrets')
	              : extensionApiCapabilities.filter((capability) => capability !== 'secrets')
	        ])
	      )
	    }
	  }
	  const extensionPackageManager = new ExtensionPackageManager(
	    extensionPaths,
	    extensionRegistry,
	    extensionValidation
	  )
	  const extensionState = new ExtensionStateStore(extensionPaths)
	  const extensionConfiguration = new ExtensionConfigurationService(extensionState)
	  const extensionMediaHandles = new ExtensionMediaHandleService({ dataDir: core.activeOptions.dataDir })
	  const extensionMediaProcesses = new ExtensionMediaProcessService({
	    handleService: extensionMediaHandles,
	    ...(process.env.KUN_FFPROBE_PATH ? { ffprobePath: process.env.KUN_FFPROBE_PATH } : {}),
	    ...(process.env.KUN_FFMPEG_PATH ? { ffmpegPath: process.env.KUN_FFMPEG_PATH } : {})
	  })
	  const extensionArtifacts = new ExtensionArtifactService({
	    dataDir: core.activeOptions.dataDir,
	    handleService: extensionMediaHandles
	  })
	  const extensionJobDiagnostics: ExtensionJobDiagnostic[] = []
	  const extensionJobStore = new ExtensionJobStore({
	    path: join(core.activeOptions.dataDir, 'extensions', 'jobs.json')
	  })
	  const extensionJobs = new ExtensionJobService({
	    store: extensionJobStore,
	    reauthorize: async (snapshot, workspaceRoot) => {
	      const entry = await extensionRegistry.get(snapshot.ownerExtensionId)
	      if (!entry) return false
	      const manifest = entry.useDevelopment
	        ? entry.development?.manifest
	        : entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined
	      if (!manifest) return false
	      const workspaceKey = extensionPaths.workspaceKey(workspaceRoot)
	      if (workspaceKey !== snapshot.workspaceId) return false
	      return workspaceKey in entry.workspaceEnablement
	        ? entry.workspaceEnablement[workspaceKey] === true
	        : entry.globallyEnabled === true
	    },
	    onDiagnostic: (diagnostic) => {
	      extensionJobDiagnostics.push(diagnostic)
	      if (extensionJobDiagnostics.length > 128) extensionJobDiagnostics.shift()
	    }
	  })
	  const extensionFfmpeg = new ExtensionMediaFfmpegService({
	    handleService: extensionMediaHandles,
	    processService: extensionMediaProcesses
	  })
	  const extensionMediaJobs = new ExtensionMediaJobService({
	    jobs: extensionJobs,
	    ffmpeg: extensionFfmpeg,
	    media: extensionMediaProcesses,
	    artifacts: extensionArtifacts
	  })
	  const extensionAudioAnalysisJobs = new ExtensionAudioAnalysisJobService({
	    jobs: extensionJobs,
	    media: extensionMediaProcesses
	  })
	  const extensionVisualAnalysis = new ExtensionVisualAnalysisService({
	    dataDir: core.activeOptions.dataDir,
	    media: extensionMediaProcesses
	  })
	  const extensionMediaArchive = new ExtensionMediaArchiveService({
	    handles: extensionMediaHandles
	  })
	  const extensionMediaArchiveJobs = new ExtensionMediaArchiveJobService({
	    jobs: extensionJobs,
	    archive: extensionMediaArchive
	  })
	  const extensionViewSessions = new ExtensionViewSessionService()
	  const extensionViewHostGenerations = new ExtensionViewHostGenerationTracker()
	  const extensionSecretReveals = new ExtensionSecretRevealConsentService()
	  const extensionPreparations = new Map<string, { revision: number; promise: Promise<void> }>()
	  let extensionBroker!: ExtensionHostBroker
	  const extensionManager = new ExtensionManager({
	    packageManager: extensionPackageManager,
	    paths: extensionPaths,
	    ...(core.activeOptions.extensionHostRunnerPath
	      ? { runnerPath: core.activeOptions.extensionHostRunnerPath }
	      : {}),
	    capabilitiesForExtension: () => extensionApiCapabilities,
	    broker: (request) => extensionBroker.handle(request),
	    requiredPermission: requiredExtensionBrokerPermission,
	    onNotification: (principal, method, params) =>
	      extensionBroker.notification(principal, method, params),
	    onStream: (principal, requestId, sequence, payload, terminal) =>
	      extensionBroker.stream(principal, requestId, sequence, payload, terminal),
	    onHostActivated: (principal) => {
	      extensionJobs.clearExtensionFence(principal.extensionId)
	      for (const workspaceRoot of principal.workspaceRoots) {
	        extensionJobs.clearWorkspaceFence(
	          principal.extensionId,
	          extensionPaths.workspaceKey(workspaceRoot)
	        )
	      }
	      extensionViewHostGenerations.bindExtension(
	        principal.extensionId,
	        principal.workspaceRoots,
	        principal.lifecycleNonce
	      )
	    },
	    onHostExit: async (exit, principal) => {
	      // Unexpected exits invalidate every guest bound to the crashed Host.
	      // Expected lifecycle stops are already coordinated by disable/version/
	      // shutdown paths. Keeping their sessions here also prevents an idle
	      // teardown from deleting a newly retained View that is waiting for the
	      // old Host cleanup to finish before reactivation.
	      if (!exit.expected) {
	        const workspaceIds = principal.workspaceRoots.map((root) =>
	          extensionPaths.workspaceKey(root))
	        await extensionJobs.handleExtensionHostCrash(
	          exit.extensionId,
	          workspaceIds.length === 0 ? undefined : workspaceIds
	        )
	        for (const sessionId of extensionViewHostGenerations.takeExitedGeneration(
	          exit.extensionId,
	          exit.lifecycleNonce
	        )) {
	          extensionViewSessions.disposeSession(sessionId)
	        }
	      }
	      await extensionBroker.disposeHost(principal)
	      // A crash does not change the registry revision, so explicitly drop
	      // successful lazy-preparation entries and allow clean reactivation.
	      extensionPreparations.clear()
	    }
	  })
	  const resolveExtensionManifest = async (extensionId: string): Promise<ExtensionManifest | undefined> => {
	    const entry = await extensionRegistry.get(extensionId)
	    if (!entry) return undefined
	    if (entry.useDevelopment) return entry.development?.manifest
	    return entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined
	  }
	  extensionBroker = new ExtensionHostBroker({
	    agent: agent.extensionAgent,
	    profiles: agent.extensionProfiles,
	    tools: agent.extensionTools,
	    modelProviders: extensionModelProviders,
	    providerAccounts: extensionProviderAccounts,
	    accounts: extensionAccounts,
	    credentials: extensionCredentials,
	    state: extensionState,
	    configuration: extensionConfiguration,
	    artifacts: extensionArtifacts,
	    mediaHandles: extensionMediaHandles,
	    mediaProcesses: extensionMediaProcesses,
	    mediaJobs: extensionMediaJobs,
	    audioAnalysisJobs: extensionAudioAnalysisJobs,
	    visualAnalysis: extensionVisualAnalysis,
	    archiveJobs: extensionMediaArchiveJobs,
	    jobs: extensionJobs,
	    invokeExtension: (extensionId, activationEvent, method, params, invokeOptions) =>
	      extensionManager.invoke(extensionId, activationEvent, method, params, invokeOptions),
	    notifyExtension: (principal, method, params) =>
	      extensionManager.notify(principal.extensionId, method, params, {
	        workspaceRoots: [...principal.workspaceRoots]
	      }),
	    notifyView: (input) => extensionViewSessions.publishBridgeNotification(input),
	    resolveManifest: resolveExtensionManifest,
	    onUiRequest: extensionViewSessions.onUiRequest,
	    authorizeSecretReveal: (input) => extensionSecretReveals.authorize(input)
	  })
	  extensionViewSessions.onDidDispose((sessionId) => {
	    extensionBroker.disposeViewSession(sessionId)
	  })
	  extensionViewSessions.onDidLifecycle(({ state, session }) => {
	    if (state === 'created') {
	      extensionViewHostGenerations.register(
	        session.sessionId,
	        session.extensionId,
	        session.workspaceRoot,
	        extensionManager.activeHostGeneration(session.extensionId, {
	          ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {})
	        })
	      )
	      extensionManager.retainView(session.extensionId, {
	        ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {})
	      })
	    } else {
	      extensionViewHostGenerations.unregister(session.sessionId)
	      extensionManager.releaseView(session.extensionId, {
	        ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {})
	      })
	    }
	  })
	  extensionConfiguration.onDidChange(async (change) => {
	    const event = {
	      sectionId: change.sectionId,
	      key: change.key,
	      scope: change.scope,
	      value: change.value
	    }
	    const deliveryScope = change.scope === 'workspace'
	      ? { workspaceKey: change.workspaceKey }
	      : undefined
	    await extensionManager.notify(
	      change.extensionId,
	      'configuration.changed',
	      event,
	      deliveryScope
	    ).catch(() => undefined)
	    extensionViewSessions.publish(change.extensionId, 'bridge', {
	      method: 'configuration.changed',
	      params: event
	    }, deliveryScope)
	  })
	  const extensionStateMigrations = new ExtensionStateMigrationCoordinator(
	    extensionState,
	    extensionManager,
	    extensionRegistry
	  )
	  const extensionLifecycle = extensionStateMigrations.lifecycle()
	  extensionPackageManager.setLifecycle({
	    runVersionSwitch: async (context, commitSelection) => {
	      await extensionJobs.handleExtensionRollback(context.extensionId)
	      await extensionMediaHandles.revokeExtension(context.extensionId)
	      extensionViewSessions.disposeExtension(context.extensionId)
	      await extensionBroker.disposeExtension(context.extensionId)
	      if (extensionLifecycle.runVersionSwitch === undefined) {
	        throw new Error('Extension version switch transaction coordinator is unavailable')
	      }
	      await extensionLifecycle.runVersionSwitch(context, commitSelection)
	    },
	    recoverVersionSwitch: (extensionId) =>
	      extensionLifecycle.recoverVersionSwitch?.(extensionId) ?? Promise.resolve(),
	    recoverVersionSwitches: () =>
	      extensionLifecycle.recoverVersionSwitches?.() ?? Promise.resolve(),
	    beforeDisable: async (extensionId, workspaceKey, workspaceRoot) => {
	      if (workspaceKey === undefined) {
	        await extensionJobs.handleExtensionDisabled(extensionId)
	        await extensionMediaHandles.revokeExtension(extensionId)
	      } else {
	        await extensionJobs.handleWorkspaceRevoked(extensionId, workspaceKey)
	        await extensionMediaHandles.revokeExtensionWorkspace(
	          extensionId,
	          workspaceKey,
	          workspaceRoot
	        )
	      }
	      await extensionLifecycle.beforeDisable?.(extensionId, workspaceKey)
	      if (workspaceKey === undefined) {
	        extensionViewSessions.disposeExtension(extensionId)
	        await extensionBroker.disposeExtension(extensionId)
	      } else {
	        extensionViewSessions.disposeExtensionWorkspace(extensionId, workspaceKey)
	        await extensionBroker.disposeExtensionWorkspace(extensionId, workspaceKey)
	      }
	    },
	    beforePermissionChange: async (extensionId, workspaceKey, workspaceRoot) => {
	      await extensionJobs.handleWorkspaceRevoked(extensionId, workspaceKey)
	      await extensionMediaHandles.revokeExtensionWorkspace(
	        extensionId,
	        workspaceKey,
	        workspaceRoot
	      )
	      extensionViewSessions.disposeExtensionWorkspace(extensionId, workspaceKey)
	      await extensionManager.deactivateWorkspace(extensionId, workspaceKey)
	      await extensionBroker.disposeExtensionWorkspace(extensionId, workspaceKey)
	    },
	    beforeUninstall: async (extensionId) => {
	      await extensionJobs.handleExtensionUninstalled(extensionId)
	      await extensionMediaHandles.revokeExtension(extensionId)
	      await extensionLifecycle.beforeUninstall?.(extensionId)
	      extensionViewSessions.disposeExtension(extensionId)
	      await extensionBroker.disposeExtension(extensionId)
	    }
	  })
	  await extensionPackageManager.recover()
	  let bundledSeedResults: BundledExtensionSeedResult[] = []
	  await extensionJobs.initialize()
	  if (core.activeOptions.bundledExtensionsDir) {
	    try {
	      const bundledResults = await seedBundledExtensions({
	        directory: core.activeOptions.bundledExtensionsDir,
	        packageManager: extensionPackageManager
	      })
	      bundledSeedResults = bundledResults
	      for (const result of bundledResults) {
	        if (result.outcome === 'unchanged') continue
	        const suffix = result.code ? ` (${result.code})` : ''
	        const message = `[extensions] bundled ${result.extensionId}@${result.version}: ${result.outcome}${suffix}`
	        if (result.outcome === 'failed' || result.outcome.startsWith('skipped-')) {
	          console.warn(message)
	        } else {
	          console.info(message)
	        }
	      }
	    } catch (error) {
	      const message = error instanceof Error ? error.message : 'unknown bundled extension error'
	      console.warn(`[extensions] bundled catalog unavailable: ${message}`)
	    }
	  }
	  const extensionIndexClient = new ExtensionIndexClient()
	  const activateDeclaredHeadlessContributions = async (
	    document: Awaited<ReturnType<ExtensionRegistry['read']>>,
	    context?: ToolHostContext
	  ): Promise<boolean> => {
	    const outcomes = await Promise.allSettled(Object.values(document.extensions).map(async (entry) => {
	      const workspaceRoot = context?.workspace && isAbsolute(context.workspace)
	        ? context.workspace
	        : undefined
	      const workspaceKey = workspaceRoot
	        ? extensionPaths.workspaceKey(workspaceRoot)
	        : undefined
	      const enabled = workspaceKey && workspaceKey in entry.workspaceEnablement
	        ? entry.workspaceEnablement[workspaceKey]
	        : entry.globallyEnabled
	      if (!enabled) return
	      const manifest = entry.useDevelopment
	        ? entry.development?.manifest
	        : entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined
	      if (!manifest?.main) return
	      const declaredHeadlessEvents = [
	        ...manifest.contributes.tools.map(({ id }) => `onTool:${id}`),
	        ...manifest.contributes.modelProviders.map(({ id }) => `onProvider:${id}`),
	        ...manifest.contributes.agentProfiles.map(({ id }) => `onAgentProfile:${id}`)
	      ]
	      const event = declaredHeadlessEvents.find((candidate) =>
	        manifest.activationEvents.includes(candidate)
	      ) ?? (manifest.activationEvents.includes('onStartup') ? 'onStartup' : undefined)
	      if (event) await extensionManager.activate(entry.id, event, {
	        ...(workspaceRoot
	          ? {
	              workspaceRoot,
	              workspaceContext: {
	                id: workspaceKey!,
	                name: basename(workspaceRoot) || workspaceRoot,
	                root: workspaceRoot,
	                trusted: true,
	                active: true
	              }
	            }
	          : {})
	      })
	    }))
	    return outcomes.every((outcome) => outcome.status === 'fulfilled')
	  }
	  agent.prepareExtensionContributions = async (context) => {
	    const key = context?.workspace ?? '__global__'
	    const document = await extensionRegistry.read()
	    const existing = extensionPreparations.get(key)
	    if (existing?.revision === document.revision) return existing.promise
	    let record!: { revision: number; promise: Promise<void> }
	    const promise = activateDeclaredHeadlessContributions(document, context)
	      .then((allSucceeded) => {
	        // A partially failed activation is deliberately not sticky. The
	        // manager's bounded restart backoff controls retries per extension.
	        if (!allSucceeded && extensionPreparations.get(key) === record) {
	          extensionPreparations.delete(key)
	        }
	      })
	      .catch((error) => {
	        if (extensionPreparations.get(key) === record) extensionPreparations.delete(key)
	        throw error
	      })
	    record = { revision: document.revision, promise }
	    extensionPreparations.set(key, record)
	    return promise
	  }
	  backgroundShellRuntime.bindAgentLoop({
	    runTurn: agent.runAgentTurn
	  })
	  delegationRuntime?.bindAgentLoop({
	    runTurn: agent.runAgentTurn
	  })
  return {
    agent,
    extensionPaths,
    extensionRegistry,
    extensionApiCapabilities,
    legacyExtensionApiCapabilities,
    extensionValidation,
    extensionPackageManager,
    extensionState,
    extensionConfiguration,
    extensionMediaHandles,
    extensionMediaProcesses,
    extensionArtifacts,
    extensionJobDiagnostics,
    extensionJobStore,
    extensionJobs,
    extensionFfmpeg,
    extensionMediaJobs,
    extensionAudioAnalysisJobs,
    extensionVisualAnalysis,
    extensionMediaArchive,
    extensionMediaArchiveJobs,
    extensionViewSessions,
    extensionViewHostGenerations,
    extensionSecretReveals,
    extensionPreparations,
    extensionBroker,
    extensionManager,
    resolveExtensionManifest,
    extensionStateMigrations,
    extensionLifecycle,
    bundledSeedResults,
    extensionIndexClient,
    activateDeclaredHeadlessContributions
  }
}
