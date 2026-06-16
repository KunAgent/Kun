import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

/**
 * A skill-root identifier: a common-directory id (e.g. `workspace-claude`,
 * `global-codex`) or, for user-configured extra dirs, the absolute path itself.
 * Kept as a plain string so the marketplace picker stays in sync with whatever
 * roots the backend (`skill:list-roots`) and the settings page report, rather
 * than a hardcoded subset.
 */
export type SkillRootId = string

const SKILL_ROOT_PREFERENCE_KEY = 'kun.skillRootPreference'

/** The skill root the user last picked in the marketplace, or '' when unset. */
export function loadPreferredSkillRootId(): SkillRootId {
  return readBrowserStorageItem(SKILL_ROOT_PREFERENCE_KEY)?.trim() ?? ''
}

export function savePreferredSkillRootId(id: SkillRootId): void {
  writeBrowserStorageItem(SKILL_ROOT_PREFERENCE_KEY, id)
}
