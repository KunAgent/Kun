import { describe, expect, it } from 'vitest'
import { renderCapabilityDetails } from '../src/webview/render-capability.js'

describe('render capability evidence for the Webview', () => {
  it('preserves affected nodes, capabilities, and remediation from Host failures', () => {
    expect(renderCapabilityDetails({
      unsupportedNodes: [{
        nodeId: 'item-interview:effect-blur',
        nodeType: 'effect',
        capability: 'filter:boxblur',
        message: 'The selected backend cannot render blur.',
        guidance: 'Install an FFmpeg build with the boxblur filter or disable this effect.'
      }],
      advancedIssues: [{
        nodeId: 'export:h265-mp4',
        capability: 'encoder:hevc',
        guidance: 'Choose the portable FFV1 target on this machine.'
      }]
    })).toEqual([
      {
        nodeId: 'item-interview:effect-blur',
        nodeType: 'effect',
        capability: 'filter:boxblur',
        message: 'The selected backend cannot render blur.',
        guidance: 'Install an FFmpeg build with the boxblur filter or disable this effect.'
      },
      {
        nodeId: 'export:h265-mp4',
        capability: 'encoder:hevc',
        guidance: 'Choose the portable FFV1 target on this machine.'
      }
    ])
  })

  it('deduplicates malformed Host data and keeps the projection bounded', () => {
    const repeated = Array.from({ length: 40 }, (_, index) => ({
      nodeId: `node-${index}`,
      capability: `capability-${index}`,
      guidance: 'x'.repeat(800)
    }))
    const details = renderCapabilityDetails({
      unsupportedNodes: [
        { nodeId: 'same-node', capability: 'same-capability' },
        { nodeId: 'same-node', capability: 'same-capability', guidance: 'duplicate' },
        { nodeId: '', capability: 'missing-node' },
        { nodeId: 'missing-capability' },
        ...repeated
      ],
      advancedIssues: 'not-an-array'
    })

    expect(details).toHaveLength(16)
    expect(details.filter(({ nodeId }) => nodeId === 'same-node')).toHaveLength(1)
    expect(details.at(-1)?.guidance).toHaveLength(512)
  })
})
