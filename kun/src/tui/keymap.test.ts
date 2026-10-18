import { describe, expect, it } from 'vitest'
import { parseKeypress } from '@opentui/core'
import { parseTuiKeymapConfig } from './keymap.js'
import type { TuiKeyEvent } from './keys.js'

const key = (sequence: string): TuiKeyEvent => {
  const parsed = parseKeypress(sequence, { useKittyKeyboard: true })
  if (!parsed) throw new Error(`unparsed key ${JSON.stringify(sequence)}`)
  return parsed
}

describe('TuiKeymap', () => {
  it('uses OpenCode-compatible navigation plus Kimi-aligned direct-action defaults', () => {
    const { keymap, warnings } = parseTuiKeymapConfig({})

    expect(warnings).toEqual([])
    expect(keymap.matchesLeader(key('\x18'))).toBe(true)
    expect(keymap.leaderAction(key('l'))).toBe('session_list')
    expect(keymap.matches('variant_cycle', key('\x14'))).toBe(true)
    expect(keymap.matches('tool_details_toggle', key('\x0f'))).toBe(true)
    expect(keymap.matches('subagent_detach', key('\x02'))).toBe(true)
    expect(keymap.matches('input_editor', key('\x07'))).toBe(true)
    expect(keymap.matches('input_steer', key('\x13'))).toBe(true)
    expect(keymap.matches('input_paste', key('\x16'))).toBe(true)
    expect(keymap.matches('input_paste', key('\x1bv'))).toBe(true)
    expect(keymap.matches('input_paste', key('\x1b[118;6u'))).toBe(true)
    expect(keymap.matches('input_paste', key('\x1b[118;9u'))).toBe(true)
    expect(keymap.leaderAction(key('v'))).toBe('input_paste')
    expect(keymap.leaderAction(key('p'))).toBe('pointer_mode_toggle')
    expect(keymap.leaderTimeoutMs).toBe(2_000)
  })

  it('expands a configured leader and supports arrays and comma alternatives', () => {
    const { keymap } = parseTuiKeymapConfig({
      leader_timeout: 750,
      keybinds: {
        leader: 'ctrl+g',
        session_list: '<leader>s',
        variant_cycle: ['ctrl+t', 'f3'],
        command_list: 'ctrl+p,f4'
      }
    })

    expect(keymap.matchesLeader(key('\x07'))).toBe(true)
    expect(keymap.leaderAction(key('s'))).toBe('session_list')
    expect(keymap.matches('variant_cycle', key('\x14'))).toBe(true)
    expect(keymap.matches('variant_cycle', key('\x1bOR'))).toBe(true)
    expect(keymap.matches('command_list', key('\x10'))).toBe(true)
    expect(keymap.leaderTimeoutMs).toBe(750)
  })

  it('allows bindings and the leader to be disabled', () => {
    const { keymap } = parseTuiKeymapConfig({
      keybinds: { leader: false, variant_cycle: 'none', command_list: false }
    })

    expect(keymap.matchesLeader(key('\x18'))).toBe(false)
    expect(keymap.leaderAction(key('l'))).toBeUndefined()
    expect(keymap.matches('variant_cycle', key('\x14'))).toBe(false)
    expect(keymap.matches('command_list', key('\x10'))).toBe(false)
  })

  it('accepts advanced bindings and reports invalid/unavailable configuration', () => {
    const { keymap, warnings } = parseTuiKeymapConfig({
      leader_timeout: 5,
      keybinds: {
        variant_cycle: { key: 'f4', event: 'press', preventDefault: false, fallthrough: true },
        session_list: 'not-a-key',
        sidebar_toggle: '<leader>b',
        made_up_action: 'ctrl+k'
      }
    })

    expect(keymap.matches('variant_cycle', key('\x1bOS'))).toBe(true)
    expect(keymap.match('variant_cycle', key('\x1bOS'))).toMatchObject({
      event: 'press', preventDefault: false, fallthrough: true
    })
    expect(keymap.matches('session_list', key('not-a-key'))).toBe(false)
    expect(warnings.join('\n')).toMatch(/leader_timeout/)
    expect(keymap.leaderAction(key('b'))).toBe('sidebar_toggle')
    expect(warnings.join('\n')).toMatch(/made_up_action.*ignored/)
  })
})
