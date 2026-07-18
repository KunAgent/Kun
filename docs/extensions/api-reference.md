# Kun Extension API 参考

> Extension API：v1.2.0（稳定）
> 适用 Kun：以扩展 Manifest 的 `engines.kun` 与[兼容矩阵](./versioning-and-migrations.md#兼容矩阵)为准
> English: [Kun Extension API Reference](./api-reference.en.md)

本页是 `@kun/extension-api`、`@kun/extension-react` 和 `@kun/extension-test` 的独立公开 API 参考。中文行为指南仍是规范主源；这里精确列出包入口、核心服务和由 TypeScript 公共模块生成的导出清单。未出现在清单或包 `exports` map 中的源码路径都不是受支持 API。

## 版本与权威来源

三个 SDK 当前版本均为 `1.2.0`，对应 Extension API major 1。Host 继续接受 v1.1 与 v1.0 Manifest。v1.2 以可选方式新增 composer context、媒体调度、有界文档/归档和真实本地音视频分析 surface，不改变既有 v1.1 或 v1.0 方法。Manifest 字段以生成的 [JSON Schema](../../packages/extension-api/schema/kun-extension.schema.json) 和 `ExtensionManifestSchema` 为机器真源；Host API、事件和 payload 以发布包的 `.d.ts` 与 runtime Schema 为真源。

公开入口、export 或可达 `.d.ts` 发生任何变化时，public surface SHA-256 会变化，文档门禁要求同时更新本页和 [API Changelog](./release-troubleshooting-changelog.md#api-changelog)。只改本表的摘要值而不记录兼容性影响，不算完成发布审查。

## 包与入口

| 包 | 用途 | 唯一受支持入口 |
| --- | --- | --- |
| `@kun/extension-api` | Framework-neutral Manifest、生命周期、Host client、Agent、工具、Provider、账号、存储、网络、UI、media、job 和 artifact 契约 | `@kun/extension-api`；另有只读 `@kun/extension-api/manifest.schema.json` |
| `@kun/extension-react` | 基于 `ExtensionHostClient` 的 React Provider、hooks 和状态组件 | `@kun/extension-react` |
| `@kun/extension-test` | Fake Host/transport/service 与 `ExtensionTestHarness` | `@kun/extension-test` |

不要导入 `src/*`、`dist/*`、Kun runtime、renderer store、Electron IPC 或其它未声明 subpath。即使文件在开发仓库或安装包里存在，也没有 SemVer 保证。

## Framework-neutral Host API

Node 入口通常接收 Host 创建的 `ExtensionContext`；Webview 使用 Host 提供的窄 `HostTransport` 创建 `ExtensionHostClient`。调用者不提供 extension identity、runtime token 或授权结果。

```ts
import { ExtensionHostClient, type ExtensionContext, type HostTransport } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('refresh', async () => ({ refreshed: true }))
  )
}

export function createViewClient(transport: HostTransport): ExtensionHostClient {
  return new ExtensionHostClient(transport)
}
```

### `ExtensionContext` 服务

| 属性 | 公开契约 |
| --- | --- |
| `subscriptions`, `onDidError` | 生命周期释放与结构化扩展错误 |
| `commands` | 声明过的命令注册、执行与 handler disposal |
| `storage`, `configuration` | extension/workspace 隔离状态与声明式设置；不保存秘密 |
| `network` | permission/domain/account 约束的 Broker fetch |
| `ui` | theme、locale、View state、Host message、通知和主会话上下文挂载 |
| `agent`, `threads` | 扩展自有 Agent run、事件、steer/cancel 和 thread projection |
| `tools` | Manifest 声明工具的注册、progress、cancellation 与 bounded result |
| `modelProviders` | 自定义 Provider adapter 的 probe/listModels/stream/cancel/countTokens |
| `authentication` | redacted account、受保护认证 session、authenticated fetch 和显式 secret reveal |
| `media` | 受保护选择、不透明 handle、bounded metadata/probe、View resource lease 和 brokered FFmpeg job 创建 |
| `jobs` | 扩展自有 durable job 的 get/list/subscribe/cancel；不提供通用扩展 worker 或 `jobs.start` |
| `workspace`, `workspaceContext` | 已授权 root 内的文件操作与当前 workspace/trust 投影 |

Media 方法要求最小化的 `media.read`、`media.process` 或 `media.export` grant，以及适用的 workspace permission。`pickFiles`、`pickSaveTarget`、`openViewResource` 和 `performArtifactAction` 要求受保护的交互 surface；纯 headless 执行会返回结构化 interaction-required 或 unavailable 错误。`performArtifactAction` 只接受 opaque artifact ID 和 `open`/`reveal`，owner、精确版本与 workspace 由 Host 派生。Handle、artifact reference、action response 和 `kun-media://` lease 都不能替代绝对路径。Lease URL 是短期 View resource，不得持久化。

Picker、播放、FFmpeg、artifact、headless 和排错契约详见[扩展媒体与后台任务](./media-and-jobs.md)。

Job 观察要求 `jobs.manage`。`jobs.subscribe()` 从可选的不透明 cursor 之后重放保留事件，再交付 bounded live event；`replayGap` 提醒调用者从随附 snapshot 刷新。取消是幂等的，terminal job 保留原始 outcome。只有 `media.startFfmpegJob()`、音频分析、归档创建等受支持 core broker 可以创建 job；扩展不能注册任意 worker。

`ui.showNotification(options)` 返回用户选择的 action `id`；关闭、45 秒超时、工作台 lease 失效或扩展停用返回 `undefined`。它不返回内部通知实例 ID，也不要求存在 Webview Session。

`ui.attachComposerContext(request)` 仅允许已认证的交互式 Extension View 在获得 `ui.actions` 后调用。请求最多携带 16 KiB、深度和条目数受限且不含文件路径的 JSON reference；Host 重新校验当前 View、扩展版本、workspace trust 与权限，并补充不可伪造的扩展/View/workspace provenance。成功结果在匹配 workspace 的主会话输入框显示为可移除上下文，并只随下一次成功创建的主会话 turn 消费一次。模型只把它视为 user message 中的不可信 reference data，不会放入稳定 system prefix；Node Host 扩展不能用它绕过 View 身份边界。

### Runtime Schema 与类型

以 `Schema` 结尾的导出是 runtime validation 值；同名或相邻的 TypeScript type/interface 描述通过验证后的静态形状。例如 `AgentRunSchema`/`AgentRun`、`ToolResultSchema`/`ToolResult`。输入使用 `z.input` 推导时可能允许 Schema 默认字段省略，输出类型则反映规范化结果。

Manifest 工具的 `outputSchema` 描述并验证 `ToolResult.content`，不是整个 `ToolResult` envelope。省略它表示只应用通用 JSON、大小和策略限制，并不关闭输出上限。

`ToolResult` 和 terminal `JobResult` 可以在顶层提供 `generatedArtifacts`。每个 artifact 包含 durable opaque ownership、completion、media-handle、MIME、size、availability 和 provenance metadata；不包含绝对路径或临时播放 URL。`ResultPreviewSource` 可引用 artifact 和 media handle，同时保留 v1.0 attachment/relative-path source 字段。

## React bindings

`ExtensionViewProvider` 提供一个已绑定的 `ExtensionHostClient`。`useTheme`、`useLocale`、`useViewState`、`useHostMessage`、`usePostHostMessage`、`useCommand`、`useAgentRun`、`useAccounts`、`useProviderStatus` 和 `useConfiguration` 复用 framework-neutral 语义；它们不会获得额外权限。`ExtensionAsyncBoundary`、`AgentRunStatus` 是可选 Host-aware 呈现组件。

## Test harness

`createExtensionTestHarness`/`ExtensionTestHarness` 组合 `FakeHostTransport` 与 fake storage、workspace、Agent、tool、Provider、account、Webview、media 和 durable-job service。`FakeMediaService`、`FakeJobService` 与 `createGeneratedArtifactFixture()` 提供确定性的受保护选择、probe、FFmpeg admission、progress、restart、cancellation race、executable unavailable、revocation 和 artifact 行为，不需要真实 media tool 或 wall-clock wait。测试仍应声明与生产相同的 permission/workspace/account scope；fake service 不会让生产 Broker 自动放行。

## 生成的公开导出清单

以下区域由 `node scripts/generate-extension-api-reference.mjs` 从 package `exports`、TypeScript module symbols 和公开入口可达的内存 `.d.ts` 图计算。手工编辑会被 `npm run check:extension-docs` 拒绝。

<!-- BEGIN GENERATED SDK EXPORTS -->
| SDK 包 | 版本 | 公开入口 | 公开导出数 | 公开 surface SHA-256 |
| --- | --- | --- | --- | --- |
| `@kun/extension-api` | `1.2.0` | `.`<br>`./manifest.schema.json` | 494 | `b30724f4cdc3c9c1a989794a3a120e385c394a8fc6341e27a27742dabf429fbb` |
| `@kun/extension-react` | `1.2.0` | `.` | 22 | `e2099a64dc22c05056dca0c599bafdfb22702b6d57e9b60edd2154b165323322` |
| `@kun/extension-test` | `1.2.0` | `.` | 16 | `386c2beca46c240f957af2c92925c410a6d801a3bcc9f87697944d9f6d23337e` |

| SDK 包 | 源码模块 | 运行时导出 | 类型导出 |
| --- | --- | --- | --- |
| `@kun/extension-api` | `accounts` | `AccountSchema`<br>`AccountSessionSchema`<br>`AccountStatusSchema`<br>`AuthenticatedFetchRequestSchema`<br>`AuthenticationProviderDeclarationSchema`<br>`AuthenticationTypeSchema`<br>`CreateAccountSessionRequestSchema`<br>`CredentialReferenceSchema`<br>`ListAccountsRequestSchema`<br>`ProviderBindingSchema`<br>`RevealSecretRequestSchema` | `Account`<br>`AccountSession`<br>`AccountStatus`<br>`AuthenticatedFetchRequest`<br>`AuthenticationProviderDeclaration`<br>`AuthenticationType`<br>`CreateAccountSessionRequest`<br>`CredentialReference`<br>`ListAccountsRequest`<br>`ProviderBinding`<br>`RevealSecretRequest` |
| `@kun/extension-api` | `agent` | `AgentBudgetSchema`<br>`AgentCancelRequestSchema`<br>`AgentCreateRunRequestSchema`<br>`AgentCreateRunResponseSchema`<br>`AgentInputSchema`<br>`AgentMutationResultSchema`<br>`AgentProfileDeclarationSchema`<br>`AgentRunEventSchema`<br>`AgentRunSchema`<br>`AgentRunStateSchema`<br>`AgentSteerRequestSchema`<br>`AgentSubscribeRequestSchema`<br>`ExtensionThreadProjectionSchema`<br>`ExtensionVisibilitySchema`<br>`ListOwnThreadsRequestSchema`<br>`ListOwnThreadsResponseSchema`<br>`ResolvedAgentProfileSchema` | `AgentBudget`<br>`AgentCancelRequest`<br>`AgentCreateRunRequest`<br>`AgentCreateRunResponse`<br>`AgentInput`<br>`AgentMutationResult`<br>`AgentProfileDeclaration`<br>`AgentProfileDeclarationInput`<br>`AgentRun`<br>`AgentRunEvent`<br>`AgentRunState`<br>`AgentSteerRequest`<br>`AgentSubscribeRequest`<br>`ExtensionThreadProjection`<br>`ExtensionVisibility`<br>`ListOwnThreadsRequest`<br>`ListOwnThreadsResponse`<br>`ResolvedAgentProfile` |
| `@kun/extension-api` | `artifacts` | `ArtifactHostActionRequestSchema`<br>`ArtifactHostActionResultSchema`<br>`ArtifactHostActionSchema`<br>`ArtifactMediaHandleIdSchema`<br>`GeneratedArtifactAvailabilitySchema`<br>`GeneratedArtifactIdSchema`<br>`GeneratedArtifactMediaKindSchema`<br>`GeneratedArtifactProvenanceSchema`<br>`GeneratedArtifactSchema`<br>`GeneratedArtifactsSchema` | `ArtifactHostAction`<br>`ArtifactHostActionRequest`<br>`ArtifactHostActionResult`<br>`ArtifactMediaHandleId`<br>`GeneratedArtifact`<br>`GeneratedArtifactAvailability`<br>`GeneratedArtifactId`<br>`GeneratedArtifactInput`<br>`GeneratedArtifactMediaKind`<br>`GeneratedArtifactProvenance`<br>`GeneratedArtifacts` |
| `@kun/extension-api` | `client` | `createExtensionContext`<br>`ExtensionHostClient` | `ExtensionContext` |
| `@kun/extension-api` | `common` | `ContributionIdSchema`<br>`ExtensionIdentitySchema`<br>`extensionIdOf`<br>`ExtensionIdSchema`<br>`ExtensionNameSchema`<br>`JsonObjectSchema`<br>`JsonValueSchema`<br>`LocalIdSchema`<br>`PageInfoSchema`<br>`PageRequestSchema`<br>`PublisherSchema`<br>`qualifiedContributionId`<br>`RelativePathSchema`<br>`SEMVER_PATTERN`<br>`SemverRangeSchema`<br>`SemverSchema` | `ExtensionIdentity`<br>`JsonObject`<br>`JsonPrimitive`<br>`JsonValue`<br>`PageInfo`<br>`PageRequest` |
| `@kun/extension-api` | `compatibility` | `ApiNegotiationRequestSchema`<br>`ApiNegotiationResultSchema`<br>`CompatibilityDiagnosticSchema`<br>`CompatibilityDimensionSchema`<br>`CompatibilityReportSchema`<br>`negotiateApiVersion`<br>`supportedApiMajors` | `ApiNegotiationRequest`<br>`ApiNegotiationResult`<br>`CompatibilityDiagnostic`<br>`CompatibilityDimension`<br>`CompatibilityReport` |
| `@kun/extension-api` | `composer-context` | `ComposerContextAttachmentRequestSchema`<br>`ComposerContextAttachmentSchema`<br>`ComposerContextProvenanceSchema`<br>`ComposerContextReferenceSchema`<br>`MAX_COMPOSER_CONTEXT_ATTACHMENTS`<br>`MAX_COMPOSER_CONTEXT_REFERENCE_BYTES` | `ComposerContextAttachment`<br>`ComposerContextAttachmentRequest`<br>`ComposerContextProvenance` |
| `@kun/extension-api` | `content-scripts` | `HostContentScriptContextSchema`<br>`HostContentScriptDiagnosticSchema` | `HostContentScriptContext`<br>`HostContentScriptDiagnostic`<br>`KunHostContentScriptApi` |
| `@kun/extension-api` | `errors` | `DiagnosticSchema`<br>`EXTENSION_ERROR_CODES`<br>`ExtensionApiError`<br>`ExtensionErrorCodeSchema`<br>`ExtensionErrorSchema` | `Diagnostic`<br>`ExtensionErrorCode`<br>`ExtensionErrorData` |
| `@kun/extension-api` | `jobs` | `JobCancellationResultSchema`<br>`JobCancelRequestSchema`<br>`JobCursorSchema`<br>`JobErrorSchema`<br>`JobEventNotificationSchema`<br>`JobEventSchema`<br>`JobEventTypeSchema`<br>`JobFilterSchema`<br>`JobGetRequestSchema`<br>`JobIdSchema`<br>`JobListRequestSchema`<br>`JobPageSchema`<br>`JobProgressSchema`<br>`JobReferenceSchema`<br>`JobResultSchema`<br>`JobSnapshotSchema`<br>`JobStateSchema`<br>`JobSubscribeRequestSchema`<br>`JobSubscriptionResponseSchema`<br>`JobTerminalStateSchema` | `JobCancellationResult`<br>`JobCancelRequest`<br>`JobCursor`<br>`JobError`<br>`JobEvent`<br>`JobEventNotification`<br>`JobEventType`<br>`JobFilter`<br>`JobGetRequest`<br>`JobId`<br>`JobListRequest`<br>`JobPage`<br>`JobProgress`<br>`JobReference`<br>`JobResult`<br>`JobResultInput`<br>`JobSnapshot`<br>`JobState`<br>`JobSubscribeRequest`<br>`JobSubscriptionResponse`<br>`JobTerminalState` |
| `@kun/extension-api` | `lifecycle` | `ActivationContextDataSchema`<br>`DisposableStore`<br>`Emitter`<br>`toDisposable`<br>`WorkspaceContextSchema` | `Activate`<br>`ActivationContextData`<br>`Deactivate`<br>`Disposable`<br>`DisposeLike`<br>`Event`<br>`StateMigration`<br>`StateMigrationContext`<br>`WorkspaceContext` |
| `@kun/extension-api` | `manifest` | `ActionContributionSchema`<br>`ActivationEventSchema`<br>`CommandContributionSchema`<br>`ContextMenuContributionSchema`<br>`CURRENT_EXTENSION_API_VERSION`<br>`CURRENT_MANIFEST_VERSION`<br>`ExtensionContributionsSchema`<br>`ExtensionManifestSchema`<br>`ExternalBrowserContributionSchema`<br>`ExternalBrowserSiteSchema`<br>`HostContentScriptContributionSchema`<br>`HostSurfaceMatcherSchema`<br>`MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS`<br>`ManifestContributionLocalizationsSchema`<br>`ManifestLocaleTagSchema`<br>`ManifestLocalizationSchema`<br>`ManifestLocalizationsSchema`<br>`NotificationContributionSchema`<br>`parseExtensionManifest`<br>`requiredManifestPermissions`<br>`resolveExtensionManifestLocale`<br>`ResultPreviewContributionSchema`<br>`SettingsContributionSchema`<br>`SUPPORTED_EXTENSION_API_VERSIONS`<br>`ViewContainerContributionSchema`<br>`ViewContributionSchema` | `ActionContribution`<br>`ActivationEvent`<br>`CommandContribution`<br>`ContextMenuContribution`<br>`ExtensionContributions`<br>`ExtensionContributionsInput`<br>`ExtensionManifest`<br>`ExtensionManifestInput`<br>`ExternalBrowserContribution`<br>`ExternalBrowserSite`<br>`HostContentScriptContribution`<br>`HostSurfaceMatcher`<br>`ManifestContributionLocalizations`<br>`ManifestLocaleTag`<br>`ManifestLocalization`<br>`ManifestLocalizations`<br>`NotificationContribution`<br>`ResultPreviewContribution`<br>`SettingsContribution`<br>`ViewContainerContribution`<br>`ViewContribution` |
| `@kun/extension-api` | `media` | `MAX_MEDIA_ARCHIVE_ENTRIES`<br>`MAX_MEDIA_ARCHIVE_INLINE_BYTES`<br>`MAX_MEDIA_OTIO_TEXT_BYTES`<br>`MAX_MEDIA_SUBTITLE_TEXT_BYTES`<br>`MAX_MEDIA_TEXT_BYTES`<br>`MEDIA_ERROR_CODES`<br>`MediaAnalyzeVisualFramesRequestSchema`<br>`MediaAnalyzeVisualFramesResultSchema`<br>`MediaArchiveInlineEntrySchema`<br>`MediaArchiveInputEntrySchema`<br>`MediaArchiveJobResultSchema`<br>`MediaArchivePathSchema`<br>`MediaAudioAnalysisCapabilitiesSchema`<br>`MediaAudioAnalysisCapabilitySchema`<br>`MediaAudioAnalysisKindSchema`<br>`MediaAudioAnalysisResultSchema`<br>`MediaAudioAnalysisUnavailableCodeSchema`<br>`MediaBeatAnalysisResultSchema`<br>`MediaCacheFormatSchema`<br>`MediaCapabilitiesSchema`<br>`MediaCapabilityFeatureSchema`<br>`MediaCreateCacheTargetRequestSchema`<br>`MediaCreateCacheTargetResultSchema`<br>`MediaEmbedVisualQueryRequestSchema`<br>`MediaEmbedVisualQueryResultSchema`<br>`MediaErrorCodeSchema`<br>`MediaErrorSchema`<br>`MediaExecutableCapabilitySchema`<br>`MediaHandleIdSchema`<br>`MediaHandleModeSchema`<br>`MediaInstallVisualModelRequestSchema`<br>`MediaJobPrioritySchema`<br>`MediaJobSchedulingSchema`<br>`MediaKindSchema`<br>`MediaLeaseIdSchema`<br>`MediaMetadataSchema`<br>`MediaOpenViewResourceRequestSchema`<br>`MediaPickerFilterSchema`<br>`MediaPickFilesRequestSchema`<br>`MediaPickFilesResultSchema`<br>`MediaPickSaveTargetRequestSchema`<br>`MediaPickSaveTargetResultSchema`<br>`MediaProbeRequestSchema`<br>`MediaProbeResultSchema`<br>`MediaProbeStreamSchema`<br>`MediaReadTextRequestSchema`<br>`MediaReadTextResultSchema`<br>`MediaReleaseRequestSchema`<br>`MediaReleaseResultSchema`<br>`MediaResourceLeaseSchema`<br>`MediaSilenceAnalysisResultSchema`<br>`MediaStartArchiveJobRequestSchema`<br>`MediaStartArchiveJobResultSchema`<br>`MediaStartAudioAnalysisJobRequestSchema`<br>`MediaStartAudioAnalysisJobResultSchema`<br>`MediaStartBeatAnalysisJobRequestSchema`<br>`MediaStartFfmpegJobRequestSchema`<br>`MediaStartFfmpegJobResultSchema`<br>`MediaStartSilenceAnalysisJobRequestSchema`<br>`MediaStartSyncFeaturesAnalysisJobRequestSchema`<br>`MediaStatRequestSchema`<br>`MediaStreamDispositionSchema`<br>`MediaSyncFeaturesAnalysisResultSchema`<br>`MediaTextOutputMimeTypeSchema`<br>`MediaTextOutputSchema`<br>`MediaVisualAdapterBindingSchema`<br>`MediaVisualFrameSampleSchema`<br>`MediaVisualModelDescriptorSchema`<br>`MediaVisualModelFileSchema`<br>`MediaVisualModelInstallReceiptSchema`<br>`MediaVisualModelStatusSchema`<br>`MediaVisualUnavailableCodeSchema`<br>`RationalSchema` | `MediaAnalyzeVisualFramesRequest`<br>`MediaAnalyzeVisualFramesResult`<br>`MediaArchiveInlineEntry`<br>`MediaArchiveInputEntry`<br>`MediaArchiveJobResult`<br>`MediaArchivePath`<br>`MediaAudioAnalysisCapabilities`<br>`MediaAudioAnalysisCapability`<br>`MediaAudioAnalysisKind`<br>`MediaAudioAnalysisResult`<br>`MediaAudioAnalysisUnavailableCode`<br>`MediaBeatAnalysisResult`<br>`MediaCacheFormat`<br>`MediaCapabilities`<br>`MediaCapabilityFeature`<br>`MediaCreateCacheTargetRequest`<br>`MediaCreateCacheTargetResult`<br>`MediaEmbedVisualQueryRequest`<br>`MediaEmbedVisualQueryResult`<br>`MediaError`<br>`MediaErrorCode`<br>`MediaExecutableCapability`<br>`MediaHandleId`<br>`MediaHandleMode`<br>`MediaInstallVisualModelRequest`<br>`MediaJobPriority`<br>`MediaJobScheduling`<br>`MediaKind`<br>`MediaLeaseId`<br>`MediaMetadata`<br>`MediaOpenViewResourceRequest`<br>`MediaPickerFilter`<br>`MediaPickFilesRequest`<br>`MediaPickFilesResult`<br>`MediaPickSaveTargetRequest`<br>`MediaPickSaveTargetResult`<br>`MediaProbeRequest`<br>`MediaProbeResult`<br>`MediaProbeStream`<br>`MediaReadTextRequest`<br>`MediaReadTextResult`<br>`MediaReleaseRequest`<br>`MediaReleaseResult`<br>`MediaResourceLease`<br>`MediaSilenceAnalysisResult`<br>`MediaStartArchiveJobRequest`<br>`MediaStartArchiveJobResult`<br>`MediaStartAudioAnalysisJobRequest`<br>`MediaStartAudioAnalysisJobResult`<br>`MediaStartBeatAnalysisJobRequest`<br>`MediaStartFfmpegJobRequest`<br>`MediaStartFfmpegJobResult`<br>`MediaStartSilenceAnalysisJobRequest`<br>`MediaStartSyncFeaturesAnalysisJobRequest`<br>`MediaStatRequest`<br>`MediaStreamDisposition`<br>`MediaSyncFeaturesAnalysisResult`<br>`MediaTextOutput`<br>`MediaTextOutputMimeType`<br>`MediaVisualAdapterBinding`<br>`MediaVisualFrameSample`<br>`MediaVisualModelDescriptor`<br>`MediaVisualModelFile`<br>`MediaVisualModelInstallReceipt`<br>`MediaVisualModelStatus`<br>`MediaVisualUnavailableCode`<br>`ParsedMediaStartArchiveJobRequest`<br>`ParsedMediaStartAudioAnalysisJobRequest`<br>`Rational` |
| `@kun/extension-api` | `methods` | `EXTENSION_VIEW_SAFE_METHODS`<br>`isExtensionViewSafeMethod` | `ExtensionViewSafeMethod` |
| `@kun/extension-api` | `permissions` | `hasPermission`<br>`NETWORK_PERMISSION_PATTERN`<br>`permissionMatches`<br>`PermissionSchema`<br>`PROVIDER_PERMISSION_PATTERN`<br>`ScopedPermissionSchema`<br>`STATIC_PERMISSIONS`<br>`StaticPermissionSchema` | `Permission`<br>`ScopedPermission`<br>`StaticPermission` |
| `@kun/extension-api` | `providers` | `ModelCapabilitiesSchema`<br>`ModelContentPartSchema`<br>`ModelMessageSchema`<br>`ModelModalitySchema`<br>`ModelProviderDeclarationSchema`<br>`ModelProviderRequestSchema`<br>`ModelProviderStreamEventSchema`<br>`ModelToolSchema`<br>`ModelUsageSchema`<br>`ProviderModelSchema`<br>`ProviderProbeResultSchema`<br>`ProviderStatusSchema` | `ModelCapabilities`<br>`ModelContentPart`<br>`ModelMessage`<br>`ModelModality`<br>`ModelProviderAdapter`<br>`ModelProviderDeclaration`<br>`ModelProviderDeclarationInput`<br>`ModelProviderOperationContext`<br>`ModelProviderRequest`<br>`ModelProviderStreamEvent`<br>`ModelTool`<br>`ModelUsage`<br>`ProviderModel`<br>`ProviderProbeResult`<br>`ProviderStatus` |
| `@kun/extension-api` | `registry` | `ExtensionRegistryEntrySchema`<br>`ExtensionRegistrySchema`<br>`ExtensionSourceSchema`<br>`InstalledExtensionVersionSchema`<br>`PermissionGrantSchema`<br>`SignatureStatusSchema` | `ExtensionRegistry`<br>`ExtensionRegistryEntry`<br>`ExtensionSource`<br>`InstalledExtensionVersion`<br>`PermissionGrant`<br>`SignatureStatus` |
| `@kun/extension-api` | `services` | `ConfigurationChangeEventSchema`<br>`HostMessageSchema`<br>`LocaleSchema`<br>`NetworkRequestSchema`<br>`NetworkResponseSchema`<br>`NotificationOptionsSchema`<br>`RESULT_PREVIEW_OPEN_CHANNEL`<br>`ResultPreviewOpenPayloadSchema`<br>`ResultPreviewSourceSchema`<br>`StorageEntrySchema`<br>`StorageScopeSchema`<br>`ThemeSchema`<br>`WorkspaceFileSchema` | `AgentApi`<br>`AgentRunSubscription`<br>`AuthenticationApi`<br>`CommandsApi`<br>`ConfigurationApi`<br>`ConfigurationChangeEvent`<br>`HostMessage`<br>`HostNotification`<br>`HostRequestContext`<br>`HostRequestHandler`<br>`HostRequestOptions`<br>`HostTransport`<br>`JobsApi`<br>`JobSubscription`<br>`Locale`<br>`MediaApi`<br>`ModelProvidersApi`<br>`NetworkApi`<br>`NetworkRequest`<br>`NetworkResponse`<br>`NotificationOptions`<br>`ResultPreviewOpenPayload`<br>`ResultPreviewSource`<br>`ScopedStorageApi`<br>`StorageApi`<br>`StorageEntry`<br>`StorageScope`<br>`Theme`<br>`ThreadsApi`<br>`ToolsApi`<br>`UiApi`<br>`WorkspaceApi`<br>`WorkspaceFile` |
| `@kun/extension-api` | `tools` | `ExtensionToolDeclarationSchema`<br>`ToolInvocationSchema`<br>`ToolProgressSchema`<br>`ToolResultSchema`<br>`ToolSideEffectsSchema` | `CancellationToken`<br>`ExtensionToolDeclaration`<br>`ExtensionToolDeclarationInput`<br>`ExtensionToolHandler`<br>`ToolInvocation`<br>`ToolInvocationContext`<br>`ToolProgress`<br>`ToolResult`<br>`ToolSideEffects` |
| `@kun/extension-react` | `index` | `AgentRunStatus`<br>`ExtensionAsyncBoundary`<br>`ExtensionViewProvider`<br>`useAccounts`<br>`useAgentRun`<br>`useCommand`<br>`useConfiguration`<br>`useExtensionClient`<br>`useHostMessage`<br>`useLocale`<br>`usePostHostMessage`<br>`useProviderStatus`<br>`useTheme`<br>`useViewState` | `AgentRunHookResult`<br>`AgentRunStatusProps`<br>`AsyncBoundaryProps`<br>`AsyncValue`<br>`CommandHookResult`<br>`ConfigurationHookResult`<br>`ExtensionViewProviderProps`<br>`ViewStateResult` |
| `@kun/extension-test` | `index` | `createExtensionTestHarness`<br>`createGeneratedArtifactFixture`<br>`ExtensionTestHarness`<br>`FakeAccountService`<br>`FakeAgentService`<br>`FakeClock`<br>`FakeHostTransport`<br>`FakeJobService`<br>`FakeMediaService`<br>`FakeProviderService`<br>`FakeStorageService`<br>`FakeToolService`<br>`FakeWebviewService`<br>`FakeWorkspaceService` | `ExtensionTestHarnessOptions`<br>`FakeTransportOptions` |
<!-- END GENERATED SDK EXPORTS -->

## 稳定性与弃用

公开导出从发布起受 SemVer 保护。新增可选能力属于兼容 minor；删除、重命名、收紧输入或改变既有语义需要新 major。弃用项必须在类型声明、两种语言的本参考、Changelog、诊断和迁移指南中同时注明 replacement 与最早 removal major。原始 DOM selector、私有 IPC/HTTP 和未导出路径不进入本清单，也不会因为被第三方使用而成为稳定 API。
