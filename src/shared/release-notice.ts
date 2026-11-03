/**
 * The "what's new" notice shown the first time Kun opens after an update.
 * Main decides whether one is due; the renderer owns the dialog and the
 * release-note content (bundled from `release/release-v<version>.md`).
 */
export type ReleaseNotice = {
  /** The running version the notice describes. */
  version: string
  /** The version the user ran before this update; absent when reopened by hand. */
  previousVersion?: string
  /** Release notes cached from the update feed, used when no bundled notes exist. */
  releaseNotes?: string
  /** Where "full changelog" leads for this version. */
  changelogUrl: string
}

export type ReleaseNoticeRequest = {
  /** Return the notice for the running version even if it was already seen. */
  current?: boolean
}
