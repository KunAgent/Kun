import { describe, expect, it } from 'vitest'
import type { WorkspacePresentationViewReference } from '@shared/office-document'
import { createWorkspaceOfficeViewPositionAttachment } from '../lib/workspace-office-view-context'
import { createWriteTurnReferenceAttachments } from '../write/write-turn-reference-context'
import { routeComposerContexts } from './chat-store-composer-context-routing'

const view: WorkspacePresentationViewReference = {
  kind: 'presentation', path: '/repo/deck.pptx', sourceName: 'deck.pptx', sourceFormat: 'pptx',
  sourceSha256: 'a'.repeat(64), slide: 2, slideCount: 5
}

describe('composer context routing', () => {
  it('keeps the artifact panel file and view contexts on the artifacts route', async () => {
    const references = await createWriteTurnReferenceAttachments({
      workspaceRoot: '/repo',
      activeResource: { sourceName: 'deck.pptx', locator: 'deck.pptx', resourceKind: 'office', access: 'read-write' },
      selections: [], retrieval: null, officeDocument: null, query: 'x', now: 1
    })
    const position = await createWorkspaceOfficeViewPositionAttachment({ workspaceRoot: '/repo', view, now: 1 })
    const routed = routeComposerContexts('artifacts', [position, ...references], [])
    expect(routed.map((context) => context.reference.kind)).toEqual(['work-reference-resource', 'office-view-position'])
    expect(routeComposerContexts('settings', [position, ...references], [])).toEqual([])
  })
})
