import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, win32 as win32Path } from 'node:path'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import semver from 'semver'
import type { GuiUpdateChannel } from '../shared/gui-update'
import {
  normalizeGuiUpdateScheduleState,
  type GuiUpdateScheduleState
} from '../shared/gui-update-schedule'

// R2 prefix 保持旧值:线上还在运行的 DeepSeek GUI 老版本轮询的
// 就是 `deepseek-gui/channels/<channel>/latest/`,prefix 一改老客户端
// 就再也收不到 Kun 的升级包。域名优先使用 kun-agent,旧域名仅作兜底。
export const PRIMARY_R2_PUBLIC_BASE_URL = 'https://www.kun-agent.com/api/r2'
export const SECONDARY_R2_PUBLIC_BASE_URL = 'https://kun-agent.com/api/r2'
export const LEGACY_R2_PUBLIC_BASE_URL = 'https://deepseek-gui.com/api/r2'
export const DEFAULT_R2_RELEASE_PREFIX = 'deepseek-gui'
export const UPDATE_FEED_PROBE_TIMEOUT_MS = 5_000
export const MANUAL_UPDATE_FETCH_TIMEOUT_MS = 10_000
export const GUI_UPDATE_FEED_CACHE_FILE = 'gui-update-feed-cache.json'
export const GUI_UPDATE_FEED_CACHE_TTL_MS = 86_400_000
export const { autoUpdater } = electronUpdater
export const DEVELOPMENT_APP_FLAVOR = process.env.KUN_APP_FLAVOR === 'development'
export const DEVELOPMENT_UPDATE_MESSAGE =
  'kun-dv is a source/testing application and cannot use the production Kun update channel.'
export const WINDOWS_INSTALLER_UPDATE_SOURCE_ENV = 'KUN_INSTALLER_UPDATE_SOURCE'

export function envWithLegacyFallback(kunName: string, legacyName: string): string {
  return process.env[kunName]?.trim() || process.env[legacyName]?.trim() || ''
}

export function setWindowsInstallerUpdateSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath
): () => void {
  if (platform !== 'win32') return () => undefined
  const hadPrevious = Object.prototype.hasOwnProperty.call(env, WINDOWS_INSTALLER_UPDATE_SOURCE_ENV)
  const previous = env[WINDOWS_INSTALLER_UPDATE_SOURCE_ENV]
  env[WINDOWS_INSTALLER_UPDATE_SOURCE_ENV] = win32Path.dirname(executablePath)
  return () => {
    if (hadPrevious && previous !== undefined) {
      env[WINDOWS_INSTALLER_UPDATE_SOURCE_ENV] = previous
    } else {
      delete env[WINDOWS_INSTALLER_UPDATE_SOURCE_ENV]
    }
  }
}

export const GUI_UPDATE_SCHEDULE_FILE = 'gui-update-schedule.json'
export const GUI_VERSION_STATE_FILE = 'gui-version-state.json'
export const DEFAULT_CHANGELOG_DIRECTORY_URL = 'https://github.com/KunAgent/Kun/tree/master/release'
export const DEFAULT_CHANGELOG_FILE_BASE_URL = 'https://github.com/KunAgent/Kun/blob/master/release'

export type GuiVersionState = {
  lastSeenVersion?: string
  pendingUpdate?: {
    version: string
    releaseNotes?: string
  }
}

export function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

export function joinUrl(base: string, ...parts: string[]): string {
  const cleanBase = normalizeBaseUrl(base)
  const cleanParts = parts.map((p) => trimSlashes(p)).filter(Boolean)
  return [cleanBase, ...cleanParts].join('/')
}

export function envUpdateUrl(channel: GuiUpdateChannel): string {
  const channelSpecific = envWithLegacyFallback(
    `KUN_UPDATE_URL_${channel.toUpperCase()}`,
    `DEEPSEEK_GUI_UPDATE_URL_${channel.toUpperCase()}`
  )
  const direct = channelSpecific || envWithLegacyFallback('KUN_UPDATE_URL', 'DEEPSEEK_GUI_UPDATE_URL')
  return direct ? direct.replace(/\{channel\}/g, channel).replace(/\/?$/, '/') : ''
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

export function defaultR2BaseUrls(): string[] {
  const configured = process.env.R2_PUBLIC_BASE_URL?.trim()
  if (configured) return [configured]
  return [PRIMARY_R2_PUBLIC_BASE_URL, SECONDARY_R2_PUBLIC_BASE_URL, LEGACY_R2_PUBLIC_BASE_URL]
}

export function updateFeedUrlCandidates(channel: GuiUpdateChannel): string[] {
  const direct = envUpdateUrl(channel)
  if (direct) return [direct]

  const prefix = process.env.R2_RELEASE_PREFIX?.trim() || DEFAULT_R2_RELEASE_PREFIX
  return uniqueStrings(
    defaultR2BaseUrls().map((base) => `${joinUrl(base, prefix, 'channels', channel, 'latest')}/`)
  )
}

export function updateFeedUrl(channel: GuiUpdateChannel): string {
  return updateFeedUrlCandidates(channel)[0]
}

export function updateFeedManifestUrl(feedUrl: string): string {
  return `${feedUrl}${platformManifestName()}`
}

export type UpdateFeedResolution =
  | { ok: true; url: string }
  | { ok: false; code: 'update_feed_unavailable'; message: string }

type FeedCache = Partial<Record<GuiUpdateChannel, { url: string; at: string }>>
let feedCacheWriteLane: Promise<void> = Promise.resolve()

export function updateFeedCachePath(): string {
  return join(app.getPath('userData'), GUI_UPDATE_FEED_CACHE_FILE)
}

async function readFeedCache(): Promise<FeedCache> {
  try {
    const value = JSON.parse(await readFile(updateFeedCachePath(), 'utf8'))
    return value && typeof value === 'object' ? value as FeedCache : {}
  } catch { return {} }
}

async function writeFeedCache(channel: GuiUpdateChannel, url: string): Promise<void> {
  const write = async (): Promise<void> => {
    const path = updateFeedCachePath()
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, JSON.stringify({ ...(await readFeedCache()), [channel]: { url, at: new Date().toISOString() } }), 'utf8')
    await rename(temporary, path)
  }
  const pending = feedCacheWriteLane.then(write, write)
  feedCacheWriteLane = pending.catch(() => undefined)
  await pending
}

function probeHeaders(): Record<string, string> {
  return { Accept: 'application/x-yaml,text/yaml,text/plain,*/*', 'User-Agent': `kun/${app.getVersion()}` }
}

async function probeUpdateFeed(feedUrl: string, signal: AbortSignal): Promise<boolean> {
  try {
    const url = updateFeedManifestUrl(feedUrl)
    const head = await fetch(url, { method: 'HEAD', headers: probeHeaders(), signal })
    if (head.ok) return true
    if (![403, 405, 501].includes(head.status)) return false
    const get = await fetch(url, { method: 'GET', headers: { ...probeHeaders(), Range: 'bytes=0-0' }, signal })
    if (get.body) await Promise.resolve(get.body.cancel()).catch(() => undefined)
    return get.ok
  } catch { return false }
}

export async function isUpdateFeedAccessible(feedUrl: string): Promise<boolean> {
  return probeUpdateFeed(feedUrl, AbortSignal.timeout(UPDATE_FEED_PROBE_TIMEOUT_MS))
}

export async function resolveUpdateFeedUrl(channel: GuiUpdateChannel): Promise<UpdateFeedResolution> {
  const configured = updateFeedUrlCandidates(channel)
  const cached = (await readFeedCache())[channel]
  const cachedAt = cached ? Date.parse(cached.at) : NaN
  const candidates = uniqueStrings([
    ...(cached && configured.includes(cached.url) && Date.now() - cachedAt <= GUI_UPDATE_FEED_CACHE_TTL_MS ? [cached.url] : []),
    ...configured
  ])
  const controller = new AbortController()
  let clearDeadline = (): void => undefined
  const deadline = new Promise<null>((resolve) => {
    const timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, UPDATE_FEED_PROBE_TIMEOUT_MS)
    clearDeadline = () => clearTimeout(timer)
  })
  // 首个可达源立即胜出：慢源/无响应源不允许把已确认可用的更新源拖到
  // 全局 deadline。全部候选失败时 Promise.any 才 reject。
  const attempts = candidates.map(async (url) => {
    if (!(await probeUpdateFeed(url, controller.signal))) {
      throw new Error(`Update feed unavailable: ${url}`)
    }
    return { url }
  })
  try {
    const selected = await Promise.race([Promise.any(attempts), deadline])
    if (!selected) {
      return {
        ok: false,
        code: 'update_feed_unavailable',
        message: `The ${channel} update feed probe exceeded its ${UPDATE_FEED_PROBE_TIMEOUT_MS}ms deadline.`
      }
    }
    await writeFeedCache(channel, selected.url).catch(() => undefined)
    return { ok: true, url: selected.url }
  } catch {
    return { ok: false, code: 'update_feed_unavailable', message: `No reachable GUI update feed is available for the ${channel} channel.` }
  } finally {
    clearDeadline()
    controller.abort()
  }
}

export async function fetchUpdateFeedManifest(feedUrl: string, currentVersion: string): Promise<Response> {
  return fetch(updateFeedManifestUrl(feedUrl), {
    headers: { Accept: 'application/x-yaml,text/yaml,text/plain,*/*', 'User-Agent': `kun/${currentVersion}` },
    signal: AbortSignal.timeout(MANUAL_UPDATE_FETCH_TIMEOUT_MS)
  })
}

export function guiUpdateSchedulePath(): string {
  return join(app.getPath('userData'), GUI_UPDATE_SCHEDULE_FILE)
}

export function guiVersionStatePath(): string {
  return join(app.getPath('userData'), GUI_VERSION_STATE_FILE)
}

export async function readGuiVersionState(): Promise<GuiVersionState> {
  try {
    const raw = await readFile(guiVersionStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as GuiVersionState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function writeGuiVersionState(state: GuiVersionState): Promise<void> {
  const path = guiVersionStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8')
}

export function normalizeChangelogVersion(version: string): string {
  const cleaned = version.trim().replace(/^v/i, '')
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(cleaned) ? `v${cleaned}` : ''
}

export function changelogUrl(version?: string): string {
  const normalizedVersion = normalizeChangelogVersion(version ?? '')
  const configured = envWithLegacyFallback('KUN_CHANGELOG_URL', 'DEEPSEEK_GUI_CHANGELOG_URL')
  if (configured) {
    return normalizedVersion ? configured.replace(/\{version\}/g, normalizedVersion) : configured
  }
  return normalizedVersion
    ? `${DEFAULT_CHANGELOG_FILE_BASE_URL}/release-${encodeURIComponent(normalizedVersion)}.md`
    : DEFAULT_CHANGELOG_DIRECTORY_URL
}

export function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !('note' in entry)) return ''
      return typeof entry.note === 'string' ? entry.note.trim() : ''
    })
    .filter(Boolean)
  return notes.length > 0 ? notes.join('\n\n') : undefined
}

export async function recordPendingUpdate(updateInfo: UpdateInfo): Promise<void> {
  const state = await readGuiVersionState()
  await writeGuiVersionState({
    ...state,
    pendingUpdate: {
      version: updateInfo.version.trim(),
      releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes)
    }
  })
}
export async function readGuiUpdateScheduleState(): Promise<GuiUpdateScheduleState> {
  try {
    return normalizeGuiUpdateScheduleState(JSON.parse(await readFile(guiUpdateSchedulePath(), 'utf8')))
  } catch {
    return {}
  }
}

export async function writeGuiUpdateScheduleState(state: GuiUpdateScheduleState): Promise<void> {
  const path = guiUpdateSchedulePath()
  const toIso = (value: number | null | undefined): string | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : undefined
  const normalized = normalizeGuiUpdateScheduleState(state)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({
      ...(toIso(normalized.lastAttemptAt) ? { lastAttemptAt: toIso(normalized.lastAttemptAt) } : {}),
      ...(toIso(normalized.lastSuccessAt) ? { lastSuccessAt: toIso(normalized.lastSuccessAt) } : {}),
      ...(typeof normalized.consecutiveFailures === 'number'
        ? { consecutiveFailures: normalized.consecutiveFailures }
        : {}),
      ...(toIso(normalized.nextRetryAt) ? { nextRetryAt: toIso(normalized.nextRetryAt) } : {})
    }, null, 2),
    'utf8'
  )
}

export function normalizeGithubOwnerRepo(raw: string): string | null {
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

export function packageJsonPath(): string {
  return join(app.getAppPath(), 'package.json')
}

export function readPackageJson(): Record<string, unknown> | null {
  try {
    const path = packageJsonPath()
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function resolveGithubReleaseUrl(): string | null {
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

export function downloadPageUrl(channel: GuiUpdateChannel): string {
  const direct = envWithLegacyFallback('KUN_DOWNLOAD_URL', 'DEEPSEEK_GUI_DOWNLOAD_URL')
  if (direct) return direct

  const pkg = readPackageJson()
  const homepage = typeof pkg?.homepage === 'string' ? pkg.homepage.trim() : ''
  if (homepage) return homepage

  return resolveGithubReleaseUrl() ?? updateFeedUrl(channel)
}

export function releaseUrlForVersion(version: string, channel: GuiUpdateChannel): string {
  const page = downloadPageUrl(channel)
  if (/github\.com\/.+\/releases\/?$/i.test(page)) {
    return `${page.replace(/\/+$/, '')}/tag/v${version.replace(/^v/i, '')}`
  }
  return page
}

export function isVersionGreater(latest: string, current: string): boolean {
  const normalizedLatest = semver.clean(latest.trim())
  const normalizedCurrent = semver.clean(current.trim())
  if (!normalizedLatest || !semver.valid(normalizedLatest)) throw new TypeError(`Invalid update version: "${latest}"`)
  if (!normalizedCurrent || !semver.valid(normalizedCurrent)) throw new TypeError(`Invalid current version: "${current}"`)
  return semver.gt(normalizedLatest, normalizedCurrent)
}

export function platformManifestName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  if (platform === 'darwin') return 'latest-mac.yml'
  if (platform === 'linux') return arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml'
  return 'latest.yml'
}

export function parseYamlScalar(source: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`^${escaped}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'))
  return match?.[1]?.trim() ?? ''
}

export function macAutoUpdateAllowed(): boolean {
  if (process.platform !== 'darwin') return true
  if (process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES === '1') return true

  const pkg = readPackageJson()
  const hints = pkg?.buildHints
  if (!hints || typeof hints !== 'object') return false
  const values = hints as { macSigningEnabled?: unknown; notarizationEnabled?: unknown }
  return values.macSigningEnabled === true && values.notarizationEnabled === true
}

export function unsupportedMessage(): string {
  if (process.platform === 'darwin') {
    return 'Automatic updates require a signed and notarized macOS build. Use the download page for this build.'
  }
  return 'Automatic updates are not supported for this build. Use the download page instead.'
}

export function extractHttpStatus(raw: string): number | null {
  const match = raw.match(/\b(\d{3})\b/)
  if (!match) return null
  const status = Number.parseInt(match[1], 10)
  return Number.isFinite(status) ? status : null
}

export function sanitizeUpdaterError(raw: string, channel: GuiUpdateChannel): string {
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
