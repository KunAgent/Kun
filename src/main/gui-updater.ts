import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
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

const DEFAULT_R2_PUBLIC_BASE_URL = 'https://deepseek-gui.com/api/r2'
const DEFAULT_R2_RELEASE_PREFIX = 'deepseek-gui'
const { autoUpdater } = electronUpdater

let initialized = false
let getMainWindow: (() => BrowserWindow | null) | null = null
let lastInfo: Extract<GuiUpdateInfo, { ok: true }> | null = null
let lastState: GuiUpdateState = { status: 'idle' }
let downloaded = false
let downloadPromise: Promise<string[]> | null = null
let configuredChannel: GuiUpdateChannel = normalizeGuiUpdateChannel(
  process.env.DEEPSEEK_GUI_UPDATE_CHANNEL?.trim()
)
let configuredFeedUrl = ''
let getSelectedChannel: (() => GuiUpdateChannel | Promise<GuiUpdateChannel>) | null = null

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function joinUrl(base: string, ...parts: string[]): string {
  const cleanBase = normalizeBaseUrl(base)
  const cleanParts = parts.map((p) => trimSlashes(p)).filter(Boolean)
  return [cleanBase, ...cleanParts].join('/')
}

function envUpdateUrl(channel: GuiUpdateChannel): string {
  const channelSpecific = process.env[`DEEPSEEK_GUI_UPDATE_URL_${channel.toUpperCase()}`]?.trim()
  const direct = channelSpecific || process.env.DEEPSEEK_GUI_UPDATE_URL?.trim() || ''
  return direct ? direct.replace(/\{channel\}/g, channel).replace(/\/?$/, '/') : ''
}

function updateFeedUrl(channel: GuiUpdateChannel): string {
  const direct = envUpdateUrl(channel)
  if (direct) return direct

  const base = process.env.R2_PUBLIC_BASE_URL?.trim() || DEFAULT_R2_PUBLIC_BASE_URL
  const prefix = process.env.R2_RELEASE_PREFIX?.trim() || DEFAULT_R2_RELEASE_PREFIX
  return `${joinUrl(base, prefix, 'channels', channel, 'latest')}/`
}

function normalizeGithubOwnerRepo(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('github:')) s = s.slice('github:'.length).trim()
  const ssh = s.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/i)
  if (ssh?.[1]) return ssh[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  const https = s.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:$|[#/])/i)
  if (https?.[1]) return https[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s
  return null
}

function packageJsonPath(): string {
  return join(app.getAppPath(), 'package.json')
}

function readPackageJson(): Record<string, unknown> | null {
  try {
    const path = packageJsonPath()
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveGithubReleaseUrl(): string | null {
  const envRepo = normalizeGithubOwnerRepo(process.env.DEEPSEEK_GUI_GITHUB_REPO?.trim() ?? '')
  if (envRepo) return `https://github.com/${envRepo}/releases`

  const pkg = readPackageJson()
  const repository = pkg?.repository
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository
        ? String((repository as { url?: unknown }).url ?? '')
        : ''
  const repo = normalizeGithubOwnerRepo(raw)
  return repo ? `https://github.com/${repo}/releases` : null
}

function downloadPageUrl(): string {
  const direct = process.env.DEEPSEEK_GUI_DOWNLOAD_URL?.trim()
  if (direct) return direct

  const pkg = readPackageJson()
  const homepage = typeof pkg?.homepage === 'string' ? pkg.homepage.trim() : ''
  if (homepage) return homepage

  return resolveGithubReleaseUrl() ?? updateFeedUrl(configuredChannel)
}

function releaseUrlForVersion(version: string): string {
  const page = downloadPageUrl()
  if (/github\.com\/.+\/releases\/?$/i.test(page)) {
    return `${page.replace(/\/+$/, '')}/tag/v${version.replace(/^v/i, '')}`
  }
  return page
}

function parseVersionParts(v: string): number[] {
  const cleaned = v.trim().replace(/^v/i, '').replace(/-.*$/, '')
  return cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function isVersionGreater(latest: string, current: string): boolean {
  const a = parseVersionParts(latest)
  const b = parseVersionParts(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return false
}

function platformManifestName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

function parseYamlScalar(source: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`^${escaped}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'))
  return match?.[1]?.trim() ?? ''
}

function macAutoUpdateAllowed(): boolean {
  if (process.platform !== 'darwin') return true
  if (process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES === '1') return true

  const pkg = readPackageJson()
  const hints = pkg?.buildHints
  if (!hints || typeof hints !== 'object') return false
  const values = hints as { macSigningEnabled?: unknown; notarizationEnabled?: unknown }
  return values.macSigningEnabled === true && values.notarizationEnabled === true
}

function unsupportedMessage(): string {
  if (process.platform === 'darwin') {
    return 'Automatic updates require a signed and notarized macOS build. Use the download page for this build.'
  }
  return 'Automatic updates are not supported for this build. Use the download page instead.'
}

function extractHttpStatus(raw: string): number | null {
  const match = raw.match(/\b(\d{3})\b/)
  if (!match) return null
  const status = Number.parseInt(match[1], 10)
  return Number.isFinite(status) ? status : null
}

function sanitizeUpdaterError(raw: string, channel: GuiUpdateChannel): string {
  const message = raw.trim()
  if (!message) {
    return `Could not read GUI update metadata for the ${channel} channel. Open the download page instead.`
  }

  if (/Invalid release object path\./i.test(message)) {
    return `The ${channel} update feed is not published correctly yet. Open the download page instead.`
  }

  if (/Object not found\./i.test(message)) {
    return `The ${channel} update feed is missing release metadata right now. Open the download page instead.`
  }

  const status = extractHttpStatus(message)
  if (status === 400 || status === 404) {
    return `The ${channel} update feed is not available right now. Open the download page instead.`
  }
  if (status === 403) {
    return `The ${channel} update feed denied this request. Open the download page instead.`
  }
  if (status === 429) {
    return `The ${channel} update feed is rate limited right now. Please try again later.`
  }
  if (status && status >= 500) {
    return `The ${channel} update feed is temporarily unavailable. Please try again later.`
  }

  return message.split(/\n(?:Headers:|Data:)/, 1)[0].trim() || message
}

function toGuiInfo(updateInfo: UpdateInfo, hasUpdate: boolean, manualOnly = false): Extract<GuiUpdateInfo, { ok: true }> {
  const latestVersion = updateInfo.version.trim()
  return {
    ok: true,
    currentVersion: app.getVersion(),
    latestVersion,
    hasUpdate,
    releaseUrl: releaseUrlForVersion(latestVersion),
    releaseDate: updateInfo.releaseDate,
    channel: configuredChannel,
    manualOnly,
    downloaded
  }
}

function emitGuiUpdateState(state: GuiUpdateState): void {
  lastState = state
  const win = getMainWindow?.()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('gui:update-state', state)
}

async function resolveUpdateChannel(requested?: GuiUpdateChannel): Promise<GuiUpdateChannel> {
  if (requested) return normalizeGuiUpdateChannel(requested)
  if (getSelectedChannel) {
    return normalizeGuiUpdateChannel(await getSelectedChannel())
  }
  return DEFAULT_GUI_UPDATE_CHANNEL
}

function configureUpdaterChannel(channel: GuiUpdateChannel): void {
  const normalized = normalizeGuiUpdateChannel(channel)
  const feedUrl = updateFeedUrl(normalized)
  const changed = normalized !== configuredChannel || feedUrl !== configuredFeedUrl
  configuredChannel = normalized
  configuredFeedUrl = feedUrl
  autoUpdater.allowPrerelease = normalized === 'frontier'
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  if (!changed) return
  downloaded = false
  downloadPromise = null
  lastInfo = null
  emitGuiUpdateState({ status: 'idle' })
}

export function setGuiUpdateChannel(channel: GuiUpdateChannel): void {
  configureUpdaterChannel(channel)
}

async function checkManualUpdate(
  channel: GuiUpdateChannel,
  code: GuiUpdateFailureCode = 'unsupported'
): Promise<GuiUpdateInfo> {
  const currentVersion = app.getVersion()
  try {
    const url = `${updateFeedUrl(channel)}${platformManifestName()}`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/x-yaml,text/yaml,text/plain,*/*',
        'User-Agent': `deepseek-gui/${currentVersion}`
      }
    })
    if (!res.ok) {
      return {
        ok: false,
        currentVersion,
        code,
        message: `${unsupportedMessage()} Update metadata returned ${res.status}.`,
        releaseUrl: downloadPageUrl(),
        channel
      }
    }
    const text = await res.text()
    const latestVersion = parseYamlScalar(text, 'version')
    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        code,
        message: `${unsupportedMessage()} Update metadata is missing a version.`,
        releaseUrl: downloadPageUrl(),
        channel
      }
    }
    const info: Extract<GuiUpdateInfo, { ok: true }> = {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isVersionGreater(latestVersion, currentVersion),
      releaseUrl: releaseUrlForVersion(latestVersion),
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
      releaseUrl: downloadPageUrl(),
      channel
    }
  }
}

export function initializeGuiUpdater(
  windowGetter: () => BrowserWindow | null,
  channelGetter?: () => GuiUpdateChannel | Promise<GuiUpdateChannel>
): void {
  getMainWindow = windowGetter
  getSelectedChannel = channelGetter ?? null
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  configureUpdaterChannel(configuredChannel)
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.logger = {
    info: (message?: unknown) => console.info('[deepseek-gui updater]', message),
    warn: (message?: unknown) => console.warn('[deepseek-gui updater]', message),
    error: (message?: unknown) => console.error('[deepseek-gui updater]', message)
  }

  autoUpdater.on('checking-for-update', () => {
    emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  })

  autoUpdater.on('update-available', (updateInfo: UpdateInfo) => {
    downloaded = false
    const info = toGuiInfo(updateInfo, true)
    lastInfo = info
    emitGuiUpdateState({ status: 'available', info })
  })

  autoUpdater.on('update-not-available', (updateInfo: UpdateInfo) => {
    downloaded = false
    const info = toGuiInfo(updateInfo, false)
    lastInfo = info
    emitGuiUpdateState({ status: 'not_available', info })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    emitGuiUpdateState({ status: 'downloading', info: lastInfo ?? undefined, progress })
  })

  autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    downloaded = true
    const info = toGuiInfo(event, true)
    lastInfo = info
    emitGuiUpdateState({ status: 'downloaded', info })
  })

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'unknown' })
  })
}

export function getGuiUpdateState(): GuiUpdateState {
  return lastState
}

export async function checkGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateInfo> {
  const selectedChannel = await resolveUpdateChannel(channel)
  configureUpdaterChannel(selectedChannel)

  if (!macAutoUpdateAllowed()) {
    return checkManualUpdate(selectedChannel, 'unsupported')
  }

  emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return checkManualUpdate(selectedChannel, 'not_configured')
    }
    const info = toGuiInfo(result.updateInfo, result.isUpdateAvailable)
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
      releaseUrl: downloadPageUrl(),
      channel: selectedChannel
    }
    emitGuiUpdateState({ status: 'error', info, message, code: 'unknown' })
    return info
  }
}

export async function downloadGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateDownloadResult> {
  const selectedChannel = await resolveUpdateChannel(channel)
  configureUpdaterChannel(selectedChannel)

  if (!macAutoUpdateAllowed()) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'unsupported',
      message: unsupportedMessage()
    }
  }

  try {
    if (!lastInfo?.hasUpdate || lastInfo.channel !== selectedChannel) {
      const checked = await checkGuiUpdate(selectedChannel)
      if (!checked.ok) return checked
      if (!checked.hasUpdate || checked.manualOnly) {
        return {
          ok: false,
          currentVersion: app.getVersion(),
          code: checked.manualOnly ? 'unsupported' : 'unknown',
          message: checked.manualOnly
            ? unsupportedMessage()
            : 'No downloadable GUI update is available.'
        }
      }
    }

    if (!downloadPromise) {
      downloadPromise = autoUpdater.downloadUpdate().finally(() => {
        downloadPromise = null
      })
    }
    const paths = await downloadPromise
    return { ok: true, paths }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'download_failed' })
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'download_failed',
      message
    }
  }
}

export async function installGuiUpdate(): Promise<GuiUpdateInstallResult> {
  try {
    if (!downloaded) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        code: 'install_failed',
        message: 'The update has not finished downloading yet.'
      }
    }
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'install_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}
