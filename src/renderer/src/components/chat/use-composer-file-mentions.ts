import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import {
  composerFileReferenceKey,
  filterWorkspaceFileMentionSuggestions,
  formatComposerKnowledgeBaseMentionToken,
  getFileMentionAtCursor,
  hasComposerFileMentionToken,
  isComposerDirectoryReference,
  removeComposerFileMentionToken,
  replaceComposerMentionWithToken,
  replaceFileMentionInInput,
  type ComposerFileMention,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { extraRootsForWorkspace } from '../../lib/code-workspace-folder-lookup'
import type { KnowledgeBaseIndexStatus, KnowledgeBaseMount } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  loadWorkspaceFileIndex,
  loadWorkspaceMentionPathSuggestions,
  mergeMentionCandidates
} from '../../lib/workspace-file-index'

export function shouldCaptureFileMentionCommitKey(
  event: Pick<ReactKeyboardEvent<HTMLTextAreaElement>, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'>
): boolean {
  if (event.key === 'Tab') return true
  return event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey
}

type Options = {
  enabled: boolean
  canCompose: boolean
  input: string
  setInput: (value: string) => void
  workspaceRoot: string
  activeThreadId: string | null
  slashQuery: string | null
  menuBlocked: boolean
  references: ComposerFileReference[]
  extraCandidates: ComposerFileReference[]
  textareaRef: RefObject<HTMLTextAreaElement | null>
  focusComposer: () => void
  onAdd?: (reference: ComposerFileReference) => void
  onRemove?: (relativePath: string) => void
}

const EMPTY_KNOWLEDGE_BASE_MOUNTS: KnowledgeBaseMount[] = []
const EMPTY_KNOWLEDGE_BASE_STATUSES: KnowledgeBaseIndexStatus[] = []

export type ComposerKnowledgeBaseMentionSuggestion = {
  kind: 'knowledge-base'
  id: string
  name: string
  status?: KnowledgeBaseIndexStatus['state']
}

export type ComposerFileMentionSuggestion = {
  kind: 'file-reference'
  reference: ComposerFileReference
}

export type ComposerMentionSuggestion =
  | ComposerKnowledgeBaseMentionSuggestion
  | ComposerFileMentionSuggestion

export function filterKnowledgeBaseMentionSuggestions(
  mounts: readonly KnowledgeBaseMount[],
  statuses: readonly KnowledgeBaseIndexStatus[],
  query: string
): ComposerKnowledgeBaseMentionSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const statusById = new Map(statuses.map((status) => [status.id, status.state]))
  return mounts
    .filter((mount) => !normalizedQuery || mount.name.toLocaleLowerCase().includes(normalizedQuery))
    .map((mount) => ({
      kind: 'knowledge-base' as const,
      id: mount.id,
      name: mount.name,
      status: statusById.get(mount.id)
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function composerMentionSuggestionKey(suggestion: ComposerMentionSuggestion): string {
  return suggestion.kind === 'knowledge-base'
    ? `knowledge-base:${suggestion.id}`
    : `file-reference:${composerFileReferenceKey(suggestion.reference)}`
}

/** Owns file-mention discovery, selection, token/reference synchronization, and keyboard capture. */
export function useComposerFileMentions({
  enabled,
  canCompose,
  input,
  setInput,
  workspaceRoot,
  activeThreadId,
  slashQuery,
  menuBlocked,
  references,
  extraCandidates,
  textareaRef,
  focusComposer,
  onAdd,
  onRemove
}: Options) {
  const activeThread = useChatStore((state) => activeThreadId
    ? state.threads.find((thread) => thread.id === activeThreadId)
    : undefined)
  const knowledgeBaseStatusMap = useChatStore((state) => state.knowledgeBaseStatuses)
  const knowledgeBases = activeThread?.knowledgeBases ?? EMPTY_KNOWLEDGE_BASE_MOUNTS
  const knowledgeBaseStatuses = activeThreadId
    ? knowledgeBaseStatusMap[activeThreadId] ?? EMPTY_KNOWLEDGE_BASE_STATUSES
    : EMPTY_KNOWLEDGE_BASE_STATUSES
  const folderSets = useChatStore((state) => state.codeWorkspaceFolderSets)
  const extraWorkspaceRoots = extraRootsForWorkspace(workspaceRoot, folderSets)
  const [cursor, setCursor] = useState(() => input.length)
  const [suggestions, setSuggestions] = useState<ComposerMentionSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const presenceRef = useRef<Map<string, boolean>>(new Map())
  const activeMention = useMemo<ComposerFileMention | null>(() => {
    if (!enabled || slashQuery != null || !workspaceRoot) return null
    return getFileMentionAtCursor(input, cursor)
  }, [cursor, enabled, input, slashQuery, workspaceRoot])
  const activeKey = activeMention
    ? `${activeMention.start}:${activeMention.query}:${activeMention.quoted ? 'q' : 'p'}`
    : null
  const showMenu = canCompose && Boolean(activeMention) && activeKey !== dismissedKey && !menuBlocked
  const highlighted = suggestions.length > 0
    ? suggestions[Math.min(selectedIndex, suggestions.length - 1)]
    : null

  useEffect(() => setSelectedIndex(0), [activeKey])

  useEffect(() => {
    if (!showMenu || !activeMention || !workspaceRoot) {
      setSuggestions((current) => (current.length === 0 ? current : []))
      setLoading(false)
      return
    }
    let cancelled = false
    const query = activeMention.query
    const knowledgeSuggestions = filterKnowledgeBaseMentionSuggestions(
      knowledgeBases,
      knowledgeBaseStatuses,
      query
    )
    const timer = window.setTimeout(() => {
      setLoading(true)
      void Promise.all([
        Promise.all(
          [workspaceRoot, ...extraWorkspaceRoots].map((root) =>
            loadWorkspaceFileIndex(root).catch(() => ({ files: [], directories: [], loadedAt: 0 }))
          )
        ),
        Promise.all(
          [workspaceRoot, ...extraWorkspaceRoots].map((root) =>
            loadWorkspaceMentionPathSuggestions(root, query).catch(() => [])
          )
        )
      ])
        .then(([indexes, pathSuggestionLists]) => {
          if (cancelled) return
          const indexedCandidates = mergeMentionCandidates(
            extraCandidates,
            indexes.flatMap((index) => [...index.directories, ...index.files])
          )
          const fileSuggestions = filterWorkspaceFileMentionSuggestions(
            mergeMentionCandidates(indexedCandidates, pathSuggestionLists.flat()), query, references
          ).map((reference) => ({ kind: 'file-reference' as const, reference }))
          setSuggestions([...knowledgeSuggestions, ...fileSuggestions])
        })
        .catch(() => {
          if (!cancelled) setSuggestions(knowledgeSuggestions)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeMention, extraCandidates, extraWorkspaceRoots, knowledgeBaseStatuses, knowledgeBases, references, showMenu, workspaceRoot])

  useEffect(() => {
    const previous = presenceRef.current
    const next = new Map<string, boolean>()
    const removedRelativePaths: string[] = []
    for (const reference of references) {
      const key = composerFileReferenceKey(reference)
      const present = hasComposerFileMentionToken(
        input,
        reference.relativePath,
        isComposerDirectoryReference(reference)
      )
      if (previous.get(key) === true && !present) removedRelativePaths.push(reference.relativePath)
      next.set(key, present)
    }
    presenceRef.current = next
    if (!onRemove) return
    for (const relativePath of removedRelativePaths) onRemove(relativePath)
  }, [input, onRemove, references])

  const syncCursor = (element = textareaRef.current): void => {
    if (element) setCursor(element.selectionStart ?? input.length)
  }

  const updateInput = (value: string, nextCursor: number): void => {
    setInput(value)
    setCursor(nextCursor)
    setDismissedKey(null)
  }

  const applySuggestion = (suggestion: ComposerMentionSuggestion | null): void => {
    if (!suggestion || !activeMention) return
    const next = suggestion.kind === 'knowledge-base'
      ? replaceComposerMentionWithToken(
          input,
          activeMention,
          formatComposerKnowledgeBaseMentionToken(suggestion.name)
        )
      : replaceFileMentionInInput(input, activeMention, suggestion.reference)
    setInput(next.input)
    if (suggestion.kind === 'file-reference') onAdd?.(suggestion.reference)
    setDismissedKey(null)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
      setCursor(next.cursor)
    })
  }

  const removeReference = (reference: ComposerFileReference): void => {
    onRemove?.(reference.relativePath)
    presenceRef.current.set(composerFileReferenceKey(reference), false)
    const nextInput = removeComposerFileMentionToken(
      input,
      reference.relativePath,
      isComposerDirectoryReference(reference)
    )
    if (nextInput !== input) {
      setInput(nextInput)
      window.requestAnimationFrame(() => syncCursor())
    }
    focusComposer()
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    composing: boolean
  ): boolean => {
    if (composing || !showMenu) return false
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % suggestions.length)
      return true
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => current === 0 ? suggestions.length - 1 : current - 1)
      return true
    }
    if (shouldCaptureFileMentionCommitKey(event)) {
      event.preventDefault()
      if (highlighted) applySuggestion(highlighted)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedKey(activeKey)
      setSuggestions([])
      return true
    }
    return false
  }

  return {
    showMenu,
    suggestions,
    loading,
    selectedIndex,
    highlighted,
    setCursor,
    syncCursor,
    updateInput,
    applySuggestion,
    hasMountedKnowledgeBases: knowledgeBases.length > 0,
    removeReference,
    handleKeyDown
  }
}
