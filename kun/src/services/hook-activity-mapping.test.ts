import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapHookEvent, trimHookPayload } from './hook-activity-mapping.js'

/**
 * Fixture-driven mapping tests (05 §6.3, impl p2 P2-03): each recorded
 * Claude Code hook payload is trimmed to the ingest fields, then mapped.
 */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../harness/__fixtures__/hooks/claude-code-2.1'
)

async function rawFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'))
}

async function mapFixture(
  name: string,
  event: string,
  inferredInterrupt = false
) {
  const payload = trimHookPayload(await rawFixture(name), event)
  return { payload, mapping: mapHookEvent('claude-settings', payload, { inferredInterrupt }) }
}

describe('hook payload trimming', () => {
  it('keeps only event, sessionId, toolName, timestamp — never paths or tool input', async () => {
    const { payload } = await mapFixture('pre-tool-use.json', 'PreToolUse')
    expect(payload).toEqual({
      event: 'PreToolUse',
      sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      toolName: 'Edit',
      timestamp: undefined
    })
  })
})

describe('claude-settings event mapping', () => {
  it('SessionStart goes idle and records the native session id', async () => {
    const { mapping } = await mapFixture('session-start.json', 'SessionStart')
    expect(mapping?.patch.mainState).toBe('idle')
    expect(mapping?.nativeSessionId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479')
  })

  it('UserPromptSubmit goes working', async () => {
    const { mapping } = await mapFixture('user-prompt-submit.json', 'UserPromptSubmit')
    expect(mapping?.patch.mainState).toBe('working')
  })

  it('PreToolUse and PostToolUse update currentTool', async () => {
    const pre = await mapFixture('pre-tool-use.json', 'PreToolUse')
    expect(pre.mapping?.patch).toMatchObject({ mainState: 'working', currentTool: 'Edit' })
    const post = await mapFixture('post-tool-use.json', 'PostToolUse')
    expect(post.mapping?.patch).toMatchObject({ mainState: 'working', currentTool: 'Bash' })
  })

  it('permission notifications wait on the terminal', async () => {
    for (const [file, event] of [
      ['permission-request.json', 'PermissionRequest'],
      ['notification.json', 'Notification']
    ] as const) {
      const { mapping } = await mapFixture(file, event)
      expect(mapping?.patch).toMatchObject({ mainState: 'waiting', waitingReason: 'terminal_prompt' })
    }
  })

  it('Stop completes the turn; an interrupt hint flips it to cancelled', async () => {
    const normal = await mapFixture('stop.json', 'Stop')
    expect(normal.mapping?.patch).toMatchObject({ mainState: 'done', lastOutcome: 'completed' })
    const interrupted = await mapFixture('stop.json', 'Stop', true)
    expect(interrupted.mapping?.patch).toMatchObject({ mainState: 'done', lastOutcome: 'cancelled' })
  })

  it('PreCompact marks the compacting phase and SessionEnd closes the row', async () => {
    const compact = await mapFixture('pre-compact.json', 'PreCompact')
    expect(compact.mapping?.patch).toMatchObject({ mainState: 'working', phase: 'compacting' })
    const end = await mapFixture('session-end.json', 'SessionEnd')
    expect(end.mapping?.patch.mainState).toBe('closed')
  })

  it('ignores subagent bookkeeping and unknown events/kinds', async () => {
    expect((await mapFixture('subagent-stop.json', 'SubagentStop')).mapping).toBeNull()
    expect((await mapFixture('stop.json', 'MysteryEvent')).mapping).toBeNull()
    const payload = trimHookPayload(await rawFixture('stop.json'), 'Stop')
    expect(mapHookEvent('unknown-kind', payload)).toBeNull()
    expect(mapHookEvent(undefined, payload)).toBeNull()
  })
})
