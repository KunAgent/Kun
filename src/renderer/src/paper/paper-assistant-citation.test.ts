import { describe, expect, it } from 'vitest'
import { paperAssistantCitationPage } from './paper-assistant-citation'

describe('current PDF citation navigation', () => {
  it.each(['papers/a/paper.pdf#page=3', '/source/papers/a/paper.pdf#page=3', './papers/a/paper.pdf#page=3', 'paper.pdf#page=3'])('accepts %s', (href) => {
    expect(paperAssistantCitationPage(href, '/source', '/source/papers/a/paper.pdf')).toBe(3)
  })
  it('decodes path characters and handles Windows source roots', () => {
    expect(paperAssistantCitationPage('papers/a%20b.pdf#page=2', '/source', '/source/papers/a b.pdf')).toBe(2)
    expect(paperAssistantCitationPage('papers/a.pdf#page=2', 'C:\\source', 'C:\\source\\papers\\a.pdf')).toBe(2)
  })
  it.each(['https://example.com/paper.pdf#page=3', 'javascript:alert(1)#page=3', '/other/paper.pdf#page=3',
    'papers/b/paper.pdf#page=3', '../paper.pdf#page=3', 'papers/%2e%2e/paper.pdf#page=3', 'paper.pdf#page=0',
    'paper.pdf#page=-1', 'paper.pdf#page=1.5', 'paper.pdf#page=9007199254740992', 'paper.pdf#page=x', 'paper.pdf', '%xx#page=2'])('rejects %s', (href) => {
    expect(paperAssistantCitationPage(href, '/source', '/source/papers/a/paper.pdf')).toBeNull()
  })
})
