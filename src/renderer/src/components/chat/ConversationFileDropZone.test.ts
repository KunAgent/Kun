import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { COMPOSER_FILE_REFERENCE_DRAG_MIME } from '../../lib/composer-file-references'
import { ConversationFileDropZone } from './ConversationFileDropZone'
import {
  canAcceptComposerFileDrop,
  routeComposerFileDrop,
  type ComposerFileDropOptions,
  type ComposerFileDropSource
} from './composer-file-drop'

function options(overrides: Partial<ComposerFileDropOptions> = {}): ComposerFileDropOptions {
  return {
    canPickAttachment: true,
    canPickLocalFileReference: true,
    canAddFileReference: true,
    workspaceRoot: '/workspace/project',
    onPickAttachments: vi.fn(),
    onAddFileReference: vi.fn(),
    getPathForFile: (file) => `/workspace/project/${file.name}`,
    ...overrides
  }
}

function sourceFile(name = 'netassist.go'): File {
  return new File(['package main'], name, { type: 'text/plain' })
}

describe('composer file drop routing', () => {
  it('routes source files to composer references without sending anything', () => {
    const onAddFileReference = vi.fn()
    const onPickAttachments = vi.fn()
    const dropOptions = options({ onAddFileReference, onPickAttachments })
    const source: ComposerFileDropSource = {
      types: ['Files'],
      files: [sourceFile()]
    }

    expect(canAcceptComposerFileDrop(source, dropOptions)).toBe(true)
    expect(routeComposerFileDrop(source, dropOptions)).toBe(true)
    expect(onPickAttachments).not.toHaveBeenCalled()
    expect(onAddFileReference).toHaveBeenCalledWith({
      path: '/workspace/project/netassist.go',
      relativePath: 'netassist.go',
      name: 'netassist.go',
      type: 'file',
      workspaceRoot: '/workspace/project'
    })
  })

  it('routes images and PDFs as attachments while keeping source files as references', () => {
    const image = new File(['image'], 'screen.png', { type: 'image/png' })
    const pdf = new File(['pdf'], 'notes.pdf', { type: 'application/pdf' })
    const code = sourceFile('main.ts')
    const onPickAttachments = vi.fn()
    const onAddFileReference = vi.fn()
    const dropOptions = options({ onPickAttachments, onAddFileReference })
    const source: ComposerFileDropSource = {
      types: ['Files'],
      files: [image, pdf, code]
    }

    expect(routeComposerFileDrop(source, dropOptions)).toBe(true)
    expect(onPickAttachments).toHaveBeenCalledWith([image, pdf])
    expect(onAddFileReference).toHaveBeenCalledTimes(1)
    expect(onAddFileReference).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'main.ts'
    }))
  })

  it('validates and routes internal workspace reference payloads', () => {
    const onAddFileReference = vi.fn()
    const reference = {
      path: '/workspace/project/src/app.ts',
      relativePath: 'src/app.ts',
      name: 'app.ts',
      type: 'file',
      workspaceRoot: '/workspace/project'
    }
    const source: ComposerFileDropSource = {
      types: [COMPOSER_FILE_REFERENCE_DRAG_MIME],
      getData: (format) => format === COMPOSER_FILE_REFERENCE_DRAG_MIME
        ? JSON.stringify(reference)
        : ''
    }
    const dropOptions = options({ onAddFileReference })

    expect(canAcceptComposerFileDrop(source, dropOptions)).toBe(true)
    expect(routeComposerFileDrop(source, dropOptions)).toBe(true)
    expect(onAddFileReference).toHaveBeenCalledWith(reference)
  })

  it('does not claim payloads when composer capabilities are unavailable', () => {
    const onPickAttachments = vi.fn()
    const onAddFileReference = vi.fn()
    const dropOptions = options({
      canPickAttachment: false,
      canPickLocalFileReference: false,
      canAddFileReference: false,
      onPickAttachments,
      onAddFileReference
    })
    const source: ComposerFileDropSource = {
      types: ['Files'],
      files: [sourceFile()]
    }

    expect(canAcceptComposerFileDrop(source, dropOptions)).toBe(false)
    expect(routeComposerFileDrop(source, dropOptions)).toBe(false)
    expect(onPickAttachments).not.toHaveBeenCalled()
    expect(onAddFileReference).not.toHaveBeenCalled()
  })
})

describe('ConversationFileDropZone', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps its overlay active across nested drag boundaries and clears it on final leave', () => {
    let renderer: ReactTestRenderer
    const dropOptions = options()
    const dataTransfer = {
      types: ['Files'],
      files: [],
      dropEffect: 'none'
    }
    const event = {
      dataTransfer,
      preventDefault: vi.fn()
    }

    act(() => {
      renderer = create(createElement(ConversationFileDropZone, {
        options: dropOptions,
        children: createElement('div', { 'data-timeline': true })
      }))
    })
    let zone = renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'false' })

    act(() => {
      zone.props.onDragEnter(event)
      zone.props.onDragEnter(event)
    })
    zone = renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'true' })
    expect(zone.findByProps({ 'data-conversation-file-drop-overlay': true })).toBeTruthy()
    expect(JSON.stringify(renderer!.toJSON())).toContain('Release to add files to this conversation')
    expect(dataTransfer.dropEffect).toBe('copy')

    act(() => zone.props.onDragLeave())
    expect(renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'true' })).toBeTruthy()

    zone = renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'true' })
    act(() => zone.props.onDragLeave())
    expect(renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'false' })).toBeTruthy()
    act(() => renderer!.unmount())
  })

  it('stages a dropped file exactly once and clears the overlay', () => {
    const onAddFileReference = vi.fn()
    const dropOptions = options({ onAddFileReference })
    const draggedFile = sourceFile()
    const dragTransfer = {
      types: ['Files'],
      files: [],
      dropEffect: 'none'
    }
    const dropTransfer = {
      types: ['Files'],
      files: [draggedFile],
      dropEffect: 'copy'
    }
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(ConversationFileDropZone, {
        options: dropOptions,
        children: createElement('div', { 'data-timeline': true })
      }))
    })
    let zone = renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'false' })
    act(() => zone.props.onDragEnter({ dataTransfer: dragTransfer, preventDefault: vi.fn() }))
    zone = renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'true' })

    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    act(() => zone.props.onDrop({
      dataTransfer: dropTransfer,
      preventDefault,
      stopPropagation
    }))

    expect(onAddFileReference).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findByProps({ 'data-conversation-file-drop-active': 'false' })).toBeTruthy()
    act(() => renderer!.unmount())
  })
})
