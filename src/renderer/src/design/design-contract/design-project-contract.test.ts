import { describe, expect, it } from 'vitest'
import {
  createDefaultShape,
  createEmptyDocument,
  createHtmlFrameShape,
  ROOT_SHAPE_ID,
  type CanvasDocument
} from '../canvas/canvas-types'
import type { DesignSystem } from '../canvas/design-system-types'
import type { DesignArtifact, DesignDocument } from '../design-types'
import {
  buildDesignProjectContractMarkdown,
  summarizeDesignProjectContract
} from './design-project-contract'
import { buildDesignContractViewModel } from './design-contract-view-model'
import { CANVAS_MOTION_VERSION } from '../motion/canvas-motion-types'

const now = '2026-06-29T00:00:00.000Z'

function artifact(id: string, title: string): DesignArtifact {
  return {
    id,
    kind: 'html',
    title,
    relativePath: `.kun-design/doc/${id}/v1.html`,
    designMdPath: `.kun-design/doc/${id}/DESIGN.md`,
    createdAt: now,
    updatedAt: now,
    versions: [{ id: `${id}-v1`, relativePath: `.kun-design/doc/${id}/v1.html`, createdAt: now, summary: '' }],
    direction: { id: 'dir_1', name: 'Ops direction', status: 'active', createdAt: now }
  }
}

function documentWithArtifacts(artifacts: DesignArtifact[]): DesignDocument {
  return {
    id: 'doc',
    title: 'Ops app',
    createdAt: now,
    updatedAt: now,
    order: 0,
    artifacts,
    activeArtifactId: artifacts[0]?.id ?? null
  }
}

function canvasDocument(): CanvasDocument {
  const doc = createEmptyDocument()
  const frame = {
    ...createHtmlFrameShape('Home', 10, 20, 'home', 'mobile'),
    id: 'frame_home',
    parentId: ROOT_SHAPE_ID
  }
  const image = {
    ...createDefaultShape('image', 420, 20),
    id: 'asset_logo',
    name: 'Logo',
    parentId: ROOT_SHAPE_ID,
    imageUrl: '.kun-design/assets/logo.png'
  }
  doc.objects[ROOT_SHAPE_ID] = { ...doc.objects[ROOT_SHAPE_ID], children: [frame.id, image.id] }
  doc.objects[frame.id] = frame
  doc.objects[image.id] = image
  doc.graph = { version: 1, projectId: 'doc', updatedAt: now, lastJournalEntryId: 'journal_1' }
  doc.operationJournal = [
    {
      id: 'journal_1',
      label: 'Move hero card',
      createdAt: now,
      status: 'applied',
      affectedIds: ['frame_home'],
      errors: [],
      operations: [
        {
          id: 'op_1',
          type: 'move_shape',
          label: 'Move hero card',
          source: 'agent',
          createdAt: now,
          targetIds: ['frame_home'],
          payload: { dx: 12, dy: 0 }
        }
      ]
    }
  ]
  doc.codeBindings = [
    {
      id: 'binding_1',
      designObjectId: 'frame_home',
      kind: 'component',
      status: 'active',
      createdAt: now,
      target: {
        sourceFile: 'src/pages/Home.tsx',
        componentName: 'HomeView',
        routePath: '/'
      }
    }
  ]
  return doc
}

const designSystem: DesignSystem = {
  tokens: {
    'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' }
  },
  components: {}
}

describe('design project contract', () => {
  it('exports a project-level DESIGN.md with graph, journal, and code bindings', () => {
    const artifacts = [artifact('home', 'Home')]
    const doc = documentWithArtifacts(artifacts)
    const markdown = buildDesignProjectContractMarkdown({
      document: doc,
      canvasDocument: canvasDocument(),
      designSystem,
      artifacts,
      designContext: { designTarget: 'app', designGuidelines: 'Use compact ops workflows.' },
      updatedAt: now
    })

    expect(markdown).toContain('# DESIGN.md: Ops app')
    expect(markdown).toContain('Project brief: `.kun-design/doc/design.md`')
    expect(markdown).toContain('## Design Document')
    expect(markdown).toContain('- Document: Ops app (`doc`)')
    expect(markdown).toContain('## Design Mode')
    expect(markdown).toContain('- Recommended surface: `whiteboard`')
    expect(markdown).toContain('- code-bridge (active): 78/100; tools design.bind_code, design.implement')
    expect(markdown).toContain('### Workflow')
    expect(markdown).toContain('- Recommended step: `critique-current-direction`')
    expect(markdown).toContain('- critique-current-direction (recommended): design.critique')
    expect(markdown).toContain('## Design Graph')
    expect(markdown).toContain('`frame_home` html-frame: Home @ 10,20 390x844')
    expect(markdown).toContain(
      'Ops direction (active): 1 canvas object(s); needs-review; score 51/100; cost medium; risks unreviewed, not-implemented'
    )
    expect(markdown).toContain('## Canvas Operation Journal')
    expect(markdown).toContain('Move hero card (applied); move_shape; 1 affected object(s)')
    expect(markdown).toContain('## Code Bindings')
    expect(markdown).toContain('`frame_home` -> component (active); `src/pages/Home.tsx`; component `HomeView`; route `/`')
    expect(markdown).toContain('## Assets')
    expect(markdown).toContain('`asset_logo` image: Logo; `.kun-design/assets/logo.png`; workspace; model-ready; 100x100')
    expect(markdown).toContain('## Agent Contract')
    expect(markdown).toContain('### Tool Protocol')
    expect(markdown).toContain('design.ops (operations): Apply validated Design Operations')
    expect(markdown).toContain('design.bind_code (code): Create or refresh code bindings')
  })

  it('summarizes the contract for UI status', () => {
    const artifacts = [artifact('home', 'Home')]
    const summary = summarizeDesignProjectContract({
      document: documentWithArtifacts(artifacts),
      canvasDocument: canvasDocument(),
      designSystem,
      artifacts,
      designContext: { designTarget: 'web' },
      updatedAt: now
    })

    expect(summary).toMatchObject({
      path: '.kun-design/HANDOFF.md',
      title: 'Ops app',
      artifactCount: 1,
      screenCount: 1,
      objectCount: 3,
      rootObjectCount: 2,
      directionCount: 1,
      assetCount: 1,
      modelReadyAssetCount: 1,
      modeSurfaceCount: 6,
      readyModeSurfaceCount: 2,
      codeBindingCount: 1,
      journalEntryCount: 1
    })
  })

  it('exports bounded Design Motion handoff and reduced-motion implementation notes', () => {
    const canvas = canvasDocument()
    canvas.motion = {
      version: CANVAS_MOTION_VERSION,
      timelines: {
        frame_home: {
          id: 'timeline_home',
          frameId: 'frame_home',
          durationMs: 750,
          playback: 'ping-pong',
          tracks: [{
            id: 'track_home_rotation',
            targetShapeId: 'frame_home',
            property: 'rotation',
            operation: 'offset',
            baseValue: 0,
            keyframes: [
              { id: 'kf_0', timeMs: 0, value: -5, easing: { type: 'spring', mass: 1, stiffness: 120, damping: 14 } },
              { id: 'kf_1', timeMs: 750, value: 0, easing: { type: 'linear' } }
            ]
          }]
        }
      }
    }
    const options = {
      document: documentWithArtifacts([artifact('home', 'Home')]),
      canvasDocument: canvas,
      designSystem,
      artifacts: [artifact('home', 'Home')],
      designContext: { designTarget: 'web' as const },
      updatedAt: now
    }
    const markdown = buildDesignProjectContractMarkdown(options)
    const summary = summarizeDesignProjectContract(options)

    expect(markdown).toContain('## Design Motion')
    expect(markdown).toContain('`timeline_home` Home (`frame_home`): 750ms; ping-pong; 1 track(s); 2 keyframe(s)')
    expect(markdown).toContain('`track_home_rotation` Home (`frame_home`): rotation; 2 keyframe(s)')
    expect(markdown).toContain('Reduced motion: disable automatic playback when preferred')
    expect(markdown).toContain('separate from standalone SVG inner animation and Prototype screen navigation')
    expect(summary).toMatchObject({
      motionTimelineCount: 1,
      motionTrackCount: 1,
      motionKeyframeCount: 2
    })
  })

  it('builds export availability from workspace and document state', () => {
    const emptyCanvas = createEmptyDocument()
    const ready = buildDesignContractViewModel({
      workspaceRoot: '/workspace',
      document: documentWithArtifacts([]),
      canvasDocument: emptyCanvas,
      designSystem,
      designContext: { designTarget: 'web' }
    })
    const missingWorkspace = buildDesignContractViewModel({
      workspaceRoot: '',
      document: documentWithArtifacts([]),
      canvasDocument: emptyCanvas,
      designSystem,
      designContext: { designTarget: 'web' }
    })
    const missingDocument = buildDesignContractViewModel({
      workspaceRoot: '/workspace',
      document: null,
      canvasDocument: emptyCanvas,
      designSystem,
      designContext: { designTarget: 'web' }
    })

    expect(ready.canExport).toBe(true)
    expect(ready.toolAction).toMatchObject({
      id: 'prepare-handoff-package',
      intentMode: 'preview',
      toolId: 'design.export',
      toolInputSeed: {
        format: 'package',
        title: 'Ops app',
        designMdPath: '.kun-design/HANDOFF.md'
      }
    })
    expect(ready.toolAction.prompt).toContain('Suggested tool call: design.export')
    expect(missingWorkspace).toMatchObject({ canExport: false, disabledReason: 'no-workspace' })
    expect(missingDocument).toMatchObject({ visible: false, canExport: false, disabledReason: 'no-document' })
  })
})
