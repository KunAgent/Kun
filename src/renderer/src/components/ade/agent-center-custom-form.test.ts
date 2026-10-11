import { describe, expect, it } from 'vitest'
import {
  customAgentId,
  exportCustomEntryJson,
  parseCustomEntryJson,
  parseEnvLines
} from './agent-center-custom-form'

describe('customAgentId', () => {
  it('slugs display names under the custom- prefix', () => {
    expect(customAgentId('My Agent')).toBe('custom-my-agent')
    expect(customAgentId('  Weird   Name!! ')).toBe('custom-weird-name')
    expect(customAgentId('---')).toBe('custom-agent')
  })
})

describe('parseEnvLines', () => {
  it('parses KEY=value lines and skips blanks', () => {
    expect(parseEnvLines('A=1\n\nB=2\n')).toEqual({ A: '1', B: '2' })
    expect(parseEnvLines('')).toEqual({})
  })

  it('returns null on a malformed line', () => {
    expect(parseEnvLines('A=1\nnot-an-env')).toBeNull()
    expect(parseEnvLines('=novalue')).toBeNull()
  })
})

describe('parseCustomEntryJson', () => {
  it('parses a full exported definition', () => {
    const entry = parseCustomEntryJson(
      JSON.stringify({
        id: 'custom-x',
        displayName: 'X Agent',
        command: '/bin/x',
        args: ['--acp', '--verbose'],
        env: { LOG_LEVEL: 'debug' },
        secretEnv: [{ name: 'X_API_KEY', secretRef: 'cred_1' }]
      })
    )
    expect(entry).toEqual({
      id: 'custom-x',
      displayName: 'X Agent',
      command: '/bin/x',
      args: ['--acp', '--verbose'],
      env: { LOG_LEVEL: 'debug' },
      secretEnv: [{ name: 'X_API_KEY', secretRef: 'cred_1' }]
    })
  })

  it('round-trips through exportCustomEntryJson', () => {
    const original = {
      id: 'custom-y',
      displayName: 'Y',
      command: '/bin/y',
      args: ['-a'],
      env: { A: '1' },
      secretEnv: [{ name: 'Y_KEY', secretRef: 'cred_9' }]
    }
    expect(parseCustomEntryJson(exportCustomEntryJson(original))).toEqual(original)
  })

  it('drops malformed secretEnv rows but keeps the entry', () => {
    const entry = parseCustomEntryJson(
      JSON.stringify({
        displayName: 'X',
        command: '/bin/x',
        secretEnv: [
          { name: 'OK_KEY', secretRef: 'cred_1' },
          { name: 'lowercase', secretRef: 'cred_2' },
          { name: 'NO_REF' },
          'garbage'
        ]
      })
    )
    expect(entry?.secretEnv).toEqual([{ name: 'OK_KEY', secretRef: 'cred_1' }])
  })

  it('rejects missing name/command and non-JSON input', () => {
    expect(parseCustomEntryJson('not json')).toBeNull()
    expect(parseCustomEntryJson('{"displayName":"x"}')).toBeNull()
    expect(parseCustomEntryJson('{"command":"/bin/x"}')).toBeNull()
    expect(parseCustomEntryJson('[{"displayName":"x","command":"/bin/x"}]')).toBeNull()
    expect(parseCustomEntryJson('{"displayName":" ","command":"/bin/x"}')).toBeNull()
  })

  it('regenerates a missing id from the display name', () => {
    const entry = parseCustomEntryJson(
      JSON.stringify({ displayName: 'Imported Agent', command: '/bin/i' })
    )
    expect(entry?.id).toBe('custom-imported-agent')
  })

  it('filters non-string args and invalid env keys instead of rejecting', () => {
    const entry = parseCustomEntryJson(
      JSON.stringify({
        displayName: 'X',
        command: '/bin/x',
        args: ['-a', 3, '--ok'],
        env: { GOOD: '1', lowercase: 'drop-me', NUM: 2 }
      })
    )
    expect(entry?.args).toEqual(['-a', '--ok'])
    expect(entry?.env).toEqual({ GOOD: '1' })
  })
})

describe('exportCustomEntryJson', () => {
  it('emits refs, never resolved values', () => {
    const json = exportCustomEntryJson({
      id: 'custom-x',
      displayName: 'X',
      command: '/bin/x',
      args: [],
      env: {},
      secretEnv: [{ name: 'X_KEY', secretRef: 'cred_42' }]
    })
    expect(json).toContain('cred_42')
    expect(JSON.parse(json)).toMatchObject({
      secretEnv: [{ name: 'X_KEY', secretRef: 'cred_42' }]
    })
  })
})
