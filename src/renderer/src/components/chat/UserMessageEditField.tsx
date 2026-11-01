import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import { useTranslation } from 'react-i18next'
import type { UserFileReference } from '../../agent/types'
import {
  composerFileReferenceKey,
  hasComposerFileMentionToken,
  isComposerDirectoryReference,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useChatStore } from '../../store/chat-store'
import { getSlashQuery, type SlashCommand } from './floating-composer-commands'
import { FloatingComposerFileMentionMenu } from './FloatingComposerFileMentionMenu'
import { FloatingComposerSlashCommandMenu } from './FloatingComposerSlashCommandMenu'
import { useComposerFileMentions } from './use-composer-file-mentions'
import { buildComposerSlashCommands, type ComposerSkillCommand } from './use-composer-slash-command-menu'

type MessageEditAssist = {
  skillCommands: ComposerSkillCommand[]
  disabledSkillIds?: string[]
}

const EMPTY_ASSIST: MessageEditAssist = { skillCommands: [] }
const NO_EXTRA_CANDIDATES: ComposerFileReference[] = []
const MessageEditAssistContext = createContext<MessageEditAssist>(EMPTY_ASSIST)

/** Lends the composer's skill catalog to messages edited in the timeline. */
export function MessageEditAssistProvider({
  skillCommands,
  disabledSkillIds,
  children
}: MessageEditAssist & { children: ReactNode }): ReactElement {
  const value = useMemo(() => ({ skillCommands, disabledSkillIds }), [disabledSkillIds, skillCommands])
  return <MessageEditAssistContext.Provider value={value}>{children}</MessageEditAssistContext.Provider>
}

export function userToComposerFileReferences(references: UserFileReference[]): ComposerFileReference[] {
  return references.map((reference) => ({
    path: reference.path,
    relativePath: reference.relativePath,
    name: reference.name,
    type: reference.kind === 'directory' ? 'directory' : 'file'
  }))
}

/** References the edited text still mentions, in the shape a send carries. */
export function editedFileReferences(text: string, references: ComposerFileReference[]): UserFileReference[] {
  return references
    .filter((reference) => hasComposerFileMentionToken(
      text,
      reference.relativePath,
      isComposerDirectoryReference(reference)
    ))
    .map((reference) => ({
      path: reference.path,
      relativePath: reference.relativePath,
      name: reference.name,
      kind: isComposerDirectoryReference(reference) ? 'directory' : 'file'
    }))
}

const EDIT_TEXTAREA_MAX_HEIGHT = 360

/** Grows the edit textarea with its content; it scrolls only past the cap. */
export function autosizeEditTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  const height = Math.min(element.scrollHeight, EDIT_TEXTAREA_MAX_HEIGHT)
  element.style.height = `${height}px`
  element.style.overflowY = element.scrollHeight > EDIT_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

function useEditSkillMenu(input: string, setInput: (value: string) => void) {
  const { t } = useTranslation('common')
  const { skillCommands, disabledSkillIds } = useContext(MessageEditAssistContext)
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const query = getSlashQuery(input)
  // Only skills: the other slash commands act on the composer or the thread
  // and mean nothing inside an edited message.
  const skills = useMemo(() => buildComposerSlashCommands({
    t,
    route,
    runtimeReady: true,
    busy: false,
    activeThreadId: null,
    activeThreadArchived: false,
    canOpenGoalPanel: false,
    canCreateNewThread: false,
    workspaceRoot,
    hasPlanCommand: false,
    hasBtwCommand: false,
    hideBtwCommand: true,
    hasReviewCommand: false,
    skillCommands,
    disabledSkillIds
  }).filter((command) => command.kind === 'skill'), [disabledSkillIds, route, skillCommands, t, workspaceRoot])
  const matches = useMemo(() => {
    if (query == null) return []
    if (!query) return skills
    return skills.filter((command) =>
      [command.id, command.title, command.description, ...command.keywords]
        .some((part) => part.toLowerCase().includes(query)))
  }, [query, skills])
  const [selectedIndex, setSelectedIndex] = useState(0)
  useEffect(() => setSelectedIndex(0), [query])
  const highlighted: SlashCommand | null = matches.length > 0
    ? matches[Math.min(selectedIndex, matches.length - 1)]
    : null
  const apply = (id: string): void => {
    const command = matches.find((item) => item.id === id)
    if (command?.skillPrompt) setInput(command.skillPrompt)
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>, composing: boolean): boolean => {
    if (composing || matches.length === 0) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : matches.length - 1
      setSelectedIndex((current) => (current + step) % matches.length)
      return true
    }
    if ((event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
      event.preventDefault()
      if (highlighted) apply(highlighted.id)
      return true
    }
    return false
  }
  return { open: matches.length > 0, matches, highlighted, selectedIndex, apply, handleKeyDown }
}

/**
 * The textarea of a user message being edited, with the composer's `@` file
 * and folder mentions and `/` skills. Mentions picked here, and the ones the
 * original message carried, travel with the resend while their token remains.
 */
export function UserMessageEditField({
  value,
  onChange,
  references,
  onReferencesChange,
  textareaRef,
  onSubmit,
  onCancel
}: {
  value: string
  onChange: (value: string) => void
  references: ComposerFileReference[]
  onReferencesChange: (references: ComposerFileReference[]) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onSubmit: () => void
  onCancel: () => void
}): ReactElement {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const workspaceRoot = useChatStore((s) => normalizeWorkspaceRoot(
    s.threads.find((thread) => thread.id === s.activeThreadId)?.workspace || s.workspaceRoot
  ))
  const skillMenu = useEditSkillMenu(value, onChange)
  const fileMentions = useComposerFileMentions({
    enabled: Boolean(workspaceRoot),
    canCompose: true,
    input: value,
    setInput: onChange,
    workspaceRoot,
    activeThreadId,
    slashQuery: getSlashQuery(value),
    menuBlocked: false,
    references,
    extraCandidates: NO_EXTRA_CANDIDATES,
    textareaRef,
    focusComposer: () => textareaRef.current?.focus(),
    onAdd: (reference) => {
      const key = composerFileReferenceKey(reference)
      if (references.some((item) => composerFileReferenceKey(item) === key)) return
      onReferencesChange([...references, reference])
    },
    onRemove: (relativePath) => onReferencesChange(references.filter((item) => item.relativePath !== relativePath))
  })


  return (
    <div className="relative">
      {skillMenu.open ? (
        <FloatingComposerSlashCommandMenu
          commands={skillMenu.matches}
          highlighted={skillMenu.highlighted}
          selectedIndex={skillMenu.selectedIndex}
          onSelect={skillMenu.apply}
        />
      ) : null}
      {fileMentions.showMenu ? (
        <FloatingComposerFileMentionMenu
          suggestions={fileMentions.suggestions}
          loading={fileMentions.loading}
          selectedIndex={fileMentions.selectedIndex}
          highlighted={fileMentions.highlighted}
          hasMountedKnowledgeBases={fileMentions.hasMountedKnowledgeBases}
          knowledgeBaseHint={false}
          onSelect={fileMentions.applySuggestion}
        />
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          fileMentions.updateInput(event.target.value, event.target.selectionStart ?? event.target.value.length)
          autosizeEditTextarea(event.currentTarget)
        }}
        onSelect={(event) => fileMentions.syncCursor(event.currentTarget)}
        onKeyDown={(event) => {
          const composing = event.nativeEvent.isComposing
          if (fileMentions.handleKeyDown(event, composing)) return
          if (skillMenu.handleKeyDown(event, composing)) return
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSubmit()
          }
        }}
        rows={2}
        className="block w-full min-w-0 resize-none overflow-y-hidden break-words bg-transparent text-[15px] leading-[1.6] text-ds-ink outline-none [overflow-wrap:anywhere] [scrollbar-width:thin] focus:outline-none focus-visible:outline-none"
      />
    </div>
  )
}
