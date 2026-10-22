import { useEffect, useMemo } from 'react'
import { terminalOutputFromComposerContext } from '../../lib/terminal-output-attachment'
import { workspaceRootScopeKey } from '../../lib/workspace-path'
import { resolveActiveExtensionWorkspaceRoot } from '../../extensions/active-extension-workspace'
import {
  useCommittedExtensionContributionLoadContext
} from '../../extensions/use-contributions'
import type { ExtensionContributionLoadContext } from '../../extensions/contribution-load-coordinator'
import type { useWorkbenchChatStoreState } from './useWorkbenchChatStoreState'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { messageQuoteFromComposerContext } from '../../lib/message-quote'

type WorkbenchState = ReturnType<typeof useWorkbenchChatStoreState>

type Params = {
  activeThreadId: string | null
  threads: WorkbenchState['threads']
  workspaceRoot: string
  route: WorkbenchState['route']
  language: string
  extensionComposerContexts: WorkbenchState['extensionComposerContexts']
  attachExtensionComposerContext: WorkbenchState['attachExtensionComposerContext']
}

export function useWorkbenchExtensionContext({
  activeThreadId,
  threads,
  workspaceRoot,
  route,
  language,
  extensionComposerContexts,
  attachExtensionComposerContext
}: Params) {
  const extensionWorkspaceRoot = useMemo(
    () => resolveActiveExtensionWorkspaceRoot(activeThreadId, threads, workspaceRoot),
    [activeThreadId, threads, workspaceRoot]
  )

  useEffect(() => {
    if (typeof window.kunGui?.onExtensionComposerContext !== 'function') return
    return window.kunGui.onExtensionComposerContext(attachExtensionComposerContext)
  }, [attachExtensionComposerContext])

  const activeComposerContextEvents = useMemo(() => {
    if (route !== 'chat') return []
    const workspace = workspaceRootScopeKey(extensionWorkspaceRoot)
    return extensionComposerContexts.filter((event) =>
      workspaceRootScopeKey(event.workspaceRoot) === workspace &&
      (!event.threadId || event.threadId === activeThreadId)
    )
  }, [activeThreadId, extensionComposerContexts, extensionWorkspaceRoot, route])

  const extensionComposerContextChips = useMemo(
    () => activeComposerContextEvents.map(composerContextChip),
    [activeComposerContextEvents]
  )

  const selectedPreviewElementCount = useMemo(() => activeComposerContextEvents.filter((event) =>
    'source' in event.attachment.provenance &&
    event.attachment.provenance.source === 'dev-preview' &&
    event.attachment.reference.kind === 'element'
  ).length, [activeComposerContextEvents])

  const extensionContributionLoadContext = useMemo<ExtensionContributionLoadContext>(() => ({
    workspaceRoot: extensionWorkspaceRoot,
    locale: language
  }), [extensionWorkspaceRoot, language])
  const extensionContributionLoadContextRef =
    useCommittedExtensionContributionLoadContext(extensionContributionLoadContext)

  return {
    activeComposerContextEvents,
    extensionComposerContextChips,
    extensionContributionLoadContext,
    extensionContributionLoadContextRef,
    extensionWorkspaceRoot,
    selectedPreviewElementCount
  }
}

export function composerContextChip(
  event: WorkbenchState['extensionComposerContexts'][number]
): DesignComposerContext {
  const { attachment } = event
  const messageQuote = 'source' in attachment.provenance &&
    attachment.provenance.source === 'workspace-selection'
    ? messageQuoteFromComposerContext(attachment)
    : null
  if (messageQuote) {
    return {
      id: attachment.attachmentId,
      kind: 'message-quote',
      label: attachment.title,
      removable: true,
      messageQuote: {
        text: messageQuote.text,
        role: messageQuote.role,
        truncated: messageQuote.truncated
      }
    }
  }
  const terminalOutput = 'source' in attachment.provenance && attachment.provenance.source === 'workspace-selection'
    ? terminalOutputFromComposerContext(attachment)
    : null
  if (terminalOutput) {
    return { id: attachment.attachmentId, kind: 'terminal-output', label: attachment.title, removable: true, terminalOutput }
  }
  if (
    'source' in attachment.provenance &&
    attachment.provenance.source === 'workspace-selection' &&
    attachment.reference.kind === 'document-quote'
  ) {
    const text = stringValue(attachment.reference.text)
    const pageStart = numberValue(attachment.reference.pageStart)
    const pageEnd = numberValue(attachment.reference.pageEnd)
    const charCount = numberValue(attachment.reference.charCount)
    if (text && pageStart && pageEnd && charCount !== null) {
      return {
        id: attachment.attachmentId,
        kind: 'document-quote',
        label: attachment.title,
        removable: true,
        quote: { text, pageStart, pageEnd, charCount }
      }
    }
  }
  const kind = 'source' in attachment.provenance && attachment.provenance.source === 'dev-preview'
    ? attachment.reference.kind === 'issue' ? 'dev-preview-issue' : 'dev-preview-element'
    : 'extension-context'
  return {
    id: attachment.attachmentId,
    kind,
    label: attachment.title,
    detail: attachment.summary,
    removable: true
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
