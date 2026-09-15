/*
 * Kun Remote bridge. Served by the Remote gateway to browser clients; the
 * gateway prepends __KUN_REMOTE_BOOTSTRAP__ with host constants. Inside the
 * Electron app the real preload already installed window.kunGui, so this file
 * is a no-op there.
 */
(function installKunRemoteBridge() {
  if (typeof window === 'undefined') return
  if (window.kunGui) return

  var BOOT = window.__KUN_REMOTE_BOOTSTRAP__ || {}
  var CLIENT_ID_KEY = 'kun-remote-client-id'

  function remoteClientId() {
    try {
      var existing = window.sessionStorage.getItem(CLIENT_ID_KEY)
      if (existing) return existing
      var generated = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : 'client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      window.sessionStorage.setItem(CLIENT_ID_KEY, generated)
      return generated
    } catch {
      return 'client-' + Date.now().toString(36)
    }
  }

  var clientId = remoteClientId()
  var eventHandlers = new Map()
  var eventSource = null

  function dispatchEvent(channel, payload) {
    var handlers = eventHandlers.get(channel)
    if (!handlers) return
    handlers.slice().forEach(function (handler) {
      try {
        handler(payload)
      } catch (error) {
        setTimeout(function () { throw error }, 0)
      }
    })
  }

  function ensureEventStream() {
    if (eventSource) return
    eventSource = new EventSource('/remote/events?client=' + encodeURIComponent(clientId))
    eventSource.addEventListener('kun-ipc', function (event) {
      try {
        var frame = JSON.parse(event.data)
        if (frame && typeof frame.channel === 'string') dispatchEvent(frame.channel, frame.payload)
      } catch { /* best-effort */ }
    })
  }

  function on(channel) {
    return function (handler) {
      if (typeof handler !== 'function') return function () {}
      ensureEventStream()
      var handlers = eventHandlers.get(channel)
      if (!handlers) {
        handlers = []
        eventHandlers.set(channel, handlers)
      }
      handlers.push(handler)
      return function () {
        var index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    }
  }

  function invoke(channel, args) {
    return fetch('/remote/invoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-kun-remote-request': '1',
        'x-kun-remote-client': clientId
      },
      body: JSON.stringify({ channel: channel, args: args || [] })
    }).then(function (response) {
      if (response.status === 401) {
        window.location.href = '/remote/login'
        return new Promise(function () {})
      }
      return response.json().then(function (body) {
        if (!body || body.ok !== true) {
          throw new Error(body && body.error ? body.error : 'Remote invoke failed: ' + channel)
        }
        return body.result
      })
    })
  }

  function invokeRaw(channel) {
    return function () {
      return invoke(channel, Array.prototype.slice.call(arguments))
    }
  }

  function invokePayload(channel) {
    return function (payload) {
      return invoke(channel, [payload])
    }
  }

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

  function unavailableObject(name) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'then') return undefined
        return unavailable(name + '.' + String(prop))
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
    onRuntimeStatus: on('runtime:status'),
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
    pickWorkspaceDirectory: function (defaultPath) { return invoke('workspace:pick-directory', [defaultPath]) },
    workspaceDirectoryExists: function (root) { return invoke('workspace:directory-exists', [root]) },
    getWorkspaceCreationTimes: function (workspaceRoots) {
      return invoke('workspace:creation-times', [{ workspaceRoots: workspaceRoots }])
    },
    createConversationWorkspace: function (root) { return invoke('conversation:create-workspace', [{ root: root }]) },
    pickLocalFiles: function (defaultPath) { return invoke('file:pick-local-files', [defaultPath]) },
    listWorkspaceDirectory: invokePayload('file:list-workspace-directory'),
    resolveWorkspaceFile: invokePayload('file:resolve-workspace'),
    openWorkspaceFileInSystem: invokePayload('file:open-workspace-system'),
    revealWorkspaceFileInFolder: invokePayload('file:reveal-workspace-file'),
    readWorkspaceFile: invokePayload('file:read-workspace'),
    readWorkspaceImage: invokePayload('file:read-workspace-image'),
    readWorkspacePdf: invokePayload('file:read-workspace-pdf'),
    openWorkspacePreviewResource: invokePayload('file:open-workspace-preview'),
    releaseWorkspacePreviewResource: invokePayload('file:release-workspace-preview'),
    readLocalPdfText: invokePayload('file:read-local-pdf-text'),
    saveWorkspaceFileAs: invokePayload('file:save-as'),
    writeWorkspaceFile: invokePayload('file:write-workspace'),
    createWorkspaceFile: invokePayload('file:create-workspace'),
    createWorkspaceDirectory: invokePayload('file:create-workspace-directory'),
    saveWorkspaceClipboardImage: invokePayload('file:save-workspace-clipboard-image'),
    pickWorkspaceImage: invokePayload('file:pick-workspace-image'),
    saveWorkspaceImageBytes: invokePayload('file:save-workspace-image-bytes'),
    renameWorkspaceEntry: invokePayload('file:rename-workspace-entry'),
    deleteWorkspaceEntry: invokePayload('file:delete-workspace-entry'),
    watchWorkspaceFile: invokePayload('file:watch-workspace'),
    unwatchWorkspaceFile: function (watchId) { return invoke('file:unwatch-workspace', [watchId]) },
    onWorkspaceFileChanged: on('file:workspace-changed'),
    readClipboardImage: invokeRaw('clipboard:read-image'),
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
    pickRemoteSshIdentityFile: invokeRaw('remote-ssh:pick-identity-file'),
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
    pickLegacySessionDir: invokeRaw('kun:sessions:pick-source-dir'),
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
    onRemoteAccessStatusChanged: function () { return function () {} }
  }

  window.kunGui = new Proxy(api, {
    get: function (target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      return unavailable(String(prop))
    }
  })

  ensureEventStream()
})()
