import { describe, expect, it } from 'vitest'
import { workspaceFileIconKind } from './workspace-file-icons'
import {
  isWorkspaceConvertedImagePath,
  isWorkspacePreviewPath,
  isWorkspaceRasterImagePreviewPath,
  isWorkspaceTextBackedPreviewKind,
  workspaceFilePreviewKind
} from './workspace-text-preview'

describe('isWorkspaceRasterImagePreviewPath', () => {
  it('accepts browser image formats and the ones the main process converts', () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'heic', 'tiff']) {
      expect(isWorkspaceRasterImagePreviewPath(`/tmp/app/image.${extension}`)).toBe(true)
    }
    expect(isWorkspaceConvertedImagePath('/tmp/app/IMG_2041.HEIC')).toBe(true)
    expect(isWorkspaceConvertedImagePath('/tmp/app/photo.png')).toBe(false)
  })

  it('leaves SVG on the text-backed SVG preview path', () => {
    expect(isWorkspaceRasterImagePreviewPath('/tmp/app/image.svg')).toBe(false)
    expect(isWorkspaceRasterImagePreviewPath('/tmp/app/image.pdf')).toBe(false)
  })
})

describe('workspaceFilePreviewKind', () => {
  it('picks dedicated viewers by extension', () => {
    expect(workspaceFilePreviewKind('README.md')).toBe('markdown')
    expect(workspaceFilePreviewKind('index.html')).toBe('html')
    expect(workspaceFilePreviewKind('diagram.svg')).toBe('svg')
    expect(workspaceFilePreviewKind('usage.csv')).toBe('table')
    expect(workspaceFilePreviewKind('usage.tsv')).toBe('table')
    expect(workspaceFilePreviewKind('report.pdf')).toBe('pdf')
    expect(workspaceFilePreviewKind('legacy-report.doc')).toBe('office')
    expect(workspaceFilePreviewKind('budget.xlsx')).toBe('office')
    expect(workspaceFilePreviewKind('legacy-deck.ppt')).toBe('office')
    expect(workspaceFilePreviewKind('voice.mp3')).toBe('audio')
    expect(workspaceFilePreviewKind('demo.webm')).toBe('video')
    expect(workspaceFilePreviewKind('photo.heic')).toBe('image')
  })

  it('opens every other file as text, so content decides what is binary', () => {
    for (const name of ['.env.local', 'LICENSE', '.prettierrc', 'events.jsonl', 'mod.mts', 'fix.patch', 'api.proto', 'Dockerfile.dev', 'deploy', 'notes.cfg']) {
      expect(workspaceFilePreviewKind(`/repo/${name}`)).toBe('text')
      expect(isWorkspacePreviewPath(`/repo/${name}`)).toBe(true)
    }
  })

  it('sends known binary formats straight to the binary card', () => {
    expect(workspaceFilePreviewKind('archive.zip')).toBe('binary')
    expect(workspaceFilePreviewKind('kun-remote-0.2.1.tgz')).toBe('binary')
    expect(workspaceFilePreviewKind('model.gguf')).toBe('binary')
    expect(isWorkspaceTextBackedPreviewKind('binary')).toBe(false)
    expect(isWorkspaceTextBackedPreviewKind('table')).toBe(true)
  })
})

describe('workspaceFileIconKind', () => {
  it('maps names and extensions to tinted icon kinds', () => {
    expect(workspaceFileIconKind('/repo/src/app.tsx')).toBe('ts')
    expect(workspaceFileIconKind('/repo/main.py')).toBe('py')
    expect(workspaceFileIconKind('/repo/.env.local')).toBe('env')
    expect(workspaceFileIconKind('/repo/.prettierrc')).toBe('cfg')
    expect(workspaceFileIconKind('/repo/.gitignore')).toBe('cfg')
    expect(workspaceFileIconKind('/repo/package-lock.json')).toBe('lock')
    expect(workspaceFileIconKind('/repo/package.json')).toBe('json')
    expect(workspaceFileIconKind('/repo/LICENSE')).toBe('txt')
    expect(workspaceFileIconKind('/repo/Dockerfile.dev')).toBe('cfg')
    expect(workspaceFileIconKind('/repo/usage.csv')).toBe('sheet')
    expect(workspaceFileIconKind('/repo/vendor/kun.tgz')).toBe('zip')
    expect(workspaceFileIconKind('/repo/deploy')).toBe('file')
  })
})
