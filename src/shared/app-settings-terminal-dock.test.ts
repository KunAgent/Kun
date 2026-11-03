import { describe, expect, it } from 'vitest'
import {
  normalizeTerminalAppearance,
  normalizeTerminalBehavior,
  normalizeTerminalProfiles,
  profileCommandLine,
  profileTakesTask,
  quoteShellWord,
  resolveProfileArgv,
  splitProfileArgs
} from './app-settings-terminal-dock'
import { mergeTerminalSettings, normalizeTerminalSettings, resolveTerminalTheme, TERMINAL_PRESET_CONTRAST } from './app-settings-terminal'

describe('terminal dock settings', () => {
  it('clamps appearance and rejects unsafe font lists', () => {
    expect(normalizeTerminalAppearance({ fontSize: 99, lineHeight: 0.2, cursorStyle: 'beam' as never, fontFamily: 'Fira Code; color: red' })).toEqual({
      fontFamily: '', fontSize: 24, lineHeight: 1, cursorStyle: 'block', cursorBlink: true
    })
    expect(normalizeTerminalAppearance({ fontFamily: ' "JetBrains Mono", monospace ', lineHeight: 1.47 }).lineHeight).toBe(1.45)
  })

  it('keeps only absolute shell paths and rounds scrollback', () => {
    const behavior = normalizeTerminalBehavior({ shell: 'zsh', scrollback: 12_345, confirmClose: false })
    expect(behavior.shell).toBe('')
    expect(behavior.scrollback).toBe(12_300)
    expect(behavior.confirmClose).toBe(false)
    expect(normalizeTerminalBehavior({ shell: '/bin/bash' }).shell).toBe('/bin/bash')
  })

  it('drops invalid and duplicate profiles and bad env keys', () => {
    const profiles = normalizeTerminalProfiles([
      { id: 'a', name: 'A', command: 'claude', args: '', icon: 'claude-code', cwd: 'relative', env: [{ key: 'GOOD', value: '1' }, { key: '1BAD', value: 'x' }, { key: 'GOOD', value: '2' }] },
      { id: 'a', name: 'Dup', command: 'x', args: '', icon: 'terminal', cwd: '', env: [] },
      { id: '', name: 'No id', command: 'x', args: '', icon: 'terminal', cwd: '', env: [] },
      { id: 'b', name: 'B', command: 'two\nlines', args: '', icon: 'terminal', cwd: '', env: [] }
    ])
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ id: 'a', cwd: '', env: [{ key: 'GOOD', value: '1' }] })
  })

  it('splits arguments like a shell, without expansion', () => {
    expect(splitProfileArgs(`--a 'b c' "d \\"e\\"" f\\ g $HOME`)).toEqual(['--a', 'b c', 'd "e"', 'f g', '$HOME'])
    expect(splitProfileArgs('  ')).toEqual([])
    expect(splitProfileArgs("''")).toEqual([''])
  })

  it('substitutes the task and drops placeholder-only arguments when empty', () => {
    const profile = { command: 'opencode', args: '--model x --prompt={task} {任务}' }
    expect(profileTakesTask(profile)).toBe(true)
    expect(resolveProfileArgv(profile, 'fix it')).toEqual(['opencode', '--model', 'x', '--prompt=fix it', 'fix it'])
    expect(resolveProfileArgv(profile, '  ')).toEqual(['opencode', '--model', 'x'])
    expect(profileTakesTask({ command: 'kun', args: '' })).toBe(false)
  })

  it('quotes the command line for the shell', () => {
    expect(quoteShellWord("it's")).toBe(`'it'\\''s'`)
    expect(quoteShellWord('plain-word_1.2')).toBe('plain-word_1.2')
    expect(profileCommandLine({ command: 'claude', args: '{task}', env: [{ key: 'A', value: 'b c' }] }, 'fix the bug')).toBe(`A='b c' claude 'fix the bug'`)
  })

  it('merges partial patches and keeps arrays unless replaced', () => {
    const base = normalizeTerminalSettings({ hiddenAgentIds: ['codex'] })
    const merged = mergeTerminalSettings(base, { behavior: { copyOnSelect: true }, appearance: { fontSize: 15 } })
    expect(merged.behavior.copyOnSelect).toBe(true)
    expect(merged.behavior.confirmClose).toBe(true)
    expect(merged.appearance.fontSize).toBe(15)
    expect(merged.hiddenAgentIds).toEqual(['codex'])
    expect(mergeTerminalSettings(merged, { hiddenAgentIds: [] }).hiddenAgentIds).toEqual([])
  })

  it('resolves the high-contrast palette regardless of theme', () => {
    const settings = normalizeTerminalSettings({ colors: { colorMode: 'contrast' } })
    const theme = resolveTerminalTheme(settings.colors, 'light', 'rgb(255, 255, 255)')
    expect(theme.background).toBe(TERMINAL_PRESET_CONTRAST.background)
    expect(theme.red).toBe(TERMINAL_PRESET_CONTRAST.red)
  })
})
