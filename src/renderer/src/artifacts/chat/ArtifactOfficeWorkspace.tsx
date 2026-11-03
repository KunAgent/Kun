import { useMemo, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import type { LibraryArtifact } from '../artifact-types'
import { resolveArtifactChatBinding, useArtifactChatBinding } from './artifact-chat-binding'
import { closeArtifactCompare, restoreArtifactVersion, useArtifactChatSession } from './artifact-chat-session'
import { officeFormatForPath } from './artifact-office-diff'
import { ArtifactChatPanel } from './ArtifactChatPanel'
import { ArtifactOfficeStage } from './ArtifactOfficeStage'
import { useArtifactOfficeSession, type ArtifactChatHost } from './use-artifact-office-session'

/** PPTX, DOCX and XLSX artifacts get the chat panel; Kun edits these formats in place. */
export function artifactHasOfficeChat(artifact: Pick<LibraryArtifact, 'kind' | 'path'>): boolean {
  return (artifact.kind === 'slides' || artifact.kind === 'doc' || artifact.kind === 'sheet') &&
    officeFormatForPath(artifact.path) !== null
}

/** Stage and chat panel for an Office artifact. Below `lg` the panel is a drawer over the stage. */
export function ArtifactOfficeWorkspace({ artifact, host, chatOpen, onCloseChat }: {
  artifact: LibraryArtifact
  host: ArtifactChatHost
  chatOpen: boolean
  onCloseChat: () => void
}): ReactElement {
  const threads = useChatStore((state) => state.threads)
  const bindingState = useArtifactChatBinding(useShallow((state) => ({ threads: state.threads, drafts: state.drafts })))
  const binding = useMemo(() => resolveArtifactChatBinding(artifact, threads, bindingState), [artifact, bindingState, threads])
  const threadId = binding.thread?.id ?? null
  const session = useArtifactOfficeSession(artifact, host, threadId)
  const compare = useArtifactChatSession((state) => state.compare[artifact.id] ?? null)
  const latest = useArtifactChatSession((state) => state.latest[artifact.id] ?? null)
  const restoring = useArtifactChatSession((state) => state.restoring[artifact.id] === true)
  const pending = useArtifactChatSession((state) => Boolean(state.pending[artifact.id]))
  const changedSlides = useMemo(() => latest?.change.kind === 'presentation'
    ? [...latest.change.changedSlides, ...latest.change.addedSlides]
    : undefined, [latest])
  const running = Boolean(threadId && host.activeThreadId === threadId && host.busy)
  const editing = session.officeAgentEditing || (pending && running)
  const currentSha = session.officeResult?.ok ? session.officeResult.sourceSha256 : ''

  return (
    <div className="ds-no-drag relative mt-3 flex min-h-0 flex-1 overflow-hidden border-t border-ds-border" data-artifact-office-workspace>
      <section aria-label={artifact.title} className="relative min-h-0 min-w-0 flex-1">
        <ArtifactOfficeStage
          artifact={artifact}
          session={session}
          compare={compare}
          changedSlides={changedSlides}
          editing={editing}
          restoring={restoring}
          onRestoreCompare={() => { if (compare && currentSha) void restoreArtifactVersion(artifact, compare.versionId, currentSha) }}
          onCloseCompare={() => closeArtifactCompare(artifact.id)}
        />
      </section>
      <ArtifactChatPanel
        artifact={artifact}
        host={host}
        session={session}
        binding={binding}
        onClose={onCloseChat}
        className={chatOpen
          ? 'absolute inset-y-0 right-0 z-30 flex w-[min(400px,100%)] shadow-[-12px_0_28px_rgba(24,24,27,0.14)] lg:static lg:w-[400px] lg:shrink-0 lg:shadow-none'
          : 'hidden w-[400px] shrink-0 lg:flex'}
      />
    </div>
  )
}
