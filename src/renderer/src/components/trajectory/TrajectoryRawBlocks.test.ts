import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TrajectoryRawBlocks } from './TrajectoryRawBlocks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { index?: number; type?: string }) => key === 'trajectoryRawBlockLabel'
      ? `Block ${values?.index} · ${values?.type}`
      : key === 'trajectoryRawEmpty' ? 'No raw content was recorded for this event.' : key
  })
}))

describe('TrajectoryRawBlocks', () => {
  it('renders ordered wire blocks without embedding attachment bodies', () => {
    const html = renderToStaticMarkup(createElement(TrajectoryRawBlocks, {
      threadId: 'thread-1',
      content: { blocks: [
        { type: 'reasoning', content: 'First thought', itemId: 'reasoning-1' },
        { type: 'text', content: 'Final answer', itemId: 'text-1' },
        { type: 'image', attachmentId: 'attachment-1', content: 'data:image/png;base64,AAAA' }
      ] }
    }))
    expect(html).toContain('Block 1')
    expect(html).toContain('First thought')
    expect(html).toContain('Final answer')
    expect(html).toContain('attachment-1')
    expect(html).not.toContain('base64')
    expect(html.indexOf('First thought')).toBeLessThan(html.indexOf('Final answer'))
  })

  it('projects only allowlisted legacy item content and redacts tool payloads', () => {
    const html = renderToStaticMarkup(createElement(TrajectoryRawBlocks, {
      threadId: 'thread-1',
      content: [
        { kind: 'user_message', id: 'item-1', threadId: 'secret-thread-envelope', workspace: '/private/workspace', text: 'hello Cookie: session=legacy-cookie-sentinel\nprefix data:image/png;base64,LEGACY_BINARY_SENTINEL' },
        { kind: 'tool_call', id: 'item-2', toolName: 'fetch', callId: 'call-1', arguments: { authorization: 'Bearer secret', accessKeyId: 'legacy-access-key-sentinel', query: 'safe' } },
        { kind: 'unknown_private_item', text: 'must not render' }
      ]
    }))
    expect(html).toContain('hello')
    expect(html).toContain('fetch')
    expect(html).toContain('&quot;query&quot;: &quot;safe&quot;')
    expect(html).toContain('[redacted]')
    expect(html).not.toContain('secret-thread-envelope')
    expect(html).not.toContain('/private/workspace')
    expect(html).not.toContain('must not render')
    expect(html).not.toContain('legacy-cookie-sentinel')
    expect(html).not.toContain('LEGACY_BINARY_SENTINEL')
    expect(html).not.toContain('legacy-access-key-sentinel')
  })

  it('shows an explicit empty state for unsupported content', () => {
    const html = renderToStaticMarkup(createElement(TrajectoryRawBlocks, { threadId: 'thread-1', content: { private: true } }))
    expect(html).toContain('No raw content was recorded for this event.')
  })
})
