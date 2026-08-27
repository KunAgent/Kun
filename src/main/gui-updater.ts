import { app, autoUpdater as nativeAutoUpdater, BrowserWindow } from 'electron'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateFailureCode,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from '../shared/gui-update'
import { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel } from '../shared/gui-update'
import type { AppLocale } from '../shared/app-locales'
import { createGuiUpdateScheduler, type GuiUpdateScheduler } from './gui-updater-scheduler'
import { GuiUpdateOperationCoordinator, type GuiUpdateOperation } from './gui-updater-operation'
import { GuiUpdateInstaller } from './gui-updater-install'
import { showGuiUpdateReleaseNotes } from './gui-updater-release-notes'
import {
  autoUpdater,
  DEVELOPMENT_APP_FLAVOR,
  DEVELOPMENT_UPDATE_MESSAGE,
  downloadPageUrl,
  envWithLegacyFallback,
  isVersionGreater,
  MANUAL_UPDATE_FETCH_TIMEOUT_MS,
  macAutoUpdateAllowed,
  parseYamlScalar,
  readGuiUpdateScheduleState,
  recordPendingUpdate,
  releaseUrlForVersion,
  resolveUpdateFeedUrl,
  sanitizeUpdaterError,
  setWindowsInstallerUpdateSource,
  unsupportedMessage,
  updateFeedManifestUrl,
  updateFeedUrl,
  writeGuiUpdateScheduleState
} from './gui-updater-support'

export { setWindowsInstallerUpdateSource } from './gui-updater-support'
let initialized = false
let getMainWindow: (() => BrowserWindow | null) | null = null
let lastInfo: Extract<GuiUpdateInfo, { ok: true }> | null = null
let lastState: GuiUpdateState = { status: 'idle' }
let downloadPromise: Promise<string[]> | null = null
const operations = new GuiUpdateOperationCoordinator()
let eventOperation: GuiUpdateOperation | null = null
let configuredChannel: GuiUpdateChannel = normalizeGuiUpdateChannel(
  envWithLegacyFallback('KUN_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || undefined
)
let configuredFeedUrl = ''
let getSelectedChannel: (() => GuiUpdateChannel | Promise<GuiUpdateChannel>) | null = null
let getSelectedLocale: (() => AppLocale | Promise<AppLocale>) | null = null
let beforeInstallUpdate: (() => void | Promise<void>) | null = null
let beforeInstallUpdatePromise: Promise<void> | null = null
let beforeInstallUpdatePrepared = false
let setUpdateInstallQuitting: ((active: boolean) => void) | null = null
let pendingVersionStateWrite: Promise<void> | null = null
let guiUpdateScheduler: GuiUpdateScheduler | null = null
let updateInstallQuitting = false
let downloadedInstallerSha512 = ''
let sessionEnding = false
let pendingUpdateHealthCheck: (() => Promise<boolean>) | null = null
function toGuiInfo(
  updateInfo: UpdateInfo,
  hasUpdate: boolean,
  operation: GuiUpdateOperation | null = null,
  manualOnly = false
): Extract<GuiUpdateInfo, { ok: true }> {
  const latestVersion = updateInfo.version.trim()
  return {
    ok: true,
    currentVersion: app.getVersion(),
    latestVersion,
    hasUpdate,
    releaseUrl: releaseUrlForVersion(latestVersion, operation?.channel ?? configuredChannel),
    releaseDate: updateInfo.releaseDate,
    channel: operation?.channel ?? configuredChannel,
    manualOnly,
    downloaded: operation
      ? operations.downloadedFor(operation.channel, operation.feedUrl, latestVersion)
      : Boolean(lastInfo && operations.downloadedFor(configuredChannel, configuredFeedUrl, lastInfo.latestVersion))
  }
}
function hasCurrentDownloadedUpdate(): boolean {
  return Boolean(
    lastInfo?.hasUpdate &&
    operations.downloadedFor(configuredChannel, configuredFeedUrl, lastInfo.latestVersion)
  )
}
function clearDownloadedInstaller(): void {
  downloadedInstallerSha512 = ''
  updateInstaller.clearDownloadedInstaller()
  operations.clearDownloaded()
}
function emitGuiUpdateState(state: GuiUpdateState): void {
  const wasSuspended = lastState.status === 'downloaded' || lastState.status === 'installing'
  lastState = state
  if (wasSuspended && state.status !== 'downloaded' && state.status !== 'installing') {
    guiUpdateScheduler?.notifyStateChanged()
  }
  const win = getMainWindow?.()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('gui:update-state', state)
}
function runBeforeInstallUpdate(): Promise<void> {
  if (beforeInstallUpdatePrepared) return Promise.resolve()
  if (!beforeInstallUpdate) return Promise.resolve()
  if (!beforeInstallUpdatePromise) {
    beforeInstallUpdatePromise = Promise.resolve()
      .then(() => beforeInstallUpdate?.())
      .then(() => {
        beforeInstallUpdatePrepared = true
      })
      .finally(() => {
        beforeInstallUpdatePromise = null
      })
  }
  return beforeInstallUpdatePromise
}
function markUpdateInstallQuitting(active: boolean): void {
  if (updateInstallQuitting === active) return
  updateInstallQuitting = active
  setUpdateInstallQuitting?.(active)
}
function clearBeforeInstallUpdatePreparation(): void {
  beforeInstallUpdatePrepared = false
}
const updateInstaller = new GuiUpdateInstaller({
  runExclusive: (task) => operations.run(task),
  details: () => ({
    hasDownloaded: hasCurrentDownloadedUpdate(),
    targetVersion: lastInfo?.latestVersion ?? '',
    channel: configuredChannel
  }),
  stateInfo: () => lastInfo ?? undefined,
  emit: emitGuiUpdateState,
  prepare: runBeforeInstallUpdate,
  clearPreparation: clearBeforeInstallUpdatePreparation,
  setQuitting: markUpdateInstallQuitting,
  quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
  isSessionEnding: () => sessionEnding
})
async function resolveUpdateChannel(requested?: GuiUpdateChannel): Promise<GuiUpdateChannel> {
  if (requested) return normalizeGuiUpdateChannel(requested)
  if (getSelectedChannel) {
    return normalizeGuiUpdateChannel(await getSelectedChannel())
  }
  return DEFAULT_GUI_UPDATE_CHANNEL
}
function configureUpdaterChannel(
  channel: GuiUpdateChannel,
  feedUrl = updateFeedUrl(channel),
  applyFeed = true
): void {
  const normalized = normalizeGuiUpdateChannel(channel)
  const changed = normalized !== configuredChannel || feedUrl !== configuredFeedUrl
  configuredChannel = normalized
  configuredFeedUrl = feedUrl
  if (applyFeed) {
    autoUpdater.allowPrerelease = normalized === 'frontier'
    // Switching from frontier to stable must never install an older build.
    autoUpdater.allowDowngrade = false
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  }
  if (!changed) return
  operations.invalidate()
  lastInfo = null
  emitGuiUpdateState({ status: 'idle' })
}
async function resolveConfiguredUpdateChannel(
  channel: GuiUpdateChannel,
  requestGeneration: number
): Promise<'configured' | 'stale' | Extract<GuiUpdateInfo, { ok: false }>> {
  const resolved = await resolveUpdateFeedUrl(channel)
  if (!operations.isGenerationCurrent(requestGeneration)) return 'stale'
  if (!resolved.ok) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      channel,
      code: resolved.code,
      message: resolved.message,
      releaseUrl: downloadPageUrl(channel)
    }
  }
  configureUpdaterChannel(channel, resolved.url)
  return 'configured'
}
export function setGuiUpdateChannel(channel: GuiUpdateChannel): void {
  if (DEVELOPMENT_APP_FLAVOR) return
  const nextChannel = normalizeGuiUpdateChannel(channel)
  configureUpdaterChannel(nextChannel, updateFeedUrl(nextChannel), false)
  autoUpdater.allowPrerelease = nextChannel === 'frontier'
  autoUpdater.allowDowngrade = false
}
async function checkManualUpdate(
  channel: GuiUpdateChannel,
  code: GuiUpdateFailureCode = 'unsupported',
  operation?: GuiUpdateOperation
): Promise<GuiUpdateInfo> {
  const currentVersion = app.getVersion()
  try {
    const resolution = configuredChannel === channel && configuredFeedUrl
      ? { ok: true as const, url: configuredFeedUrl }
      : await resolveUpdateFeedUrl(channel)
    if (!resolution.ok) {
      return { ok: false, currentVersion, code: resolution.code, message: resolution.message, channel }
    }
    const url = updateFeedManifestUrl(resolution.url)
    const res = await fetch(url, {
      headers: {
        Accept: 'application/x-yaml,text/yaml,text/plain,*/*',
        'User-Agent': `kun/${currentVersion}`
      },
      signal: AbortSignal.timeout(MANUAL_UPDATE_FETCH_TIMEOUT_MS)
    })
    if (!res.ok) {
      return {
        ok: false,
        currentVersion,
        code,
        message: `${unsupportedMessage()} Update metadata returned ${res.status}.`,
        releaseUrl: downloadPageUrl(configuredChannel),
        channel
      }
    }
    const text = await res.text()
    if (operation && !operations.isCurrent(operation)) {
      return {
        ok: false,
        currentVersion,
        channel,
        code: 'unknown',
        message: 'The update channel changed while checking for updates.'
      }
    }
    const latestVersion = parseYamlScalar(text, 'version')
    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        code,
        message: `${unsupportedMessage()} Update metadata is missing a version.`,
        releaseUrl: downloadPageUrl(configuredChannel),
        channel
      }
    }
    const info: Extract<GuiUpdateInfo, { ok: true }> = {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isVersionGreater(latestVersion, currentVersion),
      releaseUrl: releaseUrlForVersion(latestVersion, configuredChannel),
      releaseDate: parseYamlScalar(text, 'releaseDate'),
      channel,
      manualOnly: true,
      downloaded: false
    }
    lastInfo = info
    emitGuiUpdateState(info.hasUpdate ? { status: 'available', info } : { status: 'not_available', info })
    return info
  } catch (e) {
    return {
      ok: false,
      currentVersion,
      code,
      message: `${unsupportedMessage()} ${e instanceof Error ? e.message : String(e)}`,
      releaseUrl: downloadPageUrl(configuredChannel),
      channel
    }
  }
}
export function initializeGuiUpdater(
  windowGetter: () => BrowserWindow | null,
  channelGetter?: () => GuiUpdateChannel | Promise<GuiUpdateChannel>,
  beforeInstall?: () => void | Promise<void>,
  localeGetter?: () => AppLocale | Promise<AppLocale>,
  updateInstallQuittingSetter?: (active: boolean) => void,
  healthCheck?: () => Promise<boolean>
): void {
  getMainWindow = windowGetter
  getSelectedChannel = channelGetter ?? null
  beforeInstallUpdate = beforeInstall ?? null
  getSelectedLocale = localeGetter ?? null
  setUpdateInstallQuitting = updateInstallQuittingSetter ?? null
  pendingUpdateHealthCheck = healthCheck ?? null
  if (initialized) return
  initialized = true
  if (DEVELOPMENT_APP_FLAVOR) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  configureUpdaterChannel(configuredChannel, updateFeedUrl(configuredChannel), false)
  autoUpdater.allowPrerelease = configuredChannel === 'frontier'
  autoUpdater.allowDowngrade = false
  eventOperation = null
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }
  autoUpdater.logger = {
    info: (message?: unknown) => console.info('[kun-gui updater]', message),
    warn: (message?: unknown) => console.warn('[kun-gui updater]', message),
    error: (message?: unknown) => console.error('[kun-gui updater]', message)
  }
  autoUpdater.on('checking-for-update', () => {
    if (!operations.isCurrent(eventOperation) || eventOperation.kind !== 'check') return
    emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  })

  autoUpdater.on('update-available', (updateInfo: UpdateInfo) => {
    if (!operations.isCurrent(eventOperation) || eventOperation.kind !== 'check') return
    eventOperation.targetVersion = updateInfo.version.trim()
    const info = toGuiInfo(updateInfo, true, eventOperation)
    lastInfo = info
    emitGuiUpdateState({ status: 'available', info })
  })

  autoUpdater.on('update-not-available', (updateInfo: UpdateInfo) => {
    if (!operations.isCurrent(eventOperation) || eventOperation.kind !== 'check') return
    const info = toGuiInfo(updateInfo, false, eventOperation)
    lastInfo = info
    emitGuiUpdateState({ status: 'not_available', info })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    if (!operations.isCurrent(eventOperation) || eventOperation.kind !== 'download') return
    emitGuiUpdateState({ status: 'downloading', info: lastInfo ?? undefined, progress })
  })

  autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    if (!eventOperation || !operations.isCurrent(eventOperation) || eventOperation.kind !== 'download') return
    if (!operations.markDownloaded(eventOperation, event.version.trim())) return
    downloadedInstallerSha512 = typeof (event as { sha512?: unknown }).sha512 === 'string'
      ? (event as { sha512: string }).sha512
      : downloadedInstallerSha512
    const info = toGuiInfo(event, true, eventOperation)
    lastInfo = info
    pendingVersionStateWrite = recordPendingUpdate(event)
      .catch((error) => {
        console.warn('[kun-gui updater] failed to save release notes:', error)
      })
      .finally(() => {
        pendingVersionStateWrite = null
      })
    emitGuiUpdateState({ status: 'downloaded', info })
  })

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    const installFailed = updateInstaller.onUpdaterError(error)
    const downloadFailed = !installFailed && eventOperation?.kind === 'download' &&
      operations.isCurrent(eventOperation) && (downloadPromise !== null || lastState.status === 'downloading')
    if (downloadFailed) {
      clearDownloadedInstaller()
      downloadPromise = null
    }
    if (!installFailed && !downloadFailed && !operations.isCurrent(eventOperation)) return
    emitGuiUpdateState({
      status: 'error',
      info: lastInfo ?? undefined,
      message,
      code: installFailed ? 'install_failed' : downloadFailed ? 'download_failed' : 'unknown'
    })
  })

  nativeAutoUpdater?.on?.('before-quit-for-update', () => updateInstaller.onBeforeQuitForUpdate())

  ;(app as unknown as { on?: (event: string, listener: () => void) => void }).on?.('session-end', () => {
    sessionEnding = true
  })
  void updateInstaller.reconcile(pendingUpdateHealthCheck ?? undefined).catch((error) => {
    console.warn('[kun-gui updater] could not reconcile a pending installer update:', error)
  })
  guiUpdateScheduler = createGuiUpdateScheduler({
    isBusyState: () => lastState.status === 'checking' || lastState.status === 'downloading',
    isSuspendedState: () => lastState.status === 'downloaded' || lastState.status === 'installing',
    readState: readGuiUpdateScheduleState,
    writeState: writeGuiUpdateScheduleState,
    runCheck: async () => (await checkGuiUpdate()).ok
  })
  void guiUpdateScheduler.scheduleNext()
}

export async function showPostUpdateReleaseNotes(): Promise<void> {
  await showGuiUpdateReleaseNotes(getMainWindow, getSelectedLocale)
}

export function getGuiUpdateState(): GuiUpdateState {
  return lastState
}

export async function checkGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateInfo> {
  const requestGeneration = operations.currentGeneration()
  const selectedChannel = await resolveUpdateChannel(channel)
  if (!operations.isGenerationCurrent(requestGeneration)) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      channel: selectedChannel,
      code: 'unknown',
      message: 'The update channel changed before checking for updates.'
    }
  }
  if (DEVELOPMENT_APP_FLAVOR) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      channel: selectedChannel,
      code: 'unsupported',
      message: DEVELOPMENT_UPDATE_MESSAGE
    }
  }
  return operations.run(async () => {
    if (!operations.isGenerationCurrent(requestGeneration)) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        channel: selectedChannel,
        code: 'unknown',
        message: 'The update channel changed before checking for updates.'
      }
    }
    const feedConfiguration = await resolveConfiguredUpdateChannel(selectedChannel, requestGeneration)
    if (feedConfiguration !== 'configured') {
      if (feedConfiguration !== 'stale') {
        emitGuiUpdateState({ status: 'error', info: feedConfiguration, message: feedConfiguration.message, code: feedConfiguration.code })
        return feedConfiguration
      }
      return {
        ok: false,
        currentVersion: app.getVersion(),
        channel: selectedChannel,
        code: 'unknown',
        message: 'The update channel changed before checking for updates.'
      }
    }
    const operation = operations.begin('check', selectedChannel, configuredFeedUrl)
    eventOperation = operation
    try {
      if (!macAutoUpdateAllowed()) return await checkManualUpdate(selectedChannel, 'unsupported', operation)
      emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
      const result = await autoUpdater.checkForUpdates()
      if (!operations.isCurrent(operation)) {
        return {
          ok: false,
          currentVersion: app.getVersion(),
          channel: selectedChannel,
          code: 'unknown',
          message: 'The update channel changed while checking for updates.'
        }
      }
      if (!result) return await checkManualUpdate(selectedChannel, 'not_configured', operation)
      operation.targetVersion = result.updateInfo.version.trim()
      const info = toGuiInfo(result.updateInfo, result.isUpdateAvailable, operation)
      lastInfo = info
      emitGuiUpdateState(info.hasUpdate ? { status: 'available', info } : { status: 'not_available', info })
      return info
    } catch (e) {
      const message = sanitizeUpdaterError(e instanceof Error ? e.message : String(e), selectedChannel)
      const info: GuiUpdateInfo = {
        ok: false,
        currentVersion: app.getVersion(),
        message,
        code: 'unknown',
        releaseUrl: downloadPageUrl(selectedChannel),
        channel: selectedChannel
      }
      if (operations.isCurrent(operation)) emitGuiUpdateState({ status: 'error', info, message, code: 'unknown' })
      return info
    } finally {
      if (eventOperation === operation) eventOperation = null
      operations.end(operation)
    }
  })
}

export async function downloadGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateDownloadResult> {
  const requestGeneration = operations.currentGeneration()
  const selectedChannel = await resolveUpdateChannel(channel)
  if (!operations.isGenerationCurrent(requestGeneration)) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'download_failed',
      message: 'The update channel changed before download.'
    }
  }
  if (DEVELOPMENT_APP_FLAVOR) {
    return { ok: false, currentVersion: app.getVersion(), code: 'unsupported', message: DEVELOPMENT_UPDATE_MESSAGE }
  }
  if (!lastInfo?.hasUpdate || lastInfo.channel !== selectedChannel) {
    const checked = await checkGuiUpdate(selectedChannel)
    if (!checked.ok) return checked
    if (!checked.hasUpdate || checked.manualOnly) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        code: checked.manualOnly ? 'unsupported' : 'unknown',
        message: checked.manualOnly ? unsupportedMessage() : 'No downloadable GUI update is available.'
      }
    }
  }
  return operations.run(async () => {
    if (!operations.isGenerationCurrent(requestGeneration)) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        code: 'download_failed',
        message: 'The update channel changed before download.'
      }
    }
    const feedConfiguration = await resolveConfiguredUpdateChannel(selectedChannel, requestGeneration)
    if (feedConfiguration !== 'configured') {
      if (feedConfiguration !== 'stale') return feedConfiguration
      return {
        ok: false,
        currentVersion: app.getVersion(),
        code: 'download_failed',
        message: 'The update channel changed before download.'
      }
    }
    if (!macAutoUpdateAllowed()) {
      return { ok: false, currentVersion: app.getVersion(), code: 'unsupported', message: unsupportedMessage() }
    }
    if (!lastInfo?.hasUpdate || lastInfo.channel !== selectedChannel) {
      return { ok: false, currentVersion: app.getVersion(), code: 'unknown', message: 'The update channel changed before download.' }
    }
    const operation = operations.begin('download', selectedChannel, configuredFeedUrl)
    operation.targetVersion = lastInfo.latestVersion
    eventOperation = operation
    clearDownloadedInstaller()
    try {
      let tracked: Promise<string[]>
      tracked = autoUpdater.downloadUpdate().finally(() => {
        if (downloadPromise === tracked) downloadPromise = null
      })
      downloadPromise = tracked
      const paths = await tracked
      updateInstaller.setDownloadedInstaller(paths, downloadedInstallerSha512)
      if (operations.isCurrent(operation) && !operations.downloadedFor(
        operation.channel,
        operation.feedUrl,
        operation.targetVersion
      )) {
        operations.markDownloaded(operation, operation.targetVersion)
      }
      if (!operations.isCurrent(operation) || !operations.downloadedFor(
        operation.channel,
        operation.feedUrl,
        operation.targetVersion
      )) {
        return {
          ok: false,
          currentVersion: app.getVersion(),
          code: 'download_failed',
          message: 'The update channel changed before the download completed.'
        }
      }
      return { ok: true, paths }
    } catch (e) {
      if (operations.isCurrent(operation)) {
        clearDownloadedInstaller()
        const message = e instanceof Error ? e.message : String(e)
        emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'download_failed' })
        return { ok: false, currentVersion: app.getVersion(), code: 'download_failed', message }
      }
      return {
        ok: false,
        currentVersion: app.getVersion(),
        code: 'download_failed',
        message: 'The update channel changed before the download completed.'
      }
    } finally {
      if (eventOperation === operation) eventOperation = null
      operations.end(operation)
    }
  })
}

export function installGuiUpdate(): Promise<GuiUpdateInstallResult> {
  if (DEVELOPMENT_APP_FLAVOR) {
    return Promise.resolve({
      ok: false,
      currentVersion: app.getVersion(),
      code: 'unsupported',
      message: DEVELOPMENT_UPDATE_MESSAGE
    })
  }
  return updateInstaller.install()
}
