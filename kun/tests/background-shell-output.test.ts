import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BACKGROUND_SHELL_OUTPUT_SUBDIR,
  BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE,
  BackgroundShellOutputWriter,
  DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS,
  isBackgroundShellOutputPath,
  readBackgroundShellOutputSummary,
  resolveBackgroundShellOutputPaths,
  summarizeBackgroundShellOutput
} from '../src/services/background-shell-output.js'

describe('background-shell-output', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  it('stores all session logs under one thread-scoped folder', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kun-bg-shell-output-'))
    const first = resolveBackgroundShellOutputPaths(tempDir, 'thr_1', 'aaaa1111')
    const second = resolveBackgroundShellOutputPaths(tempDir, 'thr_1', 'bbbb2222')
    expect(first.outputDir).toBe(second.outputDir)
    expect(first.outputDir).toContain(`${BACKGROUND_SHELL_OUTPUT_SUBDIR}`)
    expect(first.outputFilePath.endsWith('aaaa1111.output')).toBe(true)
    expect(second.outputFilePath.endsWith('bbbb2222.output')).toBe(true)
    expect(resolve(first.outputFilePath)).toBe(first.outputFilePath)
  })

  it('appends a truncation notice to summarized output', () => {
    const full = 'x'.repeat(DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS + 50)
    const summary = summarizeBackgroundShellOutput(full)
    expect(summary.truncated).toBe(true)
    expect(summary.summary.endsWith(BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE)).toBe(true)
    expect([...summary.summary].length).toBeLessThanOrEqual(DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS)
  })

  it('always creates an output file and summarizes from disk', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kun-bg-shell-output-'))
    const writer = new BackgroundShellOutputWriter(tempDir, 'thr_1', 'sess1234')
    await writer.open()
    writer.append('hello\n')
    writer.append('x'.repeat(DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS + 50))
    const live = await writer.buildReturnFields()
    expect(live.output_file).toContain('sess1234.output')
    expect(live.truncated).toBe(true)
    expect(live.summary).toContain(BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE)
    await writer.close()
    const persisted = await readFile(live.output_file, 'utf-8')
    expect(persisted.startsWith('hello\n')).toBe(true)
    const summary = await readBackgroundShellOutputSummary(live.output_file)
    expect(summary.truncated).toBe(true)
  })

  it('creates an empty output file even when no bytes were written', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kun-bg-shell-output-'))
    const writer = new BackgroundShellOutputWriter(tempDir, 'thr_1', 'empty01')
    await writer.open()
    await writer.close()
    const fields = await writer.buildReturnFields()
    expect(await readFile(fields.output_file, 'utf-8')).toBe('')
    expect(summarizeBackgroundShellOutput('').truncated).toBe(false)
  })

  it('recognizes background shell output paths for sandbox read bypass', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kun-bg-shell-output-'))
    const { outputFilePath } = resolveBackgroundShellOutputPaths(tempDir, 'thr_1', 'sess1234')
    expect(
      isBackgroundShellOutputPath(outputFilePath, { runtimeDataDir: tempDir, threadId: 'thr_1' })
    ).toBe(true)
    expect(isBackgroundShellOutputPath('/tmp/other.log', { runtimeDataDir: tempDir, threadId: 'thr_1' })).toBe(
      false
    )
  })
})
