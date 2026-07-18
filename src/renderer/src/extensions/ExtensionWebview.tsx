import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { HostMessageSchema, type HostMessage } from '@kun/extension-api'
import type { RegisteredContribution } from './contribution-registry'
import {
  extensionWorkbenchClient,
  type ExtensionViewSession
} from './extension-workbench-client'
import { boundedPlainText } from './safe-text'

type WebviewElement = HTMLElement & {
  reload?: () => void
}

const MAX_INITIAL_VIEW_MESSAGES = 8
const MAX_INITIAL_VIEW_MESSAGE_BYTES = 64 * 1024

export function extensionViewSessionContractKey(
  contribution: RegisteredContribution<
    | 'views.leftSidebar'
    | 'views.rightSidebar'
    | 'views.auxiliaryPanel'
    | 'views.editorTab'
    | 'views.fullPage'
    | 'message.resultPreviews'
  >
): string {
  const owner = contribution.owner
  return JSON.stringify([
    contribution.id,
    contribution.point,
    owner.kind,
    owner.kind === 'extension' ? owner.extensionId : '',
    owner.kind === 'extension' ? owner.extensionVersion : '',
    owner.kind === 'extension' ? owner.source ?? null : null,
    owner.kind === 'extension' ? [...owner.grantedPermissions].sort() : [],
    contribution.payload.entry,
    [...contribution.payload.localResourceRoots].sort(),
    'externalBrowser' in contribution.payload
      ? contribution.payload.externalBrowser ?? null
      : null
  ])
}

export function validateExtensionViewSession(
  session: ExtensionViewSession,
  contribution: RegisteredContribution<
    | 'views.leftSidebar'
    | 'views.rightSidebar'
    | 'views.auxiliaryPanel'
    | 'views.editorTab'
    | 'views.fullPage'
    | 'message.resultPreviews'
  >
): string | null {
  if (contribution.owner.kind !== 'extension') return 'Only extension Views use the Webview host.'
  if (session.contributionId !== contribution.id) return 'View Session contribution mismatch.'
  if (session.extensionId !== contribution.owner.extensionId) return 'View Session owner mismatch.'
  if (session.extensionVersion !== contribution.owner.extensionVersion) return 'View Session version mismatch.'
  if (!session.partition || session.partition.startsWith('persist:')) {
    return 'Extension View Sessions must use an isolated non-persistent partition.'
  }
  try {
    const url = new URL(session.src)
    if (url.protocol !== 'kun-extension:' || url.hostname !== contribution.owner.extensionId) {
      return 'View Session resource origin mismatch.'
    }
  } catch {
    return 'View Session resource URL is invalid.'
  }
  return null
}

export function ExtensionWebview({
  contribution,
  workspaceRoot,
  initialMessages = [],
  onClose
}: {
  contribution: RegisteredContribution<
    | 'views.leftSidebar'
    | 'views.rightSidebar'
    | 'views.auxiliaryPanel'
    | 'views.editorTab'
    | 'views.fullPage'
    | 'message.resultPreviews'
  >
  workspaceRoot?: string
  initialMessages?: readonly HostMessage[]
  onClose?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [attempt, setAttempt] = useState(0)
  const [session, setSession] = useState<ExtensionViewSession | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const originFocusRef = useRef<HTMLElement | null>(null)
  const contributionRef = useRef(contribution)
  contributionRef.current = contribution
  const contributionId = contribution.id
  const sessionContractKey = extensionViewSessionContractKey(contribution)
  const normalizedWorkspaceRoot = workspaceRoot?.trim() || undefined
  const initialMessagesJson = JSON.stringify(initialMessages)
  const boundedInitialMessages = useMemo(() => {
    let retainedBytes = 0
    const messages: HostMessage[] = []
    const parsed = JSON.parse(initialMessagesJson) as unknown[]
    for (const input of parsed.slice(0, MAX_INITIAL_VIEW_MESSAGES)) {
      const message = HostMessageSchema.parse(input)
      const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength
      if (retainedBytes + bytes > MAX_INITIAL_VIEW_MESSAGE_BYTES) break
      messages.push(message)
      retainedBytes += bytes
    }
    return messages
  }, [initialMessagesJson])

  useEffect(() => {
    originFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let disposed = false
    let opened: ExtensionViewSession | null = null
    setSession(null)
    setFailure(null)
    const opening = attempt > 0
      ? extensionWorkbenchClient.createViewSession(
          contributionId,
          normalizedWorkspaceRoot,
          { retryHost: true }
        )
      : extensionWorkbenchClient.createViewSession(contributionId, normalizedWorkspaceRoot)
    void opening
      .then((next) => {
        if (disposed) {
          void extensionWorkbenchClient.disposeViewSession(next.sessionId)
          return
        }
        const invalid = validateExtensionViewSession(next, contributionRef.current)
        if (invalid) {
          setFailure(invalid)
          void extensionWorkbenchClient.disposeViewSession(next.sessionId)
          return
        }
        opened = next
        setSession(next)
      })
      .catch((error) => {
        if (!disposed) setFailure(boundedPlainText(error instanceof Error ? error.message : String(error), 1_024))
      })

    return () => {
      disposed = true
      if (opened) void extensionWorkbenchClient.disposeViewSession(opened.sessionId)
      const focusTarget = originFocusRef.current
      if (focusTarget?.isConnected) window.requestAnimationFrame(() => focusTarget.focus())
    }
  }, [attempt, contributionId, normalizedWorkspaceRoot, sessionContractKey])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !session) return
    const onCrash = (): void => setFailure(t('extensionViewProcessExited'))
    const onLoadFailure = (event: Event): void => {
      const detail = event as Event & { errorDescription?: string }
      setFailure(boundedPlainText(detail.errorDescription || t('extensionViewLoadFailed'), 1_024))
    }
    webview.addEventListener('render-process-gone', onCrash)
    webview.addEventListener('did-fail-load', onLoadFailure)
    return () => {
      webview.removeEventListener('render-process-gone', onCrash)
      webview.removeEventListener('did-fail-load', onLoadFailure)
    }
  }, [session, t])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !session || boundedInitialMessages.length === 0) return
    const deliver = (): void => {
      void Promise.all(boundedInitialMessages.map((message) =>
        extensionWorkbenchClient.postViewMessage(session.sessionId, message)))
        .catch((error) => setFailure(boundedPlainText(
          error instanceof Error ? error.message : String(error),
          1_024
        )))
    }
    webview.addEventListener('did-finish-load', deliver)
    return () => webview.removeEventListener('did-finish-load', deliver)
  }, [boundedInitialMessages, session])

  const title = boundedPlainText(contribution.payload.title, 128)
  return (
    <section
      className="ds-extension-view ds-no-drag flex h-full min-h-0 w-full flex-col bg-ds-sidebar"
      aria-label={t('extensionViewAriaLabel', { title })}
      data-contribution-id={contribution.id}
    >
      <header className="ds-no-drag flex h-11 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink">{title}</span>
        {contribution.owner.kind === 'extension' ? (
          <span className="max-w-36 truncate text-[10px] text-ds-faint">
            {contribution.owner.extensionId}
          </span>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('extensionViewClose', { title })}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      {failure ? (
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
          <div className="mt-3 text-[13px] font-semibold text-ds-ink">
            {t('extensionViewUnavailable')}
          </div>
          <div className="mt-1 max-w-sm text-[12px] leading-5 text-ds-muted">{failure}</div>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border px-3 py-1.5 text-[12px] font-semibold text-ds-ink hover:bg-ds-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('extensionViewRetry')}
          </button>
        </div>
      ) : session ? (
        <webview
          key={session.sessionId}
          ref={webviewRef}
          src={session.src}
          partition={session.partition}
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          data-extension-view-session={session.sessionId}
          data-contribution-id={session.contributionId}
          className="ds-no-drag flex min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <div role="status" className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-ds-muted">
          {t('extensionViewOpening')}
        </div>
      )}
    </section>
  )
}
