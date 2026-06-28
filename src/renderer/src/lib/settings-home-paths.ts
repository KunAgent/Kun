import type { AppSettingsV1 } from '@shared/app-settings'

function supportsHomeAlias(platform: string | undefined): boolean {
  return platform === 'darwin' || platform === 'linux'
}

function normalizedHomeDir(homeDir: string | undefined): string {
  return (homeDir ?? '').replace(/\\/g, '/').replace(/\/+$/g, '')
}

function currentPlatform(): string {
  return typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
}

function currentHomeDir(): string {
  return typeof window !== 'undefined' ? window.kunGui?.homeDir ?? '' : ''
}

export function compactHomePathForSettingsDisplay(
  value: string,
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): string {
  const home = normalizedHomeDir(homeDir)
  if (!supportsHomeAlias(platform) || !home || !value) return value
  const normalizedValue = value.replace(/\\/g, '/')
  const withoutTrailingSlash = normalizedValue.replace(/\/+$/g, '')
  if (normalizedValue === home) return '~'
  if (withoutTrailingSlash === home) return '~/'
  if (normalizedValue.startsWith(`${home}/`)) {
    return `~/${normalizedValue.slice(home.length + 1)}`
  }
  return value
}

export function expandHomePathForSettingsUse(
  value: string,
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): string {
  const home = normalizedHomeDir(homeDir)
  if (!supportsHomeAlias(platform) || !home) return value
  const trimmed = value.trim()
  if (trimmed === '~') return home
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return `${home}/${trimmed.slice(2).replace(/\\/g, '/')}`
  }
  return value
}

export function compactHomePathListForSettingsDisplay(
  values: readonly string[],
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): string {
  return values
    .map((value) => compactHomePathForSettingsDisplay(value, homeDir, platform))
    .join('\n')
}

export function expandHomePathListForSettingsUse(
  values: readonly string[],
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): string[] {
  return values.map((value) => expandHomePathForSettingsUse(value, homeDir, platform))
}

export function compactHomePathTextForSettingsDisplay(
  value: string,
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): string {
  return value
    .split('\n')
    .map((line) => compactHomePathForSettingsDisplay(line, homeDir, platform))
    .join('\n')
}

export function expandHomePathTextForSettingsUse(
  value: string,
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): string {
  return value
    .split('\n')
    .map((line) => expandHomePathForSettingsUse(line, homeDir, platform))
    .join('\n')
}

export function expandSettingsHomePathsForUse(
  settings: AppSettingsV1,
  homeDir = currentHomeDir(),
  platform = currentPlatform()
): AppSettingsV1 {
  const expand = (value: string): string => expandHomePathForSettingsUse(value, homeDir, platform)
  const expandList = (values: readonly string[]): string[] => expandHomePathListForSettingsUse(values, homeDir, platform)
  const kun = settings.agents.kun
  return {
    ...settings,
    workspaceRoot: expand(settings.workspaceRoot),
    conversationWorkspaceRoot: expand(settings.conversationWorkspaceRoot),
    agents: {
      ...settings.agents,
      kun: {
        ...kun,
        binaryPath: expand(kun.binaryPath),
        dataDir: expand(kun.dataDir),
        storage: {
          ...kun.storage,
          sqlitePath: expand(kun.storage.sqlitePath)
        }
      }
    },
    write: {
      ...settings.write,
      defaultWorkspaceRoot: expand(settings.write.defaultWorkspaceRoot),
      activeWorkspaceRoot: expand(settings.write.activeWorkspaceRoot),
      workspaces: expandList(settings.write.workspaces)
    },
    claw: {
      ...settings.claw,
      skills: {
        ...settings.claw.skills,
        extraDirs: expandList(settings.claw.skills.extraDirs)
      },
      im: {
        ...settings.claw.im,
        workspaceRoot: expand(settings.claw.im.workspaceRoot)
      },
      channels: settings.claw.channels.map((channel) => ({
        ...channel,
        workspaceRoot: expand(channel.workspaceRoot),
        conversations: channel.conversations.map((conversation) => ({
          ...conversation,
          workspaceRoot: expand(conversation.workspaceRoot)
        }))
      })),
      tasks: settings.claw.tasks.map((task) => ({
        ...task,
        workspaceRoot: expand(task.workspaceRoot)
      }))
    },
    schedule: {
      ...settings.schedule,
      defaultWorkspaceRoot: expand(settings.schedule.defaultWorkspaceRoot),
      skills: {
        ...settings.schedule.skills,
        extraDirs: expandList(settings.schedule.skills.extraDirs)
      },
      tasks: settings.schedule.tasks.map((task) => ({
        ...task,
        workspaceRoot: expand(task.workspaceRoot)
      }))
    }
  }
}
