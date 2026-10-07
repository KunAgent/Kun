import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { adaptAntigravityModelSelectionArgs } from './antigravity-model-selection.js'
import { runAntigravityProcess } from './antigravity-process.js'
import { antigravityTestOutput } from './antigravity-test-output.js'

// Messages captured from agy 1.3.1.
const noMedium =
  'invalid model selection (--model "gemini-3.1-pro" --effort "medium"): gemini-3.1-pro has no "medium" effort (available: low, high)'
const notSupported =
  'invalid model selection (--model "claude-sonnet-4-6" --effort "medium"): --effort is not supported for model "claude-sonnet-4-6"'
const onlyMedium =
  'invalid model selection (--model "gpt-oss-120b" --effort "high"): gpt-oss-120b has no "high" effort (available: medium)'
const requires =
  'invalid model selection (--model "gemini-3.6-flash" --effort ""): --model gemini-3.6-flash requires --effort (available: low, medium, high)'
const unknownModel =
  'invalid model selection (--model "gemini-3.5-flash" --effort ""): model gemini-3.5-flash is not recognized as a known model or custom model in settings\nAvailable models:\n  Gemini 3.8 Flash (High)'

const base = ['--print', 'hi', '--output-format', 'json', '--model', 'gemini-3.1-pro', '--effort', 'medium', '--print-timeout', '60s']

describe('adaptAntigravityModelSelectionArgs', () => {
  it('moves an unsupported tier to the nearest offered one, preferring the stronger on a tie', () => {
    expect(adaptAntigravityModelSelectionArgs(base, noMedium)).toEqual(
      ['--print', 'hi', '--output-format', 'json', '--model', 'gemini-3.1-pro', '--effort', 'high', '--print-timeout', '60s'])
    const low = [...base]
    low[low.indexOf('--effort') + 1] = 'low'
    expect(adaptAntigravityModelSelectionArgs(low, onlyMedium)).toEqual(
      low.map((value) => value === 'low' ? 'medium' : value))
  })

  it('drops --effort for models that take none', () => {
    expect(adaptAntigravityModelSelectionArgs(base, notSupported)).toEqual(
      ['--print', 'hi', '--output-format', 'json', '--model', 'gemini-3.1-pro', '--print-timeout', '60s'])
  })

  it('adds the missing tier when none was passed', () => {
    const without = ['--print', 'hi', '--model', 'gemini-3.6-flash']
    expect(adaptAntigravityModelSelectionArgs(without, requires)).toEqual([...without, '--effort', 'medium'])
  })

  it('leaves unrelated failures and no-op repairs alone', () => {
    expect(adaptAntigravityModelSelectionArgs(base, unknownModel)).toBeUndefined()
    expect(adaptAntigravityModelSelectionArgs(base, 'network unreachable')).toBeUndefined()
    expect(adaptAntigravityModelSelectionArgs(['--print', 'hi'], notSupported)).toBeUndefined()
    const high = [...base]
    high[high.indexOf('--effort') + 1] = 'high'
    expect(adaptAntigravityModelSelectionArgs(high, noMedium)).toBeUndefined()
  })
})

function scriptedSpawn(outcomes: Array<{ stderr: string; code: number } | { stdout: string }>, seen: string[][]): typeof spawn {
  let call = 0
  return ((_command: string, args: readonly string[]) => {
    seen.push([...args])
    const outcome = outcomes[call++]!
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      if ('stderr' in outcome) {
        child.stderr.write(outcome.stderr)
      } else {
        for (const chunk of antigravityTestOutput(outcome.stdout)) child.stdout.write(chunk)
      }
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', 'stderr' in outcome ? outcome.code : 0, null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
}

const run = (spawnFn: typeof spawn, args: string[]) => runAntigravityProcess({
  binaryPath: 'agy', args, cwd: '/tmp', signal: new AbortController().signal, timeoutMs: 5_000, spawnFn
})

describe('runAntigravityProcess model-selection repair', () => {
  it('resends once with the repaired effort after agy rejects the pairing', async () => {
    const seen: string[][] = []
    const output = await run(scriptedSpawn([{ stderr: `error: ${noMedium}\n`, code: 1 }, { stdout: 'pong' }], seen), base)
    expect(output).toContain('pong')
    expect(seen).toHaveLength(2)
    expect(seen[1]![seen[1]!.indexOf('--effort') + 1]).toBe('high')
  })

  it('does not loop when the repaired call is rejected again', async () => {
    const seen: string[][] = []
    const spawnFn = scriptedSpawn([
      { stderr: `error: ${noMedium}\n`, code: 1 },
      { stderr: `error: ${onlyMedium}\n`, code: 1 }
    ], seen)
    await expect(run(spawnFn, base)).rejects.toThrow(/has no "high" effort/)
    expect(seen).toHaveLength(2)
  })

  it('does not resend after an unrelated failure', async () => {
    const seen: string[][] = []
    const spawnFn = vi.fn(scriptedSpawn([{ stderr: 'error: quota exhausted\n', code: 1 }], seen))
    await expect(run(spawnFn as unknown as typeof spawn, base)).rejects.toThrow('quota exhausted')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })
})
