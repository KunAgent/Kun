function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// 品牌升级后默认目录在 ~/.kun 下;老版本/迁移失败的机器上仍可能出现
// ~/.deepseekgui 形式,这里对两套路径都要认,并归一到同一个身份键,
// 避免同一个默认工作区在侧栏里出现两份。
function isDefaultWorkspacePath(normalized: string): boolean {
  return (
    normalized === '~/.kun/default_workspace'
    || normalized.endsWith('/.kun/default_workspace')
    || normalized === '~/.deepseekgui/default_workspace'
    || normalized.endsWith('/.deepseekgui/default_workspace')
  )
}

export function workspaceRootIdentityKey(path?: string): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  const normalized = normalizePathForMatch(trimmed)
  if (isDefaultWorkspacePath(normalized)) {
    return '~/.kun/default_workspace'
  }
  return normalized
}

/**
 * Lexical, case-preserving key for security-sensitive workspace scoping.
 * Unlike the navigation identity key, this must not merge distinct paths on
 * case-sensitive filesystems. Main already resolves Extension View workspace
 * roots; the renderer only normalizes separator spelling and trailing slashes.
 */
export function workspaceRootScopeKey(path?: string): string {
  let normalized = path?.trim().replace(/\\/g, '/') ?? ''
  while (
    normalized.length > 1 &&
    normalized.endsWith('/') &&
    !/^[A-Za-z]:\/$/.test(normalized)
  ) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

export function isInternalTemporaryWorkspace(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return (
    /\/deepseek-tui-updates\/tmp(?:\/|$)/.test(normalized)
    || normalized === '/tmp'
    || normalized.startsWith('/tmp/')
    || normalized === '/private/tmp'
    || normalized.startsWith('/private/tmp/')
    || /^\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/.test(normalized)
    || /^\/private\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/.test(normalized)
    || /\/appdata\/local\/temp(?:\/|$)/.test(normalized)
  )
}

export function isClawWorkspacePath(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return normalized.includes('/.kun/claw/') || normalized.includes('/.deepseekgui/claw/')
}

// 对话会话不绑定项目文件夹,默认在 ~/Documents/Kun(macOS/Windows)或
// ~/.local/share/Kun/conversations(Linux)下按时间戳创建工作目录。
export function defaultConversationWorkspaceRoot(): string {
  const platform = typeof window !== 'undefined' && window.kunGui?.platform ? window.kunGui.platform : ''
  return platform === 'linux' ? '~/.local/share/Kun/conversations' : '~/Documents/Kun'
}
// 兼容旧引用;动态取值。
export const DEFAULT_CONVERSATION_WORKSPACE_ROOT = defaultConversationWorkspaceRoot()

// 判断给定路径是否落在对话工作目录根(或就是根本身)之下。
// root 可能是带 ~ 的设置值,也可能是绝对路径;两侧都按分隔符归一后比较前缀。
export function isConversationWorkspacePath(path?: string, root?: string): boolean {
  const trimmedPath = path?.trim() ?? ''
  if (!trimmedPath) return false
  const effectiveRoot = (root?.trim() ? root.trim() : defaultConversationWorkspaceRoot())
  const normalizedPath = normalizePathForMatch(expandHomeForMatch(trimmedPath))
  const normalizedRoot = normalizePathForMatch(expandHomeForMatch(effectiveRoot))
  if (!normalizedRoot) return false
  if (normalizedPath === normalizedRoot) return true
  return normalizedPath.startsWith(normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`)
}

// 仅供路径前缀比较:把 ~ 展开成 home(渲染层没有 node:os,这里用 window.kunGui.homeDir)。
// 与主进程的 expandHomePath 行为一致;拿不到 homeDir 时退化为不展开,仍能匹配绝对路径。
function expandHomeForMatch(value: string): string {
  if (!value.startsWith('~')) return value
  const home = typeof window !== 'undefined' && window.kunGui?.homeDir ? window.kunGui.homeDir : ''
  if (!home) return value
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return `${home}/${value.slice(2).replace(/\\/g, '/')}`
  }
  return value
}

export function isInternalDeepSeekGuiWorkspace(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return (
    normalized === '~/.kun/write_workspace'
    || normalized.endsWith('/.kun/write_workspace')
    || normalized === '~/.kun/design-workspace'
    || normalized.endsWith('/.kun/design-workspace')
    || normalized === '~/.deepseekgui/write_workspace'
    || normalized.endsWith('/.deepseekgui/write_workspace')
    || normalized === '~/.deepseekgui/design-workspace'
    || normalized.endsWith('/.deepseekgui/design-workspace')
  )
}

export function normalizeWorkspaceRoot(path?: string): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  if (isInternalTemporaryWorkspace(trimmed)) return ''
  return trimmed
}
