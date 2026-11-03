import type {
  WritePaperModeSettingsPatchV1,
  WritePaperModeSettingsV1,
  WriteSettingsPatchV1,
  WriteSettingsV1
} from '@shared/app-settings'
import { compactWorkspaceRoots, normalizePath } from './write-workspace-store-helpers'

/**
 * Work used to keep paper libraries on a separate surface. Spaces now carry
 * their papers themselves, so any registered library joins the space list,
 * and a desktop last left on the paper surface reopens on that library.
 * Returns the settings patch, or null when nothing needs to change.
 */
export function legacyPaperLibraryMigration(
  write: Partial<Pick<WriteSettingsV1, 'workspaces' | 'paperMode'>> | null | undefined
): WriteSettingsPatchV1 | null {
  const paperMode = write?.paperMode
  if (!paperMode) return null
  const spaces = compactWorkspaceRoots(write?.workspaces ?? [])
  const known = new Set(spaces)
  const active = normalizePath(paperMode.activeLibrary ?? '')
  const missing = compactWorkspaceRoots([active, ...(paperMode.libraries ?? [])]).filter((root) => !known.has(root))
  if (!paperMode.enabled && missing.length === 0) return null
  return {
    ...(missing.length ? { workspaces: [...spaces, ...missing] } : {}),
    ...(paperMode.enabled && active ? { activeWorkspaceRoot: active } : {}),
    paperMode: { enabled: false }
  }
}

/** The library-list patch that forgets `root`, or null when it was never a library. */
export function withoutPaperLibrary(
  paperMode: Pick<WritePaperModeSettingsV1, 'libraries' | 'activeLibrary'>,
  root: string
): WritePaperModeSettingsPatchV1 | null {
  const target = normalizePath(root)
  const libraries = paperMode.libraries.filter((item) => normalizePath(item) !== target)
  const wasActive = normalizePath(paperMode.activeLibrary) === target
  if (libraries.length === paperMode.libraries.length && !wasActive) return null
  return { libraries, ...(wasActive ? { activeLibrary: '' } : {}) }
}
