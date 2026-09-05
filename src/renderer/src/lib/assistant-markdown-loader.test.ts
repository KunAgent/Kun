import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAssistantMarkdownRenderer } from './assistant-markdown-loader'

describe('assistant-markdown-loader', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deduplicates concurrent loads into the same module promise', async () => {
    const first = loadAssistantMarkdownRenderer()
    const second = loadAssistantMarkdownRenderer()
    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({
      StreamdownAssistant: expect.any(Function)
    })
  })

  it('keeps prepare as a fire-and-forget compatible loader', async () => {
    const { prepareAssistantMarkdownRenderer } = await import('./assistant-markdown-loader')
    await expect(prepareAssistantMarkdownRenderer()).resolves.toBeUndefined()
  })
})
