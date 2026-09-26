import { describe, expect, it } from 'vitest'
import type { DesignTaskProfile } from '../agent/design-task-profile'
import {
  applyDesignOutputContract,
  applyDesignTaskProfileContract,
  buildDesignTaskProfileInput,
  designContextFromTaskProfile,
  resolveDesignTaskProfileSelection
} from './design-task-profile-input'

const documentTarget = { documentId: 'doc_design', boardArtifactId: 'board_design' }

describe('buildDesignTaskProfileInput', () => {
  it('snapshots an unlocked profile and trims mutable Design context fields', () => {
    const tone = ['calm', 'editorial']
    const profile = buildDesignTaskProfileInput({
      selection: { outputMedium: 'image', target: 'app', preset: 'ios' },
      documentTarget,
      designContext: {
        designType: 'product',
        brandColor: '  #123456  ',
        tone,
        designGuidelines: '  Use strong hierarchy.  ',
        radius: 'rounded',
        density: 'compact',
        fontStyle: 'humanist'
      }
    })

    tone.push('mutated-after-submit')
    expect(profile).toEqual({
      version: 1,
      documentTarget,
      outputMedium: 'image',
      target: 'app',
      preset: 'ios',
      presetSource: 'explicit',
      context: {
        designType: 'product',
        brandColor: '#123456',
        tone: ['calm', 'editorial'],
        designGuidelines: 'Use strong hierarchy.',
        radius: 'rounded',
        density: 'compact',
        fontStyle: 'humanist'
      }
    })
  })

  it('projects immutable profile fields back into an isolated execution context', () => {
    expect(designContextFromTaskProfile({
      target: 'app',
      preset: 'material',
      context: { tone: ['precise'], brandColor: '#123456' }
    })).toEqual({
      designTarget: 'app',
      designSystemPreset: 'material',
      tone: ['precise'],
      brandColor: '#123456'
    })
  })

  it('reuses the locked contract, removes disclosure-only lock metadata, and clones it', () => {
    const lockedProfile: DesignTaskProfile = {
      version: 1,
      documentTarget,
      outputMedium: 'html',
      target: 'web',
      preset: 'geist',
      context: { tone: ['precise'], brandColor: '#000000' },
      lockedAtTurnId: 'turn_first'
    }
    const submitted = buildDesignTaskProfileInput({
      selection: { outputMedium: 'image', target: 'app', preset: 'ios' },
      documentTarget,
      designContext: { tone: ['ignored'] },
      lockedProfile
    })

    expect(submitted).toEqual({
      version: 1,
      documentTarget,
      outputMedium: 'html',
      target: 'web',
      preset: 'geist',
      context: { tone: ['precise'], brandColor: '#000000' }
    })
    expect(submitted).not.toHaveProperty('lockedAtTurnId')
    submitted.documentTarget.documentId = 'mutated'
    submitted.context.tone.push('mutated')
    expect(lockedProfile.documentTarget.documentId).toBe('doc_design')
    expect(lockedProfile.context.tone).toEqual(['precise'])
  })

  it('rejects a locked profile when the current whiteboard target changed', () => {
    expect(() => buildDesignTaskProfileInput({
      selection: { outputMedium: 'html', target: 'web', preset: 'none' },
      documentTarget: { documentId: 'doc_other', boardArtifactId: 'board_design' },
      designContext: {},
      lockedProfile: {
        version: 1,
        documentTarget,
        outputMedium: 'html',
        target: 'web',
        preset: 'none',
        context: { tone: [] },
        lockedAtTurnId: 'turn_first'
      }
    })).toThrow('locked to a different whiteboard')
  })
})

describe('resolveDesignTaskProfileSelection', () => {
  const auto = { outputMedium: 'html', target: 'web', preset: 'none' } as const
  const validRoot = [
    '---',
    'name: Project',
    'colors:',
    '  primary: "#123456"',
    '---',
    '# Project design'
  ].join('\n')

  it('locks a valid root DESIGN.md ahead of the workspace default', async () => {
    const resolved = await resolveDesignTaskProfileSelection(auto, '/workspace', {
      readRootDesignMd: async () => ({ ok: true, content: validRoot }),
      readWorkspaceDefaultPreset: async () => 'ios'
    })

    expect(resolved).toMatchObject({
      ...auto,
      presetSource: 'root-design-md',
      styleSnapshot: {
        version: 1,
        source: 'root-design-md',
        sourceName: 'Project'
      }
    })
    expect(resolved.styleSnapshot?.sourceHash).toBeTruthy()
    expect(JSON.parse(resolved.styleSnapshot?.content ?? '{}')).toMatchObject({
      name: 'Project',
      colors: { primary: { hex: '#123456', raw: '#123456' } }
    })
  })

  it('falls back from an invalid root source to the workspace default', async () => {
    await expect(resolveDesignTaskProfileSelection(auto, '/workspace', {
      readRootDesignMd: async () => ({ ok: true, content: '# invalid' }),
      readWorkspaceDefaultPreset: async () => 'geist'
    })).resolves.toEqual({
      ...auto,
      preset: 'geist',
      presetSource: 'workspace-default'
    })
  })

  it('locks explicit and empty choices without consulting lower-priority sources', async () => {
    await expect(resolveDesignTaskProfileSelection({ ...auto, preset: 'radix' }, '/workspace', {
      readRootDesignMd: async () => { throw new Error('must not read') },
      readWorkspaceDefaultPreset: async () => { throw new Error('must not read') }
    })).resolves.toEqual({ ...auto, preset: 'radix', presetSource: 'explicit' })
    await expect(resolveDesignTaskProfileSelection(auto, '/workspace', {
      readRootDesignMd: async () => null,
      readWorkspaceDefaultPreset: async () => 'none'
    })).resolves.toEqual({ ...auto, presetSource: 'none' })
  })
})

describe('applyDesignOutputContract', () => {
  it('keeps the AI-image lane explicit and forbids silent HTML fallback', () => {
    const prompt = applyDesignOutputContract('Draw a campaign key visual.', 'image')

    expect(prompt).toContain('create an AI-generated raster image as the main deliverable')
    expect(prompt).toContain('Use `generate_image`')
    expect(prompt).toContain('Do not create an HTML screen or silently fall back to HTML')
    expect(prompt).toMatch(/\n\nDraw a campaign key visual\.$/)
  })

  it('keeps HTML as the primary editable interface lane', () => {
    const prompt = applyDesignOutputContract('Build account settings.', 'html')

    expect(prompt).toContain('interactive HTML interface as the main deliverable')
    expect(prompt).toContain('Generated images may be supporting assets only')
    expect(prompt).toMatch(/\n\nBuild account settings\.$/)
  })

  it('injects the complete immutable task snapshot into the actual prompt', () => {
    const prompt = applyDesignTaskProfileContract('Build the screen.', {
      version: 1,
      documentTarget,
      outputMedium: 'html',
      target: 'app',
      preset: 'none',
      presetSource: 'root-design-md',
      styleSnapshot: {
        version: 1,
        source: 'root-design-md',
        sourceHash: 'hash-at-admission',
        sourceName: 'Project',
        content: '{"colors":{"primary":{"hex":"#123456"}}}'
      },
      context: { tone: ['editorial'], brandColor: '#123456' }
    })
    expect(prompt).toContain('IMMUTABLE DESIGN TASK PROFILE')
    expect(prompt).toContain('Target: app')
    expect(prompt).toContain('source: root-design-md')
    expect(prompt).toContain('immutable root DESIGN.md snapshot')
    expect(prompt).toContain('hash-at-admission')
    expect(prompt).toContain('Do not re-read the current workspace file')
    expect(prompt).toContain('#123456')
    expect(prompt).toContain('interactive HTML interface')
  })

  it('blocks ShapeOps and HTML output when the locked drawing is Excalidraw', () => {
    const prompt = applyDesignTaskProfileContract('What does this sketch show?', {
      version: 1,
      documentTarget,
      outputMedium: 'html',
      target: 'web',
      preset: 'none',
      canvasEngine: 'excalidraw',
      context: { tone: [] }
    })
    expect(prompt).toContain('Canvas engine: excalidraw')
    expect(prompt).toContain('EXCALIDRAW SKETCH CONTRACT')
    expect(prompt).toContain('Write or edit .kun-design/doc_design/excalidraw.json')
    expect(prompt).toContain('design_apply_excalidraw')
    expect(prompt).not.toContain('The user draws in Excalidraw')
    expect(prompt).not.toContain('interactive HTML interface as the main deliverable')
  })
})
