import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentIcon, agentIconAssetUrl } from './agent-icon'

describe('AgentIcon', () => {
  it('maps stable harness IDs and keeps custom IDs neutral', () => {
    expect(agentIconAssetUrl('codex')).toBeTruthy()
    expect(agentIconAssetUrl('claude-code')).toBeTruthy()
    expect(agentIconAssetUrl('devin')).toBeTruthy()
    expect(agentIconAssetUrl('arbitrary-provider-name')).toBeUndefined()
    expect(renderToStaticMarkup(createElement(AgentIcon, { harnessId: 'arbitrary-provider-name' })))
      .toContain('data-agent-icon="unknown"')
  })

  it('uses the Devin vector mark keyed by the harness identity', () => {
    const html = renderToStaticMarkup(createElement(AgentIcon, { harnessId: 'devin', size: 20 }))
    expect(html).toContain('data-agent-icon="devin"')
    expect(html).toContain('mask-image:')
    expect(html).not.toContain('data-agent-icon="unknown"')
  })

  it('uses OpenCode brand artwork rather than the OpenCode Go provider mark', () => {
    const html = renderToStaticMarkup(createElement(AgentIcon, { harnessId: 'opencode', size: 20 }))
    expect(html).toContain('data-agent-icon="opencode"')
    expect(html).toContain('opencode-logo-light-square.svg')
    expect(html).toContain('opencode-logo-dark-square.svg')
    expect(html).not.toContain('opencodego.svg')
  })
})
