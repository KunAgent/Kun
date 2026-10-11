import type { ReleaseNotice } from '@shared/release-notice'
import {
  compareVersions,
  parseReleaseNotes,
  type ReleaseNotesLanguage,
  type ReleaseNotesSummary
} from '@shared/release-notes-summary'

/**
 * Curated release notes ship inside the renderer bundle: each
 * `release/release-v<version>.md` becomes its own lazy chunk, so the dialog
 * works offline and only loads the versions it shows.
 */
const RELEASE_FILES = import.meta.glob<string>('../../../../../release/release-v*.md', {
  query: '?raw',
  import: 'default'
})

/** Versions skipped in one jump that still get their own collapsed row. */
const MAX_OLDER_VERSIONS = 5

export type WhatsNewContent = {
  version: string
  previousVersion?: string
  changelogUrl: string
  current: ReleaseNotesSummary | null
  /** Versions between the previous and the current one, newest first. */
  older: ReleaseNotesSummary[]
}

type ReleaseLoader = () => Promise<string>

function bundledReleases(files: Record<string, ReleaseLoader>): Map<string, ReleaseLoader> {
  const releases = new Map<string, ReleaseLoader>()
  for (const [path, load] of Object.entries(files)) {
    const version = /release-v([^/]+)\.md$/.exec(path)?.[1]
    if (version) releases.set(version, load)
  }
  return releases
}

async function loadSummary(
  load: ReleaseLoader | undefined,
  version: string,
  language: ReleaseNotesLanguage
): Promise<ReleaseNotesSummary | null> {
  if (!load) return null
  try {
    return parseReleaseNotes(await load(), version, language)
  } catch {
    return null
  }
}

export async function loadWhatsNewContent(
  notice: ReleaseNotice,
  language: ReleaseNotesLanguage,
  files: Record<string, ReleaseLoader> = RELEASE_FILES
): Promise<WhatsNewContent> {
  const releases = bundledReleases(files)
  const version = notice.version.replace(/^v/i, '')
  const current = await loadSummary(releases.get(version), version, language)
    ?? (notice.releaseNotes ? parseReleaseNotes(notice.releaseNotes, version, language) : null)
  const previous = notice.previousVersion?.replace(/^v/i, '')
  const olderVersions = previous
    ? [...releases.keys()]
      .filter((candidate) => compareVersions(candidate, previous) > 0 && compareVersions(candidate, version) < 0)
      .sort((a, b) => compareVersions(b, a))
      .slice(0, MAX_OLDER_VERSIONS)
    : []
  const older = (await Promise.all(
    olderVersions.map((candidate) => loadSummary(releases.get(candidate), candidate, language))
  )).filter((summary): summary is ReleaseNotesSummary => summary !== null)
  return {
    version,
    ...(previous ? { previousVersion: previous } : {}),
    changelogUrl: notice.changelogUrl,
    current,
    older
  }
}

export function releaseNotesLanguage(locale: string | undefined): ReleaseNotesLanguage {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
