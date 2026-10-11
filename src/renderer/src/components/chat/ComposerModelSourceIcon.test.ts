import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ComposerModelSourceIcon } from './ComposerModelSourceIcon'

describe('composer model source identity', () => {
  it('shows the Agent\'s own mark for its sign-in and a neutral account icon without one', () => {
    const own = renderToStaticMarkup(createElement(ComposerModelSourceIcon, { providerId: 'ade-cred:native-login', agentId: 'claude-code' }))
    expect(own).toContain('data-model-source-icon="agent-account"')
    expect(own).toContain('data-agent-icon')
    const html = renderToStaticMarkup(createElement(ComposerModelSourceIcon, { providerId: 'ade-cred:native-login' }))
    expect(html).toContain('data-model-source-icon="native-login"')
    expect(html).not.toContain('data-provider-icon')
    expect(html).not.toContain('lucide-key')
  })

  it('shows the Kun provider that supplies a native login', () => {
    const html = renderToStaticMarkup(createElement(ComposerModelSourceIcon, { providerId: 'ade-cred:native-login:claude-subscription' }))
    expect(html).toContain('data-provider-icon="claude"')
    expect(html).not.toContain('data-agent-icon')
  })

  it.each(['ade-cred:provider:deepseek', 'ade-cred:kun-gateway:deepseek', 'deepseek'])(
    'resolves the actual DeepSeek source for %s', (providerId) => {
      const html = renderToStaticMarkup(createElement(ComposerModelSourceIcon, { providerId }))
      expect(html).toContain('data-provider-icon="deepseek"')
      expect(html).not.toContain('data-provider-icon="kun"')
    }
  )

  it('retains trusted provider preset branding for a custom gateway account', () => {
    const html = renderToStaticMarkup(createElement(ComposerModelSourceIcon, {
      providerId: 'ade-cred:kun-gateway:custom-provider-2', presetId: 'minimax'
    }))
    expect(html).toContain('data-provider-icon="minimax"')
  })
})
