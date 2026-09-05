import { vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { createWriteDocumentSession, writeDocumentKey } from '../../write/write-editor-layout'
import type { useWorkbenchComposerSubmitController } from './useWorkbenchComposerSubmitController'

export type ControllerParams = Parameters<typeof useWorkbenchComposerSubmitController>[0]

export function controllerParams(overrides: Partial<ControllerParams> = {}): ControllerParams {
  return {
    activeClawChannelId: '',
    activeSddDraft: false,
    activeThreadId: 'thr_mapped',
    attachmentUploadEnabled: true,
    buildCodeCanvasOutboundPrompt: vi.fn(async () => ''),
    clearComposerAttachments: vi.fn(),
    removeComposerAttachments: vi.fn(),
    clearComposerFileReferences: vi.fn(),
    restoreComposerAttachments: vi.fn(async () => undefined),
    restoreComposerFileReferences: vi.fn(),
    composerAttachments: [],
    composerFileReferences: [],
    composerMode: 'agent',
    composerModel: '',
    composerProviderId: '',
    composerModelGroups: [],
    composerReasoningEffort: 'auto',
    composerFastMode: false,
    getAttachmentScope: () => 'write',
    handleGuiPlanCommand: vi.fn(),
    input: 'keep this prompt',
    resetClawChannelSession: vi.fn(async () => undefined),
    requestAutoPlanBuild: vi.fn(async () => 'rejected' as const),
    rightPanelMode: null,
    route: 'write',
    selectClawChannel: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => true),
    sendPlanTurn: vi.fn(async () => false),
    sendSddAssistantPrompt: vi.fn(async () => undefined),
    setAttachmentUploadError: vi.fn(),
    setClawChannelModel: vi.fn(async () => undefined),
    setError: vi.fn(),
    setInput: vi.fn(),
    threads: [],
    workspaceRoot: '/tmp/write',
    appendLocalClawTurn: vi.fn(),
    ...overrides
  }
}

export function activateTextFile(): void {
  useWriteWorkspaceStore.setState({
    workspaceRoot: '/tmp/write',
    activeFilePath: '/tmp/write/draft.md',
    activeFileKind: 'text',
    fileContent: 'saved draft',
    persistedContent: 'saved draft',
    fileTruncated: false,
    documentEpoch: 1,
    contentRevision: 0,
    saveStatus: 'saved',
    fileError: null,
    reviewActive: false,
    pendingAgentReview: null,
    quotedSelections: [],
    agentPresets: [],
    assistantAgentPresetId: '',
    assistantModel: '',
    assistantProviderId: ''
  })
}

export function activateOfficeFile(): void {
  const path = '/tmp/write/report.docx'
  const preview = {
    ok: true as const,
    path,
    name: 'report.docx',
    sourceFormat: 'docx' as const,
    renderFormat: 'docx' as const,
    viewer: 'word' as const,
    size: 128,
    mtimeMs: 1,
    sourceSha256: 'a'.repeat(64),
    data: new Uint8Array([1, 2, 3])
  }
  const document = createWriteDocumentSession({
    path,
    kind: 'office',
    officePreview: preview,
    fileSize: preview.size,
    documentEpoch: 4
  })
  useWriteWorkspaceStore.setState({
    workspaceRoot: '/tmp/write',
    activeFilePath: path,
    activeFileKind: 'office',
    fileContent: '',
    persistedContent: '',
    fileTruncated: false,
    documentEpoch: 4,
    contentRevision: 0,
    saveStatus: 'saved',
    fileError: null,
    reviewActive: false,
    pendingAgentReview: null,
    quotedSelections: [],
    documentsByPath: { [writeDocumentKey(path)]: document },
    agentPresets: [],
    assistantAgentPresetId: '',
    assistantModel: '',
    assistantProviderId: ''
  })
}
