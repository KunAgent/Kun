import { describe, expect, it } from 'vitest'
import {
  conversationVisualizationText,
  parseConversationVisualization,
  visualizationFromToolPayload
} from './conversation-visualization'

const value = {
  version: 1,
  title: 'Media pipeline',
  description: 'Prepare and publish the final asset.',
  sections: [
    {
      kind: 'flow',
      steps: [
        { id: 'download', title: 'Download', description: 'Drive to temp' },
        { id: 'publish', title: 'Publish', tone: 'success' }
      ]
    },
    {
      kind: 'callout',
      tone: 'warning',
      lines: ['Limit concurrency to one.']
    }
  ]
}

describe('conversation visualization renderer contract', () => {
  it('parses a valid tool result and applies defaults', () => {
    const parsed = visualizationFromToolPayload({ conversationVisualization: value })
    expect(parsed).toMatchObject({
      title: 'Media pipeline',
      sections: [
        { kind: 'flow', direction: 'horizontal' },
        { kind: 'callout', tone: 'warning' }
      ]
    })
  })

  it('fails closed for unknown versions and duplicate ids', () => {
    expect(parseConversationVisualization({ ...value, version: 2 })).toBeNull()
    expect(parseConversationVisualization({
      ...value,
      sections: [{
        kind: 'flow',
        steps: [{ id: 'same', title: 'One' }, { id: 'same', title: 'Two' }]
      }]
    })).toBeNull()
  })

  it('serializes visual content in reading order', () => {
    const parsed = parseConversationVisualization(value)
    expect(parsed).not.toBeNull()
    const text = conversationVisualizationText(parsed!)
    expect(text).toContain('1. Download — Drive to temp')
    expect(text).toContain('2. Publish')
    expect(text).toContain('• Limit concurrency to one.')
  })
})
