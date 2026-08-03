import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  act,
  create as createRenderer,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  getModelProviderPreset,
  modelProviderPresetAccountProfile,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import type {
  AntigravitySubscriptionModelCatalog,
  ClaudeSubscriptionProbeResult,
  CursorSubscriptionModel,
  ModelsDevCatalogResult,
  ModelProviderProbeResult
} from '@shared/kun-gui-api'
import {
  AgentsSettingsSection,
  LaboratorySettingsSection,
  modelProvidersSettingsPatch
} from './settings-section-agents'
import {
  ProvidersSettingsSection,
  antigravityProviderCatalogPatch
} from './settings-section-providers'

const labels: Record<string, string> = {
  agentsQuickBase: 'Base',
  agentsQuickSkill: 'Skills',
  agentsQuickMcp: 'MCP',
  agentsQuickPermissions: 'Permissions',
  agentsQuickLaboratory: 'Laboratory',
  agents: 'Agents',
  providers: 'Providers',
  providersDesc: 'Providers description',
  kunProvider: 'Provider',
  kunProviderDesc: 'Provider description',
  kunProviderSelectDesc: 'Provider select description',
  modelProviderAdd: 'Add provider',
  modelProviderAddMenuCustom: 'Custom provider…',
  modelProviderAddCustomDesc: 'Start with a blank provider and configure its endpoint and models.',
  modelProviderAddDialogTitle: 'Add a provider',
  modelProviderAddDialogDesc: 'Choose a preset or create a custom provider.',
  modelProviderAddDialogCancel: 'Close add provider dialog',
  modelProviderAddDialogSearch: 'Search provider presets…',
  modelProviderAddDialogEmpty: 'No provider presets match "{{query}}".',
  modelProviderTabConnection: 'Connection',
  modelProviderTabModels: 'Models',
  modelProviderTabCapabilities: 'Capabilities',
  modelProviderTabAdvanced: 'Advanced',
  modelProviderWorkspaceTabs: 'Provider settings tabs',
  modelProviderCompactSelect: 'Choose provider',
  modelProviderSearchPlaceholder: 'Search configured providers…',
  modelProviderSearchEmpty: 'No providers match "{{query}}".',
  modelProviderGroupPlans: 'Subscription plans',
  modelProviderSubscriptionRegions: 'Subscription plan regions',
  modelProviderSubscriptionRegionAll: 'All',
  modelProviderSubscriptionRegionChina: 'China',
  modelProviderSubscriptionRegionUnitedStates: 'United States',
  modelProviderGroupApi: 'Pay-as-you-go',
  modelProviderPlanBadge: 'Plan',
  modelProviderTokenPlanBadge: 'Token Plan',
  modelProviderPresetUpdateTag: 'Update preset',
  modelProviderAccountCount: '{{count}} accounts',
  modelProviderAddAccountHint: 'Add an independent account',
  modelProviderNewName: 'Custom provider {{index}}',
  modelProviderDraftBadge: 'Unsaved',
  modelProviderDraftSection: 'Add this provider',
  modelProviderDraftConfirm: 'Add',
  modelProviderDraftDiscard: 'Cancel',
  modelProviderDraftHintReady: 'Click Add to save this provider and switch to it.',
  modelProviderDraftHintNoKey: 'No API key yet — Add saves without activating.',
  modelProviderNeedsConfiguration: 'Needs configuration',
  modelProviderReady: 'Ready',
  modelProviderIdentitySection: 'Provider identity',
  modelProviderIdentityHint: 'Manage the provider ID under Advanced.',
  modelProviderSectionBasics: 'Provider basics',
  modelProviderSectionConnection: 'Provider connection',
  geminiCliReady: 'Antigravity CLI is ready',
  geminiSyncModels: 'Sync Antigravity models',
  geminiModelsSynced: 'Synced {{count}} Antigravity models.',
  modelProviderSectionDanger: 'Danger zone',
  modelProviderTestConnection: 'Test connection',
  modelProviderTesting: 'Testing connection…',
  modelProviderTestSuccess: 'Connected · {{latency}}ms · {{total}} models',
  modelProviderTestFailed: 'Connection failed: {{message}}',
  modelProviderPresetMissingKeyForProbe: 'Enter this provider API key first.',
  claudeSubProbeNotReady: 'Claude subscription is not ready.',
  claudeSubProbeTimeout: 'The real Claude authentication test timed out.',
  claudeSubTokenInvalid: 'Paste only the complete sk-ant-oat token.',
  modelProviderInvalidUrl: 'URL must start with http:// or https://',
  modelProviderFetchModels: 'Fetch models',
  modelProviderFetchedModels: 'Fetched {{total}} new models',
  modelProviderModelsPlaceholder: 'Type a model ID and press Enter',
  modelProviderModelCount: '{{total}} models',
  modelProviderModelRemove: 'Remove {{model}}',
  modelProviderInUse: 'In use',
  modelProviderMissingKey: 'No API key',
  modelProviderDefaultBadge: 'Default',
  modelProviderPresetBadge: 'Preset',
  modelProviderCustomBadge: 'Custom',
  modelProviderDangerHint: 'Danger hint',
  modelProviderIdLocked: 'Provider ID locked',
  modelProviderRemove: 'Remove provider',
  modelProviderName: 'Provider name',
  modelProviderId: 'Provider ID',
  modelProviderApiKey: 'Provider API key',
  modelProviderApiKeyPlaceholder: 'Enter provider API key',
  cursorSubscriptionNote: 'Enter an API key created in the Cursor dashboard.',
  cursorSubscriptionGetApiKey: 'Get Cursor API key',
  cursorSubscriptionAccount: 'Connected account: {{account}} · API key: {{keyName}}',
  cursorSubscriptionRestartRequired: 'Fully quit Kun and reopen it, then try again.',
  geminiCliApiEndpointLocked: 'Gemini CLI API endpoint is fixed.',
  geminiCliApiSubscriptionNote: 'Gemini CLI direct API keeps Kun in charge of long sessions.',
  geminiCliApiChecking: 'Checking the Gemini CLI login…',
  geminiCliApiReady: 'Gemini CLI Google login is ready',
  geminiCliApiLoginRequired: 'Gemini CLI is not signed in to Google',
  geminiCliApiMissing: 'Gemini CLI is not installed',
  geminiCliApiLoginHint: 'Run gemini and sign in with Google.',
  geminiCliApiInstallHint: 'Install and sign in to Gemini CLI.',
  geminiCliApiRecheck: 'Check login again',
  geminiCliApiSyncModels: 'Sync Gemini CLI API models',
  geminiCliApiStatusFailed: 'Could not inspect the Gemini CLI login.',
  geminiCliApiModelsSynced: 'Synced {{count}} Gemini CLI API models.',
  geminiCliApiModelsSyncFailed: 'Could not read the Gemini CLI API model catalog.',
  modelProviderBaseUrl: 'Provider base URL',
  modelProviderEndpointFormat: 'Endpoint format',
  modelProviderRetrySection: 'Failure retry',
  modelProviderRetryMaxAttempts: 'Retry attempts',
  modelProviderRetryMaxAttemptsHint: 'Excludes the initial request. Default 5, maximum 10.',
  modelProviderRetryInitialDelayMs: 'Initial retry delay (ms)',
  modelProviderRetryStatusCodes: 'Retry HTTP status codes',
  modelProviderRetryStatusCodesHint: 'Separate multiple status codes with commas, for example 429,503.',
  modelProviderFetchEmpty: 'No models found',
  providerModelImportTitle: 'Pick models to import',
  providerModelImportSubtitle: 'Found {{total}} for {{provider}}; {{existing}} already added.',
  providerModelImportSearchPlaceholder: 'Search by model name',
  providerModelImportFilterAll: 'All types ({{count}})',
  providerModelImportSourceAll: 'All sources ({{count}})',
  providerModelImportSourceApi: 'Provider API ({{count}})',
  providerModelImportSourceCatalog: 'models.dev ({{count}})',
  providerModelImportSourceApiBadge: 'Provider API',
  providerModelImportSourceCatalogBadge: 'models.dev only',
  providerModelImportSourceBothBadge: 'API + models.dev',
  providerModelImportHideExisting: 'Hide already added ({{count}})',
  providerModelImportAlreadyAdded: 'Already added',
  providerModelImportNoneFetched: 'No models available',
  providerModelImportNoneMatch: 'No models match',
  providerModelImportSelectAllVisible: 'Select filtered ({{count}})',
  providerModelImportClearVisible: 'Clear filtered selection',
  providerModelImportSelectedCount: '{{count}} selected',
  providerModelImportCancel: 'Cancel import',
  providerModelImportConfirm: 'Import {{count}}',
  providerModelImportApplyMetadata: 'Apply model metadata',
  providerModelImportMetadataUpdates: '{{count}} existing models can be updated',
  providerModelImportProviderWarning: 'Provider verification failed: {{message}}',
  providerModelImportProviderReturnedEmpty: 'Provider API returned no models.',
  providerModelImportCatalogError: 'Catalog unavailable: {{message}}',
  providerModelImportCatalogUnmapped: 'No exact catalog mapping.',
  providerModelImportCatalogStale: 'Using cached catalog data.',
  providerModelImportContextBadge: 'Context {{value}}',
  providerModelImportOutputBadge: 'Output {{value}}',
  providerModelImportVisionBadge: 'Vision',
  providerModelImportToolsBadge: 'Tools',
  providerModelImportNoToolsBadge: 'No tools',
  providerModelImportReasoningBadge: 'Reasoning',
  modelEndpointChatCompletions: '/v1/chat/completions (openai)',
  modelEndpointResponses: '/v1/responses (openai)',
  modelEndpointMessages: '/v1/messages (anthropic)',
  modelEndpointCustomEndpoint: 'Custom full endpoint',
  modelProviderModels: 'Provider models',
  modelProviderImageCapability: 'Image capability',
  modelProviderImageCapabilityDesc: 'Image capability description',
  modelProviderImageEnable: 'Enable image',
  modelProviderImageDisable: 'Disable image',
  modelProviderSpeechCapability: 'Speech-to-text capability',
  modelProviderSpeechCapabilityDesc: 'Speech-to-text capability description',
  modelProviderTextToSpeechCapability: 'Speech generation capability',
  modelProviderTextToSpeechCapabilityDesc: 'Speech generation capability description',
  modelProviderMusicCapability: 'Music generation capability',
  modelProviderMusicCapabilityDesc: 'Music generation capability description',
  modelProviderVideoCapability: 'Video generation capability',
  modelProviderVideoCapabilityDesc: 'Video generation capability description',
  modelProviderCapabilityConfigure: 'Configure',
  modelProviderCapabilityCollapse: 'Collapse',
  modelProviderCapabilityEnabled: 'Enabled',
  modelProviderCapabilityDisabled: 'Disabled',
  modelProviderGlobalNetwork: 'Global network proxy',
  modelProviderVisionBadge: 'Vision',
  imageGenProtocol: 'Image protocol',
  imageGenProtocolOpenAi: 'OpenAI Images',
  imageGenProtocolMiniMax: 'MiniMax image_generation',
  imageGenBaseUrl: 'Image base URL',
  imageGenModel: 'Image model',
  imageGenBaseUrlPlaceholder: 'https://api.example.com/v1',
  speechToTextProtocol: 'Speech protocol',
  speechToTextBaseUrl: 'Speech API base URL',
  speechToTextModels: 'Speech models',
  textToSpeechProtocol: 'Speech generation protocol',
  textToSpeechBaseUrl: 'Speech generation base URL',
  textToSpeechBaseUrlPlaceholder: 'https://api.example.com/v1',
  textToSpeechModel: 'Speech generation model',
  musicGenerationProtocol: 'Music generation protocol',
  musicGenerationBaseUrl: 'Music generation base URL',
  musicGenerationBaseUrlPlaceholder: 'https://api.example.com/v1',
  musicGenerationModel: 'Music model',
  videoGenerationProtocol: 'Video generation protocol',
  videoGenerationBaseUrl: 'Video generation base URL',
  videoGenerationBaseUrlPlaceholder: 'https://api.example.com/v1',
  videoGenerationModel: 'Video model',
  proxyEnabled: 'Use proxy for model requests',
  proxyUrlDesc: 'Route model requests through a global proxy.',
  proxyUrlPlaceholder: 'http://127.0.0.1:7890',
  baseUrlPlaceholder: 'https://api.example.com/v1',
  autoApplyHint: 'Changes apply automatically',
  applying: 'Applying…',
  applied: 'Applied',
  applyFailed: 'Could not apply',
  kunApiKey: 'Kun API key',
  kunApiKeyDesc: 'Kun API key description',
  kunApiKeyPlaceholder: 'Inherit API key',
  kunApiKeyInherited: 'Inherited API key',
  kunApiKeyMissing: 'Missing API key',
  kunApiKeyOverride: 'Override API key',
  kunBaseUrl: 'Kun base URL',
  kunBaseUrlDesc: 'Kun base URL description',
  kunBaseUrlPlaceholder: 'Inherit base URL',
  kunBaseUrlOfficial: 'Official base URL',
  kunBaseUrlInherited: 'Inherited base URL',
  kunBaseUrlOverride: 'Override base URL',
  kunAssistantAdvanced: 'Assistant advanced settings',
  kunAssistantAdvancedDesc: 'Assistant advanced settings description',
  autoStart: 'Auto start',
  autoStartDesc: 'Auto start description',
  port: 'Port',
  portDesc: 'Port description',
  kunBinary: 'Kun binary',
  kunBinaryDesc: 'Kun binary description',
  kunBinaryPlaceholder: 'Bundled Kun',
  kunDataDir: 'Data dir',
  kunDataDirDesc: 'Data dir description',
  kunModel: 'Model',
  kunModelDesc: 'Model description',
  kunTokenEconomy: 'Token-saving mode',
  kunTokenEconomyDesc: 'Token-saving mode description',
  kunTokenEconomySavings: 'Saved {{tokens}} tokens',
  kunTokenEconomySavingsLoading: 'Loading savings',
  kunTokenEconomySavingsEmpty: 'Savings empty',
  kunTokenEconomyAdvanced: 'Token-saving advanced settings',
  kunTokenEconomyAdvancedDesc: 'Token-saving advanced settings description',
  kunTokenEconomyOptions: 'Token-saving options',
  kunTokenEconomyOptionsDesc: 'Token-saving options description',
  kunCompressToolDescriptions: 'Compress tool descriptions',
  kunCompressToolResults: 'Compress tool results',
  kunConciseResponses: 'Concise responses',
  kunHistoryHygiene: 'History guard',
  kunHistoryHygieneDesc: 'History guard description',
  kunHistoryMaxResultLines: 'Max result lines',
  kunHistoryMaxResultBytes: 'Max result bytes',
  kunHistoryMaxResultTokens: 'Max result tokens',
  kunHistoryMaxArgumentBytes: 'Max argument bytes',
  kunHistoryMaxArgumentTokens: 'Max argument tokens',
  kunHistoryMaxArrayItems: 'Max array items',
  runtimeToken: 'Runtime token',
  runtimeTokenDesc: 'Runtime token description',
  showSecret: 'Show',
  hideSecret: 'Hide',
  kunInsecure: 'Insecure',
  kunInsecureDesc: 'Insecure description',
  kunInsecureForcedDesc: 'Insecure forced',
  kunAdvanced: 'Advanced runtime settings',
  kunAdvancedDetails: 'Storage, model context, and tool guards',
  kunAdvancedDetailsDesc: 'Per-model context policy comes from models.profiles',
  kunStorageBackend: 'Storage backend',
  kunStorageBackendDesc: 'Storage backend description',
  kunStorageHybrid: 'Hybrid storage',
  kunStorageFile: 'Pure JSONL file storage',
  kunStorageSqlitePath: 'SQLite path',
  kunStorageSqlitePathDesc: 'SQLite path description',
  kunStorageSqlitePathPlaceholder: 'Automatic SQLite path',
  kunModelContextProfile: 'Current model context policy',
  kunModelContextProfileDesc: 'Current model context policy description',
  kunModelContextModel: 'Matched model',
  kunModelContextWindow: 'Context window',
  kunModelContextSoft: 'Model soft threshold',
  kunModelContextHard: 'Model hard threshold',
  kunModelContextSourceBuiltIn: 'Built-in model config',
  kunModelContextSourceFallback: 'Fallback model config',
  kunCompactionThresholds: 'Fallback compaction thresholds',
  kunCompactionThresholdsDesc: 'Fallback compaction thresholds description',
  kunCompactionSoftThreshold: 'Fallback soft threshold',
  kunCompactionHardThreshold: 'Fallback hard threshold',
  kunCompactionSummary: 'Compaction summary',
  kunCompactionSummaryDesc: 'Compaction summary description',
  kunCompactionSummaryMode: 'Summary mode',
  kunCompactionSummaryHeuristic: 'Heuristic summary',
  kunCompactionSummaryModel: 'Model summary',
  kunCompactionSummaryTimeout: 'Summary timeout',
  kunCompactionSummaryMaxTokens: 'Summary max tokens',
  kunCompactionSummaryInputBytes: 'Summary input bytes',
  kunMaxConcurrentTurns: 'Maximum concurrent turns',
  kunMaxConcurrentTurnsDesc: 'Maximum concurrent turns description',
  kunMaxWallTime: 'Maximum turn duration',
  kunMaxWallTimeDesc: 'Maximum turn duration description',
  kunStreamIdleTimeout: 'Stream idle timeout',
  kunStreamIdleTimeoutDesc: 'Stream idle timeout description',
  kunToolStorm: 'Tool storm',
  kunToolStormDesc: 'Tool storm description',
  kunToolStormLimits: 'Tool storm limits',
  kunToolStormLimitsDesc: 'Tool storm limits description',
  kunToolStormWindowSize: 'Tool storm window',
  kunToolStormThreshold: 'Tool storm threshold',
  kunToolOutputLimits: 'Tool output limits',
  kunToolOutputLimitsDesc: 'Tool output limits description',
  kunToolOutputMaxLines: 'Tool output max lines',
  kunToolOutputMaxBytes: 'Tool output max bytes',
  kunToolArgumentRepair: 'Tool argument repair',
  kunToolArgumentRepairDesc: 'Tool argument repair description',
  kunInstructions: 'AGENTS.md instructions',
  kunInstructionsDesc: 'AGENTS.md instructions description',
  kunInstructionsDiagnostics: '1 source injected last turn',
  kunDiagnostics: 'Kun diagnostics',
  kunDiagnosticsAdvanced: 'Detailed diagnostics',
  kunDiagnosticsAdvancedDesc: 'Detailed diagnostics description',
  kunRuntimeCapabilities: 'Runtime capabilities',
  kunRuntimeCapabilitiesDesc: 'Runtime capabilities description',
  kunRuntimeModel: 'Runtime model',
  kunRuntimePid: 'Runtime PID',
  kunDiagnosticsRefresh: 'Refresh diagnostics',
  kunToolDiagnostics: 'Tool diagnostics',
  kunToolDiagnosticsDesc: 'Tool diagnostics description',
  kunDiagnosticsProviders: 'Providers',
  kunDiagnosticsMcpServers: 'MCP servers',
  kunDiagnosticsSkills: 'Discovered Skills',
  kunDiagnosticsAttachments: 'Attachments',
  kunMemoryRecords: 'Memory records',
  kunMemoryRecordsDesc: 'Memory records description',
  kunMemoryEmpty: 'No memories',
  kunMemoryDisable: 'Disable memory',
  memoryRestore: 'Restore',
  kunMemoryDelete: 'Delete memory',
  kunMemoryDisabled: 'Disabled',
  skill: 'Skill',
  skillsLocation: 'Skill location',
  skillsLocationDesc: 'Skill location description',
  skillsPath: 'Skills path',
  skillsPathDesc: 'Skills path description',
  skillsRootUnavailable: 'Unavailable',
  skillsPermissionSources: 'Skill permission sources',
  skillsPermissionSourcesDesc: 'Skill permission sources description',
  skillsPermissionEnabledRoots: 'Enabled roots',
  skillsPermissionDisabledRoots: 'Disabled roots',
  skillsPermissionWorkspaceRoots: 'Workspace roots',
  skillsPermissionGlobalRoots: 'Global roots',
  skillsPermissionDisabledIds: 'Blocked skills',
  skillsPermissionRuntimeNote: 'Only enabled skill roots reach runtime',
  skillsScanDirs: 'Scan dirs',
  skillsScanDirsDesc: 'Scan dirs description',
  skillsActions: 'Skill actions',
  skillsActionsDesc: 'Skill actions description',
  skillsOpenRoot: 'Open root',
  skillsOpenPlugins: 'Open plugins',
  mcp: 'MCP',
  mcpSearchEnabled: 'MCP search enabled',
  mcpSearchEnabledDesc: 'MCP search description',
  mcpAdvanced: 'MCP advanced settings',
  mcpAdvancedDesc: 'MCP advanced settings description',
  mcpSearchMode: 'MCP search mode',
  mcpSearchModeDesc: 'MCP search mode description',
  mcpSearchModeAuto: 'Auto mode',
  mcpSearchModeSearch: 'Search mode',
  mcpSearchModeDirect: 'Direct mode',
  mcpSearchLimits: 'MCP search limits',
  mcpSearchLimitsDesc: 'MCP search limits description',
  mcpSearchAutoThreshold: 'Auto threshold',
  mcpSearchTopKDefault: 'Default results',
  mcpSearchTopKMax: 'Max results',
  mcpSearchMinScore: 'Minimum score',
  mcpSearchDiagnostics: 'MCP search diagnostics',
  mcpSearchDiagnosticsDesc: 'MCP search diagnostics description',
  mcpSearchStatus: 'MCP search status',
  mcpSearchActive: 'Active',
  mcpSearchInactive: 'Inactive',
  mcpSearchIndexed: 'Indexed',
  mcpSearchAdvertised: 'Advertised',
  mcpPermissionSources: 'External tool permission sources',
  mcpPermissionSourcesDesc: 'External tool permission sources description',
  mcpPermissionEnabledServers: 'Enabled servers',
  mcpPermissionDisabledServers: 'Disabled servers',
  mcpPermissionUserServers: 'All-workspace scope',
  mcpPermissionWorkspaceServers: 'Workspace scope',
  mcpPermissionVisibleServers: 'Workspace-visible only',
  mcpPermissionLocalServers: 'Local commands',
  mcpPermissionRemoteServers: 'HTTP/SSE servers',
  mcpPermissionEnvServers: 'Uses env',
  mcpPermissionHeaderServers: 'Uses headers',
  mcpPermissionParseError: 'Permission preview unavailable: {{error}}',
  mcpPermissionRuntimeNote: 'Secret values stay hidden here',
  configFilePath: 'External tool config path',
  mcpPathDesc: 'MCP JSON path description',
  mcpEditor: 'MCP editor',
  mcpEditorDesc: 'Model and API credentials do not live in this MCP file',
  mcpFileStatusReady: 'MCP config ready',
  mcpFileStatusMissing: 'MCP config missing',
  loading: 'Loading',
  mcpActions: 'MCP actions',
  mcpRuntimeHint: 'MCP runtime hint',
  mcpSave: 'Save MCP config',
  mcpReload: 'Reload MCP config',
  mcpOpenDir: 'Open MCP directory',
  permissions: 'Permissions',
  toolPermissionMode: 'Tool permission mode',
  toolPermissionModeDesc: 'Tool permission mode description',
  computerUseTitle: 'Computer control',
  browserUseSettingsTitle: 'Browser',
  designQualityTitle: 'Design quality',
  graphSettingsTitle: 'Graph mode',
  toolPermissionAskForApproval: 'Ask for approval',
  toolPermissionAskForApprovalDesc: 'Approval-worthy actions ask you first',
  toolPermissionApproveForMe: 'Approve for me',
  toolPermissionApproveForMeDesc: 'Your selected model reviews approval-worthy actions',
  toolPermissionFullAccess: 'Full access',
  toolPermissionFullAccessDesc: 'Unrestricted files, host commands, and network-capable tools',
  permissionsBehaviorHint: 'Choose who reviews approval-worthy actions or grant full access',
  projectConfigTitle: 'Project MCP & Skills',
  projectConfigDescription: 'Portable project configuration',
  projectConfigSecurityHint: 'Project MCP requires digest approval',
  projectConfigWorkspaceRequired: 'Select a workspace first',
  projectConfigWorkspace: 'Project scope',
  projectConfigWorkspaceDesc: 'Fixed workspace config path',
  projectConfigStatus: 'Validation and trust',
  projectConfigStatusDesc: 'Local digest trust',
  projectConfigStatus_missing: 'File not created',
  projectConfigStatus_invalid: 'Invalid configuration',
  projectConfigStatus_valid: 'Valid configuration',
  projectConfigTrust_untrusted: 'MCP not approved',
  projectConfigTrust_trusted: 'MCP approved',
  projectConfigTrust_stale: 'Approval stale',
  projectConfigSummary: 'Project declarations',
  projectConfigSummaryDesc: 'Redacted targets',
  projectConfigMcpServers: 'Project MCP servers',
  projectConfigSkillRoots: 'Project Skill roots',
  projectConfigDisabledSkills: 'Project disabled Skills',
  projectConfigServerEnabled: 'enabled',
  projectConfigServerDisabled: 'disabled',
  projectConfigEditor: 'Project JSON',
  projectConfigEditorDesc: 'Workspace-relative paths',
  projectConfigActions: 'Project actions',
  projectConfigActionsDesc: 'Save does not approve',
  projectConfigSave: 'Save project config',
  projectConfigRefresh: 'Refresh project config',
  projectConfigOpenDir: 'Open project config dir',
  projectConfigApprove: 'Approve project MCP',
  projectConfigReapprove: 'Reapprove project MCP',
  projectConfigRevoke: 'Revoke project MCP'
}

function t(key: string, params?: Record<string, unknown>): string {
  let value = labels[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.split(`{{${name}}}`).join(String(replacement))
  }
  return value
}

function baseCtx(): Record<string, unknown> {
  const noop = () => undefined
  const asyncNoop = async () => undefined
  const ref = { current: null }
  const kun = {
    ...defaultKunRuntimeSettings(),
    autoStart: true,
    runtimeToken: '',
    insecure: true
  }
  return {
    t,
    tCommon: t,
    form: { claw: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } } },
    kun,
    activeApiKey: '',
    update: noop,
    updateKun: noop,
    updateSharedCredential: noop,
    sharedApiKey: '',
    sharedBaseUrl: '',
    showApiKey: false,
    setShowApiKey: noop,
    showRuntimeToken: false,
    setShowRuntimeToken: noop,
    portError: '',
    selectControlClass: 'select',
    openOnboardingPreview: noop,
    pickWorkspace: asyncNoop,
    resetWorkspaceToDefault: noop,
    workspacePickerError: '',
    guiUpdateInfo: null,
    checkingGuiUpdate: false,
    downloadingGuiUpdate: false,
    installingGuiUpdate: false,
    guiUpdateDownloaded: false,
    guiUpdateProgress: null,
    guiUpdateError: null,
    checkGuiUpdate: asyncNoop,
    downloadGuiUpdate: asyncNoop,
    installGuiUpdate: asyncNoop,
    logPath: '',
    logDirOpenError: '',
    setLogDirOpenError: noop,
    compactHomePath: (path: string) => path,
    expandHomePath: (path: string) => path,
    compactHomePathList: (values: readonly string[]) => values.join('\n'),
    expandHomePathList: (value: string) => value.split('\n').filter(Boolean),
    pickWriteWorkspace: asyncNoop,
    resetWriteWorkspaceToDefault: noop,
    writeWorkspacePickerError: '',
    writeInlineBaseUrlInherited: false,
    effectiveWriteInlineBaseUrl: '',
    writeInlineModelInherited: false,
    effectiveWriteInlineModel: '',
    setWriteDebugModalOpen: noop,
    loadWriteDebugEntries: asyncNoop,
    scrollToAgentSection: noop,
    agentsSectionRef: ref,
    skillSectionRef: ref,
    mcpSectionRef: ref,
    permissionsSectionRef: ref,
    skillRoots: [],
    skillRootsLoading: false,
    toggleSkillRoot: noop,
    skillNotice: null,
    openSkillRoot: asyncNoop,
    openPlugins: noop,
    mcpConfigPath: '/tmp/project/.kun/mcp.json',
    mcpConfigExists: true,
    mcpConfigText: '{"mcpServers":{}}',
    setMcpConfigText: noop,
    mcpLoading: false,
    mcpBusy: false,
    mcpNotice: null,
    saveMcpConfig: asyncNoop,
    loadMcpConfig: asyncNoop,
    openMcpConfigDir: asyncNoop,
    activeProjectWorkspaceRoot: '/tmp/project',
    projectConfig: {
      workspaceRoot: '/tmp/project',
      path: '/tmp/project/.kun/project.json',
      content: '{"version":1}',
      exists: true,
      status: 'valid',
      trust: 'untrusted',
      digest: 'a'.repeat(64),
      serverSummaries: [{ id: 'local', transport: 'stdio', target: 'node', enabled: true }],
      skillRootCount: 1,
      disabledSkillCount: 2
    },
    projectConfigText: '{"version":1}',
    setProjectConfigText: noop,
    projectConfigLoading: false,
    projectConfigBusy: false,
    projectConfigNotice: null,
    loadProjectConfig: asyncNoop,
    saveProjectConfig: asyncNoop,
    setProjectConfigTrust: asyncNoop,
    openProjectConfigDir: asyncNoop,
    runtimeInfo: null,
    toolDiagnostics: null,
    memoryRecords: [],
    runtimeDiagnosticsBusy: false,
    runtimeDiagnosticsNotice: null,
    refreshKunDiagnostics: asyncNoop,
    disableMemoryRecord: asyncNoop,
    deleteMemoryRecord: asyncNoop,
    pickClawWorkspace: asyncNoop,
    resetClawWorkspaceToDefault: noop,
    clawWorkspacePickerError: '',
    splitSettingsList: (value: string) => value.split('\n').filter(Boolean),
    listSettingsText: (value: string[]) => value.join('\n')
  }
}

function instanceText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => typeof child === 'string' ? child : instanceText(child))
    .join('')
}

function rendererText(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

function findButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root.findAllByType('button')
    .find((candidate) => instanceText(candidate).trim() === label)
  expect(button, `button "${label}"`).toBeTruthy()
  return button!
}

function findButtonContaining(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root.findAllByType('button')
    .find((candidate) => instanceText(candidate).includes(label))
  expect(button, `button containing "${label}"`).toBeTruthy()
  return button!
}

function activePanelText(renderer: ReactTestRenderer): string {
  const panels = renderer.root
    .findAllByProps({ role: 'tabpanel' })
    .filter((panel) => String(panel.props.id ?? '').startsWith('provider-settings-panel-'))
    .filter((panel) => panel.props.hidden !== true)
  expect(panels).toHaveLength(1)
  return instanceText(panels[0])
}

async function renderProviders(ctx: Record<string, unknown>): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = createRenderer(createElement(ProvidersSettingsSection, { ctx }))
  })
  return renderer
}

async function clickProviderTab(renderer: ReactTestRenderer, label: string): Promise<void> {
  const tab = renderer.root.findAllByProps({ role: 'tab' })
    .find((candidate) => instanceText(candidate) === label)
  expect(tab, `tab "${label}"`).toBeTruthy()
  await act(async () => tab!.props.onClick())
}

describe('AgentsSettingsSection Kun diagnostics smoke', () => {
  it('builds a single patch when adding and selecting a model provider', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'custom-provider-2',
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'responses',
      models: [],
      modelProfiles: {}
    } satisfies ModelProviderProfileV1

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, customProvider],
      kun: { providerId: customProvider.id }
    })

    expect(patch.provider?.providers).toEqual([...provider.providers, customProvider])
    expect(patch.agents?.kun?.providerId).toBe(customProvider.id)
    expect(patch.agents?.kun?.apiKey).toBe('')
    expect(patch.agents?.kun?.baseUrl).toBe('')
  })

  it('builds a single patch when removing the active model provider', () => {
    const provider = defaultModelProviderSettings()

    const patch = modelProvidersSettingsPatch({
      provider: {
        ...provider,
        providers: [
          ...provider.providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: '',
            baseUrl: 'https://api.example.com/v1',
            endpointFormat: 'responses',
            models: [],
            modelProfiles: {}
          }
        ]
      },
      providers: provider.providers,
      kun: { providerId: DEFAULT_MODEL_PROVIDER_ID }
    })

    expect(patch.provider?.providers).toEqual(provider.providers)
    expect(patch.agents?.kun?.providerId).toBe(DEFAULT_MODEL_PROVIDER_ID)
    expect(patch.agents?.kun?.apiKey).toBe('')
    expect(patch.agents?.kun?.baseUrl).toBe('')
  })

  it('builds a single patch when adding a preset model provider', () => {
    const provider = defaultModelProviderSettings()
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi).not.toBeNull()
    const xiaomiProvider = modelProviderPresetProfile(xiaomi!)

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, xiaomiProvider],
      kun: {
        providerId: xiaomiProvider.id,
        model: xiaomiProvider.models[0]
      }
    })

    expect(patch.provider?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'xiaomi',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        endpointFormat: 'chat_completions',
        models: expect.arrayContaining(['mimo-v2.5'])
      })
    ]))
    expect(patch.agents?.kun).toEqual(expect.objectContaining({
      providerId: 'xiaomi',
      model: xiaomiProvider.models[0]
    }))
  })

  it('defaults MiniMax media generation when adding a configured MiniMax provider', () => {
    const provider = defaultModelProviderSettings()
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProvider = modelProviderPresetProfile(minimax!, 'sk-minimax')

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, minimaxProvider],
      currentKun: defaultKunRuntimeSettings(),
      kun: {
        providerId: minimaxProvider.id,
        model: minimaxProvider.models[0]
      }
    })

    expect(patch.agents?.kun).toEqual(expect.objectContaining({
      providerId: 'minimax',
      model: minimaxProvider.models[0],
      textToSpeech: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'speech-2.8-hd'
      }),
      musicGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'music-2.6'
      }),
      videoGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'MiniMax-Hailuo-2.3'
      })
    }))
  })

  describe('provider settings workspace', () => {
    const antigravityCatalog: AntigravitySubscriptionModelCatalog = {
      models: [
        {
          id: 'gemini-3.6-flash',
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium'
        },
        {
          id: 'claude-sonnet-4-6',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        },
        {
          id: 'gpt-oss-120b',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        }
      ]
    }
    const probeModelProvider = vi.fn(async (): Promise<ModelProviderProbeResult> => ({
      ok: true as const,
      latencyMs: 18,
      modelIds: ['model-a', 'model-b']
    }))
    const fetchModelsDevCatalog = vi.fn(async (): Promise<ModelsDevCatalogResult> => ({
      status: 'ok' as const,
      providerKey: 'test-provider',
      providerName: 'Test Provider',
      matchMode: 'catalog' as const,
      stale: false,
      models: [
        {
          id: 'model-a',
          name: 'Model A',
          description: 'Vision-capable catalog metadata',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          contextWindowTokens: 128_000,
          maxOutputTokens: 16_000,
          toolCalling: true
        },
        {
          id: 'catalog-only',
          inputModalities: ['text'],
          outputModalities: ['text'],
          toolCalling: false
        }
      ]
    }))
    const claudeSubscriptionStatus = vi.fn(async () => ({
      loggedIn: true,
      source: 'cli' as const
    }))
    const claudeSubscriptionProbe = vi.fn(async (): Promise<ClaudeSubscriptionProbeResult> => ({
      ok: true as const,
      latencyMs: 23
    }))
    const geminiCliSubscriptionStatus = vi.fn(async () => ({
      installed: true,
      authenticated: true,
      path: '/usr/local/bin/gemini',
      credentialSource: 'keychain' as const
    }))
    const geminiCliSubscriptionModels = vi.fn(async () => [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash'
    ])
    const geminiSubscriptionCliStatus = vi.fn(async () => ({
      installed: true,
      path: '/Applications/Kun.app/Contents/Resources/agy'
    }))
    const geminiSubscriptionModels = vi.fn(async () => antigravityCatalog)
    const cursorSubscriptionDiscover = vi.fn(async (): Promise<{
      account: {
        apiKeyName: string
        userEmail?: string
        userFirstName?: string
        userLastName?: string
      }
      models: CursorSubscriptionModel[]
    }> => ({
      account: { apiKeyName: 'test-key', userEmail: 'cursor@example.com' },
      models: [{ id: 'auto', displayName: 'Auto' }]
    }))
    const openExternal = vi.fn(async () => undefined)
    let mountedRenderers: ReactTestRenderer[] = []

    beforeEach(() => {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      probeModelProvider.mockClear()
      fetchModelsDevCatalog.mockClear()
      claudeSubscriptionStatus.mockClear()
      claudeSubscriptionProbe.mockReset()
      claudeSubscriptionProbe.mockResolvedValue({ ok: true, latencyMs: 23 })
      geminiCliSubscriptionStatus.mockClear()
      geminiCliSubscriptionModels.mockClear()
      geminiSubscriptionCliStatus.mockClear()
      geminiSubscriptionModels.mockClear()
      cursorSubscriptionDiscover.mockReset()
      cursorSubscriptionDiscover.mockResolvedValue({
        account: { apiKeyName: 'test-key', userEmail: 'cursor@example.com' },
        models: [{ id: 'auto', displayName: 'Auto' }]
      })
      openExternal.mockClear()
      mountedRenderers = []
      vi.stubGlobal('window', {
        kunGui: {
          probeModelProvider,
          fetchModelsDevCatalog,
          cursorSubscriptionDiscover,
          geminiCliSubscriptionStatus,
          geminiCliSubscriptionModels,
          geminiSubscriptionCliStatus,
          geminiSubscriptionModels,
          onGeminiSubscriptionCliProgress: vi.fn(() => () => undefined),
          openExternal,
          claudeSubscriptionStatus,
          claudeSubscriptionProbe,
          claudeSubscriptionSdkStatus: vi.fn(async () => ({ installed: true })),
          claudeSubscriptionModels: vi.fn(async () => []),
          onClaudeSubscriptionSdkProgress: vi.fn(() => () => undefined)
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        setTimeout: (callback: () => void) => {
          callback()
          return 1
        },
        clearTimeout: vi.fn()
      })
      vi.stubGlobal('document', {
        body: { style: { overflow: '' } },
        activeElement: null
      })
    })

    afterEach(async () => {
      await act(async () => {
        for (const renderer of mountedRenderers) renderer.unmount()
      })
      vi.unstubAllGlobals()
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    })

    const mountProviders = async (ctx: Record<string, unknown>): Promise<ReactTestRenderer> => {
      const renderer = await renderProviders(ctx)
      mountedRenderers.push(renderer)
      return renderer
    }

    it('opens the official Cursor User API Keys page from the connection form', async () => {
      const settings = defaultModelProviderSettings()
      const cursor = modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        ''
      )
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: { ...defaultKunRuntimeSettings(), providerId: cursor.id, model: 'auto' }
      })

      expect(activePanelText(renderer)).toContain('Enter an API key created in the Cursor dashboard.')
      await act(async () => findButton(renderer, 'Get Cursor API key').props.onClick())

      expect(openExternal).toHaveBeenCalledOnce()
      expect(openExternal).toHaveBeenCalledWith(
        'https://cursor.com/dashboard/api?section=user-keys#user-api-keys'
      )
    })

    it('renders Gemini CLI direct API as a keyless provider separate from Antigravity', async () => {
      const settings = defaultModelProviderSettings()
      const direct = modelProviderPresetProfile(
        getModelProviderPreset('gemini-cli-subscription')!,
        'must-not-be-stored'
      )
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, direct] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: direct.id,
          model: 'gemini-2.5-flash'
        }
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      const panel = activePanelText(renderer)
      expect(panel).toContain('Gemini CLI direct API keeps Kun in charge of long sessions.')
      expect(panel).toContain('Gemini CLI Google login is ready')
      expect(panel).toContain('Gemini CLI API endpoint is fixed.')
      expect(panel).not.toContain('Enter provider API key')
      expect(findButton(renderer, 'Sync Gemini CLI API models')).toBeTruthy()
      expect(geminiCliSubscriptionStatus).toHaveBeenCalled()
      await act(async () => findButton(renderer, 'Models').props.onClick())
      expect(rendererText(renderer)).toContain('gemini-3-flash-preview')
      expect(rendererText(renderer)).not.toContain('gemini-3.6-flash')
    })

    it('maps the authoritative Antigravity catalog to model-specific reasoning profiles', () => {
      const patch = antigravityProviderCatalogPatch(antigravityCatalog)

      expect(patch.models).toEqual([
        'gemini-3.6-flash',
        'claude-sonnet-4-6',
        'gpt-oss-120b'
      ])
      expect(patch.modelProfiles['gemini-3.6-flash']).toMatchObject({
        inputModalities: ['text', 'image'],
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium',
          requestProtocol: 'none'
        }
      })
      expect(patch.modelProfiles['claude-sonnet-4-6'].inputModalities).toEqual(['text', 'image'])
      expect(patch.modelProfiles['gpt-oss-120b']).toMatchObject({
        inputModalities: ['text'],
        reasoning: {
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        }
      })
    })

    it('synchronizes all Antigravity model families and profiles into provider settings', async () => {
      const settings = defaultModelProviderSettings()
      const antigravity = modelProviderPresetProfile(
        getModelProviderPreset('gemini-subscription')!,
        ''
      )
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: { ...settings, providers: [...settings.providers, antigravity] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: antigravity.id,
          model: 'gemini-3.6-flash'
        }
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => findButton(renderer, 'Sync Antigravity models').props.onClick())

      expect(geminiSubscriptionModels).toHaveBeenCalledOnce()
      const lastPatch = update.mock.calls.at(-1)?.[0] as {
        provider?: { providers?: ModelProviderProfileV1[] }
      }
      const saved = lastPatch.provider?.providers?.find((provider) => provider.id === antigravity.id)
      expect(saved?.models).toEqual([
        'gemini-3.6-flash',
        'claude-sonnet-4-6',
        'gpt-oss-120b'
      ])
      expect(saved?.modelProfiles['claude-sonnet-4-6']?.reasoning?.supportedEfforts)
        .toEqual(['medium'])
      expect(saved?.modelProfiles['gpt-oss-120b']?.reasoning?.supportedEfforts)
        .toEqual(['medium'])
    })

    it('preserves Antigravity discovery profiles through the model import flow', async () => {
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'google',
        providerName: 'Google',
        matchMode: 'enrichment-only',
        stale: false,
        models: [
          {
            id: 'gemini-3.6-flash',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            contextWindowTokens: 1_048_576,
            toolCalling: true
          },
          {
            id: 'claude-sonnet-4-6',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            contextWindowTokens: 200_000,
            toolCalling: true
          }
        ]
      })
      const settings = defaultModelProviderSettings()
      const antigravity = modelProviderPresetProfile(
        getModelProviderPreset('gemini-subscription')!,
        ''
      )
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: { ...settings, providers: [...settings.providers, antigravity] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: antigravity.id,
          model: 'gemini-3.6-flash'
        }
      })

      await clickProviderTab(renderer, 'Models')
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(findButton(renderer, 'Import 3').props.disabled).toBe(false)
      await act(async () => findButton(renderer, 'Import 3').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const saved = updatedProviders.find((provider) => provider.id === antigravity.id)
      expect(saved?.models).toEqual([
        'gemini-3.6-flash',
        'claude-sonnet-4-6',
        'gpt-oss-120b'
      ])
      expect(saved?.modelProfiles['gemini-3.6-flash']).toMatchObject({
        contextWindowTokens: 1_048_576,
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium'
        }
      })
      expect(saved?.modelProfiles['claude-sonnet-4-6']?.reasoning?.supportedEfforts)
        .toEqual(['medium'])
      expect(saved?.modelProfiles['claude-sonnet-4-6']?.contextWindowTokens).toBe(200_000)
    })

    it('turns a stale Cursor discovery handler error into restart guidance', async () => {
      cursorSubscriptionDiscover.mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'cursor-subscription:discover': "
          + "Error: No handler registered for 'cursor-subscription:discover'"
        )
      )
      const settings = defaultModelProviderSettings()
      const cursor = modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        'cursor-secret'
      )
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: { ...defaultKunRuntimeSettings(), providerId: cursor.id, model: 'auto' }
      })

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendererText(renderer)).toContain(
        'Connection failed: Fully quit Kun and reopen it, then try again.'
      )
      expect(rendererText(renderer)).not.toContain('No handler registered')
    })

    it('imports Cursor mixed-vendor context, vision, and SDK aliases', async () => {
      cursorSubscriptionDiscover.mockResolvedValueOnce({
        account: { apiKeyName: 'test-key', userEmail: 'cursor@example.com' },
        models: [{
          id: 'gemini-3.6-flash',
          displayName: 'Gemini 3.6 Flash',
          aliases: ['gemini-flash-latest']
        }]
      })
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'cursor-mixed',
        providerName: 'Cursor',
        matchMode: 'enrichment-only',
        stale: false,
        models: [{
          id: 'gemini-3.6-flash',
          providerKey: 'google',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          contextWindowTokens: 1_048_576,
          maxOutputTokens: 65_536,
          reasoning: true,
          toolCalling: true
        }]
      })
      const settings = defaultModelProviderSettings()
      const cursor = modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        'cursor-secret'
      )
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: { ...defaultKunRuntimeSettings(), providerId: cursor.id, model: 'auto' },
        update
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'cursor-subscription',
        baseUrl: '',
        forceRefresh: true,
        modelHints: [{
          id: 'gemini-3.6-flash',
          aliases: ['gemini-flash-latest']
        }]
      })
      expect(findButton(renderer, 'Import 1').props.disabled).toBe(false)
      await act(async () => findButton(renderer, 'Import 1').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedCursor = updatedProviders.find((item) => item.id === cursor.id)
      expect(updatedCursor?.models).toEqual(['gemini-3.6-flash'])
      expect(updatedCursor?.modelProfiles['gemini-3.6-flash']).toEqual(expect.objectContaining({
        aliases: ['gemini-flash-latest'],
        contextWindowTokens: 1_048_576,
        maxOutputTokens: 65_536,
        inputModalities: ['text', 'image'],
        messageParts: ['text', 'image_url'],
        reasoning: {
          supportedEfforts: ['auto'],
          defaultEffort: 'auto',
          requestProtocol: 'none'
        }
      }))
    })

    it('repairs missing metadata for an existing pulled Cursor model list', async () => {
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'cursor-mixed',
        providerName: 'Cursor',
        matchMode: 'enrichment-only',
        stale: false,
        models: [{
          id: 'gemini-3.6-flash',
          providerKey: 'google',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          contextWindowTokens: 1_048_576,
          maxOutputTokens: 65_536,
          reasoning: true,
          toolCalling: true
        }]
      })
      const settings = defaultModelProviderSettings()
      const cursor = {
        ...modelProviderPresetProfile(
          getModelProviderPreset('cursor-subscription')!,
          'cursor-secret'
        ),
        models: ['gemini-3.6-flash'],
        modelProfiles: {}
      }
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: cursor.id,
          model: 'gemini-3.6-flash'
        },
        update
      })

      await act(async () => {
        findButton(renderer, 'Models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'cursor-subscription',
        baseUrl: '',
        forceRefresh: false,
        modelHints: [{
          id: 'gemini-3.6-flash'
        }]
      })
      const updatedProviders = update.mock.calls.at(-1)?.[0]?.provider?.providers as
        | ModelProviderProfileV1[]
        | undefined
      const updatedCursor = updatedProviders?.find((item) => item.id === cursor.id)
      expect(updatedCursor?.modelProfiles['gemini-3.6-flash']).toEqual(expect.objectContaining({
        contextWindowTokens: 1_048_576,
        maxOutputTokens: 65_536,
        inputModalities: ['text', 'image'],
        messageParts: ['text', 'image_url'],
        reasoning: {
          supportedEfforts: ['auto'],
          defaultEffort: 'auto',
          requestProtocol: 'none'
        }
      }))
    })

    it('renders task tabs and keeps the selected task while switching providers', async () => {
      const provider = defaultModelProviderSettings()
      const customProvider = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: '',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'messages',
        models: Array.from({ length: 9 }, (_, index) => `custom-model-${index + 1}`),
        modelProfiles: {},
        image: {
          protocol: 'openai-images',
          baseUrl: 'api.example.com/v1',
          models: ['image-model']
        }
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: customProvider.id
        }
      })

      const workspacePanels = renderer.root.findAllByProps({ role: 'tabpanel' })
        .filter((panel) => String(panel.props.id ?? '').startsWith('provider-workspace-panel-'))
      expect(workspacePanels.map((panel) => panel.props.id)).toEqual([
        'provider-workspace-panel-providers',
        'provider-workspace-panel-routes'
      ])
      expect(workspacePanels.map((panel) => panel.props.hidden)).toEqual([false, true])

      const tabs = renderer.root
        .findAllByProps({ role: 'tab' })
        .filter((tab) => String(tab.props.id ?? '').startsWith('provider-settings-tab-'))
      expect(tabs.map(instanceText)).toEqual(['Connection', 'Models', 'Capabilities', 'Advanced'])
      expect(tabs.map((tab) => tab.props['aria-selected'])).toEqual([true, false, false, false])
      expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1, -1])
      expect(tabs.map((tab) => tab.props['aria-controls'])).toEqual([
        'provider-settings-panel-connection',
        'provider-settings-panel-models',
        'provider-settings-panel-capabilities',
        'provider-settings-panel-advanced'
      ])
      const initialPanel = renderer.root.findByProps({ id: 'provider-settings-panel-connection' })
      expect(initialPanel.props.id).toBe('provider-settings-panel-connection')
      expect(initialPanel.props['aria-labelledby']).toBe('provider-settings-tab-connection')
      const taskPanels = renderer.root.findAllByProps({ role: 'tabpanel' })
        .filter((panel) => String(panel.props.id ?? '').startsWith('provider-settings-panel-'))
      expect(taskPanels.map((panel) => panel.props.id)).toEqual([
        'provider-settings-panel-connection',
        'provider-settings-panel-advanced',
        'provider-settings-panel-models',
        'provider-settings-panel-capabilities'
      ])
      expect(taskPanels.map((panel) => panel.props.hidden)).toEqual([false, true, true, true])
      expect(activePanelText(renderer)).toContain('Provider connection')
      expect(activePanelText(renderer)).not.toContain('Provider models')
      expect(renderer.root.findAllByType('select').some((select) => select.props.value === 'messages')).toBe(true)
      expect(rendererText(renderer)).toContain('Enter provider API key')
      expect(rendererText(renderer)).not.toContain('Inherit API key')

      const preventDefault = vi.fn()
      await act(async () => tabs[0].props.onKeyDown({
        key: 'ArrowRight',
        preventDefault
      }))
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(renderer.root
        .findAllByProps({ role: 'tab' })
        .filter((tab) => String(tab.props.id ?? '').startsWith('provider-settings-tab-'))
        .map((tab) => tab.props.tabIndex))
        .toEqual([-1, 0, -1, -1])
      expect(activePanelText(renderer)).toContain('Provider models')
      expect(activePanelText(renderer)).toContain('Fetch models')
      expect(activePanelText(renderer)).not.toContain('Provider connection')
      const modelSearch = renderer.root.findByProps({
        placeholder: 'providerModelSearchPlaceholder'
      })
      await act(async () => {
        modelSearch.props.onChange({ target: { value: 'custom-model-9' } })
      })

      await clickProviderTab(renderer, 'Capabilities')
      expect(activePanelText(renderer)).toContain('Image capability')
      expect(activePanelText(renderer)).toContain('Speech-to-text capability')
      expect(activePanelText(renderer)).toContain('Speech generation capability')
      expect(activePanelText(renderer)).toContain('Music generation capability')
      expect(activePanelText(renderer)).toContain('Video generation capability')
      expect(activePanelText(renderer)).toContain('Needs configuration')
      const imageCapabilityConfigure = renderer.root.findByProps({
        'aria-label': 'Configure: Image capability'
      })
      expect(imageCapabilityConfigure.props['aria-controls']).toBe('provider-capability-image')

      await clickProviderTab(renderer, 'Models')
      expect(renderer.root.findByProps({
        placeholder: 'providerModelSearchPlaceholder'
      }).props.value).toBe('custom-model-9')

      await clickProviderTab(renderer, 'Advanced')
      const customIdInput = renderer.root.findAllByType('input')
        .find((input) => input.props.value === 'custom-provider-2')
      expect(customIdInput?.props.readOnly).toBe(false)
      expect(activePanelText(renderer)).toContain('Provider identity')
      expect(activePanelText(renderer)).toContain('Failure retry')
      expect(rendererText(renderer)).toContain('Danger zone')

      await act(async () => findButtonContaining(renderer, 'DeepSeek').props.onClick())
      expect(renderer.root.findAllByProps({ role: 'tab' })
        .find((tab) => instanceText(tab) === 'Advanced')?.props['aria-selected']).toBe(true)
      expect(activePanelText(renderer)).toContain('Provider identity')
      expect(renderer.root.findAllByType('input')
        .find((input) => input.props.value === DEFAULT_MODEL_PROVIDER_ID)?.props.readOnly).toBe(true)
      expect(rendererText(renderer)).not.toContain('Danger zone')
    })

    it('renders and persists provider retry controls in the Advanced tab', async () => {
      const provider = defaultModelProviderSettings()
      const update = vi.fn()
      const customProvider = {
        id: 'retry-provider',
        name: 'Retry Provider',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        retry: {
          maxAttempts: 3,
          initialDelayMs: 3000,
          httpStatusCodes: [429, 503]
        },
        models: ['retry-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: customProvider.id
        }
      })

      await clickProviderTab(renderer, 'Advanced')
      const panelText = activePanelText(renderer)
      expect(panelText).toContain('Failure retry')
      expect(panelText).toContain('Retry HTTP status codes')
      expect(renderer.root.findAllByType('input').some((input) => input.props.value === '429,503')).toBe(true)
      expect(renderer.root.findAllByType('input').some((input) => input.props.value === '429, 503')).toBe(false)
      expect(panelText).toContain('Separate multiple status codes with commas, for example 429,503.')
      expect(panelText).toContain('Excludes the initial request. Default 5, maximum 10.')
      expect(panelText.indexOf('Separate multiple status codes with commas, for example 429,503.'))
        .toBeLessThan(panelText.indexOf('Retry attempts'))

      const retryCountInput = renderer.root.findAllByType('input')
        .find((input) => input.props.type === 'number' && input.props.value === 3)
      expect(retryCountInput).toBeDefined()
      await act(async () => retryCountInput!.props.onChange({ target: { value: '7' } }))

      const updatedProviders = update.mock.calls.at(-1)?.[0]?.provider?.providers as
        | ModelProviderProfileV1[]
        | undefined
      expect(updatedProviders?.find((item) => item.id === customProvider.id)?.retry?.maxAttempts)
        .toBe(7)
    })

    it('restores the five-retry default when provider retries are re-enabled', async () => {
      const provider = defaultModelProviderSettings()
      const update = vi.fn()
      const disabledProvider = {
        ...provider.providers[0]!,
        id: 'retry-disabled',
        name: 'Retry Disabled',
        retry: {
          maxAttempts: 0,
          initialDelayMs: 3000,
          httpStatusCodes: [429, 503]
        }
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: {
          ...provider,
          providers: [...provider.providers, disabledProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: disabledProvider.id
        }
      })

      await clickProviderTab(renderer, 'Advanced')
      const retryToggle = renderer.root.findByProps({
        role: 'switch',
        'aria-label': 'Failure retry'
      })
      expect(retryToggle.props['aria-checked']).toBe(false)
      await act(async () => retryToggle.props.onClick())

      const updatedProviders = update.mock.calls.at(-1)?.[0]?.provider?.providers as
        | ModelProviderProfileV1[]
        | undefined
      expect(updatedProviders?.find((item) => item.id === disabledProvider.id)?.retry?.maxAttempts)
        .toBe(5)
    })

    it('locks preset IDs, blocks probes without required credentials, and limits the danger zone', async () => {
      const provider = defaultModelProviderSettings()
      const xiaomi = getModelProviderPreset('xiaomi')
      expect(xiaomi).not.toBeNull()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, modelProviderPresetProfile(xiaomi!)]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: 'xiaomi'
        }
      })

      expect(rendererText(renderer)).toContain('Needs configuration')
      expect(rendererText(renderer)).toContain('No API key')
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(true)
      expect(findButton(renderer, 'Test connection').props.title).toBe('Enter this provider API key first.')

      await clickProviderTab(renderer, 'Advanced')
      const providerIdInput = renderer.root.findAllByType('input')
        .find((input) => input.props.value === 'xiaomi')
      expect(providerIdInput?.props.readOnly).toBe(true)
      expect(rendererText(renderer)).toContain('Provider ID locked')
      expect(rendererText(renderer)).toContain('Danger zone')

      await act(async () => findButtonContaining(renderer, 'DeepSeek').props.onClick())
      expect(rendererText(renderer)).not.toContain('Danger zone')
      expect(rendererText(renderer)).toContain('Needs configuration')
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(true)
    })

    it('allows an agent SDK subscription to use its host login without an API key', async () => {
      const provider = defaultModelProviderSettings()
      const claudeSubscription = getModelProviderPreset('claude-subscription')
      expect(claudeSubscription).not.toBeNull()
      const profile = modelProviderPresetProfile(claudeSubscription!)
      expect(profile.kind).toBe('agent-sdk')
      expect(profile.apiKey).toBe('')

      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        }
      })

      expect(rendererText(renderer)).toContain('Ready')
      expect(rendererText(renderer)).not.toContain('Needs configuration')
      const testConnection = findButton(renderer, 'Test connection')
      expect(testConnection.props.disabled).toBe(false)
      claudeSubscriptionProbe.mockClear()

      await act(async () => {
        testConnection.props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(claudeSubscriptionProbe).toHaveBeenCalledOnce()
      expect(claudeSubscriptionProbe).toHaveBeenCalledWith(undefined)
      expect(probeModelProvider).not.toHaveBeenCalled()
      expect(rendererText(renderer)).toContain('Connected · 23ms')
    })

    it('shows a real Claude authentication failure instead of a false connected state', async () => {
      const provider = defaultModelProviderSettings()
      const preset = getModelProviderPreset('claude-subscription')
      expect(preset).not.toBeNull()
      const profile = modelProviderPresetProfile(preset!)
      claudeSubscriptionProbe.mockResolvedValueOnce({
        ok: false,
        message: 'API Error: 401 Invalid Bearer <redacted>'
      })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        }
      })

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(claudeSubscriptionProbe).toHaveBeenCalledWith(undefined)
      expect(rendererText(renderer)).toContain(
        'Connection failed: API Error: 401 Invalid Bearer <redacted>'
      )
      expect(rendererText(renderer)).not.toContain('Connected ·')
    })

    it('marks a wrapped Claude setup token invalid before a request is sent', async () => {
      const provider = defaultModelProviderSettings()
      const preset = getModelProviderPreset('claude-subscription')
      expect(preset).not.toBeNull()
      const profile = {
        ...modelProviderPresetProfile(preset!),
        apiKey: 'Bearer sk-ant-oat01-wrapped-token'
      }
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        }
      })

      expect(rendererText(renderer)).toContain(
        'Paste only the complete sk-ant-oat token.'
      )
      expect(claudeSubscriptionProbe).not.toHaveBeenCalled()
    })

    it('filters the add dialog and keeps custom providers local until confirmation', async () => {
      const provider = defaultModelProviderSettings()
      const inspectedProvider = {
        id: 'inspection-provider',
        name: 'Inspection Provider',
        apiKey: 'sk-inspection',
        baseUrl: 'https://api.inspection.example/v1',
        endpointFormat: 'chat_completions',
        models: ['inspection-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, inspectedProvider]
        },
        kun: defaultKunRuntimeSettings(),
        update
      })

      await act(async () => findButtonContaining(renderer, 'Inspection Provider').props.onClick())

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      expect(dialog.props['aria-modal']).toBe('true')
      expect(instanceText(dialog)).toContain('Choose a preset or create a custom provider.')

      const regionTablist = renderer.root.findByProps({
        role: 'tablist',
        'aria-label': 'Subscription plan regions'
      })
      const regionTab = (label: string): ReactTestInstance => {
        const tab = regionTablist.findAllByProps({ role: 'tab' })
          .find((candidate) => instanceText(candidate) === label)
        expect(tab, `subscription region tab "${label}"`).toBeTruthy()
        return tab!
      }
      expect(regionTab('All').props['aria-selected']).toBe(true)
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Claude (Pro/Max 订阅)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Kimi Code')

      await act(async () => regionTab('China').props.onClick())
      expect(regionTab('China').props['aria-selected']).toBe(true)
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Zhipu Coding Plan')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Kimi Code')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('Claude (Pro/Max 订阅)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('ChatGPT 订阅')

      await act(async () => regionTab('United States').props.onClick())
      expect(regionTab('United States').props['aria-selected']).toBe(true)
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Claude (Pro/Max 订阅)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('ChatGPT 订阅')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Ollama Cloud')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('Kimi Code')

      await act(async () => regionTab('All').props.onClick())
      const searchInput = renderer.root.findByProps({ 'aria-label': 'Search provider presets…' })
      await act(async () => searchInput.props.onChange({ target: { value: 'xiaomi' } }))
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Xiaomi')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('MiniMax')

      await act(async () => findButtonContaining(renderer, 'Custom provider…').props.onClick())
      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
      expect(rendererText(renderer)).toContain('Unsaved')
      expect(rendererText(renderer)).toContain('Add this provider')
      expect(activePanelText(renderer)).toContain('Provider connection')
      expect(renderer.root.findAllByProps({ role: 'tab' })
        .find((tab) => instanceText(tab) === 'Connection')?.props['aria-selected']).toBe(true)
      expect(update).not.toHaveBeenCalled()

      await act(async () => findButton(renderer, 'Cancel').props.onClick())
      expect(rendererText(renderer)).not.toContain('Unsaved')
      expect(update).not.toHaveBeenCalled()
      expect(renderer.root.findAllByType('button')
        .find((button) => button.props['aria-pressed'] === true && instanceText(button).includes('Inspection Provider')))
        .toBeTruthy()

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      await act(async () => findButtonContaining(renderer, 'Custom provider…').props.onClick())
      const apiKeyInput = renderer.root.findAllByType('input')
        .find((input) => input.props.placeholder === 'Enter provider API key')
      expect(apiKeyInput).toBeTruthy()
      await act(async () => apiKeyInput!.props.onChange({ target: { value: 'sk-custom' } }))
      expect(rendererText(renderer)).toContain('Click Add to save this provider and switch to it.')

      await act(async () => findButton(renderer, 'Add').props.onClick())
      expect(update).toHaveBeenCalledTimes(1)
      expect(update.mock.calls[0][0]).toMatchObject({
        provider: {
          providers: expect.arrayContaining([
            expect.objectContaining({
              id: 'custom-provider-3',
              apiKey: 'sk-custom'
            })
          ])
        },
        agents: {
          kun: expect.objectContaining({ providerId: 'custom-provider-3' })
        }
      })
      expect(rendererText(renderer)).not.toContain('Unsaved')
    })

    it('deletes the canonical shared provider before removing it from local settings', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: 'sk-custom',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        kind: 'http',
        models: ['custom-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const sharedProvider = {
        id: target.id,
        accountId: `account:${target.id}`,
        name: target.name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      }
      const snapshot = (revision: number, providers = [sharedProvider]) => ({
        schemaVersion: 1,
        revision,
        providers,
        defaultProviderId: providers[0]?.id,
        defaultAccountId: providers[0]?.accountId,
        defaultModel: providers[0]?.selectedModel,
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      let resolveDelete!: (value: { ok: true; status: 200; body: string }) => void
      const deleteRequest = new Promise<{ ok: true; status: 200; body: string }>((resolve) => {
        resolveDelete = resolve
      })
      const runtimeRequest = vi.fn(async (path: string, method: string) => {
        if (method === 'DELETE') return deleteRequest
        return { ok: true, status: 200, body: JSON.stringify(snapshot(1)) }
      })
      Object.assign(window.kunGui, {
        runtimeRequest,
        confirmDialog: vi.fn(async () => true)
      })
      const update = vi.fn()
      const initialCtx = {
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saving',
        update
      }
      const renderer = await mountProviders(initialCtx)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      await clickProviderTab(renderer, 'Advanced')
      let removePromise!: Promise<void>
      await act(async () => {
        removePromise = findButton(renderer, 'Remove provider').props.onClick()
        await Promise.resolve()
      })

      const unrelatedProvider = {
        ...settings.providers[0]!,
        name: 'Edited while delete was pending'
      }
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, {
          ctx: {
            ...initialCtx,
            provider: {
              ...initialCtx.provider,
              providers: [unrelatedProvider, target]
            }
          }
        }))
        await Promise.resolve()
      })
      resolveDelete({ ok: true, status: 200, body: JSON.stringify(snapshot(2, [])) })
      await act(async () => {
        await removePromise
      })

      const deleteCallIndex = runtimeRequest.mock.calls.findIndex(([path, method]) =>
        method === 'DELETE' && path.includes('/v1/model-connections/custom-provider-2?')
      )
      expect(deleteCallIndex).toBeGreaterThanOrEqual(0)
      expect(update).toHaveBeenCalledOnce()
      expect(update.mock.calls[0]?.[0]?.provider?.providers).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: target.id })])
      )
      expect(update.mock.calls[0]?.[0]?.provider?.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({
          id: unrelatedProvider.id,
          name: unrelatedProvider.name
        })])
      )
      expect(runtimeRequest.mock.invocationCallOrder[deleteCallIndex]).toBeLessThan(update.mock.invocationCallOrder[0]!)
    })

    it('keeps a custom provider rename while a stale registry event races the canonical PATCH', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: 'sk-custom',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        kind: 'http',
        models: ['custom-model'],
        modelProfiles: {
          'custom-model': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      } satisfies ModelProviderProfileV1
      const sharedProvider = (name: string) => ({
        id: target.id,
        accountId: `account:${target.id}`,
        name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      })
      const snapshot = (revision: number, name: string) => ({
        schemaVersion: 1,
        revision,
        providers: [sharedProvider(name)],
        defaultProviderId: target.id,
        defaultAccountId: `account:${target.id}`,
        defaultModel: target.models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      let resolveStaleEvent!: (value: { ok: true; status: 200; body: string }) => void
      const staleEvent = new Promise<{ ok: true; status: 200; body: string }>((resolve) => {
        resolveStaleEvent = resolve
      })
      let eventRequests = 0
      const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
        if (path.includes('/events?')) {
          eventRequests += 1
          if (eventRequests === 1) return staleEvent
          return new Promise<never>(() => undefined)
        }
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(snapshot(1, target.name)) }
        }
        if (path === `/v1/model-connections/${target.id}` && method === 'PATCH') {
          expect(JSON.parse(body ?? '{}')).toMatchObject({
            expectedRevision: 1,
            name: 'Renamed Provider'
          })
          return { ok: true, status: 200, body: JSON.stringify(snapshot(2, 'Renamed Provider')) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const update = vi.fn()
      const initialCtx = {
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saved',
        update
      }
      const renderer = await mountProviders(initialCtx)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      const nameInput = renderer.root.findAllByType('input')
        .find((input) => input.props.value === target.name)
      expect(nameInput).toBeTruthy()
      await act(async () => nameInput!.props.onChange({ target: { value: 'Renamed Provider' } }))
      expect(update).toHaveBeenCalledOnce()
      const localPatch = update.mock.calls[0]![0]
      expect(localPatch.provider.providers.find((item: ModelProviderProfileV1) => item.id === target.id)?.name)
        .toBe('Renamed Provider')

      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, {
          ctx: {
            ...initialCtx,
            provider: { ...initialCtx.provider, ...localPatch.provider },
            kun: { ...initialCtx.kun, ...localPatch.agents?.kun }
          }
        }))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(runtimeRequest.mock.calls.some(([path, method]) =>
        path === `/v1/model-connections/${target.id}` && method === 'PATCH'
      )).toBe(true)
      resolveStaleEvent({ ok: true, status: 200, body: JSON.stringify(snapshot(1, target.name)) })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(update.mock.calls.some(([patch]) =>
        patch.provider?.providers?.some((item: ModelProviderProfileV1) =>
          item.id === target.id && item.name === target.name
        )
      )).toBe(false)
    })

    it('keeps the local provider and shows an error when the shared registry cannot delete it', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: 'sk-custom',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        kind: 'http',
        models: ['custom-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const sharedProvider = {
        id: target.id,
        accountId: `account:${target.id}`,
        name: target.name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      }
      let registryReads = 0
      const runtimeRequest = vi.fn(async (path: string, method: string) => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          registryReads += 1
          if (registryReads > 1) {
            return {
              ok: false,
              status: 503,
              body: JSON.stringify({ message: 'Shared registry unavailable' })
            }
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            schemaVersion: 1,
            revision: 1,
            providers: [sharedProvider],
            defaultProviderId: target.id,
            defaultAccountId: sharedProvider.accountId,
            defaultModel: target.models[0],
            proxy: settings.proxy,
            routePools: settings.routePools,
            localModelGateway: { enabled: settings.localGateway.enabled }
          })
        }
      })
      Object.assign(window.kunGui, {
        runtimeRequest,
        confirmDialog: vi.fn(async () => true)
      })
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saving',
        update
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      await clickProviderTab(renderer, 'Advanced')
      await act(async () => {
        findButton(renderer, 'Remove provider').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(runtimeRequest.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false)
      expect(update).not.toHaveBeenCalled()
      expect(rendererText(renderer)).toContain('Shared registry unavailable')
      expect(rendererText(renderer)).toContain('Custom Provider')
    })

    it('configures Ollama Cloud and imports only provider-confirmed models with catalog metadata', async () => {
      const settings = defaultModelProviderSettings()
      const preset = getModelProviderPreset('ollama')
      expect(preset).not.toBeNull()
      const target = {
        ...modelProviderPresetProfile(preset!, 'ollama-secret'),
        models: [],
        modelProfiles: {}
      }
      const update = vi.fn()
      probeModelProvider.mockResolvedValueOnce({
        ok: true,
        latencyMs: 12,
        modelIds: ['gpt-oss:120b', 'ollama-new:model']
      })
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'ollama-cloud',
        providerName: 'Ollama Cloud',
        matchMode: 'enrichment-only',
        stale: false,
        models: [
          {
            id: 'gpt-oss:120b',
            reasoning: true,
            toolCalling: true,
            inputModalities: ['text'],
            outputModalities: ['text'],
            contextWindowTokens: 131_072,
            maxOutputTokens: 32_768
          },
          {
            id: 'catalog-only',
            inputModalities: ['text'],
            outputModalities: ['text']
          }
        ]
      })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id
        },
        update
      })

      expect(rendererText(renderer)).toContain('Ollama Cloud')
      expect(renderer.root.findAllByType('input')
        .some((input) => input.props.value === 'Ollama Cloud')).toBe(true)
      expect(renderer.root.findAllByType('input')
        .some((input) => input.props.value === 'https://ollama.com/v1')).toBe(true)
      expect(renderer.root.findAllByType('input')
        .some((input) => input.props.value === 'ollama-secret')).toBe(true)

      await clickProviderTab(renderer, 'Models')
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(probeModelProvider).toHaveBeenCalledWith({
        baseUrl: 'https://ollama.com/v1',
        apiKey: 'ollama-secret',
        endpointFormat: 'chat_completions'
      })
      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'ollama',
        baseUrl: 'https://ollama.com/v1',
        forceRefresh: true
      })
      const importDialog = renderer.root.findByProps({ role: 'dialog' })
      expect(instanceText(importDialog)).toContain('gpt-oss:120b')
      expect(instanceText(importDialog)).toContain('ollama-new:model')
      expect(instanceText(importDialog)).not.toContain('catalog-only')

      await act(async () => findButton(renderer, 'Import 2').props.onClick())
      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedOllama = updatedProviders.find((provider) => provider.id === 'ollama')
      expect(updatedOllama?.models).toEqual(['gpt-oss:120b', 'ollama-new:model'])
      expect(updatedOllama?.modelProfiles['gpt-oss:120b']).toMatchObject({
        contextWindowTokens: 131_072,
        maxOutputTokens: 32_768,
        supportsToolCalling: true,
        reasoning: {
          supportedEfforts: ['auto'],
          defaultEffort: 'auto',
          requestProtocol: 'none'
        }
      })
      expect(updatedOllama?.modelProfiles['ollama-new:model']).toBeUndefined()
    })

    it('adds repeated Token Plan accounts with independent numbered identities', async () => {
      const settings = defaultModelProviderSettings()
      const minimax = getModelProviderPreset('minimax')
      const first = modelProviderTokenPlanProfile(minimax!, 'sk-first')!
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, first] },
        kun: { ...defaultKunRuntimeSettings(), providerId: first.id, model: first.models[0] },
        update
      })

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      expect(instanceText(dialog)).toContain('1 accounts')
      const minimaxPlanEntry = dialog.findAllByType('button')
        .find((button) => {
          const text = instanceText(button)
          return text.includes('MiniMax') && text.includes('Token Plan') && text.includes('1 accounts')
        })
      expect(minimaxPlanEntry).toBeDefined()
      expect(instanceText(minimaxPlanEntry!)).toContain('Add an independent account')

      await act(async () => minimaxPlanEntry!.props.onClick())
      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
      expect(rendererText(renderer)).toContain('Unsaved')
      expect(rendererText(renderer)).toContain('MiniMax Token Plan 2')

      await act(async () => findButton(renderer, 'Cancel').props.onClick())
      expect(rendererText(renderer)).not.toContain('Unsaved')
      expect(update).not.toHaveBeenCalled()

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const reopenedDialog = renderer.root.findByProps({ role: 'dialog' })
      const reopenedEntry = reopenedDialog.findAllByType('button')
        .find((button) => {
          const text = instanceText(button)
          return text.includes('MiniMax') && text.includes('Token Plan') && text.includes('1 accounts')
        })
      await act(async () => reopenedEntry!.props.onClick())

      const apiKeyInput = renderer.root.findAllByType('input')
        .find((input) => input.props.placeholder === 'Enter provider API key')
      await act(async () => apiKeyInput!.props.onChange({ target: { value: 'sk-second' } }))
      await act(async () => findButton(renderer, 'Add').props.onClick())

      const savedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      expect(savedProviders.filter((provider) => provider.presetSource?.presetId === 'minimax')).toEqual([
        expect.objectContaining({
          id: 'minimax-token-plan',
          name: 'MiniMax Token Plan',
          apiKey: 'sk-first',
          presetSource: { presetId: 'minimax', mode: 'token-plan' }
        }),
        expect.objectContaining({
          id: 'minimax-token-plan-2',
          name: 'MiniMax Token Plan 2',
          apiKey: 'sk-second',
          presetSource: { presetId: 'minimax', mode: 'token-plan' }
        })
      ])
      expect(update.mock.calls[0]?.[0]?.agents?.kun?.providerId).toBe('minimax-token-plan-2')
    })

    it('uses the canonical models.dev source for a numbered provider account', async () => {
      const settings = defaultModelProviderSettings()
      const kimi = getModelProviderPreset('kimi-code')!
      const first = modelProviderPresetAccountProfile(kimi, 'api', [])!
      const second = {
        ...modelProviderPresetAccountProfile(kimi, 'api', [first])!,
        apiKey: 'sk-second'
      }
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, first, second] },
        kun: { ...defaultKunRuntimeSettings(), providerId: second.id, model: second.models[0] }
      })

      await clickProviderTab(renderer, 'Models')
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'kimi-code',
        baseUrl: second.baseUrl,
        forceRefresh: true
      })
    })

    it('continues to refresh a pay-as-you-go preset without creating a duplicate account', async () => {
      const settings = defaultModelProviderSettings()
      const xiaomi = getModelProviderPreset('xiaomi')!
      const existing = {
        ...modelProviderPresetProfile(xiaomi, 'sk-xiaomi'),
        name: 'Work Xiaomi',
        models: [...modelProviderPresetProfile(xiaomi).models, 'private-model']
      }
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, existing] },
        kun: { ...defaultKunRuntimeSettings(), providerId: existing.id, model: existing.models[0] },
        update
      })

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      const xiaomiEntry = dialog.findAllByType('button')
        .find((button) => instanceText(button).includes('Xiaomi') && instanceText(button).includes('Update preset'))
      await act(async () => {
        xiaomiEntry!.props.onClick()
        await Promise.resolve()
      })

      expect(update).toHaveBeenCalledTimes(1)
      const savedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const savedXiaomi = savedProviders.filter((provider) => provider.id === 'xiaomi')
      expect(savedXiaomi).toHaveLength(1)
      expect(savedXiaomi[0]).toMatchObject({
        name: 'Work Xiaomi',
        apiKey: 'sk-xiaomi',
        models: expect.arrayContaining(['private-model']),
        presetSource: { presetId: 'xiaomi', mode: 'api' }
      })
      expect(rendererText(renderer)).not.toContain('Unsaved')
    })

    it('separates readiness, save failure, and fresh probe state', async () => {
      const provider = defaultModelProviderSettings()
      const probeProvider = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: ['probe-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const providerContext = (profile: ModelProviderProfileV1): Record<string, unknown> => ({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        },
        saveStatus: 'error',
        saveError: 'Disk is read-only'
      })
      const renderer = await mountProviders(providerContext(probeProvider))

      expect(rendererText(renderer)).toContain('Ready')
      expect(rendererText(renderer)).toContain('Could not apply')
      const providersPanel = renderer.root.findByProps({
        id: 'provider-workspace-panel-providers'
      })
      expect(providersPanel.findAllByType('span')
        .filter((span) => span.props.title === 'Disk is read-only')).toHaveLength(1)
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(false)

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
      })
      expect(probeModelProvider).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-probe',
        endpointFormat: 'chat_completions'
      })
      expect(fetchModelsDevCatalog).not.toHaveBeenCalled()
      expect(rendererText(renderer)).toContain('Connected · 18ms · 2 models')
      expect(rendererText(renderer)).toContain('Could not apply')

      const changedProvider = { ...probeProvider, baseUrl: 'https://api.changed.example/v1' }
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, { ctx: providerContext(changedProvider) }))
      })
      expect(rendererText(renderer)).not.toContain('Connected · 18ms · 2 models')
      expect(rendererText(renderer)).toContain('Ready')

      const invalidProvider = { ...probeProvider, baseUrl: 'api.changed.example/v1' }
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, { ctx: providerContext(invalidProvider) }))
      })
      expect(rendererText(renderer)).toContain('Needs configuration')
      expect(rendererText(renderer)).toContain('URL must start with http:// or https://')
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(true)
      expect(rendererText(renderer)).toContain('Could not apply')
    })

    it('fetches both model sources and persists metadata only for confirmed selections', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: [],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id },
        update
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(probeModelProvider).toHaveBeenCalledWith({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        endpointFormat: target.endpointFormat
      })
      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: target.id,
        baseUrl: target.baseUrl,
        forceRefresh: true
      })
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('models.dev only')
      expect(findButton(renderer, 'Import 2').props.disabled).toBe(false)

      await act(async () => findButton(renderer, 'Import 2').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedTarget = updatedProviders.find((item) => item.id === target.id)
      expect(updatedTarget?.models).toEqual(['model-a', 'model-b'])
      expect(updatedTarget?.models).not.toContain('catalog-only')
      expect(updatedTarget?.modelProfiles['model-a']).toEqual(expect.objectContaining({
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_000,
        inputModalities: ['text', 'image'],
        supportsToolCalling: true,
        messageParts: ['text', 'image_url']
      }))
    })

    it('applies catalog metadata to models that were already configured', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: ['model-a', 'model-b'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id },
        update
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(findButton(renderer, 'Apply model metadata').props.disabled).toBe(false)
      await act(async () => findButton(renderer, 'Apply model metadata').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedTarget = updatedProviders.find((item) => item.id === target.id)
      expect(updatedTarget?.models).toEqual(target.models)
      expect(updatedTarget?.modelProfiles['model-a']).toEqual(expect.objectContaining({
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_000,
        inputModalities: ['text', 'image'],
        supportsToolCalling: true,
        messageParts: ['text', 'image_url']
      }))
    })

    it('keeps catalog-only candidates unchecked when the provider model request fails', async () => {
      probeModelProvider.mockResolvedValueOnce({ ok: false, message: '401 unauthorized' })
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: [],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id }
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      const dialogText = instanceText(renderer.root.findByProps({ role: 'dialog' }))
      expect(dialogText).toContain('Provider verification failed: 401 unauthorized')
      expect(dialogText).toContain('models.dev only')
      expect(findButton(renderer, 'Import 0').props.disabled).toBe(true)
    })
  })

  it('keeps advanced agent controls behind collapsed disclosures', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Assistant advanced settings')
    expect(html).toContain('Storage, model context, and tool guards')
    expect(html).toContain('Maximum concurrent turns')
    expect(html).toContain('value="256"')
    expect(html).toContain('Maximum turn duration')
    expect(html).toContain('value="86400000"')
    expect(html).toContain('MCP advanced settings')
    expect(html).not.toContain('<details open')
  })

  it('does not render image generation settings inside the agent section', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).not.toContain('imageGen')
  })

  it('renders exactly three unified permission controls with full access as the default', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Permissions')
    expect(html).toContain('Choose who reviews approval-worthy actions or grant full access')
    expect(html).toContain('Tool permission mode')
    expect(html).toContain('role="radiogroup"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).toContain('Ask for approval')
    expect(html).toContain('Approval-worthy actions ask you first')
    expect(html).toContain('Approve for me')
    expect(html).toContain('Your selected model reviews approval-worthy actions')
    expect(html).toContain('Full access')
    expect(html).toContain('Unrestricted files, host commands, and network-capable tools')
    expect(html).toContain('lucide-hand')
    expect(html).toContain('lucide-bot')
    expect(html).toContain('lucide-lock-keyhole-open')
    expect(html).not.toContain('Approval policy')
    expect(html).not.toContain('Sandbox mode')
  })

  it('applies the complete full-access mapping only from trusted activation', () => {
    const updateKun = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(AgentsSettingsSection, {
        ctx: {
          ...baseCtx(),
          kun: {
            ...defaultKunRuntimeSettings(),
            approvalPolicy: 'on-request',
            sandboxMode: 'workspace-write',
            approvalReviewer: 'user'
          },
          updateKun
        }
      }))
    })
    const fullAccess = renderer.root
      .findAllByProps({ role: 'radio' })
      .find((button) => instanceText(button).includes('Full access'))
    expect(fullAccess).toBeDefined()

    act(() => {
      fullAccess?.props.onClick({ isTrusted: false })
    })
    expect(updateKun).not.toHaveBeenCalled()

    act(() => {
      fullAccess?.props.onClick({ isTrusted: true })
    })
    expect(updateKun).toHaveBeenCalledWith({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'user'
    })
  })

  it('keeps permissions in the assistant and experimental features in a standalone laboratory', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(AgentsSettingsSection, {
        ctx: {
          ...baseCtx(),
          settingsSection: 'permissions'
        }
      }))
    })

    const primaryPermissionsPanel = renderer.root.findByProps({
      id: 'agents-settings-panel-permissions'
    })
    expect(renderer.root.findByProps({
      id: 'agents-settings-tab-permissions'
    }).props['aria-selected']).toBe(true)
    expect(primaryPermissionsPanel.props.className).not.toContain('hidden')

    const secondaryTabs = renderer.root
      .findAllByProps({ role: 'tab' })
      .filter((tab) => String(tab.props.id ?? '').startsWith('agents-permissions-tab-'))
    expect(secondaryTabs.map(instanceText)).toEqual([
      'Tool permission mode',
      'Design quality'
    ])
    expect(secondaryTabs.map((tab) => tab.props['aria-selected']))
      .toEqual([true, false])
    expect(secondaryTabs.map((tab) => tab.props['aria-controls'])).toEqual([
      'agents-permissions-panel-policy',
      'agents-permissions-panel-quality'
    ])

    const secondaryPanels = renderer.root
      .findAllByProps({ role: 'tabpanel' })
      .filter((panel) => String(panel.props.id ?? '').startsWith('agents-permissions-panel-'))
    expect(secondaryPanels).toHaveLength(2)
    expect(secondaryPanels.map((panel) => panel.props.hidden))
      .toEqual([false, true])
    expect(secondaryPanels[0].findAllByProps({ role: 'radiogroup' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ id: 'agents-settings-tab-laboratory' })).toHaveLength(0)

    act(() => {
      renderer = createRenderer(createElement(LaboratorySettingsSection, {
        ctx: baseCtx()
      }))
    })

    const laboratoryTabs = renderer.root
      .findAllByProps({ role: 'tab' })
      .filter((tab) => String(tab.props.id ?? '').startsWith('laboratory-settings-tab-'))
    expect(laboratoryTabs.map(instanceText)).toEqual([
      'Computer control',
      'Browser',
      'Graph mode'
    ])
    expect(laboratoryTabs.map((tab) => tab.props['aria-selected']))
      .toEqual([true, false, false])
    expect(laboratoryTabs.map((tab) => tab.props['aria-controls'])).toEqual([
      'laboratory-settings-panel-computer',
      'laboratory-settings-panel-browser',
      'laboratory-settings-panel-graph'
    ])

    const laboratoryPanels = renderer.root
      .findAllByProps({ role: 'tabpanel' })
      .filter((panel) => String(panel.props.id ?? '').startsWith('laboratory-settings-panel-'))
    expect(laboratoryPanels).toHaveLength(3)
    expect(laboratoryPanels.map((panel) => panel.props.hidden))
      .toEqual([false, true, true])
  })

  it('renders pure JSONL as a selectable storage backend', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Storage backend')
    expect(html).toContain('<option value="hybrid"')
    expect(html).toContain('Hybrid storage')
    expect(html).toContain('<option value="file"')
    expect(html).toContain('Pure JSONL file storage')
  })

  it('shows DeepSeek V4 model compaction thresholds from the model profile', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Current model context policy')
    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Built-in model config')
    expect(html).toContain('1,000,000')
    expect(html).toContain('980,000')
    expect(html).toContain('990,000')
    expect(html).toContain('Fallback compaction thresholds')
  })

  it('renders MCP, Skill, web, attachment, and memory diagnostics', () => {
    const ctx = {
      ...baseCtx(),
      runtimeInfo: {
        pid: 123,
        capabilities: {
          model: { id: 'deepseek-chat' },
          mcp: { status: 'available', configuredServers: 2, connectedServers: 2 },
          web: { status: 'available', provider: 'brave-search' },
          instructions: { status: 'available', lastSourceCount: 1 },
          skills: { status: 'available' },
          subagents: { status: 'available' },
          attachments: { status: 'available' },
          memory: { status: 'available' }
        }
      },
      toolDiagnostics: {
        providers: [{ id: 'builtin' }, { id: 'mcp' }, { id: 'web' }, { id: 'memory' }],
        mcpServers: [{ id: 'github' }],
        instructions: { lastInjection: { sources: [{ scope: 'workspace', path: '/tmp/project/AGENTS.md' }] } },
        skills: { skills: [{ id: 'skill_docs' }] },
        attachments: { count: 1 }
      },
      memoryRecords: [
        {
          id: 'mem_1',
          content: 'Prefer pnpm for this workspace',
          scope: 'workspace',
          tags: ['tooling'],
          disabledAt: '2026-06-21T01:00:00.000Z'
        }
      ]
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Kun diagnostics')
    expect(html).toContain('MCP')
    expect(html).toContain('available')
    expect(html).toContain('2/2')
    expect(html).toContain('brave-search')
    expect(html).toContain('Instructions')
    expect(html).toContain('AGENTS.md instructions')
    expect(html).toContain('Providers')
    expect(html).toContain('MCP servers')
    expect(html).toContain('Discovered Skills')
    expect(html).toContain('Prefer pnpm for this workspace')
    expect(html).toContain('mem_1')
    expect(html).toContain('aria-label="Restore"')
    expect(html).not.toContain('aria-label="Disable memory"')
    expect(html).toContain('Delete memory')
  })

  it('describes MCP config as an external-tool JSON file instead of model credentials', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('External tool config path')
    expect(html).toContain('/tmp/project/.kun/mcp.json')
    expect(html).toContain('Model and API credentials do not live in this MCP file')
    expect(html).not.toContain('DeepSeek auth')
    expect(html).not.toContain('Base URL are stored in this file')
    expect(html).not.toContain('config.toml')
  })

  it('renders valid untrusted project config with redacted summaries and approval actions', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Project MCP &amp; Skills')
    expect(html).toContain('/tmp/project/.kun/project.json')
    expect(html).toContain('Valid configuration')
    expect(html).toContain('MCP not approved')
    expect(html).toContain('sha256:aaaaaaaaaaaa')
    expect(html).toContain('local')
    expect(html).toContain('node')
    expect(html).toContain('Save project config')
    expect(html).toContain('Approve project MCP')
    expect(html).not.toContain('GITHUB_TOKEN')
  })

  it('renders trusted, stale, invalid, and missing-workspace project states', () => {
    const trusted = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: { ...(baseCtx().projectConfig as object), trust: 'trusted' }
      }
    }))
    expect(trusted).toContain('MCP approved')
    expect(trusted).toContain('Revoke project MCP')

    const stale = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: { ...(baseCtx().projectConfig as object), trust: 'stale' }
      }
    }))
    expect(stale).toContain('Approval stale')
    expect(stale).toContain('Reapprove project MCP')
    expect(stale).toContain('Revoke project MCP')

    const staleInvalid = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: {
          ...(baseCtx().projectConfig as object),
          status: 'invalid',
          trust: 'stale',
          message: 'Project config is invalid'
        }
      }
    }))
    expect(staleInvalid).toContain('Revoke project MCP')
    expect(staleInvalid).toMatch(/Reapprove project MCP<\/button>/)
    expect(staleInvalid).toContain('disabled=""')

    const invalid = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: {
          ...(baseCtx().projectConfig as object),
          status: 'invalid',
          trust: 'untrusted',
          message: 'Skill root escapes the workspace'
        }
      }
    }))
    expect(invalid).toContain('Invalid configuration')
    expect(invalid).toContain('Skill root escapes the workspace')
    expect(invalid).toMatch(/Approve project MCP<\/button>/)
    expect(invalid).toContain('disabled=""')

    const missingWorkspace = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: { ...baseCtx(), activeProjectWorkspaceRoot: '' }
    }))
    expect(missingWorkspace).toContain('Select a workspace first')
    expect(missingWorkspace).not.toContain('Save project config')
  })

  it('renders Skill and MCP permission-source previews without exposing secret values', () => {
    const ctx = {
      ...baseCtx(),
      form: {
        claw: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } },
        disabledSkillIds: ['legacy-skill']
      },
      skillRoots: [
        {
          id: 'workspace-agents',
          disableKey: 'workspace-agents',
          path: '/repo/.agents/skills',
          scope: 'project',
          source: 'common',
          exists: true,
          enabled: true,
          skillCount: 2
        },
        {
          id: 'global-kun',
          disableKey: 'global-kun',
          path: '/home/me/.kun/skills',
          scope: 'global',
          source: 'common',
          exists: true,
          enabled: true,
          skillCount: 1
        },
        {
          id: 'disabled-extra',
          disableKey: 'disabled-extra',
          path: '/tmp/disabled-skills',
          scope: 'global',
          source: 'extra',
          exists: true,
          enabled: false,
          skillCount: 1
        }
      ],
      mcpConfigText: JSON.stringify({
        servers: {
          github: {
            transport: 'stdio',
            command: 'npx',
            env: { GITHUB_TOKEN: '' },
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/repo']
          },
          docs: {
            transport: 'streamable-http',
            url: 'https://mcp.example.com',
            workspaceRoots: ['/repo/docs'],
            headers: { Authorization: '' },
            trustScope: 'user'
          },
          disabled: {
            transport: 'sse',
            url: 'https://disabled.example.com',
            enabled: false
          }
        }
      })
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Skill permission sources')
    expect(html).toContain('Enabled roots')
    expect(html).toContain('Disabled roots')
    expect(html).toContain('Workspace roots')
    expect(html).toContain('Global roots')
    expect(html).toContain('Blocked skills')
    expect(html).toContain('External tool permission sources')
    expect(html).toContain('Enabled servers')
    expect(html).toContain('Disabled servers')
    expect(html).toContain('All-workspace scope')
    expect(html).toContain('Workspace scope')
    expect(html).toContain('Workspace-visible only')
    expect(html).toContain('Local commands')
    expect(html).toContain('HTTP/SSE servers')
    expect(html).toContain('Uses env')
    expect(html).toContain('Uses headers')
    expect(html).toContain('Secret values stay hidden here')
  })

  it('defines the LiteLLM provider preset for the Providers menu', () => {
    const litellm = getModelProviderPreset('litellm')
    expect(litellm && modelProviderPresetProfile(litellm)).toMatchObject({
      id: 'litellm',
      name: 'LiteLLM',
      baseUrl: 'http://localhost:4000',
      endpointFormat: 'chat_completions'
    })
  })

  it('defines OpenAI-compatible provider presets for the Providers menu', () => {
    const expected = [
      ['longcat', 'LongCat', 'https://api.longcat.chat/openai'],
      ['zhipu-coding-plan', 'Zhipu Coding Plan', 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', 'custom_endpoint'],
      ['zai-coding-plan', 'Z.ai Coding Plan', 'https://api.z.ai/api/coding/paas/v4/chat/completions', 'custom_endpoint'],
      ['kimi-code', 'Kimi Code', 'https://api.kimi.com/coding/v1'],
      ['volcengine', 'Volcano Ark API', 'https://ark.cn-beijing.volces.com/api/v3'],
      ['volcengine-agent-plan', 'Volcano Ark Agent Plan', 'https://ark.cn-beijing.volces.com/api/plan/v3'],
      ['volcengine-coding-plan', 'Volcano Ark Coding Plan', 'https://ark.cn-beijing.volces.com/api/coding/v3'],
      ['moonshot-cn', 'Moonshot CN', 'https://api.moonshot.cn/v1'],
      ['moonshot-global', 'Moonshot Global', 'https://api.moonshot.ai/v1']
    ] as const

    for (const [id, name, baseUrl, endpointFormat = 'chat_completions'] of expected) {
      const preset = getModelProviderPreset(id)
      expect(preset && modelProviderPresetProfile(preset)).toMatchObject({
        id,
        name,
        baseUrl,
        endpointFormat
      })
    }
  })
})
