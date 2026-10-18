import { afterEach, describe, expect, it } from 'vitest'
import { key, keys } from '../keys.test-support.js'
import { fixtureItems as item } from '../transcript-fixtures.test-support.js'
import { sessionThread, startSessionHarness } from './chat-session.test-support.js'

const harnesses: Array<Awaited<ReturnType<typeof startSessionHarness>>> = []

async function harness(options: Parameters<typeof startSessionHarness>[0] = {}) {
  const value = await startSessionHarness(options)
  harnesses.push(value)
  return value
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for session state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((value) => value.session.stop().catch(() => undefined)))
})

describe('ChatSession', () => {
  it('asks for a second Ctrl+C before quitting, and clears a draft first', async () => {
    const { session, composer, running } = await harness()
    composer.setText('draft')
    expect(session.handleKey(keys.ctrlC)).toBe(true)
    expect(composer.text).toBe('')
    session.handleKey(keys.ctrlC)
    expect(session.transientHint).toBe('Press Ctrl+C again to exit')
    session.handleKey(keys.ctrlC)
    await expect(running).resolves.toBeUndefined()
  })

  it('cancels a pending exit when a different key arrives', async () => {
    const { session } = await harness()
    session.handleKey(keys.ctrlC)
    session.handleKey(key('a'))
    expect(session.transientHint).toBeUndefined()
  })

  it('recalls submitted prompts with Up and restores the draft with Down', async () => {
    const { session, composer, controller } = await harness()
    composer.setText('first prompt')
    await session.submitComposer()
    await waitFor(() => Boolean(controller.state.projection))
    expect(composer.text).toBe('')
    composer.setText('unsent')
    expect(session.handleKey(keys.up)).toBe(true)
    expect(composer.text).toBe('first prompt')
    expect(session.handleKey(keys.down)).toBe(true)
    expect(composer.text).toBe('unsent')
  })

  it('completes slash commands from the composer and submits them on Enter', async () => {
    const { session, composer } = await harness()
    composer.setText('/thin')
    session.onComposerChanged()
    await waitFor(() => Boolean(session.autocomplete))
    expect(session.autocomplete?.items[0]?.value).toBe('thinking')
    session.handleKey(keys.enter)
    await waitFor(() => session.showReasoning)
    expect(composer.text).toBe('')
  })

  it('opens the command palette as a page and closes it with Escape', async () => {
    const { session } = await harness()
    session.handleKey(key('\x10')) // Ctrl+P
    expect(session.page?.kind).toBe('commands')
    session.handleKey(keys.escape)
    expect(session.page).toBeUndefined()
  })

  it('writes a resumed thread to scrollback and keeps nothing live once it is settled', async () => {
    const thread = sessionThread([
      item.user('u1', 'turn_1', 'hello'),
      item.text('a1', 'turn_1', 'Hi there.\n\nSecond paragraph.')
    ])
    const { session, commits } = await harness({ thread })
    await waitFor(() => commits.length > 0)
    expect(commits[0]).toMatchObject({ kind: 'thread-header', title: 'Session thread' })
    const keysWritten = commits.flatMap((commit) => commit.kind === 'entry' ? [commit.entry.key] : [])
    expect(keysWritten).toEqual(['u1', 'kun-reply:turn_1', 'a1#0', 'a1#1'])
    expect(session.liveEntries).toEqual([])
  })

  it('does not write scrollback while it is not ready, then catches up', async () => {
    const thread = sessionThread([item.user('u1', 'turn_1', 'hello')])
    const { session, commits } = await harness({ thread })
    await waitFor(() => commits.length > 0)
    const before = commits.length
    session.setScrollbackReady(false)
    session.replayScrollback()
    expect(commits.length).toBe(before)
    session.setScrollbackReady(true)
    expect(commits.length).toBeGreaterThan(before)
    expect(commits[before]).toMatchObject({ kind: 'thread-header' })
  })
})
