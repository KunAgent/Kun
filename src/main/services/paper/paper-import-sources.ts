import { isAbsolute, relative, resolve } from 'node:path'
import type { AppSettingsV1 } from '../../../shared/app-settings'
import { normalizeWritePaperModeSettings } from '../../../shared/app-settings-paper-mode'
import { canonicalPath, expandHomePath, resolveTargetPathWithinWorkspace } from '../workspace-paths'

type PaperImportSource = { workspaceRoot: string; papersAbs: string }

/** Only roots already registered by the user are eligible for legacy dedupe. No file moves. */
export async function paperImportSources(settings: AppSettingsV1, workspaceRoot: string, papersDir: string): Promise<PaperImportSource[]> {
  const mode = normalizeWritePaperModeSettings(settings.write?.paperMode)
  const roots = [...new Set([workspaceRoot, ...mode.libraries, ...(settings.write?.workspaces ?? [])])]
  const sources: PaperImportSource[] = []
  for (const root of roots) {
    try {
      const canonical = await canonicalPath(resolve(expandHomePath(root)))
      const papersAbs = await resolveTargetPathWithinWorkspace(papersDir, canonical)
      if (!sources.some((source) => source.workspaceRoot === canonical)) sources.push({ workspaceRoot: canonical, papersAbs })
    } catch {
      // Unavailable legacy sources do not create replacement directories.
    }
  }
  return sources
}

/** Return the real source of a reused unit, never a path escaping the requested root. */
export function paperImportSourceForUnit(sources: readonly PaperImportSource[], fallbackRoot: string, unitAbs: string): string {
  return [...sources].sort((a, b) => b.workspaceRoot.length - a.workspaceRoot.length).find(({ workspaceRoot }) => {
    const path = relative(workspaceRoot, unitAbs)
    return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path)
  })?.workspaceRoot ?? fallbackRoot
}
