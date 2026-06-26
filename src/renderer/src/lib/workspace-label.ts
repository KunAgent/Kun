import i18n from '../i18n'

const DEFAULT_WORKSPACE_LABEL = 'Kun'

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// Treat both current and legacy default workspace paths as the app workspace.
// Older installs can keep the ~/.deepseekgui path until migration completes.
function isDefaultWorkspacePath(path: string): boolean {
  const normalized = normalizePathForMatch(path)
  return (
    normalized === '~/.kun/default_workspace'
    || normalized.endsWith('/.kun/default_workspace')
    || normalized === '~/.deepseekgui/default_workspace'
    || normalized.endsWith('/.deepseekgui/default_workspace')
  )
}

export function workspaceLabelFromPath(path: string): string {
  const p = path?.trim() ?? ''
  if (!p) return i18n.t('common:workingDirectory')
  if (isDefaultWorkspacePath(p)) return DEFAULT_WORKSPACE_LABEL
  const normalized = p.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/)
  const base = parts[parts.length - 1]
  return base || i18n.t('common:workingDirectory')
}
