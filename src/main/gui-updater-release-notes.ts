import { app } from 'electron'
import type { ReleaseNotice, ReleaseNoticeRequest } from '../shared/release-notice'
import {
  changelogUrl,
  DEVELOPMENT_APP_FLAVOR,
  isVersionGreater,
  readGuiVersionState,
  writeGuiVersionState
} from './gui-updater-support'

/**
 * Development builds never record versions. `KUN_RELEASE_NOTICE_FROM=<version>`
 * fakes an upgrade from that version so the dialog can be exercised locally.
 */
function developmentNoticeFrom(): string | null {
  const from = process.env.KUN_RELEASE_NOTICE_FROM?.trim()
  return from ? from : null
}

function tracksVersions(): boolean {
  return !DEVELOPMENT_APP_FLAVOR && app.isPackaged
}

/**
 * Runs once at startup. A fresh install only records its version, so the
 * first launch never shows a "what's new" notice.
 */
export async function recordFirstLaunchVersion(): Promise<void> {
  if (!tracksVersions()) return
  const state = await readGuiVersionState()
  if (state.lastSeenVersion) return
  await writeGuiVersionState({ ...state, lastSeenVersion: app.getVersion().trim() })
}

/**
 * The notice the renderer should show, or null. It stays due until the
 * renderer acknowledges it, so a crash before the dialog appears does not
 * lose it.
 */
export async function readReleaseNotice(request: ReleaseNoticeRequest = {}): Promise<ReleaseNotice | null> {
  const version = app.getVersion().trim()
  if (request.current) return { version, changelogUrl: changelogUrl(version) }
  if (!tracksVersions()) {
    const from = developmentNoticeFrom()
    return from ? { version, previousVersion: from, changelogUrl: changelogUrl(version) } : null
  }
  const state = await readGuiVersionState()
  if (!state.lastSeenVersion) {
    await writeGuiVersionState({ ...state, lastSeenVersion: version })
    return null
  }
  if (state.lastSeenVersion === version || !isVersionGreater(version, state.lastSeenVersion)) return null
  const pendingUpdate = state.pendingUpdate?.version === version ? state.pendingUpdate : undefined
  return {
    version,
    previousVersion: state.lastSeenVersion,
    ...(pendingUpdate?.releaseNotes ? { releaseNotes: pendingUpdate.releaseNotes } : {}),
    changelogUrl: changelogUrl(version)
  }
}

/** Marks the running version as seen; later launches stay quiet until the next update. */
export async function acknowledgeReleaseNotice(version: string): Promise<void> {
  if (!tracksVersions()) return
  const current = app.getVersion().trim()
  if (version.trim() !== current) return
  const state = await readGuiVersionState()
  if (state.lastSeenVersion === current && !state.pendingUpdate) return
  const next = { ...state, lastSeenVersion: current }
  if (next.pendingUpdate && !isVersionGreater(next.pendingUpdate.version, current)) delete next.pendingUpdate
  await writeGuiVersionState(next)
}
