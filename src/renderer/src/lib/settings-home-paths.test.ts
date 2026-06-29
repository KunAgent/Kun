import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ScheduledTaskV1
} from '@shared/app-settings'
import {
  compactHomePathForSettingsDisplay,
  compactHomePathTextForSettingsDisplay,
  expandHomePathForSettingsUse,
  expandHomePathTextForSettingsUse,
  expandSettingsHomePathsForUse
} from './settings-home-paths'

function channel(workspaceRoot: string): ClawImChannelV1 {
  const now = '2026-06-19T00:00:00.000Z'
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu Agent',
    enabled: true,
    providerId: '',
    model: 'auto',
    threadId: '',
    workspaceRoot,
    agentProfile: {
      name: 'Feishu Agent',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [
      {
        id: 'conversation-1',
        chatId: 'chat-1',
        remoteThreadId: '',
        latestMessageId: '',
        senderId: '',
        senderName: '',
        localThreadId: '',
        workspaceRoot: '~/claw/channel-1/conversations/chat-1',
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  }
}

function scheduledTask(workspaceRoot: string): ScheduledTaskV1 {
  const now = '2026-06-19T00:00:00.000Z'
  return {
    id: 'task-1',
    title: 'Task',
    enabled: true,
    prompt: 'run',
    workspaceRoot,
    clawChannelId: '',
    providerId: '',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'medium',
    mode: 'agent',
    schedule: {
      kind: 'manual',
      everyMinutes: 60,
      timeOfDay: '',
      atTime: ''
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: ''
  }
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    cursorSpotlight: true,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        binaryPath: '~/bin/kun',
        dataDir: '~/.kun/data',
        storage: {
          ...defaultKunRuntimeSettings().storage,
          sqlitePath: '~/Library/Application Support/Kun/kun.sqlite3'
        }
      }
    },
    workspaceRoot: '~/.kun/default_workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 2 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: {
      ...defaultWriteSettings(),
      defaultWorkspaceRoot: '~/.kun/write_workspace',
      activeWorkspaceRoot: '~/drafts',
      workspaces: ['~/.kun/write_workspace', '~/drafts']
    },
    claw: {
      ...defaultClawSettings(),
      skills: {
        ...defaultClawSettings().skills,
        extraDirs: ['~/skills']
      },
      im: {
        ...defaultClawSettings().im,
        workspaceRoot: '~/claw'
      },
      channels: [channel('~/claw/channel-1')]
    },
    schedule: {
      ...defaultScheduleSettings(),
      defaultWorkspaceRoot: '~/schedule',
      skills: {
        ...defaultScheduleSettings().skills,
        extraDirs: ['~/schedule-skills']
      },
      tasks: [scheduledTask('~/schedule/task-1')]
    },
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('settings home paths', () => {
  it('compacts absolute home paths on macOS and Linux', () => {
    expect(compactHomePathForSettingsDisplay('/Users/mothra/.kun/default_workspace', '/Users/mothra', 'darwin'))
      .toBe('~/.kun/default_workspace')
    expect(compactHomePathForSettingsDisplay('/home/mothra/.kun/default_workspace', '/home/mothra', 'linux'))
      .toBe('~/.kun/default_workspace')
    expect(compactHomePathForSettingsDisplay('/Users/mothra/work/', '/Users/mothra', 'darwin'))
      .toBe('~/work/')
    expect(compactHomePathForSettingsDisplay('/Users/mothra/', '/Users/mothra', 'darwin'))
      .toBe('~/')
  })

  it('does not compact home paths on Windows', () => {
    expect(compactHomePathForSettingsDisplay('C:\\Users\\mothra\\.kun', 'C:\\Users\\mothra', 'win32'))
      .toBe('C:\\Users\\mothra\\.kun')
  })

  it('expands tilde input on macOS and Linux only', () => {
    expect(expandHomePathForSettingsUse('~/.kun/data', '/Users/mothra', 'darwin'))
      .toBe('/Users/mothra/.kun/data')
    expect(expandHomePathForSettingsUse('~/.kun/data', '/home/mothra', 'linux'))
      .toBe('/home/mothra/.kun/data')
    expect(expandHomePathForSettingsUse('~\\.kun\\data', '/Users/mothra', 'win32'))
      .toBe('~\\.kun\\data')
  })

  it('keeps multiline path text shape while compacting and expanding', () => {
    const text = '/Users/mothra/skills\n\n/Users/mothra/more-skills'
    expect(compactHomePathTextForSettingsDisplay(text, '/Users/mothra', 'darwin'))
      .toBe('~/skills\n\n~/more-skills')
    expect(expandHomePathTextForSettingsUse('~/skills\n\n~/more-skills', '/Users/mothra', 'darwin'))
      .toBe('/Users/mothra/skills\n\n/Users/mothra/more-skills')
  })

  it('expands nested settings paths before saving', () => {
    const expanded = expandSettingsHomePathsForUse(settings(), '/Users/mothra', 'darwin')

    expect(expanded.workspaceRoot).toBe('/Users/mothra/.kun/default_workspace')
    expect(expanded.conversationWorkspaceRoot).toBe('/Users/mothra/Documents/Kun')
    expect(expanded.agents.kun.binaryPath).toBe('/Users/mothra/bin/kun')
    expect(expanded.agents.kun.dataDir).toBe('/Users/mothra/.kun/data')
    expect(expanded.agents.kun.storage.sqlitePath).toBe('/Users/mothra/Library/Application Support/Kun/kun.sqlite3')
    expect(expanded.write.defaultWorkspaceRoot).toBe('/Users/mothra/.kun/write_workspace')
    expect(expanded.write.activeWorkspaceRoot).toBe('/Users/mothra/drafts')
    expect(expanded.claw.im.workspaceRoot).toBe('/Users/mothra/claw')
    expect(expanded.claw.skills.extraDirs).toEqual(['/Users/mothra/skills'])
    expect(expanded.claw.channels[0].workspaceRoot).toBe('/Users/mothra/claw/channel-1')
    expect(expanded.claw.channels[0].conversations[0].workspaceRoot)
      .toBe('/Users/mothra/claw/channel-1/conversations/chat-1')
    expect(expanded.schedule.defaultWorkspaceRoot).toBe('/Users/mothra/schedule')
    expect(expanded.schedule.skills.extraDirs).toEqual(['/Users/mothra/schedule-skills'])
    expect(expanded.schedule.tasks[0].workspaceRoot).toBe('/Users/mothra/schedule/task-1')
  })
})
