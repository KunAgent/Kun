import { describe, expect, it } from 'vitest'
import {
  createDefaultShape,
  createEmptyDocument,
  createHtmlFrameShape,
  createSvgFrameShape,
  ROOT_SHAPE_ID,
  type CanvasDocument
} from '../canvas/canvas-types'
import { createRunningAppFrameShape } from '../canvas/running-app-frame'
import type { DesignSystem } from '../canvas/design-system-types'
import type { DesignArtifact, DesignDocument } from '../design-types'
import {
  buildDesignResourceSurface,
  DESIGN_RESOURCE_SURFACE_PATH,
  serializeDesignResourceSurface
} from './design-resource-surface'
import { CANVAS_MOTION_VERSION } from '../motion/canvas-motion-types'

const now = '2026-06-29T00:00:00.000Z'

function artifact(): DesignArtifact {
  const relativePath = '.kun-design/doc/home/v1.html'
  return {
    id: 'home',
    kind: 'html',
    title: 'Home',
    relativePath,
    designMdPath: '.kun-design/doc/home/DESIGN.md',
    createdAt: now,
    updatedAt: now,
    versions: [{ id: 'home-v1', relativePath, createdAt: now, summary: '' }],
    direction: { id: 'dir_1', name: 'Calm ops', status: 'accepted' },
    prototypeLinks: [{ targetTitle: 'Settings', targetArtifactId: 'settings', href: '../settings/v1.html' }]
  }
}

function svgArtifact(): DesignArtifact {
  const relativePath = '.kun-design/doc/motion/v1.svg'
  return {
    id: 'motion',
    kind: 'svg',
    title: 'Orbit loader',
    relativePath,
    designMdPath: '.kun-design/doc/motion/DESIGN.md',
    createdAt: now,
    updatedAt: now,
    versions: [{ id: 'motion-v1', relativePath, createdAt: now, summary: 'Motion' }]
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
    ...createHtmlFrameShape('Home', 12, 24, 'home', 'mobile'),
    id: 'frame_home',
    parentId: ROOT_SHAPE_ID
  }
  const child = {
    ...createDefaultShape('text', 32, 48),
    id: 'title',
    name: 'Title',
    parentId: frame.id,
    frameId: frame.id
  }
  frame.children = [child.id]
  const liveFrame = {
    ...createRunningAppFrameShape({
      x: 1500,
      y: 24,
      url: 'localhost:5173/home',
      title: 'Live home',
      routePath: '/home',
      sourceFile: 'src/Home.tsx'
    })!,
    id: 'frame_live',
    parentId: ROOT_SHAPE_ID
  }
  const image = {
    ...createDefaultShape('image', 2100, 80),
    id: 'asset_logo',
    name: 'Logo',
    parentId: ROOT_SHAPE_ID,
    imageUrl: '.kun-design/assets/logo.png'
  }
  doc.objects[ROOT_SHAPE_ID] = { ...doc.objects[ROOT_SHAPE_ID], children: [frame.id, liveFrame.id, image.id] }
  doc.objects[frame.id] = frame
  doc.objects[liveFrame.id] = liveFrame
  doc.objects[image.id] = image
  doc.objects[child.id] = child
  doc.codeBindings = [
    {
      id: 'binding_1',
      designObjectId: 'frame_home',
      kind: 'component',
      status: 'active',
      createdAt: now,
      target: { sourceFile: 'src/Home.tsx', componentName: 'HomeView' }
    }
  ]
  return doc
}

const designSystem: DesignSystem = {
  tokens: {
    'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' }
  },
  components: {
    card: {
      id: 'card',
      name: 'Metric card',
      version: 1,
      tree: [createDefaultShape('frame', 0, 0)],
      slots: [{ path: 'Title', kind: 'text' }]
    }
  }
}

describe('design resource surface', () => {
  it('uses the stable resource-surface path', () => {
    expect(DESIGN_RESOURCE_SURFACE_PATH).toBe('.kun-design/design-resources.json')
  })

  it('exports MCP-like board, frame, token, component, and direction resources', () => {
    const artifacts = [artifact()]
    const surface = buildDesignResourceSurface({
      document: documentWithArtifacts(artifacts),
      canvasDocument: canvasDocument(),
      designSystem,
      artifacts,
      updatedAt: now
    })

    expect(surface).toMatchObject({
      version: 1,
      kind: 'kun.design.resources',
      document: { id: 'doc', title: 'Ops app' },
      counts: { board: 1, frame: 2, asset: 1, token: 1, component: 1, direction: 1, tool: 1, mode: 1 }
    })
    expect(surface.resources.map((resource) => resource.uri)).toEqual([
      'kun-design://documents/doc/boards/main',
      'kun-design://documents/doc/frames/frame_home',
      'kun-design://documents/doc/frames/frame_live',
      'kun-design://documents/doc/assets/asset_logo',
      'kun-design://documents/doc/tokens/brand%2Fprimary',
      'kun-design://documents/doc/components/card',
      'kun-design://documents/doc/directions/dir_1',
      'kun-design://documents/doc/modes/design-mode-surface',
      'kun-design://documents/doc/tools/design-tool-protocol'
    ])

    const board = JSON.parse(surface.resources[0].text)
    const frame = JSON.parse(surface.resources[1].text)
    const liveFrame = JSON.parse(surface.resources[2].text)
    const asset = JSON.parse(surface.resources[3].text)
    const token = JSON.parse(surface.resources[4].text)
    const direction = JSON.parse(surface.resources[6].text)
    const modeSurface = JSON.parse(surface.resources[7].text)
    const toolProtocol = JSON.parse(surface.resources[8].text)

    expect(board.graph).toMatchObject({
      projectId: 'doc',
      objectCount: 6,
      directionCount: 1,
      designSystem: {
        tokenCount: 1,
        componentCount: 1,
        tokenUsageCount: 0,
        componentInstanceCount: 0
      }
    })
    expect(frame).toMatchObject({
      id: 'frame_home',
      kind: 'html-frame',
      htmlPath: '.kun-design/doc/home/v1.html',
      codeBindings: [{ id: 'binding_1', kind: 'component', status: 'active' }]
    })
    expect(liveFrame).toMatchObject({
      id: 'frame_live',
      kind: 'running-app-frame',
      runningApp: {
        url: 'http://localhost:5173/home',
        routePath: '/home',
        sourceFile: 'src/Home.tsx'
      }
    })
    expect(asset).toMatchObject({
      id: 'asset_logo',
      kind: 'image',
      path: '.kun-design/assets/logo.png',
      sourceKind: 'workspace',
      modelReady: true
    })
    expect(token).toEqual({ name: 'brand/primary', kind: 'color', value: '#2563eb' })
    expect(direction.scorecard).toMatchObject({
      directionId: 'dir_1',
      readiness: 'needs-review',
      implementationCost: 'medium',
      screenCount: 1,
      flowCoverage: 1,
      risks: ['unreviewed', 'not-implemented']
    })
    expect(direction.screens).toEqual([
      {
        id: 'home',
        title: 'Home',
        htmlPath: '.kun-design/doc/home/v1.html',
        designMdPath: '.kun-design/doc/home/DESIGN.md',
        prototypeLinks: [{ targetTitle: 'Settings', targetArtifactId: 'settings', href: '../settings/v1.html' }]
      }
    ])
    expect(modeSurface).toMatchObject({
      kind: 'kun.design.mode-surface',
      recommendedSurfaceId: 'whiteboard',
      counts: { screenCount: 1, directionCount: 1, activeBindingCount: 1 },
      workflow: {
        kind: 'kun.design.mode-workflow',
        recommendedStepId: 'critique-current-direction'
      }
    })
    expect(toolProtocol.kind).toBe('kun.design.tool-protocol')
    expect(toolProtocol.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'design.plan' }),
      expect.objectContaining({ id: 'design.ops' })
    ]))
  })

  it('serializes as newline-terminated JSON', () => {
    const content = serializeDesignResourceSurface(
      buildDesignResourceSurface({
        document: documentWithArtifacts([]),
        canvasDocument: createEmptyDocument(),
        designSystem,
        updatedAt: now
      })
    )

    expect(content.endsWith('\n')).toBe(true)
    expect(JSON.parse(content)).toMatchObject({ kind: 'kun.design.resources' })
  })

  it('includes bounded Motion and reduced-motion guidance in board and frame resources', () => {
    const canvas = canvasDocument()
    canvas.motion = {
      version: CANVAS_MOTION_VERSION,
      timelines: {
        frame_home: {
          id: 'timeline_home',
          frameId: 'frame_home',
          durationMs: 900,
          playback: 'loop',
          tracks: [{
            id: 'track_home_opacity',
            targetShapeId: 'frame_home',
            property: 'opacity',
            operation: 'set',
            baseValue: 1,
            keyframes: [
              { id: 'kf_0', timeMs: 0, value: 0, easing: { type: 'linear' } },
              { id: 'kf_1', timeMs: 900, value: 1, easing: { type: 'ease-out' } }
            ]
          }]
        }
      }
    }
    const surface = buildDesignResourceSurface({
      document: documentWithArtifacts([artifact()]),
      canvasDocument: canvas,
      designSystem,
      artifacts: [artifact()],
      updatedAt: now
    })
    const board = JSON.parse(surface.resources.find((item) => item.kind === 'board')!.text)
    const frame = JSON.parse(surface.resources.find((item) => item.uri.endsWith('/frames/frame_home'))!.text)

    expect(board.motion).toMatchObject({ timelineCount: 1, trackCount: 1, keyframeCount: 2 })
    expect(frame.motionTimeline).toMatchObject({
      id: 'timeline_home',
      frameId: 'frame_home',
      tracks: [{ id: 'track_home_opacity', keyframes: [{ id: 'kf_0' }, { id: 'kf_1' }] }]
    })
    expect(frame.reducedMotion).toEqual({
      automaticPlayback: 'disabled-when-preferred',
      editing: 'available',
      scrubAndEndState: 'deterministic'
    })
  })

  it('exports an SVG frame resource with generic and SVG-specific source paths', () => {
    const motion = svgArtifact()
    const doc = createEmptyDocument()
    const frame = {
      ...createSvgFrameShape('Orbit loader', 80, 120, motion.id, 320, 240),
      id: 'frame_motion',
      parentId: ROOT_SHAPE_ID
    }
    doc.objects[ROOT_SHAPE_ID] = { ...doc.objects[ROOT_SHAPE_ID], children: [frame.id] }
    doc.objects[frame.id] = frame

    const surface = buildDesignResourceSurface({
      document: documentWithArtifacts([motion]),
      canvasDocument: doc,
      designSystem,
      artifacts: [motion],
      updatedAt: now
    })
    const resource = surface.resources.find((item) => item.uri.endsWith('/frames/frame_motion'))

    expect(resource).toBeDefined()
    expect(JSON.parse(resource!.text)).toMatchObject({
      id: 'frame_motion',
      kind: 'svg-frame',
      artifactPath: '.kun-design/doc/motion/v1.svg',
      artifactKind: 'svg',
      svgPath: '.kun-design/doc/motion/v1.svg',
      designMdPath: '.kun-design/doc/motion/DESIGN.md',
      source: { artifactId: 'motion', artifactKind: 'svg' }
    })
  })
})
