import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from './kun-contract'
import { extractDiagramPrototype, toolBlockFromItem } from './kun-mapper-tools'

function item(diagramPrototype: Record<string, unknown>, toolName = 'show_diagram'): CoreTurnItemJson {
  return {
    id: 'diagram-item',
    kind: 'tool_result',
    toolName,
    output: { diagramPrototype }
  } as CoreTurnItemJson
}

const diagram = {
  version: 1,
  status: 'completed',
  artifactId: 'architecture-1',
  title: 'System architecture',
  relativePath: '.kun-design/diagram-prototypes/architecture-1/diagram.html',
  viewport: { width: 960, height: 640 },
  contentHash: 'A'.repeat(64)
}

describe('diagram prototype mapping', () => {
  it('maps durable show_diagram metadata onto the tool block', () => {
    expect(toolBlockFromItem(item(diagram)).meta?.diagramPrototype).toEqual({
      ...diagram,
      contentHash: 'a'.repeat(64)
    })
  })

  it('rejects metadata from other tools and unsafe or invalid paths', () => {
    expect(extractDiagramPrototype(item(diagram, 'read'))).toBeUndefined()
    expect(extractDiagramPrototype(item({
      ...diagram,
      relativePath: '.kun-design/diagram-prototypes/../secret/diagram.html'
    }))).toBeUndefined()
    expect(extractDiagramPrototype(item({
      ...diagram,
      relativePath: '.kun-design/component-prototypes/a/prototype.html'
    }))).toBeUndefined()
  })
})
