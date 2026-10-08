import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  explainOpenCodeServiceFailure, openCodeIsolationEnv, openCodeLogEvidence, summarizeOpenCodeLogLine
} from './opencode-service-failure.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-opencode-log-')); dirs.push(dir); return dir
}
const now = Date.parse('2026-10-08T12:09:56.000Z')
const stamp = '2026-10-08T12:09:57.053Z'

describe('OpenCode log summaries', () => {
  it('keeps OpenCode2 warnings, errors and failed HTTP calls since the probe started', () => {
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=WARN run=0dd2fa6f message="failed to load plugin" target=oh-my-openagent cause="Cause([Fail(SchemaError(Missing key\\n  at [\\"default\\"]))])" http.span=400 role=server`, now))
      .toBe('WARN failed to load plugin oh-my-openagent: Cause([Fail(SchemaError(Missing key   at ["default"]))])')
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=INFO run=0dd2fa6f message="Sent HTTP response" http.span=5156 role=server http.method=GET http.url=/api/model http.status=503`, now))
      .toBe('GET /api/model -> 503')
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=ERROR run=0dd2fa6f message="database open failed" error="SQLITE_BUSY"`, now))
      .toBe('ERROR database open failed: SQLITE_BUSY')
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=INFO run=0dd2fa6f message="cli starting"`, now)).toBeUndefined()
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=INFO message="Sent HTTP response" http.method=GET http.url=/api/model http.status=200`, now)).toBeUndefined()
    expect(summarizeOpenCodeLogLine(`timestamp=2026-10-08T11:00:00.000Z level=WARN message="failed to load plugin" target=stale`, now)).toBeUndefined()
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=WARN message="configuration normalization diagnostic" path=$.provider`, now)).toBeUndefined()
    expect(summarizeOpenCodeLogLine(`timestamp=${stamp} level=WARN message="duplicate skill name" name=find-skills`, now)).toBeUndefined()
  })
  it('keeps OpenCode 1 error lines and clips long ones', () => {
    expect(summarizeOpenCodeLogLine('ERROR 2026-10-08T03:13:06 +4ms service=db path=/x/opencode.db Database is not empty and has no session table', 0))
      .toBe('ERROR service=db path=/x/opencode.db Database is not empty and has no session table')
    expect(summarizeOpenCodeLogLine('INFO  2026-10-08T03:13:06 +6ms service=config path=/x/opencode.json loading', 0)).toBeUndefined()
    expect(summarizeOpenCodeLogLine(`WARN  2026-10-08T03:13:06 +6ms ${'x'.repeat(300)}`, 0)).toHaveLength(163)
  })
})

describe('OpenCode log evidence', () => {
  it('reads the newest recent log of the first app directory that has one, last four findings only', async () => {
    const data = await scratch()
    const log = join(data, 'opencode', 'log')
    await mkdir(log, { recursive: true })
    const recent = Date.now()
    const lines = Array.from({ length: 6 }, (_, index) =>
      `timestamp=${new Date(recent + index).toISOString()} level=WARN message="failed to load plugin" target=plugin-${index}`)
    await writeFile(join(log, 'opencode.log'), [`timestamp=${new Date(recent).toISOString()} level=INFO message="cli starting"`, ...lines].join('\n') + '\n')
    await writeFile(join(log, '2026-10-01T000000.log'), 'ERROR 2026-10-01T00:00:00 +1ms stale run\n')
    await utimes(join(log, '2026-10-01T000000.log'), new Date(recent - 86_400_000), new Date(recent - 86_400_000))
    const evidence = openCodeLogEvidence({ env: { XDG_DATA_HOME: data, HOME: data }, apps: ['codemaker', 'opencode'], sinceMs: recent })
    expect(evidence).toEqual({ file: join(log, 'opencode.log'), lines: [2, 3, 4, 5].map((index) => `WARN failed to load plugin plugin-${index}`) })
    expect(openCodeLogEvidence({ env: { XDG_DATA_HOME: data, HOME: data }, apps: ['codemaker'], sinceMs: recent })).toBeUndefined()
  })
})

describe('OpenCode clean-configuration retry', () => {
  it('points every configuration source at an empty directory only for the hidden failure', async () => {
    const dir = await scratch()
    expect(openCodeIsolationEnv({ dir, message: 'session/new failed: session unavailable' })).toBeUndefined()
    const env = openCodeIsolationEnv({ dir, message: 'session/new failed: Internal error: Internal service failure' })
    expect(env).toEqual({ XDG_CONFIG_HOME: dir, OPENCODE_CONFIG_DIR: dir, OPENCODE_CONFIG: join(dir, 'opencode.json'), OPENCODE_CONFIG_CONTENT: '{}' })
    expect(JSON.parse(await readFile(join(dir, 'opencode.json'), 'utf8'))).toEqual({})
  })
  it('explains the opaque failure with the retry verdict, the log and a next step', async () => {
    const data = await scratch()
    const engine = { displayName: 'OpenCode2', command: 'opencode2', apps: ['opencode'] as const }
    expect(explainOpenCodeServiceFailure(engine, 'session/new failed: session unavailable', undefined)).toBeUndefined()
    const context = { stage: 'session/new' as const, startedAtMs: Date.now(), env: { XDG_DATA_HOME: data, HOME: data } }
    expect(explainOpenCodeServiceFailure(engine, 'session/new failed: Internal error: Internal service failure', { ...context, isolated: 'passes' }))
      .toEqual({ authRequired: false, detail: 'OpenCode2 failed inside its own service during session/new and hid the cause ("Internal service failure"). ' +
        'It works with a clean configuration, so a setting or plugin in its opencode.json (global config directory, OPENCODE_CONFIG, ~/.opencode or a project .opencode directory) breaks it. ' +
        `Its log directory ${join(data, 'opencode', 'log')} has no error for this run. ` +
        'Run `opencode2` in a terminal inside any project to see the real error, then check again.' })
    expect(explainOpenCodeServiceFailure(engine, 'initialize failed: Internal error: Internal service failure', { ...context, stage: 'initialize', isolated: 'fails' })?.detail)
      .toContain(`It fails even with a clean configuration: check its network or proxy access (it loads its model catalog online), its database under ${join(data, 'opencode')}, or reinstall it.`)
    expect(explainOpenCodeServiceFailure(engine, 'session/new failed: Internal error: Internal service failure', context)?.detail)
      .not.toContain('clean configuration')
  })
})
