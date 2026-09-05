import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendUpdateHealthProgress,
  updateHealthDiagnosticBasePath,
  writeUpdateHealthBootstrapFailure
} from './update-health-bootstrap'

describe('update health bootstrap failure', () => {
  it('writes a standard failure result and redacts the token', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-health-bootstrap-'))
    const resultPath = join(root, 'health.json')

    writeUpdateHealthBootstrapFailure({
      argv: [
        'Kun.exe',
        `--kun-update-health-check="${resultPath}" ` +
          '--kun-update-health-token="secret-token" ' +
          '--kun-update-target="C:\\Program Files\\Kun"'
      ],
      error: new Error('chunk load failed'),
      executablePath: 'C:\\Program Files\\Kun\\Kun.exe',
      resultPath,
      target: 'C:\\Program Files\\Kun',
      token: 'secret-token',
      version: '0.3.9'
    })

    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>
    expect(result).toMatchObject({
      ok: false,
      token: 'secret-token',
      installDir: 'C:\\Program Files\\Kun',
      version: '0.3.9'
    })
    expect(result.message).toContain('chunk load failed')
    expect(result.message).toContain('--kun-update-health-token=<redacted>')
    expect(result.message).not.toContain('secret-token')
    const progress = readFileSync(`${updateHealthDiagnosticBasePath(resultPath)}.progress.jsonl`, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(progress.at(-1)).toMatchObject({ phase: 'failed' })
    expect(JSON.stringify(progress)).not.toContain('secret-token')
  })

  it('keeps a precise terminal result written by the probe', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-health-bootstrap-existing-'))
    const resultPath = join(root, 'health.json')
    writeFileSync(resultPath, '{"ok":false,"message":"runtime exited"}\n', 'utf8')

    writeUpdateHealthBootstrapFailure({
      argv: ['Kun.exe'],
      error: new Error('outer rejection'),
      executablePath: 'C:\\Program Files\\Kun\\Kun.exe',
      resultPath,
      target: 'C:\\Program Files\\Kun',
      token: 'secret-token',
      version: '0.3.9'
    })

    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      ok: false,
      message: 'runtime exited'
    })
  })

  it('records append-only progress separately from the terminal result', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-health-progress-'))
    const resultPath = join(root, 'health.json')
    const startedAt = '2026-09-01T00:00:00.000Z'

    appendUpdateHealthProgress({
      resultPath,
      target: 'C:\\Program Files\\Kun',
      startedAt,
      phase: 'bootstrap'
    })
    appendUpdateHealthProgress({
      resultPath,
      target: 'C:\\Program Files\\Kun',
      startedAt,
      phase: 'runtime_waiting',
      detail: { port: 19001, runtimePid: 321 }
    })

    expect(readFileSync(`${updateHealthDiagnosticBasePath(resultPath)}.progress.jsonl`, 'utf8'))
      .toContain('"phase":"runtime_waiting"')
    expect(readFileSync(`${updateHealthDiagnosticBasePath(resultPath)}.progress.jsonl`, 'utf8'))
      .toContain('"runtimePid":321')
  })
})
