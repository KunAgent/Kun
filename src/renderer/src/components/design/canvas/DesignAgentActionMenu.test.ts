import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DesignAgentAction } from '../../../design/agent-actions/design-agent-actions'
import { DesignAgentActionMenu } from './DesignAgentActionMenu'

const action: DesignAgentAction = {
  id: 'explore-directions',
  labelKey: 'designAgentActionExploreDirections',
  detailKey: 'designAgentActionExploreDirectionsDetail',
  intentMode: 'generate',
  prompt: 'Explore directions'
}

describe('DesignAgentActionMenu', () => {
  it('drops down under the top toolbar button', () => {
    const html = renderToStaticMarkup(
      createElement(DesignAgentActionMenu, {
        open: true,
        actions: [action],
        buttonClassName: 'button-base',
        onToggle: () => {},
        onSelect: () => {}
      })
    )

    expect(html).toContain('top-full')
    expect(html).toContain('role="menu"')
    expect(html).not.toContain('right-12')
    expect(html).toContain('designAgentActionExploreDirections')
  })
})
