import { describe, expect, it, vi } from 'vitest'
import { canAcceptComposerFileDrop, routeComposerFileDrop } from './composer-file-drop'

function file(name: string, type = ''): File {
  return { name, type } as File
}

describe('composer multi-format drop routing', () => {
  it.each([
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['book.xlsx', 'application/octet-stream'],
    ['deck.pptx', '']
  ])('routes %s to the runtime attachment pipeline', (name, type) => {
    const onPickAttachments = vi.fn()
    const onAddFileReference = vi.fn()
    const source = { files: [file(name, type)], types: ['Files'] }
    const options = {
      canPickAttachment: true,
      canPickLocalFileReference: true,
      canAddFileReference: true,
      workspaceRoot: '/workspace',
      onPickAttachments,
      onAddFileReference,
      getPathForFile: () => `/workspace/${name}`
    }

    expect(canAcceptComposerFileDrop(source, options)).toBe(true)
    expect(routeComposerFileDrop(source, options)).toBe(true)
    expect(onPickAttachments).toHaveBeenCalledWith([source.files[0]])
    expect(onAddFileReference).not.toHaveBeenCalled()
  })

  it.each(['archive.bin', 'legacy.xls'])(
    'keeps unsupported %s files as local tool references',
    (name) => {
    const onPickAttachments = vi.fn()
    const onAddFileReference = vi.fn()
    const source = { files: [file(name, 'application/octet-stream')], types: ['Files'] }
    const options = {
      canPickAttachment: true,
      canPickLocalFileReference: true,
      canAddFileReference: true,
      workspaceRoot: '/workspace',
      onPickAttachments,
      onAddFileReference,
      getPathForFile: () => `/workspace/${name}`
    }

    expect(routeComposerFileDrop(source, options)).toBe(true)
    expect(onPickAttachments).not.toHaveBeenCalled()
    expect(onAddFileReference).toHaveBeenCalledWith(expect.objectContaining({
      path: `/workspace/${name}`,
      relativePath: name,
      type: 'file'
    }))
    }
  )

  it('routes dropped files onto the extra workspace that owns them', () => {
    const onAddFileReference = vi.fn()
    const source = { files: [file('server.ts')], types: ['Files'] }
    expect(routeComposerFileDrop(source, {
      canPickAttachment: false,
      canPickLocalFileReference: true,
      canAddFileReference: true,
      workspaceRoot: '/frontend',
      extraWorkspaceRoots: ['/backend'],
      onAddFileReference,
      getPathForFile: () => '/backend/src/server.ts'
    })).toBe(true)
    expect(onAddFileReference).toHaveBeenCalledWith({
      path: '/backend/src/server.ts',
      relativePath: 'src/server.ts',
      name: 'server.ts',
      type: 'file',
      workspaceRoot: '/backend'
    })
  })
})
