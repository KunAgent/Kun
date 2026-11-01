import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startupFailurePresentation } from './startup-failure-content'
import { readStartupLogTail, referencedStartupLogFile, startupLogSource } from './startup-failure-log'
import { startupFailureHtml } from './startup-failure-page'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kun-startup-page-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('startup failure page', () => {
  it('explains a Manager that exited before readiness in plain language', () => {
    const presentation = startupFailurePresentation(new Error('Owned Manager exited before readiness; inspect /x/manager.log'))
    expect(presentation.kind).toBe('manager-exited')
    const html = startupFailureHtml(presentation.message, '/tmp/logs', { kind: presentation.kind })
    expect(html).toContain('background service stopped while starting')
    expect(html).toContain('Retry Kun')
    expect(html).toContain('kun-startup-action:copy-diagnostics')
  })

  it('renders Chinese copy for a zh locale', () => {
    const html = startupFailureHtml('boom', '/tmp/logs', { kind: 'manager-exited', locale: 'zh-CN' })
    expect(html).toContain('lang="zh-CN"')
    expect(html).toContain('Kun 后台服务在启动时退出了')
    expect(html).toContain('复制诊断信息')
    expect(html).toContain('>重试<')
  })

  it('shows a spinner and the auto-restart hint instead of the retry action while busy', () => {
    const html = startupFailureHtml('boom', '/tmp/logs', { busy: true })
    expect(html).not.toContain('kun-startup-action:retry')
    expect(html).toContain('class="spinner"')
    expect(html).toContain('restarts automatically')
  })

  it('distinguishes an empty log from a missing one', () => {
    expect(startupFailureHtml('boom', '/tmp/logs', { logTail: { path: '/x/manager.log', lines: [] } }))
      .toContain('The log file is empty')
    expect(startupFailureHtml('boom', '/tmp/logs', { logTail: null })).toContain('No log file was found.')
    expect(startupFailureHtml('boom', '/tmp/logs')).not.toContain('Latest log lines')
  })
})

describe('startup failure log tail', () => {
  it('finds the log path named by the diagnostic message', () => {
    expect(referencedStartupLogFile('inspect /private/var/T/home/.kun/control/manager.log')).toBe('/private/var/T/home/.kun/control/manager.log')
    expect(referencedStartupLogFile('inspect C:\\Users\\me\\.kun\\control\\manager.log')).toBe('C:\\Users\\me\\.kun\\control\\manager.log')
    expect(referencedStartupLogFile('no log here')).toBeUndefined()
  })

  it('falls back to the newest desktop log and returns its sanitized tail', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'kun-2026-10-28.log'), 'old\n')
    writeFileSync(join(dir, 'kun-2026-10-29.log'), `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\nmanagerToken=secret\n`)
    const source = startupLogSource('plain failure', dir)
    expect(source).toEqual({ path: join(dir, 'kun-2026-10-29.log'), referenced: false })
    const tail = readStartupLogTail(source!.path)
    expect(tail?.lines).toHaveLength(30)
    expect(tail?.lines.at(-1)).toBe('managerToken=[redacted]')
    expect(readStartupLogTail(join(dir, 'missing.log'))).toBeNull()
  })
})
