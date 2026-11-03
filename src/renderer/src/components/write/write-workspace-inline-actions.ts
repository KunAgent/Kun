import type { RefObject } from 'react'
import type { TFunction } from 'i18next'
import { WRITE_INFOGRAPHIC_MAX_TEXT_CHARS } from '@shared/write-infographic'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { WriteBlockType } from '../../write/block-type'
import { toggleWriteInlineFormat, type WriteInlineFormatKind } from '../../write/inline-format'
import type { ResolvedWriteQuickAction } from '../../write/quick-actions'
import {
  beginPendingInfographic,
  buildPendingInfographicMarkdown,
  finishPendingInfographic,
  lineEndAfter,
  replacePendingInfographicInText
} from '../../write/infographic-pending'
import type { WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import type { WriteMarkdownEditorHandle } from './WriteMarkdownEditor'
import type { SelectionEditInput } from './selection-menu/use-selection-edit'
import type { WriteNotice } from './write-workspace-view-utils'
import {
  captureWriteDocumentContext,
  writeDocumentContextMatches,
  type WriteDocumentContext
} from '../../write/write-document-context'
import { enqueueWriteWorkspaceFileTask } from '../../write/write-save-coordinator'

type WriteWorkspaceState = ReturnType<typeof useWriteWorkspaceStore.getState>

type Params = {
  startSelectionEdit: (input: SelectionEditInput) => Promise<void>
  t: TFunction<'common'>
  workspaceReady: boolean
  workspaceRoot: string
  activeFilePath: string | null
  renderReadOnly: boolean
  richModeActive: boolean
  selection: WriteWorkspaceState['selection']
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  richHandleRef: RefObject<WriteRichEditorHandle | null>
  markdownHandleRef: RefObject<WriteMarkdownEditorHandle | null>
  setAssistantOpen: WriteWorkspaceState['setAssistantOpen']
  setFileContent: WriteWorkspaceState['setFileContent']
  setFileError: WriteWorkspaceState['setFileError']
  setSelection: WriteWorkspaceState['setSelection']
  quoteCurrentSelection: WriteWorkspaceState['quoteCurrentSelection']
  showExportNotice: (notice: WriteNotice) => void
}

export function createWriteWorkspaceInlineActions({
  t,
  startSelectionEdit,
  workspaceReady,
  workspaceRoot,
  activeFilePath,
  renderReadOnly,
  richModeActive,
  selection,
  input,
  setInput,
  onSubmitPrompt,
  richHandleRef,
  markdownHandleRef,
  setAssistantOpen,
  setFileContent,
  setFileError,
  setSelection,
  quoteCurrentSelection,
  showExportNotice
}: Params) {
  const submitInlineAgent = (prompt: string): void => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath) return
    // The active agent persona is applied downstream (folded into the prompt
    // context in sendWritePrompt) so it never shows as raw text in the bubble.
    setSelection(selection)
    quoteCurrentSelection(workspaceRoot)
    setAssistantOpen(true)
    if (onSubmitPrompt) {
      onSubmitPrompt(trimmed)
      return
    }
    setInput(input.trim() ? `${input.trim()}\n\n${trimmed}` : trimmed)
  }

  const quoteSelectionToAssistant = (): void => {
    if (!workspaceReady || !activeFilePath) return
    setSelection(selection)
    quoteCurrentSelection(workspaceRoot)
  }

  // Edit-mode quick actions rewrite the selection in place through the
  // inline-edit pipeline; chat-mode actions quote the selection and hand the
  // prompt to the sidebar assistant.
  const runQuickAction = (quickAction: ResolvedWriteQuickAction): void => {
    if (quickAction.mode === 'edit') {
      void startSelectionEdit({ instruction: quickAction.prompt, label: quickAction.label, source: { kind: 'skill', actionId: quickAction.id } })
      return
    }
    submitInlineAgent(quickAction.prompt)
  }

  const applyInlineFormat = (kind: WriteInlineFormatKind): void => {
    if (!workspaceReady || !activeFilePath || renderReadOnly) return
    const richHandle = richModeActive ? richHandleRef.current : null
    if (richHandle) {
      richHandle.toggleInlineFormat(kind)
      return
    }
    if (selection.ranges.length !== 1) return
    const range = selection.ranges[0]
    const replacement = toggleWriteInlineFormat(range.text, kind)
    if (replacement === null) return
    markdownHandleRef.current?.applyRangeReplacement(
      { from: range.from, to: range.to },
      range.text,
      replacement,
      kind === 'link' ? { from: replacement.lastIndexOf('https://'), to: replacement.lastIndexOf('https://') + 8 } : undefined
    )
  }

  const applyBlockType = (type: WriteBlockType): void => {
    if (!workspaceReady || !activeFilePath || renderReadOnly) return
    const richHandle = richModeActive ? richHandleRef.current : null
    if (richHandle) {
      richHandle.setBlockType(type)
      return
    }
    const effective = selection.blockType === type && type !== 'paragraph' ? 'paragraph' : type
    markdownHandleRef.current?.setBlockType(effective)
  }

  const submitInlineEdit = (instruction: string): Promise<void> => startSelectionEdit({ instruction })

  const generateInfographic = (): void => {
    if (!workspaceReady || !activeFilePath) return
    if (renderReadOnly) {
      setFileError(t('writeReadOnlySaveDisabled'))
      return
    }
    if (selection.ranges.length !== 1 || !selection.text.trim()) {
      setFileError(t('writeInlineEditNoSelection'))
      return
    }
    if (typeof window.kunGui?.generateWriteInfographic !== 'function') {
      setFileError(t('writeInfographicUnavailable'))
      return
    }
    const range = selection.ranges[0]
    const richHandle = richModeActive ? richHandleRef.current : null
    const filePath = activeFilePath
    const operationContext = captureWriteDocumentContext(useWriteWorkspaceStore.getState())
    if (!operationContext) return
    const text = selection.text.trim().slice(0, WRITE_INFOGRAPHIC_MAX_TEXT_CHARS)
    const pending = beginPendingInfographic()
    const pendingMarkdown = buildPendingInfographicMarkdown(t('writeInfographicAlt'), pending.src)
    const insertion = `\n\n${pendingMarkdown}\n`
    if (richHandle) {
      const projection = richHandle.getProjectionText() ?? ''
      const insertAt = lineEndAfter(projection, range.to)
      const applied = richHandle.applyProjectedReplacement(
        { from: insertAt, to: insertAt },
        '',
        insertion,
        t('writeInfographicGenerate')
      )
      if (!applied) {
        finishPendingInfographic(pending.id)
        setFileError(t('writeInlineEditChanged'))
        return
      }
    } else {
      const latest = useWriteWorkspaceStore.getState()
      if (
        latest.activeFilePath !== filePath ||
        latest.activeFileKind !== 'text' ||
        latest.fileContent.slice(range.from, range.to) !== range.text
      ) {
        finishPendingInfographic(pending.id)
        setFileError(t('writeInlineEditChanged'))
        return
      }
      const insertAt = lineEndAfter(latest.fileContent, range.to)
      setFileContent(
        latest.fileContent.slice(0, insertAt) + insertion + latest.fileContent.slice(insertAt)
      )
    }
    setSelection({ text: '', ranges: [], charCount: 0 })
    setFileError(null)
    void completeInfographicGeneration({
      id: pending.id,
      src: pending.src,
      pendingMarkdown,
      filePath,
      context: operationContext,
      text
    })
  }

  const completeInfographicGeneration = async (job: {
    id: string
    src: string
    pendingMarkdown: string
    filePath: string
    context: WriteDocumentContext
    text: string
  }): Promise<void> => {
    let replacementMarkdown: string | null = null
    let failureMessage: string | null = null
    try {
      const result = await window.kunGui.generateWriteInfographic({
        text: job.text,
        filePath: job.filePath,
        workspaceRoot: job.context.workspaceRoot
      })
      if (result.ok) {
        replacementMarkdown = `![${t('writeInfographicAlt')}](${result.relativePath})`
      } else {
        failureMessage = result.message
      }
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
    } finally {
      finishPendingInfographic(job.id)
    }

    const applied = await resolveInfographicPlaceholder(job, replacementMarkdown)
    if (failureMessage) {
      if (writeDocumentContextMatches(useWriteWorkspaceStore.getState(), job.context)) {
        setFileError(t('writeInfographicFailed', { message: failureMessage }))
      }
    } else if (applied) {
      showExportNotice({ tone: 'success', message: t('writeInfographicReady') })
    }
  }

  const resolveInfographicPlaceholder = async (
    job: {
      src: string
      pendingMarkdown: string
      filePath: string
      context: WriteDocumentContext
    },
    replacementMarkdown: string | null
  ): Promise<boolean> => {
    const latest = useWriteWorkspaceStore.getState()
    if (writeDocumentContextMatches(latest, job.context) && latest.activeFileKind === 'text') {
      const handle = richHandleRef.current
      if (handle?.replaceImageBySrc(job.src, replacementMarkdown ?? '')) return true
      const next = replacePendingInfographicInText(
        latest.fileContent,
        job.pendingMarkdown,
        replacementMarkdown
      )
      if (next === null) return false
      setFileContent(next)
      return true
    }
    if (
      latest.activeFileKind === 'text' &&
      latest.workspaceRoot === job.context.workspaceRoot &&
      latest.activeFilePath === job.filePath
    ) {
      const next = replacePendingInfographicInText(
        latest.fileContent,
        job.pendingMarkdown,
        replacementMarkdown
      )
      if (next === null) return false
      setFileContent(next)
      return true
    }
    if (
      typeof window.kunGui?.readWorkspaceFile !== 'function' ||
      typeof window.kunGui?.writeWorkspaceFile !== 'function'
    ) return false

    try {
      return await enqueueWriteWorkspaceFileTask(
        job.context.workspaceRoot,
        job.filePath,
        async () => {
          const file = await window.kunGui.readWorkspaceFile({
            path: job.filePath,
            workspaceRoot: job.context.workspaceRoot
          })
          if (!file.ok || file.truncated) return false
          const next = replacePendingInfographicInText(
            file.content,
            job.pendingMarkdown,
            replacementMarkdown
          )
          if (next === null) return false
          const written = await window.kunGui.writeWorkspaceFile({
            path: job.filePath,
            workspaceRoot: job.context.workspaceRoot,
            content: next
          })
          return written.ok
        }
      )
    } catch {
      return false
    }
  }

  return {
    applyBlockType,
    applyInlineFormat,
    generateInfographic,
    quoteSelectionToAssistant,
    runQuickAction,
    submitInlineEdit,
    submitInlineAgent
  }
}
