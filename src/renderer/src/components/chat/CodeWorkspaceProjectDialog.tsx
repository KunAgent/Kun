import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Folder, FolderPlus, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  MAX_ADDITIONAL_WORKSPACES,
  MAX_CODE_WORKSPACE_PROJECT_NAME_LENGTH,
  codeWorkspaceProjectFor,
  workspacePathsOverlap,
  workspaceProjectFallbackName
} from '../../lib/code-workspace-folder-sets'
import { isConversationWorkspacePath, normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { workspaceDirectoryExists } from '../../lib/workspace-availability'
import { withNativeDialog } from '../../lib/native-dialog-activity'
import { useChatStore } from '../../store/chat-store'
import {
  codeProjectErrorMessage,
  submitCodeWorkspaceProjectDraft
} from '../../store/code-workspace-project-actions'
import {
  useCodeProjectEditorStore,
  type CodeProjectEditorRequest
} from '../../store/code-workspace-project-editor'
import { threadFolderSetPrimary } from '../../store/chat-store-workspace-folder-sync'

type Draft = {
  name: string
  folders: string[]
  primary: string
  syncCurrentThread: boolean
}

function initialDraft(
  request: CodeProjectEditorRequest,
  registry: ReturnType<typeof useChatStore.getState>['codeWorkspaceFolderSets']
): Draft {
  if (request.mode === 'manage' && request.primary) {
    const project = codeWorkspaceProjectFor(registry, request.primary)
    if (project) {
      return {
        name: project.displayName || workspaceProjectFallbackName(project.primary),
        folders: [project.primary, ...project.extraRoots],
        primary: project.primary,
        syncCurrentThread: false
      }
    }
    // A legacy single-folder project has no record yet. Its fixed primary is
    // the folder itself, so managing it creates the record on save.
    const legacyPrimary = normalizeWorkspaceRoot(request.primary)
    return {
      name: workspaceProjectFallbackName(legacyPrimary),
      folders: legacyPrimary ? [legacyPrimary] : [],
      primary: legacyPrimary,
      syncCurrentThread: false
    }
  }
  const seed = normalizeWorkspaceRoot(request.seedFolder ?? '')
  return {
    name: '',
    folders: seed ? [seed] : [],
    primary: seed,
    syncCurrentThread: false
  }
}

function useModalFocusTrap(
  panelRef: RefObject<HTMLFormElement | null>,
  onClose: () => void,
  closeBlocked: boolean
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!panelRef.current) return
      if (event.key === 'Escape') {
        if (closeBlocked) return
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null)
      if (!focusables.length) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeBlocked, onClose, panelRef])
}

export function CodeWorkspaceProjectDialog(): ReactElement | null {
  const { t } = useTranslation('common')
  const request = useCodeProjectEditorStore((state) => state.request)
  const close = useCodeProjectEditorStore((state) => state.close)
  const registry = useChatStore((state) => state.codeWorkspaceFolderSets)
  const conversationRoot = useChatStore((state) => state.conversationWorkspaceRoot)
  const workspaceRoot = useChatStore((state) => state.workspaceRoot)
  const busy = useChatStore((state) => state.busy)
  const threads = useChatStore((state) => state.threads)
  const adeThreads = useChatStore((state) => state.adeThreads)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const selectWorkspaceRoot = useChatStore((state) => state.selectWorkspaceRoot)
  const selectAdeWorkspaceRoot = useChatStore((state) => state.selectAdeWorkspaceRoot)
  const [draft, setDraft] = useState<Draft>(() => request
    ? initialDraft(request, registry)
    : { name: '', folders: [], primary: '', syncCurrentThread: false })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [picking, setPicking] = useState(false)
  const panelRef = useRef<HTMLFormElement | null>(null)
  const requestKey = request ? `${request.mode}:${request.primary ?? ''}:${request.seedFolder ?? ''}` : ''

  useEffect(() => {
    if (!request) return
    setDraft(initialDraft(request, useChatStore.getState().codeWorkspaceFolderSets))
    setError('')
    setSubmitting(false)
    // Reset only when a new dialog request opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ??
      adeThreads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, adeThreads, threads]
  )
  const activeProjectPrimary = activeThread
    ? threadFolderSetPrimary(activeThread, workspaceRoot)
    : ''
  const matchesActiveProject = Boolean(
    request?.primary &&
    workspaceRootIdentityKey(activeProjectPrimary) === workspaceRootIdentityKey(request.primary)
  )
  const syncBlockedByRun = busy || activeThread?.status === 'running'
  const syncUnavailable = !matchesActiveProject || syncBlockedByRun

  useModalFocusTrap(panelRef, close, submitting)

  if (!request) return null

  const manage = request.mode === 'manage'
  const title = manage ? t('codeProjectManageTitle') : t('codeProjectCreateTitle')
  const description = manage ? t('codeProjectManageDescription') : t('codeProjectCreateDescription')
  const primaryPath = draft.primary || draft.folders[0] || ''
  const canSubmit = !submitting && !picking

  const addFolder = async (): Promise<void> => {
    if (picking || submitting) return
    if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
      setError(t('codeProjectPickerUnavailable'))
      return
    }
    setPicking(true)
    try {
      const picked = await withNativeDialog(() =>
        window.kunGui.pickWorkspaceDirectory(primaryPath || workspaceRoot || undefined)
      )
      if (picked.canceled || !picked.path) return
      const path = normalizeWorkspaceRoot(picked.path)
      if (!path) return
      if (isConversationWorkspacePath(path, conversationRoot)) {
        setError(codeProjectErrorMessage('conversation-dir'))
        return
      }
      if (draft.folders.some((folder) => workspaceRootIdentityKey(folder) === workspaceRootIdentityKey(path))) {
        setError(codeProjectErrorMessage('duplicate'))
        return
      }
      if (draft.folders.some((folder) => workspacePathsOverlap(folder, path))) {
        setError(codeProjectErrorMessage('nested'))
        return
      }
      if (draft.folders.length > MAX_ADDITIONAL_WORKSPACES) {
        setError(codeProjectErrorMessage('limit'))
        return
      }
      if (!(await workspaceDirectoryExists(path))) {
        setError(codeProjectErrorMessage('directory-missing', path))
        return
      }
      setDraft((current) => ({
        ...current,
        folders: [...current.folders, path],
        primary: current.primary || path
      }))
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : t('codeProjectPickerFailed'))
    } finally {
      setPicking(false)
    }
  }

  const removeFolder = (path: string): void => {
    if (manage && workspaceRootIdentityKey(path) === workspaceRootIdentityKey(draft.primary)) return
    setDraft((current) => {
      const folders = current.folders.filter(
        (folder) => workspaceRootIdentityKey(folder) !== workspaceRootIdentityKey(path)
      )
      return {
        ...current,
        folders,
        primary: workspaceRootIdentityKey(current.primary) === workspaceRootIdentityKey(path)
          ? (folders[0] ?? '')
          : current.primary
      }
    })
  }

  const setPrimary = (path: string): void => {
    setDraft((current) => ({ ...current, primary: path }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || picking) return
    if (!draft.folders.length) {
      setError(t('codeProjectErrorPrimary'))
      return
    }
    if (!draft.name.trim()) {
      setError(t('codeProjectErrorName'))
      return
    }
    setSubmitting(true)
    try {
      const primary = draft.primary || draft.folders[0]!
      const result = await submitCodeWorkspaceProjectDraft({
        mode: request.mode,
        displayName: draft.name,
        primary,
        extraRoots: draft.folders.filter(
          (folder) => workspaceRootIdentityKey(folder) !== workspaceRootIdentityKey(primary)
        )
      }, {
        syncCurrentThread: manage && draft.syncCurrentThread
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.syncBlocked) {
        setError(result.syncBlocked)
        return
      }
      setError('')
      close()
      const projectLabel = draft.name.replace(/\s+/g, ' ').trim()
      if (request.selectAfterSave === 'code') {
        const selected = await selectWorkspaceRoot(result.primary)
        if (selected) useChatStore.setState({ workspaceLabel: projectLabel })
      } else if (request.selectAfterSave === 'ade') {
        await selectAdeWorkspaceRoot(result.primary)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t('codeProjectSaveFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const host = typeof document === 'undefined' ? null : document.body
  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="code-project-dialog-title"
      className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/20 px-4 py-6 backdrop-blur-[2px] dark:bg-black/45"
      onMouseDown={() => { if (!submitting) close() }}
    >
      <form
        ref={panelRef}
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100vh-48px)] w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] border border-ds-border bg-ds-card shadow-[0_24px_72px_rgba(20,47,95,0.22)] dark:shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="px-6 pt-6">
          <h2
            id="code-project-dialog-title"
            className="text-[18px] font-semibold tracking-[-0.025em] text-ds-ink"
          >
            {title}
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-ds-muted">{description}</p>

          <label className="mt-5 block text-[12px] font-medium text-ds-muted" htmlFor="code-project-name">
            {t('codeProjectNameLabel')}
          </label>
          <input
            id="code-project-name"
            autoFocus
            value={draft.name}
            maxLength={MAX_CODE_WORKSPACE_PROJECT_NAME_LENGTH}
            onChange={(event) => {
              setDraft((current) => ({ ...current, name: event.target.value }))
              setError('')
            }}
            placeholder={t('codeProjectNamePlaceholder')}
            className="mt-1.5 h-11 w-full rounded-[10px] border border-ds-border bg-ds-main/60 px-3 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/20"
          />

          <div className="mt-5 flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium text-ds-muted">{t('codeProjectFoldersLabel')}</span>
            <span className="text-[11px] text-ds-faint tabular-nums">
              {t('codeProjectFolderCount', { count: draft.folders.length })}
            </span>
          </div>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-6">
          <div className="border-t border-ds-border-muted">
            {draft.folders.map((folder) => {
              const isPrimary = workspaceRootIdentityKey(folder) === workspaceRootIdentityKey(draft.primary)
              const removable = !manage || !isPrimary
              return (
                <div
                  key={folder}
                  className="flex min-h-[58px] items-center gap-3 border-b border-ds-border-muted py-2.5"
                  data-code-project-folder={folder}
                >
                  <Folder className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
                        {workspaceProjectFallbackName(folder)}
                      </span>
                      {isPrimary ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border-muted px-1.5 py-0.5 text-[10.5px] font-medium text-ds-muted">
                          <Check className="h-3 w-3" strokeWidth={2.2} />
                          {t('codeProjectPrimaryBadge')}
                        </span>
                      ) : null}
                    </div>
                    <p
                      dir="ltr"
                      title={folder}
                      className="mt-0.5 truncate font-mono text-[11px] leading-4 text-ds-faint"
                    >
                      {folder}
                    </p>
                  </div>
                  {!isPrimary && !manage ? (
                    <button
                      type="button"
                      onClick={() => setPrimary(folder)}
                      className="shrink-0 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    >
                      {t('codeProjectSetPrimary')}
                    </button>
                  ) : null}
                  {removable ? (
                    <button
                      type="button"
                      onClick={() => removeFolder(folder)}
                      aria-label={t('codeProjectRemoveFolder', { name: workspaceProjectFallbackName(folder) })}
                      title={t('codeProjectRemoveFolder', { name: workspaceProjectFallbackName(folder) })}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    >
                      <X className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : <span className="h-8 w-8 shrink-0" aria-hidden="true" />}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            disabled={picking || submitting || draft.folders.length > MAX_ADDITIONAL_WORKSPACES}
            onClick={() => void addFolder()}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-ds-border text-[12.5px] font-medium text-ds-muted transition hover:border-accent/35 hover:bg-accent/5 hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {picking
              ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              : <FolderPlus className="h-4 w-4" strokeWidth={1.9} />}
            {t('codeProjectAddFolder')}
          </button>
          <p className="mt-2 text-[11px] leading-4 text-ds-faint">
            {draft.folders.length > MAX_ADDITIONAL_WORKSPACES
              ? t('codeProjectAddLimitHint', { count: MAX_ADDITIONAL_WORKSPACES })
              : t('codeProjectFolderHint')}
          </p>
        </div>

        <div className="px-6 pb-5 pt-4">
          {manage ? (
            <div className="mb-4 rounded-[10px] border border-ds-border-muted px-3 py-2.5">
              <label className={`flex items-start gap-2.5 text-[12.5px] ${syncUnavailable ? 'text-ds-faint' : 'text-ds-ink'}`}>
                <input
                  type="checkbox"
                  checked={draft.syncCurrentThread && !syncUnavailable}
                  disabled={syncUnavailable || submitting}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    syncCurrentThread: event.target.checked
                  }))}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--ds-accent)]"
                />
                <span className="min-w-0">
                  <span className="block">{t('codeProjectSyncCurrentThread')}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-ds-faint">
                    {syncBlockedByRun ? t('codeProjectSyncBusy') : t('codeProjectSyncCurrentThreadHint')}
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mb-3 text-[12.5px] leading-5 text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={close}
              className="inline-flex h-9 items-center justify-center rounded-full border border-ds-border bg-ds-card px-4 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-9 items-center justify-center rounded-full bg-control px-4 text-[13px] font-semibold text-control-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting
                ? t('loading')
                : manage ? t('codeProjectSaveAction') : t('codeProjectCreateAction')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
  return host ? createPortal(dialog, host) : dialog
}
