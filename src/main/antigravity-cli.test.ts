import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  antigravityCliAsset,
  antigravityCliBinaryName,
  fetchAntigravityModels,
  parseAntigravityModels
} from './antigravity-cli'

function fakeChildProcess(): {
  child: ChildProcess
  stdout: PassThrough
  stderr: PassThrough
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: () => true
  }) as unknown as ChildProcess
  return { child, stdout, stderr }
}

describe('Antigravity CLI integration', () => {
  it('maps supported release assets with pinned checksums', () => {
    expect(antigravityCliAsset('darwin', 'arm64')).toMatchObject({
      name: 'agy_cli_mac_arm64.tar.gz',
      archiveKind: 'tar.gz',
      binaryName: 'antigravity'
    })
    expect(antigravityCliAsset('win32', 'x64')?.sha256).toHaveLength(64)
    expect(antigravityCliAsset('aix', 'ppc64')).toBeUndefined()
    expect(antigravityCliBinaryName('win32')).toBe('agy.exe')
  })

  it('groups effort variants while retaining every account-visible model family', () => {
    expect(parseAntigravityModels([
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.6-flash-low',
      'gemini-3.5-flash-high',
      'gemini-3.5-flash-low',
      'gemini-3.1-pro-high',
      'gemini-3.1-pro-low',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
      ''
    ].join('\n'))).toEqual({
      models: [
        {
          id: 'gemini-3.6-flash',
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium'
        },
        {
          id: 'gemini-3.5-flash',
          supportedEfforts: ['low', 'high'],
          defaultEffort: 'high'
        },
        {
          id: 'gemini-3.1-pro',
          supportedEfforts: ['low', 'high'],
          defaultEffort: 'high'
        },
        {
          id: 'claude-sonnet-4-6',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        },
        {
          id: 'claude-opus-4-6-thinking',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        },
        {
          id: 'gpt-oss-120b',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        }
      ]
    })
  })

  it('parses model ids from display-name output across whitespace formats', () => {
    expect(parseAntigravityModels([
      'gemini-3.7-flash-high      Gemini 3.7 Flash (High)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-low       Gemini 3.7 Flash (Low)',
      `claude-sonnet-4-6          ${'Claude Sonnet 4.6 '.repeat(12)}`,
      'gpt-oss-120b-medium        GPT-OSS 120B (Medium)'
    ].join('\r\n'))).toEqual({
      models: [
        {
          id: 'gemini-3.7-flash',
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium'
        },
        {
          id: 'claude-sonnet-4-6',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        },
        {
          id: 'gpt-oss-120b',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        }
      ]
    })
  })

  it('ignores diagnostic text and malformed model ids', () => {
    expect(parseAntigravityModels([
      'Loading models...',
      'gemini-3.6-flash-medium',
      'not/a-model',
      'not-a-model?       Invalid display row',
      `model-${'x'.repeat(130)}`
    ].join('\n'))).toEqual({
      models: [{
        id: 'gemini-3.6-flash',
        supportedEfforts: ['medium'],
        defaultEffort: 'medium'
      }]
    })
  })

  it('resolves valid display-name output despite stderr progress', async () => {
    const { child, stdout, stderr } = fakeChildProcess()
    const result = fetchAntigravityModels({
      binaryPath: 'agy',
      spawnFn: (() => child) as never
    })
    stdout.write('gemini-3.7-flash-medium    Gemini 3.7 Flash (Medium)\r\n')
    stderr.write('Fetching available models...\r\n')
    child.emit('exit', 0, null)

    await expect(result).resolves.toEqual({
      models: [{
        id: 'gemini-3.7-flash',
        supportedEfforts: ['medium'],
        defaultEffort: 'medium'
      }]
    })
  })
})
