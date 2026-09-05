import { afterEach, describe, expect, it, vi } from 'vitest'

const { uploadAttachment } = vi.hoisted(() => ({ uploadAttachment: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ uploadAttachment }) }))
import { useWorkbenchAttachmentController } from './useWorkbenchAttachmentController'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('document attachment controller', () => {
  it.each(['pdf', 'docx'])('keeps %s source bytes out of the renderer when the bridge is available', async (format) => {
    const filePath = `/tmp/spec.${format}`
    vi.stubGlobal('window', { kunGui: {
      getPathForFile: () => filePath,
      uploadRuntimeDocumentAttachment: vi.fn(),
      readLocalPdfText: async () => ({ ok: true, path: filePath, text: 'Document text', pageCount: 1 }),
      readLocalOfficeDocument: async () => ({
        ok: true, name: 'spec.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        documentText: 'Document text', format: 'docx', sourceSha256: 'a'.repeat(64)
      })
    } })
    const arrayBuffer = vi.fn(() => { throw new Error('source bytes must stay in main') })
    uploadAttachment.mockResolvedValue({ id: 'att_doc', name: `spec.${format}`, kind: 'document' })
    const setError = vi.fn()
    const setAttachments = vi.fn()
    const controller = useWorkbenchAttachmentController({
      attachmentUploadEnabled: true, selectedModelSupportsImageInput: false,
      attachmentCapabilities: {} as never, activeThreadId: 'thr_1',
      setAttachmentUploadBusy: vi.fn(), setAttachmentUploadError: setError,
      setComposerAttachmentsForScope: setAttachments, setComposerAttachments: vi.fn(),
      getAttachmentScope: () => 'chat', getActiveWorkspace: () => '/tmp'
    })
    await controller.handlePickAttachments([{
      name: `spec.${format}`, type: format === 'pdf' ? 'application/pdf' : '', arrayBuffer
    } as unknown as File])
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({
      dataBase64: '', localFilePath: filePath, documentText: 'Document text'
    }))
    expect(setError).toHaveBeenCalledExactlyOnceWith(null)
    expect(setAttachments).toHaveBeenCalledOnce()
  })
})
