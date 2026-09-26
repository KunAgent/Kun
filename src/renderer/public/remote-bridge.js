/*
 * Kun Remote bridge. Served by the Remote gateway to browser clients; the
 * gateway prepends __KUN_REMOTE_BOOTSTRAP__ with host constants and the
 * remote-bridge-transport.js / remote-bridge-browser.js helpers. Inside the
 * Electron app the real preload already installed window.kunGui, so this file
 * is a no-op there.
 */
(function installKunRemoteBridge() {
  if (typeof window === 'undefined') return
  if (window.kunGui) return

  var BOOT = window.__KUN_REMOTE_BOOTSTRAP__ || {}
  // Transport + browser helpers ship as sibling files; the Remote gateway
  // concatenates them ahead of this file. When this file is served alone
  // (desktop bundle, plain Vite preview) the bridge stays uninstalled.
  if (typeof window.__kunRemoteCreateTransport !== 'function') return
  var transport = window.__kunRemoteCreateTransport()
  var clientId = transport.clientId
  var ensureEventStream = transport.ensureEventStream
  var invoke = transport.invoke
  var invokeRaw = transport.invokeRaw
  var invokePayload = transport.invokePayload
  var on = transport.on
  var browser = window.__kunRemoteBrowser || {}
  var bufferToBase64 = browser.bufferToBase64
  var pickFilesWithBrowser = browser.pickFilesWithBrowser

  function normalizeStartupState(payload) {
    if (payload && typeof payload === 'object' && typeof payload.phase === 'string') {
      return typeof payload.detail === 'string'
        ? { phase: payload.phase, detail: payload.detail }
        : { phase: payload.phase }
    }
    if (typeof payload === 'string') return { phase: payload }
    return { phase: 'bootstrapping' }
  }

  function unavailable(name) {
    return function () {
      return Promise.reject(new Error('kunGui.' + name + ' is not available in Remote web mode'))
    }
  }

  var clipboardImageBridge = window.__kunRemoteBridgeClipboard

  function uploadRemoteFile(file) {
    return file.arrayBuffer().then(function (buffer) {
      return fetch('/remote/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-kun-remote-request': '1',
          'x-kun-remote-client': clientId
        },
        body: JSON.stringify({ name: file.name || 'file', dataBase64: bufferToBase64(buffer) })
      }).then(function (response) {
        if (response.status === 401) {
          window.location.href = '/remote/login'
          return new Promise(function () {})
        }
        return response.json().then(function (body) {
          if (!body || body.ok !== true) {
            throw new Error(body && body.error ? body.error : 'Remote upload failed')
          }
          return body.path
        })
      })
    })
  }

  function noopSubscription() {
    return function () {}
  }

  function unavailableMember(name, prop) {
    // onXxx members are event subscriptions: return a no-op unsubscribe so
    // useEffect(() => obj.onXxx(cb)) never hands React a rejected Promise.
    if (typeof prop === 'string' && /^on[A-Z]/.test(prop)) return noopSubscription
    return unavailable(name + '.' + String(prop))
  }

  function unavailableObject(name) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'then') return undefined
        return unavailableMember(name, prop)
      }
    })
  }

  var api = {
    platform: BOOT.platform || 'web',
    isRemoteWeb: true,
    desktopTitleBarMode: BOOT.desktopTitleBarMode || 'system',
    homeDir: BOOT.homeDir || '',
    appEnvironment: BOOT.appEnvironment || { flavor: 'production', isPackaged: true },
    startup: {
      getState: function () {
        return invoke('startup:state:get').then(normalizeStartupState)
      },
      onState: function (handler) {
        return on('startup:state')(function (payload) {
          handler(normalizeStartupState(payload))
        })
      }
    },
    storageRelocation: unavailableObject('storageRelocation'),
    sharedClientState: {
      read: function () { return invoke('shared-client-state:get') },
      write: function (expectedRevision, entries) {
        return invoke('shared-client-state:put', [{ expectedRevision: expectedRevision, entries: entries }])
      }
    },
    uninstall: unavailableObject('uninstall'),
    runtimeDataRecovery: unavailableObject('runtimeDataRecovery'),
    dataMigration: unavailableObject('dataMigration'),

    getSettings: function () { return invoke('settings:get') },
    openSettingsConfigFile: invokeRaw('settings:open-config-file'),
    setSettings: invokePayload('settings:set'),
    saveSettingsSilent: invokePayload('settings:save-silent'),
    getRuntimeSettingsSyncStatus: invokeRaw('runtime:settings-sync-status:get'),
    onRuntimeSettingsSyncStatus: on('runtime:settings-sync-status'),
    runtimeRequest: function (path, method, body, options) {
      var payload = { path: path }
      if (method !== undefined) payload.method = method
      if (body !== undefined) payload.body = body
      if (options) {
        if (options.requestId) payload.requestId = options.requestId
        if (options.priority) payload.priority = options.priority
      }
      return invoke('runtime:request', [payload])
    },
    cancelRuntimeRequest: function (requestId) {
      return invoke('runtime:request:cancel', [{ requestId: requestId }])
    },
    startSse: function (threadId, sinceSeq, streamId, options) {
      ensureEventStream()
      var payload = { threadId: threadId, sinceSeq: sinceSeq }
      if (streamId !== undefined) payload.streamId = streamId
      if (options) {
        for (var key in options) payload[key] = options[key]
      }
      return invoke('runtime:sse:start', [payload])
    },
    stopSse: function (streamId) { return invoke('runtime:sse:stop', [streamId]) },
    ackSse: function (streamId, batchId) {
      return invoke('runtime:sse:ack', [{ streamId: streamId, batchId: batchId }])
    },
    onSseOpen: on('runtime:sse-open'),
    onSseEvent: on('runtime:sse-event'),
    onSseEnd: on('runtime:sse-end'),
    onSseError: on('runtime:sse-error'),
    // Synthetic local event: fires when the client event stream re-opens
    // after a drop so the renderer can reconcile its subscriptions.
    onRemoteStreamReconnected: on('remote:stream-reconnected'),
    // Server-sent: the hub recreated (or lost) this client's sender, so every
    // stream registration made through the old sender is gone and must be
    // resubscribed.
    onRemoteSenderReset: on('remote:sender-reset'),
    onRuntimeStatus: on('runtime:status'),
    onAppQuitting: on('app:quitting'),
    onClawChannelActivity: on('claw:channel-activity'),
    onTrayAction: function () { return function () {} },
    resolveKunApproval: invokePayload('approval:decide'),
    setRoomPermissions: invokePayload('room:permissions:set'),
    restartRuntime: invokeRaw('runtime:restart'),
    restartKunServe: invokeRaw('runtime:restart-serve'),
    fetchUpstreamModels: invokeRaw('upstream:models'),
    probeModelProvider: invokePayload('provider:probe'),
    listProviderQuotas: invokeRaw('provider:quota:list'),
    fetchModelsDevCatalog: invokePayload('provider:models-dev-catalog'),
    optimizePrompt: invokePayload('prompt:optimize'),
    uploadRuntimeImageAttachment: invokePayload('runtime:attachment:upload-image'),
    uploadRuntimeDocumentAttachment: invokePayload('runtime:attachment:upload-document'),
    gatewayCredential: function (action) { return invoke('gateway:credential', [action]) },
    getAppVersion: invokeRaw('app:version'),
    setAppBadgeCount: function () { return Promise.resolve() },
    showTurnCompleteNotification: invokePayload('notification:turn-complete'),
    getWindowMiniMode: invokeRaw('window:mini-mode:get'),
    onWindowMiniMode: on('window:mini-mode'),
    logError: function (category, message, detail) {
      return invoke('log:error', [{ category: category, message: message, detail: detail }])
    },
    getLogPath: invokeRaw('log:get-path'),
    openLogDir: invokeRaw('log:open-dir'),
    cliInstallStatus: invokeRaw('cli-install:status'),
    cliInstallAction: function (action) { return invoke('cli-install:action', [action]) },

    // Workspace selection + files. Native pickers open on the host machine.
    pickWorkspaceDirectory: function () {
      // Host pickers open on the Kun machine, out of reach for a remote user;
      // accept a typed host path instead.
      var entered = window.prompt('Workspace directory on the Kun host (e.g. /Users/me/project):', '')
      var path = entered === null ? null : entered.trim()
      return Promise.resolve({ canceled: !path, path: path || null })
    },
    workspaceDirectoryExists: function (root) { return invoke('workspace:directory-exists', [root]) },
    getWorkspaceCreationTimes: function (workspaceRoots) {
      return invoke('workspace:creation-times', [{ workspaceRoots: workspaceRoots }])
    },
    createConversationWorkspace: function (root) { return invoke('conversation:create-workspace', [{ root: root }]) },
    pickLocalFiles: function () {
      // A remote device picks its own files; they are uploaded to a host temp
      // directory and the returned host paths feed the normal reference flow.
      return pickFilesWithBrowser(true).then(function (files) {
        if (!files.length) return { canceled: true, paths: [] }
        return Promise.all(files.map(uploadRemoteFile)).then(function (paths) {
          return { canceled: false, paths: paths }
        })
      })
    },
    uploadRemoteFile: uploadRemoteFile,
    listWorkspaceDirectory: invokePayload('file:list-workspace-directory'),
    resolveWorkspaceFile: invokePayload('file:resolve-workspace'),
    openWorkspaceFileInSystem: function (options) {
      // The host file manager is unreachable remotely; download instead.
      if (!options || !options.path || !options.workspaceRoot) {
        return Promise.resolve({ ok: false, message: 'Opening files is only available on the Kun host.' })
      }
      var anchor = document.createElement('a')
      anchor.href = '/remote/file-preview?workspaceRoot=' + encodeURIComponent(options.workspaceRoot) +
        '&path=' + encodeURIComponent(options.path)
      anchor.download = String(options.path).split(/[\\/]/).pop() || 'download'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return Promise.resolve({ ok: true })
    },
    revealWorkspaceFileInFolder: function (options) {
      return api.openWorkspaceFileInSystem(options)
    },
    readWorkspaceFile: invokePayload('file:read-workspace'),
    readWorkspaceImage: invokePayload('file:read-workspace-image'),
    readWorkspacePdf: invokePayload('file:read-workspace-pdf'),
    openWorkspacePreviewResource: function (options) {
      // The kun-workspace-preview:// protocol only exists inside Electron; in
      // the browser the same workspace file is streamed by the Remote gateway.
      if (!options || !options.path || !options.workspaceRoot) {
        return Promise.resolve({ ok: false, message: 'Preview target is missing.' })
      }
      var url = '/remote/file-preview?workspaceRoot=' + encodeURIComponent(options.workspaceRoot) +
        '&path=' + encodeURIComponent(options.path)
      return Promise.resolve({ ok: true, leaseId: 'remote', url: url })
    },
    releaseWorkspacePreviewResource: function () { return Promise.resolve({ ok: true }) },
    readLocalPdfText: invokePayload('file:read-local-pdf-text'),
    saveWorkspaceFileAs: function (payload) {
      // Browsers cannot open a host save dialog; download via an anchor instead.
      if (!payload) return Promise.resolve({ ok: false, message: 'No file data was provided.' })
      var fileName = String(payload.suggestedName || 'download').replace(/[\\/:*?"<>|]/g, '_')
      var triggerDownload = function (blob) {
        var objectUrl = URL.createObjectURL(blob)
        var anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(function () { URL.revokeObjectURL(objectUrl) }, 30000)
        return { ok: true, path: fileName }
      }
      if (payload.dataBase64) {
        var binary = atob(payload.dataBase64)
        var bytes = new Uint8Array(binary.length)
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        return Promise.resolve(triggerDownload(new Blob([bytes], { type: payload.mimeType || 'application/octet-stream' })))
      }
      if (payload.sourcePath) {
        if (!payload.workspaceRoot) {
          return Promise.resolve({ ok: false, message: 'A workspace is required to save this file.' })
        }
        var downloadUrl = '/remote/file-preview?path=' + encodeURIComponent(payload.sourcePath) +
          '&workspaceRoot=' + encodeURIComponent(payload.workspaceRoot)
        var anchor = document.createElement('a')
        anchor.href = downloadUrl
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        return Promise.resolve({ ok: true, path: fileName })
      }
      return Promise.resolve({ ok: false, message: 'No file data was available to save.' })
    },
    writeWorkspaceFile: invokePayload('file:write-workspace'),
    createWorkspaceFile: invokePayload('file:create-workspace'),
    createWorkspaceDirectory: invokePayload('file:create-workspace-directory'),
    saveWorkspaceClipboardImage: invokePayload('file:save-workspace-clipboard-image'),
    pickWorkspaceImage: function (payload) {
      return pickFilesWithBrowser(false).then(function (files) {
        if (!files.length) return { ok: false, canceled: true }
        return files[0].arrayBuffer().then(function (buffer) {
          return invoke('file:save-workspace-image-bytes', [{
            workspaceRoot: payload && payload.workspaceRoot,
            dataBase64: bufferToBase64(buffer),
            mimeType: files[0].type || undefined,
            imageDirectory: payload && payload.imageDirectory,
            fileName: files[0].name
          }])
        })
      })
    },
    saveWorkspaceImageBytes: invokePayload('file:save-workspace-image-bytes'),
    renameWorkspaceEntry: invokePayload('file:rename-workspace-entry'),
    deleteWorkspaceEntry: invokePayload('file:delete-workspace-entry'),
    watchWorkspaceFile: invokePayload('file:watch-workspace'),
    unwatchWorkspaceFile: function (watchId) { return invoke('file:unwatch-workspace', [watchId]) },
    onWorkspaceFileChanged: on('file:workspace-changed'),
    readClipboardImage: invokeRaw('clipboard:read-image'),
    writeClipboardImage: function (payload) {
      return clipboardImageBridge
        ? clipboardImageBridge.writeClipboardImage(invoke, payload)
        : Promise.resolve({ ok: false, message: 'Clipboard image copy is not available.' })
    },
    getPathForFile: function () { return '' },
    readLocalOfficeDocument: invokePayload('file:read-local-office-document'),
    readWorkspaceOfficePreview: invokePayload('file:read-workspace-office-preview'),
    readWorkspaceOfficeSemantic: invokePayload('file:read-workspace-office-semantic'),
    saveWorkspaceSpreadsheet: invokePayload('file:save-workspace-spreadsheet'),
    convertWorkspaceSpreadsheet: invokePayload('file:convert-workspace-spreadsheet'),
    openExtensionArtifact: invokePayload('extension:artifact:open'),
    lintProjectDesignMd: function (content) { return invoke('design:lint-project-design-md', [{ content: content }]) },

    // Git + worktrees.
    getGitBranches: function (workspaceRoot) { return invoke('git:branches', [workspaceRoot]) },
    switchGitBranch: function (workspaceRoot, branch) {
      return invoke('git:switch-branch', [{ workspaceRoot: workspaceRoot, branch: branch }])
    },
    createAndSwitchGitBranch: function (workspaceRoot, branch) {
      return invoke('git:create-and-switch-branch', [{ workspaceRoot: workspaceRoot, branch: branch }])
    },
    createGitCheckpoint: invokePayload('git:checkpoint:create'),
    restoreGitCheckpoint: invokePayload('git:checkpoint:restore'),
    checkoutGitBranchWorktree: function (workspaceRoot, branch) {
      return invoke('git:checkout-branch-worktree', [{ workspaceRoot: workspaceRoot, branch: branch }])
    },
    createGitBranchWorktree: function (workspaceRoot, branch) {
      return invoke('git:create-branch-worktree', [{ workspaceRoot: workspaceRoot, branch: branch }])
    },
    listGitBranchWorktrees: invokePayload('git:branch-worktrees'),
    removeGitBranchWorktree: invokePayload('git:remove-branch-worktree'),
    acquireWorktree: invokePayload('worktree:acquire'),
    releaseWorktree: invokePayload('worktree:release'),
    listWorktrees: invokePayload('worktree:list'),
    removeWorktree: invokePayload('worktree:remove'),
    getWorktreeChanges: invokePayload('worktree:changes'),
    commitWorktree: invokePayload('worktree:commit'),
    mergeWorktree: invokePayload('worktree:merge'),
    abortWorktreeMerge: invokePayload('worktree:abort-merge'),
    continueWorktreeMerge: invokePayload('worktree:continue-merge'),
    syncWorktreeFromMain: invokePayload('worktree:sync'),
    abortWorktreeRebase: invokePayload('worktree:abort-rebase'),
    cleanupWorktrees: invokePayload('worktree:cleanup'),
    findAvailableWorktreePoolIndex: invokePayload('worktree:find-available'),

    // Terminals.
    createTerminal: invokePayload('terminal:create'),
    writeToTerminal: invokePayload('terminal:write'),
    resizeTerminal: invokePayload('terminal:resize'),
    disposeTerminal: function (sessionId) { return invoke('terminal:dispose', [sessionId]) },
    onTerminalData: on('terminal:data'),
    onTerminalExit: on('terminal:exit'),
    listRemoteSshHosts: invokeRaw('remote-ssh:hosts:list'),
    createRemoteSshHost: invokePayload('remote-ssh:hosts:create'),
    updateRemoteSshHost: function (id, host) { return invoke('remote-ssh:hosts:update', [{ id: id, host: host }]) },
    removeRemoteSshHost: function (hostId) { return invoke('remote-ssh:hosts:remove', [hostId]) },
    connectRemoteSshHost: function (hostId) { return invoke('remote-ssh:connect', [hostId]) },
    disconnectRemoteSshHost: function (hostId) { return invoke('remote-ssh:disconnect', [hostId]) },
    resetRemoteSshHostKey: function (hostId) { return invoke('remote-ssh:host-key:reset', [hostId]) },
    confirmRemoteSshHostKey: invokePayload('remote-ssh:host-key:confirm'),
    pickRemoteSshIdentityFile: function () {
      var entered = window.prompt('SSH identity file path on the Kun host:', '')
      var path = entered === null ? '' : entered.trim()
      return Promise.resolve(path || null)
    },
    createRemoteSshTerminal: invokePayload('remote-ssh:terminal:create'),
    writeToRemoteSshTerminal: invokePayload('remote-ssh:terminal:write'),
    resizeRemoteSshTerminal: invokePayload('remote-ssh:terminal:resize'),
    disposeRemoteSshTerminal: function (sessionId) { return invoke('remote-ssh:terminal:dispose', [sessionId]) },
    onRemoteSshTerminalData: on('remote-ssh:terminal:data'),
    onRemoteSshTerminalExit: on('remote-ssh:terminal:exit'),

    // Skills + Kun config files.
    listSkills: function (workspaceRoot) { return invoke('skill:list', [{ workspaceRoot: workspaceRoot }]) },
    listSkillRoots: function (workspaceRoot) { return invoke('skill:list-roots', [{ workspaceRoot: workspaceRoot }]) },
    saveSkillFile: function (rootPath, skillName, content, manifestContent) {
      return invoke('skill:save-file', [{
        rootPath: rootPath,
        skillName: skillName,
        content: content,
        manifestContent: manifestContent
      }])
    },
    importSkillsFromGitHub: function (rootPath, url) {
      return invoke('skill:import-github', [{ rootPath: rootPath, url: url }])
    },
    openSkillRoot: function (rootPath) { return invoke('skill:open-root', [rootPath]) },
    getKunConfigFile: invokeRaw('kun:config:read'),
    setKunConfigFile: function (content) { return invoke('kun:config:write', [content]) },
    openKunConfigDir: invokeRaw('kun:config:open-dir'),
    getKunProjectConfigFile: function (workspaceRoot) {
      return invoke('kun:project-config:read', [{ workspaceRoot: workspaceRoot }])
    },
    setKunProjectConfigFile: function (workspaceRoot, content) {
      return invoke('kun:project-config:write', [{ workspaceRoot: workspaceRoot, content: content }])
    },
    setKunProjectConfigTrust: function (workspaceRoot, trusted, expectedDigest) {
      var payload = { workspaceRoot: workspaceRoot, trusted: trusted }
      if (trusted && expectedDigest) payload.expectedDigest = expectedDigest
      return invoke('kun:project-config:trust', [payload])
    },
    openKunProjectConfigDir: function (workspaceRoot) {
      return invoke('kun:project-config:open-dir', [{ workspaceRoot: workspaceRoot }])
    },

    // Claw / schedule / daemon / workflow.
    getClawStatus: invokeRaw('claw:status'),
    runClawTask: function (taskId) { return invoke('claw:task:run', [taskId]) },
    mirrorClawChannelMessage: function (threadId, text, direction) {
      return invoke('claw:channel:mirror', [{ threadId: threadId, text: text, direction: direction }])
    },
    mirrorClawChannelMessageToFeishu: function (threadId, text, direction) {
      return invoke('claw:channel:mirror-to-feishu', [{ threadId: threadId, text: text, direction: direction }])
    },
    createClawTaskFromText: function (text, options) {
      var o = options || {}
      return invoke('claw:task:create-from-text', [{
        text: text,
        channelId: o.channelId,
        providerId: o.providerId,
        modelHint: o.modelHint,
        reasoningEffort: o.reasoningEffort,
        mode: o.mode
      }])
    },
    getScheduleStatus: invokeRaw('schedule:status'),
    onScheduleStatusChanged: on('schedule:status-changed'),
    createScheduleTask: invokePayload('schedule:task:create'),
    updateScheduleTask: invokePayload('schedule:task:update'),
    deleteScheduleTask: function (taskId) { return invoke('schedule:task:delete', [taskId]) },
    runScheduleTask: function (taskId) { return invoke('schedule:task:run', [taskId]) },
    createScheduleTaskFromText: function (text, options) {
      var o = options || {}
      return invoke('schedule:task:create-from-text', [{
        text: text,
        workspaceRoot: o.workspaceRoot,
        clawChannelId: o.clawChannelId,
        providerId: o.providerId,
        modelHint: o.modelHint,
        reasoningEffort: o.reasoningEffort,
        mode: o.mode
      }])
    },
    getDaemonStatus: invokeRaw('daemon:status'),
    restartDaemon: function (daemonId) { return invoke('daemon:restart', [daemonId]) },
    readDaemonLogs: invokePayload('daemon:logs'),
    getWorkflowStatus: invokeRaw('workflow:status'),
    runWorkflow: function (workflowId, input) { return invoke('workflow:run', [workflowId, input]) },
    stopWorkflow: function (workflowId) { return invoke('workflow:stop', [workflowId]) },
    runWorkflowNode: function (workflowId, nodeId) {
      return invoke('workflow:node:run', [{ workflowId: workflowId, nodeId: nodeId }])
    },
    testWorkflowNode: function (workflowId, nodeId, mockJson) {
      return invoke('workflow:node:test', [{ workflowId: workflowId, nodeId: nodeId, mockJson: mockJson }])
    },
    resolveWorkflowApproval: function (token, decision) {
      return invoke('workflow:approval:resolve', [{ token: token, decision: decision }])
    },
    checkWorkflowCode: function (language, code) {
      return invoke('workflow:code:check', [{ language: language, code: code }])
    },

    // Legacy session import + plugins + editors.
    detectLegacySessions: invokeRaw('kun:sessions:detect-legacy'),
    importLegacySessions: function (sourceDir) { return invoke('kun:sessions:import-legacy', [{ sourceDir: sourceDir }]) },
    pickLegacySessionDir: function () {
      var entered = window.prompt('Folder on the Kun host containing previous conversations:', '')
      var path = entered === null ? '' : entered.trim()
      return Promise.resolve(path ? { canceled: false, path: path } : { canceled: true, path: null })
    },
    listUiPlugins: invokeRaw('ui-plugin:list'),
    loadUiPlugin: function (id) { return invoke('ui-plugin:load', [{ id: id }]) },
    activateUiPluginTheme: function (id) { return invoke('ui-plugin:theme:activate', [{ id: id }]) },
    deactivateUiPluginTheme: invokeRaw('ui-plugin:theme:deactivate'),
    listEditors: invokeRaw('editor:list'),
    openEditorPath: invokePayload('editor:open-path'),

    // Write/design exports + inline tools.
    exportWriteDocument: invokePayload('write:export'),
    exportConversation: invokePayload('conversation:export'),
    exportMemoryMarkdown: invokePayload('memory:export-markdown'),
    exportDesignPrototype: invokePayload('design:export-prototype'),
    copyWriteDocumentAsRichText: invokePayload('write:copy-rich-text'),
    requestWriteInlineCompletion: invokePayload('write:inline-completion'),
    requestWriteAiProperties: invokePayload('write:ai-properties'),
    retrieveWriteContext: invokePayload('write:retrieve-context'),
    readWriteDocumentSha256: invokePayload('write:read-document-sha256'),
    generateWriteInfographic: invokePayload('write:generate-infographic'),
    authorizeWritePrototype: invokePayload('write:authorize-prototype'),
    openWritePrototype: invokePayload('write:open-prototype'),
    listWriteInlineCompletionDebugEntries: invokeRaw('write:inline-completion-debug:list'),
    clearWriteInlineCompletionDebugEntries: invokeRaw('write:inline-completion-debug:clear'),
    transcribeSpeech: invokePayload('speech:transcribe'),

    // Browser-use.
    getBrowserUseState: function (threadId) { return invoke('browser-use:state:get', [{ threadId: threadId }]) },
    mountBrowserUse: invokePayload('browser-use:mount'),
    decideBrowserUseOrigin: invokePayload('browser-use:origin:decide'),
    decideBrowserUseAction: invokePayload('browser-use:action:decide'),
    setBrowserUseControl: invokePayload('browser-use:control'),
    navigateBrowserUse: invokePayload('browser-use:navigate'),
    stopBrowserUse: function (threadId) { return invoke('browser-use:stop', [{ threadId: threadId }]) },
    clearBrowserUse: function (threadId) { return invoke('browser-use:clear', [{ threadId: threadId }]) },
    onBrowserUseState: on('browser-use:state'),
    getGuiUpdateState: function () { return invoke('gui:update-state') },
    onGuiUpdateState: on('gui:update-state'),
    onClaudeSubscriptionSdkProgress: on('claude-subscription:sdk-progress'),
    onGeminiSubscriptionCliProgress: on('gemini-subscription:cli-progress'),
    onLocalWhisperModelProgress: on('speech:local-whisper:progress'),
    onLocalSanottsAssetProgress: on('speak:sanotts:progress'),
    onExtensionViewSessionInvalidated: on('extension:view-session:invalidated'),
    onExtensionExternalBrowserState: on('extension:external-browser-state'),
    onExtensionComposerContext: on('extension:composer-context-attached'),
    onExtensionNotifications: on('extension:notifications'),
    onExtensionViewEvent: on('extension:view-event'),

    // Browser-local replacements for desktop-only APIs.
    openExternal: function (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return Promise.resolve()
    },
    alertDialog: function (options) {
      window.alert((options && (options.message || options.title)) || '')
      return Promise.resolve()
    },
    confirmDialog: function (options) {
      return Promise.resolve(window.confirm((options && (options.message || options.title)) || ''))
    },
    runDesktopCommand: unavailable('runDesktopCommand'),
    remoteAccessGetStatus: unavailable('remoteAccessGetStatus'),
    remoteAccessSetConfig: unavailable('remoteAccessSetConfig'),
    remoteAccessSetPassword: unavailable('remoteAccessSetPassword'),
    remoteAccessRevokeSessions: unavailable('remoteAccessRevokeSessions'),
    remoteAccessDetectTailscale: unavailable('remoteAccessDetectTailscale'),
    onRemoteAccessStatusChanged: function () { return function () {} }
  }

  window.kunGui = new Proxy(api, {
    get: function (target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      // Event subscribers follow the onXxx convention and are often used as
      // useEffect cleanups; an unimplemented one must return a no-op
      // unsubscribe instead of a rejected Promise (React would throw
      // "destroy is not a function" on the non-function cleanup).
      if (typeof prop === 'string' && /^on[A-Z]/.test(prop)) return noopSubscription
      return unavailable(String(prop))
    }
  })

  ensureEventStream()
})()
