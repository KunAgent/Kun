import type { RefObject } from 'react'
import type { TFunction } from 'i18next'
import {
  X_ARTICLE_IMAGE_MISSING,
  type WriteExportFormat,
  type WriteRichClipboardProfile
} from '@shared/write-export'
import { useWriteWorkspaceStore, writeJoinPath } from '../../write/write-workspace-store'
import { pathsEqual } from '../../write/write-workspace-store-helpers'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { buildWritePresentationPrompt } from '../../write/write-presentation'
import {
  WRITE_RICH_CLIPBOARD_ACTION,
  exportFormatLabel,
  type WriteNotice
} from './write-workspace-view-utils'
import { renderMermaid } from '../../lib/mermaid-render'
import { splitFrontmatter } from '@shared/markdown/frontmatter'
import { parseWorkMdast } from '@shared/markdown/parse-mdast'

type WriteWorkspaceState = ReturnType<typeof useWriteWorkspaceStore.getState>
type ExportInFlight = WriteExportFormat | typeof WRITE_RICH_CLIPBOARD_ACTION | null

type MdastNode = {
  type: string
  lang?: string | null
  value?: string
  children?: MdastNode[]
}

/** Collect mermaid fence sources in document order. */
function collectMermaidSources(markdown: string): string[] {
  const { body } = splitFrontmatter(markdown)
  const mdast = parseWorkMdast(body) as unknown as MdastNode
  const sources: string[] = []
  const visit = (node: MdastNode): void => {
    if (node.type === 'code' && (node.lang ?? '') === 'mermaid') {
      sources.push(node.value ?? '')
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(mdast)
  return sources
}

/**
 * Pre-render every mermaid diagram in the document so the export IPC can
 * splice the same SVGs the editor shows (implementation §10.3).
 */
async function renderExportDiagrams(markdown: string): Promise<Record<string, string> | undefined> {
  const sources = collectMermaidSources(markdown)
  if (sources.length === 0) return undefined
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const rendered: Record<string, string> = {}
  await Promise.all(sources.map(async (source) => {
    const result = await renderMermaid(source, theme)
    if (result.ok) rendered[source] = result.svg
  }))
  return Object.keys(rendered).length > 0 ? rendered : undefined
}

type Params = {
  t: TFunction<'common'>
  workspaceReady: boolean
  workspaceRoot: string
  rootDirectory: string | null
  activeFilePath: string | null
  activeFileIsText: boolean
  fileContent: string
  presentationEnabled: boolean
  presentationInFlight: boolean
  runtimeConnection: string
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  saveTimerRef: RefObject<number | null>
  addWriteWorkspace: WriteWorkspaceState['addWriteWorkspace']
  createFile: WriteWorkspaceState['createFile']
  flushSave: WriteWorkspaceState['flushSave']
  setAssistantOpen: WriteWorkspaceState['setAssistantOpen']
  setFileError: WriteWorkspaceState['setFileError']
  ensureWriteThreadForWorkspace: (workspaceRoot: string) => unknown
  completeOnboarding: () => void
  showExportNotice: (notice: WriteNotice) => void
  setExportMenuOpen: (value: boolean) => void
  setExportingFormat: (value: ExportInFlight) => void
  setPresentationInFlight: (value: boolean) => void
  xArticleImageIndex: number
  setXArticleImageState: (state: { count: number; index: number }) => void
}

export function createWriteWorkspaceFileActions({
  t,
  workspaceReady,
  workspaceRoot,
  rootDirectory,
  activeFilePath,
  activeFileIsText,
  fileContent,
  presentationEnabled,
  presentationInFlight,
  runtimeConnection,
  input,
  setInput,
  onSubmitPrompt,
  saveTimerRef,
  addWriteWorkspace,
  createFile,
  flushSave,
  setAssistantOpen,
  setFileError,
  ensureWriteThreadForWorkspace,
  completeOnboarding,
  showExportNotice,
  setExportMenuOpen,
  setExportingFormat,
  setPresentationInFlight,
  xArticleImageIndex,
  setXArticleImageState
}: Params) {
  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(workspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        await addWriteWorkspace(picked.path)
        if (pathsEqual(useWriteWorkspaceStore.getState().workspaceRoot, picked.path)) {
          completeOnboarding()
          if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
        }
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const createDraftFile = async (): Promise<void> => {
    if (!workspaceReady) {
      await pickWriteWorkspace()
      return
    }
    const root = rootDirectory || workspaceRoot
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = writeJoinPath(root, `draft-${stamp}.md`)
    const created = await createFile(workspaceRoot, path, `# ${t('writeUntitledDraft')}\n\n`)
    if (created) completeOnboarding()
  }

  const generatePresentation = async (): Promise<void> => {
    if (!presentationEnabled || !activeFilePath || presentationInFlight) return

    const sourcePath = activeFilePath
    const sourceWorkspace = workspaceRoot
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    setPresentationInFlight(true)
    try {
      if (!await flushSave(sourceWorkspace)) {
        showExportNotice({ tone: 'error', message: t('writePptSaveFailed') })
        return
      }
      const latest = useWriteWorkspaceStore.getState()
      if (latest.workspaceRoot !== sourceWorkspace || latest.activeFilePath !== sourcePath) {
        showExportNotice({ tone: 'error', message: t('writePptSourceChanged') })
        return
      }

      const prompt = buildWritePresentationPrompt({ workspaceRoot: sourceWorkspace, sourcePath })
      setAssistantOpen(true)
      if (onSubmitPrompt) onSubmitPrompt(prompt)
      else setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writePptUnavailable', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPresentationInFlight(false)
    }
  }

  const exportCurrentFile = async (format: WriteExportFormat): Promise<void> => {
    if (!activeFilePath || !activeFileIsText) return
    if (typeof window.kunGui?.exportWriteDocument !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeExportUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(format)
    try {
      const renderedDiagrams = await renderExportDiagrams(fileContent).catch(() => undefined)
      const result = await window.kunGui.exportWriteDocument({
        path: activeFilePath,
        workspaceRoot,
        format,
        content: fileContent,
        ...(renderedDiagrams ? { renderedDiagrams } : {})
      })
      if (!result.ok) {
        if (!result.canceled) {
          showExportNotice({
            tone: 'error',
            message: t('writeExportFailed', {
              format: exportFormatLabel(format, t),
              message: result.message
            })
          })
        }
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeExportSuccess', { format: exportFormatLabel(format, t) })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeExportFailed', {
          format: exportFormatLabel(format, t),
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  const copyCurrentFileAsRichText = async (
    profile: WriteRichClipboardProfile = 'online-docs'
  ): Promise<void> => {
    if (!activeFilePath || !activeFileIsText) return
    if (typeof window.kunGui?.copyWriteDocumentAsRichText !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeCopyRichTextUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(WRITE_RICH_CLIPBOARD_ACTION)
    try {
      const result = await window.kunGui.copyWriteDocumentAsRichText({
        path: activeFilePath,
        workspaceRoot,
        content: fileContent,
        profile,
        ...(profile === 'x-articles-image' ? { imageIndex: xArticleImageIndex } : {})
      })
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: copyRichTextErrorMessage(profile, result.message, t)
        })
        return
      }
      if (profile === 'x-articles') {
        setXArticleImageState({ count: result.imageCount ?? 0, index: 0 })
      }
      if (profile === 'x-articles-image') {
        const count = result.imageCount ?? 0
        const current = result.imageIndex ?? 0
        setXArticleImageState({
          count,
          index: count > 0 ? (current + 1) % count : 0
        })
      }
      showExportNotice({
        tone: 'success',
        message: copyRichTextSuccessMessage(profile, result, t)
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeCopyRichTextFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  return {
    copyCurrentFileAsRichText,
    copyCurrentFileAsXArticle: () => copyCurrentFileAsRichText('x-articles'),
    copyCurrentFileAsXArticleImage: () => copyCurrentFileAsRichText('x-articles-image'),
    createDraftFile,
    exportCurrentFile,
    generatePresentation,
    pickWriteWorkspace
  }
}

function copyRichTextErrorMessage(
  profile: WriteRichClipboardProfile,
  message: string,
  t: TFunction<'common'>
): string {
  if (profile === 'x-articles-image' && message === X_ARTICLE_IMAGE_MISSING) {
    return t('writeCopyXArticleImageMissing')
  }
  return t('writeCopyRichTextFailed', { message })
}

function copyRichTextSuccessMessage(
  profile: WriteRichClipboardProfile,
  result: { title?: string; simplified?: boolean; overLimit?: boolean; imageCount?: number; imageIndex?: number },
  t: TFunction<'common'>
): string {
  if (profile === 'x-articles-image') {
    const current = (result.imageIndex ?? 0) + 1
    const total = result.imageCount ?? 0
    return t('writeCopyXArticleImageSuccess', {
      current,
      total,
      label: `图片 ${current}`
    })
  }
  if (profile !== 'x-articles') return t('writeCopyRichTextSuccess')
  if (result.overLimit) return t('writeCopyXArticleOverLimit')
  if ((result.imageCount ?? 0) > 0) return t('writeCopyXArticleSuccessWithImages')
  if (!result.title) return t('writeCopyXArticleSuccessNoTitle')
  return t('writeCopyXArticleSuccess')
}
