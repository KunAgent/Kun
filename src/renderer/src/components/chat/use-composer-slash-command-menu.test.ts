import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { buildComposerSlashCommands } from './use-composer-slash-command-menu'

const t = ((key: string) => key) as TFunction

const baseInput = {
  t,
  route: 'chat' as const,
  runtimeReady: true,
  busy: false,
  activeThreadId: 'thr_1',
  activeThreadArchived: false,
  canOpenGoalPanel: true,
  canCreateNewThread: true,
  workspaceRoot: '/repo',
  hasPlanCommand: true,
  hasBtwCommand: false,
  hideBtwCommand: true,
  hasReviewCommand: true,
  skillCommands: []
}

describe('buildComposerSlashCommands harness section', () => {
  it('appends harness-native commands after the builtin catalog', () => {
    const commands = buildComposerSlashCommands({
      ...baseInput,
      harnessCommands: {
        harnessLabel: 'Claude Code',
        commands: [
          { name: 'review', description: 'Run a code review' },
          { name: 'login' }
        ]
      }
    })
    const harness = commands.filter((command) => command.kind === 'harness')
    expect(harness.map((command) => command.id)).toEqual([
      'harness:review',
      'harness:login'
    ])
    expect(harness[0]?.title).toBe('/review')
    expect(harness[0]?.nativeText).toBe('/review')
    expect(harness[0]?.description).toBe('Run a code review')
    expect(harness[0]?.scopeLabel).toBe('Claude Code')
    // Harness commands sit after every builtin entry.
    const lastBuiltin = commands.map((command) => command.kind ?? 'builtin').lastIndexOf('builtin')
    const firstHarness = commands.findIndex((command) => command.kind === 'harness')
    expect(firstHarness).toBeGreaterThan(lastBuiltin)
  })

  it('normalizes names, dedupes repeats, and leaves names verbatim for send', () => {
    const commands = buildComposerSlashCommands({
      ...baseInput,
      harnessCommands: {
        harnessLabel: 'ACP Agent',
        commands: [
          { name: '/status' },
          { name: 'status' },
          { name: '  plan  ', inputHint: 'create a plan' }
        ]
      }
    })
    const harness = commands.filter((command) => command.kind === 'harness')
    expect(harness.map((command) => command.id)).toEqual([
      'harness:/status',
      'harness:status',
      'harness:plan'
    ])
    expect(harness[0]?.nativeText).toBe('/status')
    expect(harness[2]?.nativeText).toBe('/plan')
    expect(harness[2]?.description).toBe('create a plan')
  })

  it('marks harness commands disabled while the runtime is offline', () => {
    const commands = buildComposerSlashCommands({
      ...baseInput,
      runtimeReady: false,
      harnessCommands: {
        harnessLabel: 'Claude Code',
        commands: [{ name: 'review' }]
      }
    })
    expect(commands.find((command) => command.id === 'harness:review')?.disabled).toBe(true)
  })

  it('omits the section entirely when no harness commands are supplied', () => {
    const commands = buildComposerSlashCommands({ ...baseInput })
    expect(commands.some((command) => command.kind === 'harness')).toBe(false)
  })

  it('never emits harness commands on the claw route', () => {
    const commands = buildComposerSlashCommands({
      ...baseInput,
      route: 'claw',
      harnessCommands: {
        harnessLabel: 'Claude Code',
        commands: [{ name: 'review' }]
      }
    })
    expect(commands.some((command) => command.kind === 'harness')).toBe(false)
  })
})
