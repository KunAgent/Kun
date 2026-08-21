import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultShape,
  createEmptyDocument,
  createHtmlFrameShape,
  ROOT_SHAPE_ID
} from '../canvas/canvas-types'
import type { DesignArtifact, DesignDocument } from '../design-types'
import type { DesignWorkspaceState } from '../design-workspace-store-types'
import type { DerivedTokens } from '../design-token-extract'
import {
  buildDesignTurnPromptPayload,
  readDesignHtmlQualityFindings
} from './payload'

const now = '2026-07-02T00:00:00.000Z'

function artifact(id: string, title: string): DesignArtifact {
  return {
    id,
    kind: 'html',
    title,
    relativePath: `.kun-design/doc/${id}/v1.html`,
    designMdPath: `.kun-design/doc/${id}/DESIGN.md`,
    createdAt: now,
    updatedAt: now,
    versions: [{ id: `${id}-v1`, relativePath: `.kun-design/doc/${id}/v1.html`, createdAt: now, summary: `${title} summary` }]
  }
}

function document(artifacts: DesignArtifact[]): DesignDocument {
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

function promptState(artifacts: DesignArtifact[]): Pick<
  DesignWorkspaceState,
  'artifacts' | 'assistantModel' | 'assistantProviderId' | 'designContext' | 'documents' | 'activeDocumentId' | 'generationPrompt'
> {
  return {
    artifacts,
    assistantModel: '',
    assistantProviderId: '',
    designContext: { designTarget: 'web' },
    documents: [document(artifacts)],
    activeDocumentId: 'doc',
    generationPrompt: ''
  }
}

const tokensByArtifact: Record<string, DerivedTokens> = {
  '.kun-design/doc/home/v1.html': {
    extracted: {
      colors: [{ name: '--brand-primary', value: '#2563eb', role: 'primary' }],
      fonts: [],
      radii: [],
      spacing: [],
      typeScale: [],
      sampledColors: [],
      title: 'Home'
    },
    palette: {
      primary: { base: '#2563eb', ramp: [{ stop: 500, hex: '#2563eb', isBase: true }] }
    },
    typeRows: [{
      label: 'body',
      sample: 'body',
      fontSize: '15px',
      fontWeight: '500',
      lineHeight: '24px',
      fontFamily: 'Inter, sans-serif',
      px: 15
    }]
  }
}

describe('design turn prompt payload', () => {
  it('builds an intent-aware design canvas prompt without renderer-local workflow tools', async () => {
    const artifacts = [artifact('home', 'Home')]
    const payload = await buildDesignTurnPromptPayload({
      target: 'canvas',
      mode: 'text',
      promptText: '做一个 SaaS 登录页',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace',
      promptState: promptState(artifacts),
      boardArtifact: { ...artifact('board', 'Board'), kind: 'canvas' },
      visibleTargets: [],
      canvasDocument: createEmptyDocument(),
      designSystem: { tokens: {}, components: {} },
      tokensByArtifact
    })

    expect(payload.prompt).toContain('BUILD A SINGLE SCREEN')
    expect(payload.prompt).toContain('BUILD A COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(payload.prompt).toContain('renderer immediately materializes every successful result')
    expect(payload.prompt).toContain('Do NOT follow `generate_image` with an `add` op')
    expect(payload.prompt).not.toContain('Design mode workflow contract:')
    expect(payload.prompt).not.toContain('Suggested tool call: design.plan')
    expect(payload.promptState.activeDocumentId).toBe('doc')
  })

  it('keeps sibling token context when building an HTML prompt', async () => {
    const home = artifact('home', 'Home')
    const settings = artifact('settings', 'Settings')
    const payload = await buildDesignTurnPromptPayload({
      target: 'html',
      mode: 'text',
      promptText: 'Iterate settings',
      artifactRelativePath: settings.relativePath,
      workspaceRoot: '/workspace',
      promptState: promptState([home, settings]),
      boardArtifact: { ...artifact('board', 'Board'), kind: 'canvas' },
      visibleTargets: [],
      canvasDocument: createEmptyDocument(),
      designSystem: { tokens: {}, components: {} },
      tokensByArtifact,
      htmlArtifactId: settings.id
    })

    expect(payload.prompt).toContain('Other pages already in this project')
    expect(payload.prompt).toContain('accent #2563eb')
    expect(payload.prompt).not.toContain('Design mode workflow contract:')
  })

  it('builds screen sibling context from other HTML frames on the board', async () => {
    const home = artifact('home', 'Home')
    const settings = artifact('settings', 'Settings')
    const doc = createEmptyDocument()
    const homeFrame = { ...createHtmlFrameShape('Home', 0, 0, 'home', 'desktop'), id: 'frame_home', parentId: ROOT_SHAPE_ID }
    const settingsFrame = {
      ...createHtmlFrameShape('Settings', 1400, 0, 'settings', 'desktop'),
      id: 'frame_settings',
      parentId: ROOT_SHAPE_ID
    }
    doc.objects[ROOT_SHAPE_ID] = { ...doc.objects[ROOT_SHAPE_ID], children: [homeFrame.id, settingsFrame.id] }
    doc.objects[homeFrame.id] = homeFrame
    doc.objects[settingsFrame.id] = settingsFrame

    const payload = await buildDesignTurnPromptPayload({
      target: 'screen',
      mode: 'text',
      promptText: 'Tighten settings',
      artifactRelativePath: settings.relativePath,
      workspaceRoot: '/workspace',
      promptState: promptState([home, settings]),
      boardArtifact: { ...artifact('board', 'Board'), kind: 'canvas' },
      visibleTargets: [],
      canvasDocument: doc,
      designSystem: { tokens: {}, components: {} },
      tokensByArtifact,
      htmlArtifactId: settings.id,
      selectedFrame: settingsFrame
    })

    expect(payload.prompt).toContain('Other pages already in this project')
    expect(payload.prompt).toContain('Home')
    expect(payload.prompt).not.toContain('frame_settings')
  })

  it('reads static quality findings through workspace files', async () => {
    const readWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true,
      content: path.endsWith('DESIGN.md')
        ? ''
        : '<!doctype html><html><body><main><button>Click</button></main></body></html>'
    }))
    vi.stubGlobal('window', { kunGui: { readWorkspaceFile } })

    const findings = await readDesignHtmlQualityFindings({
      workspaceRoot: '/workspace',
      htmlPath: '.kun-design/doc/home/v1.html',
      designNotesPath: '.kun-design/doc/home/DESIGN.md'
    })

    expect(readWorkspaceFile).toHaveBeenCalled()
    expect(findings.length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('passes selected canvas images as context locations', async () => {
    const image = createDefaultShape('image', 10, 20)
    image.id = 'asset_logo'
    image.name = 'Logo'
    image.imageUrl = '.kun-design/assets/logo.png'
    const payload = await buildDesignTurnPromptPayload({
      target: 'canvas',
      mode: 'text',
      promptText: 'Use this logo',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace',
      promptState: promptState([]),
      boardArtifact: { ...artifact('board', 'Board'), kind: 'canvas' },
      visibleTargets: [{
        kind: 'canvas-selection',
        chip: { id: 'canvas-selection:asset_logo', kind: 'canvas-selection', label: 'Logo' },
        selectedIds: [image.id],
        selectedShapes: [image]
      }],
      canvasDocument: createEmptyDocument(),
      designSystem: { tokens: {}, components: {} },
      tokensByArtifact
    })

    expect(payload.prompt).toContain('Selected on the canvas')
    expect(payload.prompt).toContain('.kun-design/assets/logo.png')
  })
})
