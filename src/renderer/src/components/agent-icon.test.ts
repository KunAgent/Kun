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

  it.each(['opencode', 'opencode2'])('uses OpenCode brand artwork for %s while retaining its identity', (harnessId) => {
    const html = renderToStaticMarkup(createElement(AgentIcon, { harnessId, size: 20 }))
    expect(html).toContain(`data-agent-icon="${harnessId}"`)
    expect(html).toContain('opencode-logo-light-square.svg')
    expect(html).toContain('opencode-logo-dark-square.svg')
    expect(html).not.toContain('opencodego.svg')
  })

  it('uses the official Pi vector mark instead of a font-dependent text logo', () => {
    const html = renderToStaticMarkup(createElement(AgentIcon, { harnessId: 'pi', size: 20 }))
    expect(decodeURIComponent(agentIconAssetUrl('pi')!)).toContain('M420 280H280V140H0V0H420V280Z')
    expect(html).toContain('data-agent-icon="pi"')
    expect(html).toContain('mask-image:')
    expect(html).not.toContain('π')
    expect(html).not.toContain('font-serif')
  })
})
