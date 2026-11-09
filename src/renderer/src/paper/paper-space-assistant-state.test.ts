/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { paperSpaceItemKey } from './paper-space-store'
import { paperAssistantSession, patchPaperAssistant, usePaperAssistantStore } from './paper-space-assistant-state'

beforeEach(() => {
  localStorage.clear()
  usePaperAssistantStore.setState({ sessions: {} })
})

describe('paper assistant durable source bindings', () => {
  it('normalizes separators and trailing slashes without merging distinct case-sensitive sources', () => {
    const key = paperSpaceItemKey(' /library/ ', 'papers/a/')
    expect(key).toBe(paperSpaceItemKey('/library', 'papers\\a'))
    expect(key).not.toBe(paperSpaceItemKey('/Library', 'papers/a'))
    expect(key).not.toBe(paperSpaceItemKey('/library', 'papers/b'))
    expect(key).not.toBe(paperSpaceItemKey('/other', 'papers/a'))
    patchPaperAssistant(key, { threadId: 'thread-a' })
    usePaperAssistantStore.setState({ sessions: {} })
    expect(paperAssistantSession(paperSpaceItemKey('/library', 'papers\\a')).threadId).toBe('thread-a')
  })

  it('persists only the binding, not drafts, attachments or a stuck sending flag', () => {
    const key = paperSpaceItemKey('/library', 'papers/a')
    patchPaperAssistant(key, { threadId: 'thread-a', input: 'Private draft',
      images: [{ name: 'private.png', dataBase64: 'SECRET' }], sending: true })
    usePaperAssistantStore.setState({ sessions: {} })
    expect(paperAssistantSession(key)).toMatchObject({ threadId: 'thread-a', input: '', images: [], sending: false })
    expect(localStorage.getItem('kun.paper-assistant-thread-bindings.v1')).not.toContain('Private draft')
    expect(localStorage.getItem('kun.paper-assistant-thread-bindings.v1')).not.toContain('SECRET')
    patchPaperAssistant(key, { input: 'Fresh draft' })
    expect(paperAssistantSession(key)).toMatchObject({ threadId: 'thread-a', input: 'Fresh draft' })
  })

  it('removes only an explicitly cleared binding', () => {
    const a = paperSpaceItemKey('/library', 'papers/a')
    const b = paperSpaceItemKey('/library', 'papers/b')
    patchPaperAssistant(a, { threadId: 'thread-a' })
    patchPaperAssistant(b, { threadId: 'thread-b' })
    patchPaperAssistant(a, { threadId: null })
    usePaperAssistantStore.setState({ sessions: {} })
    expect(paperAssistantSession(a).threadId).toBeNull()
    expect(paperAssistantSession(b).threadId).toBe('thread-b')
  })

  it.each(['invalid JSON', 'null', '[]', '{"/library\\u0000papers/a":42}'])(
    'ignores unusable stored binding data: %s', (stored) => {
      localStorage.setItem('kun.paper-assistant-thread-bindings.v1', stored)
      expect(paperAssistantSession(paperSpaceItemKey('/library', 'papers/a')).threadId).toBeNull()
    }
  )
})
