import { describe, expect, it } from 'vitest'
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui'
import { parseTuiCommand, TUI_COMMAND_DEFINITIONS } from './commands.js'
import { TUI_SLASH_COMMANDS } from './pi-app.js'

describe('TUI slash commands', () => {
  it('parses lifecycle commands and leaves prompts alone', () => {
    expect(parseTuiCommand('hello')).toBeNull()
    expect(parseTuiCommand('/threads provider bug')).toEqual({ kind: 'threads', search: 'provider bug' })
    expect(parseTuiCommand('/new release work')).toEqual({ kind: 'new', title: 'release work' })
    expect(parseTuiCommand('/rename')).toEqual({ kind: 'command-usage', usage: '/rename <title>' })
    expect(parseTuiCommand('/quit')).toEqual({ kind: 'quit' })
  })

  it('normalizes compatibility aliases', () => {
    expect(parseTuiCommand('/sessions auth')).toEqual({ kind: 'threads', search: 'auth' })
    expect(parseTuiCommand('/resume')).toEqual({ kind: 'resume' })
    expect(parseTuiCommand('/continue')).toEqual({ kind: 'resume' })
    expect(parseTuiCommand('/clear')).toEqual({ kind: 'clear' })
    expect(parseTuiCommand('/title release')).toEqual({ kind: 'rename', title: 'release' })
    expect(parseTuiCommand('/models')).toEqual({ kind: 'model' })
    expect(parseTuiCommand('/provider')).toEqual({ kind: 'connect' })
    expect(parseTuiCommand('/provider usage')).toEqual({ kind: 'quota' })
    expect(parseTuiCommand('/provider quota')).toEqual({ kind: 'quota' })
    expect(parseTuiCommand('/usage')).toEqual({ kind: 'usage-report' })
    expect(parseTuiCommand('/quota')).toEqual({ kind: 'quota' })
    expect(parseTuiCommand('/summarize')).toEqual({ kind: 'compact' })
    expect(parseTuiCommand('/thinking')).toEqual({ kind: 'reasoning' })
    expect(parseTuiCommand('/mouse')).toEqual({ kind: 'mouse' })
    expect(parseTuiCommand('/mouse off')).toEqual({ kind: 'mouse', action: 'off' })
    expect(parseTuiCommand('/variants')).toEqual({ kind: 'variants' })
    expect(parseTuiCommand('/subagents')).toEqual({ kind: 'subagents' })
    expect(parseTuiCommand('/paste')).toEqual({ kind: 'paste' })
    expect(parseTuiCommand('/redo')).toEqual({ kind: 'redo' })
    expect(parseTuiCommand('/q')).toEqual({ kind: 'quit' })
  })

  it('parses the P0 and P1 command suite', () => {
    expect(parseTuiCommand('/export docs/thread.md')).toEqual({ kind: 'export', path: 'docs/thread.md' })
    expect(parseTuiCommand('/timeline failed tool')).toEqual({ kind: 'timeline', query: 'failed tool' })
    expect(parseTuiCommand('/jump 4')).toEqual({ kind: 'jump', target: '4' })
    expect(parseTuiCommand('/goal pause')).toEqual({ kind: 'goal', action: 'pause' })
    expect(parseTuiCommand('/graph')).toEqual({ kind: 'graph' })
    expect(parseTuiCommand('/graph status')).toEqual({ kind: 'graph', action: 'status' })
    expect(parseTuiCommand('/graph list')).toEqual({ kind: 'graph', action: 'list' })
    expect(parseTuiCommand('/graph off')).toEqual({ kind: 'graph', action: 'off' })
    expect(parseTuiCommand('/graph 实现 TUI Graph 看板')).toEqual({
      kind: 'graph',
      prompt: '实现 TUI Graph 看板'
    })
    expect(parseTuiCommand('/agent')).toEqual({ kind: 'agent' })
    expect(parseTuiCommand('/update')).toEqual({ kind: 'update', confirm: false })
    expect(parseTuiCommand('/update yes')).toEqual({ kind: 'update', confirm: true })
    expect(parseTuiCommand('/skill:pdf inspect this')).toEqual({ kind: 'skill', name: 'pdf', prompt: 'inspect this' })
    expect(parseTuiCommand('/editor draft prompt')).toEqual({ kind: 'editor', initial: 'draft prompt' })
    expect(parseTuiCommand('/add-dir')).toEqual({ kind: 'command-usage', usage: '/add-dir <path>' })
    expect(parseTuiCommand('/btw')).toEqual({ kind: 'command-usage', usage: '/btw <question>' })
    expect(parseTuiCommand('/queue')).toEqual({ kind: 'queue' })
  })

  it('offers canonical commands and compatibility aliases through pi-tui autocomplete', async () => {
    const names = TUI_SLASH_COMMANDS.map((command) => command.name)
    expect(names).toEqual(expect.arrayContaining([
      'sessions', 'resume', 'continue', 'clear', 'title', 'models', 'provider', 'usage', 'quota', 'summarize', 'q',
      'status', 'copy', 'export', 'details', 'permission', 'undo', 'init', 'mcp',
      'timeline', 'jump', 'subagents', 'tasks', 'plan', 'graph', 'agent', 'goal', 'skills', 'editor', 'add-dir',
      'btw', 'context', 'queue', 'variants', 'thinking', 'mouse', 'paste', 'redo'
    ]))
    const provider = new CombinedAutocompleteProvider(TUI_SLASH_COMMANDS, '/tmp', null)
    const suggestions = await provider.getSuggestions(['/pro'], 0, 4, { signal: new AbortController().signal })
    expect(suggestions?.items.map((item) => item.value)).toContain('provider')
  })

  it('keeps command-palette actions backed by canonical slash autocomplete entries', () => {
    const slashNames = new Set(TUI_SLASH_COMMANDS.map((command) => command.name))
    for (const definition of TUI_COMMAND_DEFINITIONS) {
      if (definition.slash) expect(slashNames.has(definition.slash), definition.id).toBe(true)
    }
    expect(new Set(TUI_COMMAND_DEFINITIONS.map((definition) => definition.id)).size).toBe(TUI_COMMAND_DEFINITIONS.length)
    expect(TUI_COMMAND_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'details', keyAction: 'tool_details_toggle' }),
      expect.objectContaining({ id: 'mouse', keyAction: 'pointer_mode_toggle' }),
      expect.objectContaining({ id: 'editor', keyAction: 'input_editor' }),
      expect.objectContaining({ id: 'steer', keyAction: 'input_steer' }),
      expect.objectContaining({ id: 'paste', keyAction: 'input_paste' })
    ]))
  })

  it('parses every slash autocomplete entry instead of exposing dead commands', () => {
    const requiredArguments: Record<string, string> = {
      open: 'session-id',
      rename: 'new title',
      title: 'new title',
      'add-dir': '/tmp/workspace',
      btw: 'what changed?'
    }
    for (const slash of TUI_SLASH_COMMANDS) {
      const command = parseTuiCommand(`/${slash.name}${requiredArguments[slash.name] ? ` ${requiredArguments[slash.name]}` : ''}`)
      expect(command, slash.name).not.toBeNull()
      expect(command?.kind, slash.name).not.toBe('unknown')
      expect(command?.kind, slash.name).not.toBe('command-usage')
    }
  })

  it('keeps every documented canonical action in the command palette', () => {
    const paletteSlashes = new Set(TUI_COMMAND_DEFINITIONS.flatMap((definition) => definition.slash ? [definition.slash] : []))
    expect(paletteSlashes).toEqual(new Set([
      'sessions', 'new', 'open', 'timeline', 'jump', 'rename', 'archive', 'archives', 'fork',
      'compact', 'export', 'status', 'copy', 'undo', 'redo', 'connect', 'model',
      'usage', 'quota',
      'variants', 'thinking', 'mouse', 'details', 'permission', 'plan', 'graph', 'agent', 'subagents', 'tasks', 'goal',
      'attach', 'paste', 'memory', 'shells', 'extensions', 'queue', 'skills', 'mcp', 'init', 'import', 'editor', 'add-dir', 'btw', 'context',
      'capabilities', 'theme', 'share', 'unshare', 'console', 'diff', 'terminal', 'update', 'help', 'quit'
    ]))
  })
})
