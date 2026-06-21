import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from './write-workspace-store'

function installDsGui(overrides: Partial<Window['kunGui']>): void {
  vi.stubGlobal('window', {
    kunGui: overrides
  })
}

function activateTextFile(path = '/tmp/write/draft.md'): void {
  useWriteWorkspaceStore.setState({
    activeFilePath: path,
    activeFileKind: 'text',
    fileContent: 'old content',
    fileError: null,
    fileLoading: false,
    saveStatus: 'saved'
  })
}

afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  vi.unstubAllGlobals()
})

describe('write workspace store', () => {
  it('refreshes the workspace and opens the imported lark document', async () => {
    const refreshWorkspace = vi.fn(async () => undefined)
    const openFile = vi.fn(async () => undefined)
    const importLarkDocumentToWorkspace = vi.fn(async () => ({
      ok: true as const,
      source: 'lark' as const,
      status: 'enabled' as const,
      path: '/tmp/write/飞书文档/Fake.md',
      metadataPath: '/tmp/write/飞书文档/Fake.lark.json',
      title: 'Fake',
      message: 'imported'
    }))
    installDsGui({ importLarkDocumentToWorkspace })
    useWriteWorkspaceStore.setState({ refreshWorkspace, openFile })

    const result = await useWriteWorkspaceStore.getState().importLarkDocument('/tmp/write', {
      id: 'lark:fake',
      source: 'lark',
      title: 'Fake',
      url: 'https://example.feishu.cn/docx/fake',
      token: 'fake',
      extension: 'docx'
    })

    expect(result.ok).toBe(true)
    expect(importLarkDocumentToWorkspace).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write',
      document: expect.objectContaining({ token: 'fake' })
    })
    expect(refreshWorkspace).toHaveBeenCalledWith('/tmp/write')
    expect(openFile).toHaveBeenCalledWith('/tmp/write', '/tmp/write/飞书文档/Fake.md')
  })

  it('reports read errors when syncing the active text file from disk', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async () => {
        throw new Error('read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileError: 'read failed',
      saveStatus: 'error'
    })
  })

  it('does not apply late read errors after the active text file changes', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async () => {
        useWriteWorkspaceStore.setState({ activeFilePath: '/tmp/write/next.md' })
        throw new Error('late read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      activeFilePath: '/tmp/write/next.md',
      fileError: null,
      saveStatus: 'saved'
    })
  })
})
