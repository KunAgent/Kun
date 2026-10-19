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

  it('exposes every entry of a resumed thread for the scrollable conversation', async () => {
    const thread = sessionThread([
      item.user('u1', 'turn_1', 'hello'),
      item.text('a1', 'turn_1', 'Hi there.\n\nSecond paragraph.')
    ])
    const { session } = await harness({ thread })
    await waitFor(() => session.entries.length > 0)
    expect(session.entries.map((entry) => entry.key)).toEqual(['u1', 'kun-reply:turn_1', 'a1#0', 'a1#1'])
  })

  it('routes message paging keys to the conversation viewport', async () => {
    const { session, scrolls } = await harness()
    expect(session.handleKey(keys.pageUp)).toBe(true)
    expect(session.handleKey(keys.pageDown)).toBe(true)
    session.handleKey(key('\x1b\x15')) // Ctrl+Alt+U
    session.handleKey(key('\x1b\x04')) // Ctrl+Alt+D
    expect(scrolls).toEqual(['page-up', 'page-down', 'half-page-up', 'half-page-down'])
  })

  it('docks the sidebar on wide terminals and overlays it on narrow ones', async () => {
    const wide = await harness({ width: 140 })
    expect(wide.session.sidebarVisible).toBe(true)
    wide.session.handleKey(key('\x18'))
    wide.session.handleKey(key('b')) // Ctrl+X B hides the docked sidebar
    expect(wide.session.sidebarVisible).toBe(false)
    expect(wide.session.sidebarOverlay).toBe(false)

    const narrow = await harness({ width: 90 })
    narrow.session.handleKey(key('\x18'))
    narrow.session.handleKey(key('b'))
    expect(narrow.session.sidebarOverlay).toBe(true)
    expect(narrow.session.handleKey(keys.escape)).toBe(true)
    expect(narrow.session.sidebarOverlay).toBe(false)
  })

  it('toggles tool details in place with Ctrl+O and closes a dialog on an outside click', async () => {
    const { session } = await harness()
    session.handleKey(key('\x0f')) // Ctrl+O
    expect(session.showToolDetails).toBe(true)
    expect(session.page).toBeUndefined()
    session.handleKey(key('\x10')) // Ctrl+P
    expect(session.page?.kind).toBe('commands')
    session.dismissPage()
    expect(session.page).toBeUndefined()
  })
})
