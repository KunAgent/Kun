import { describe, expect, it } from 'vitest'
import type { DesignOpenRequestMetadata } from '../agent/design-open-request'
import type { ChatBlock } from '../agent/types'
import type { DesignArtifact } from './design-types'
import { agentDesignArtifacts, nextAgentScreenX } from './agent-design-ingest'
import { takeLiveDesignRequests } from '../components/workbench/useAgentDesignAutoOpen'

const NOW = '2026-10-24T08:00:00.000Z'

function request(screens: { id: string; name: string; width?: number }[]): DesignOpenRequestMetadata {
  return {
    status: 'ready',
    title: 'Tray',
    requestId: 'design_0123456789abcdef',
    documentId: '0a1b2c3d',
    screenCount: screens.length,
    screens: screens.map((screen) => ({
      artifactId: screen.id,
      name: screen.name,
      relativePath: `.kun-design/0a1b2c3d/${screen.id}/v1.html`,
      width: screen.width ?? 1280,
      height: 800
    }))
  }
}

function existing(id: string, x: number, width: number): DesignArtifact {
  return {
    id,
    kind: 'html',
    title: 'Old',
    relativePath: `.kun-design/0a1b2c3d/${id}/v1.html`,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    versions: [],
    node: { x, y: 0, width, height: 800 }
  }
}

describe('agent design ingest', () => {
  it('lays new screens out in one row after the existing ones', () => {
    expect(nextAgentScreenX([])).toBe(0)
    expect(nextAgentScreenX([existing('aaaaaaaa', 0, 1280), existing('bbbbbbbb', 1440, 390)])).toBe(1990)

    const artifacts = agentDesignArtifacts(
      request([{ id: '11111111', name: 'Tray' }, { id: '22222222', name: 'Open', width: 390 }]),
      [],
      NOW
    )
    expect(artifacts.map((artifact) => [artifact.id, artifact.node?.x, artifact.node?.width])).toEqual([
      ['11111111', 0, 1280],
      ['22222222', 1440, 390]
    ])
    expect(artifacts[0]).toMatchObject({
      kind: 'html',
      title: 'Tray',
      relativePath: '.kun-design/0a1b2c3d/11111111/v1.html',
      designMdPath: '.kun-design/0a1b2c3d/11111111/DESIGN.md',
      previewStatus: 'pending',
      node: { sizeMode: 'manual-width-auto-height', viewMode: 'preview' }
    })
  })

  it('keeps a known screen where the user put it and only refreshes it', () => {
    const moved = existing('11111111', 900, 640)
    const [refreshed] = agentDesignArtifacts(request([{ id: '11111111', name: 'Tray v2' }]), [moved], NOW)
    expect(refreshed).toEqual({ ...moved, title: 'Tray v2', updatedAt: NOW })
  })

  it('opens only designs that arrived in this window', () => {
    const designBlock = (id: string, status: string, turnId: string): ChatBlock => ({
      kind: 'tool',
      id,
      turnId,
      summary: 'design_open',
      status: 'success',
      toolKind: 'file_change',
      meta: {
        toolName: 'design_open',
        designOpenRequest: status === 'pending'
          ? { status: 'pending', title: 'Tray', screenCount: 1 }
          : { ...request([{ id: '11111111', name: 'Tray' }]), requestId: `design_${id.padEnd(16, '0')}` }
      }
    } as unknown as ChatBlock)
    const seen = new Set<string>()
    const handled = new Set<string>()

    // History replay: a finished design from an earlier turn is not reopened.
    expect(takeLiveDesignRequests([designBlock('aaaa', 'ready', 'turn-old')], { busy: false, currentTurnId: null }, seen, handled))
      .toEqual([])
    // A call seen streaming, then finished, opens once.
    takeLiveDesignRequests([designBlock('bbbb', 'pending', 'turn-new')], { busy: true, currentTurnId: 'turn-new' }, seen, handled)
    const live = takeLiveDesignRequests([designBlock('bbbb', 'ready', 'turn-new')], { busy: false, currentTurnId: null }, seen, handled)
    expect(live.map((item) => item.blockId)).toEqual(['bbbb'])
    expect(takeLiveDesignRequests([designBlock('bbbb', 'ready', 'turn-new')], { busy: false, currentTurnId: null }, seen, handled))
      .toEqual([])
    // A result that lands while its turn is still running also opens.
    expect(takeLiveDesignRequests([designBlock('cccc', 'ready', 'turn-run')], { busy: true, currentTurnId: 'turn-run' }, seen, handled)
      .map((item) => item.blockId)).toEqual(['cccc'])
  })
})
