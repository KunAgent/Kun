import { Bell, FileSearch2, Puzzle, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  RESULT_PREVIEW_OPEN_CHANNEL,
  ResultPreviewOpenPayloadSchema,
  type HostMessage,
  type JsonObject,
  type JsonValue,
  type ResultPreviewSource
} from '@kun/extension-api'
import type { ExtensionWorkbenchNotification } from '@shared/extension-ipc'
import {
  extensionHostIconUrl,
  resolveContributionCommand,
  type RegisteredContribution
} from './contribution-registry'
import { ExtensionWebview } from './ExtensionWebview'
import { ExtensionExternalBrowser } from './ExtensionExternalBrowser'
import { boundedPlainText, isSecretLikeSettingKey } from './safe-text'

export { isSecretLikeSettingKey } from './safe-text'

function plainText(value: string, max = 256): string {
  return boundedPlainText(value, max)
}

const MAX_VISIBLE_EXTENSION_NOTIFICATIONS = 5

export function isTrustedNotificationActivation(event: {
  nativeEvent: { isTrusted: boolean }
}): boolean {
  return event.nativeEvent.isTrusted === true
}

function ContributionIcon({ contribution }: { contribution: RegisteredContribution }): ReactElement {
  const icon = 'icon' in contribution.payload ? contribution.payload.icon : undefined
  if (icon && contribution.owner.kind === 'extension') {
    return (
      <img
        src={extensionHostIconUrl(contribution.owner.extensionId, icon)}
        alt=""
        aria-hidden="true"
        className="h-4 w-4 shrink-0 object-contain"
      />
    )
  }
  return <Puzzle className="h-4 w-4 shrink-0" aria-hidden />
}

export function DeclarativeActionBar({
  contributions,
  context,
  onCommand,
  compact = false
}: {
  contributions: readonly RegisteredContribution<
    'actions.topBar' | 'actions.composer' | 'actions.message'
  >[]
  context: JsonValue
  onCommand: (commandId: string, context: JsonValue) => void | Promise<unknown>
  compact?: boolean
}): ReactElement {
  const [runningId, setRunningId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const invoke = async (
    contribution: RegisteredContribution<'actions.topBar' | 'actions.composer' | 'actions.message'>
  ): Promise<void> => {
    const command = resolveContributionCommand(contribution, contribution.payload.command)
    if (!command || runningId) return
    setRunningId(contribution.id)
    setFailure(null)
    try {
      await onCommand(command, context)
    } catch (error) {
      setFailure(boundedPlainText(error instanceof Error ? error.message : String(error), 512))
    } finally {
      setRunningId(null)
    }
  }
  return (
    <div className="ds-extension-actions flex min-w-0 items-center gap-1" role="toolbar">
      {contributions.map((contribution) => (
        <button
          key={contribution.id}
          type="button"
          onClick={() => void invoke(contribution)}
          disabled={runningId !== null}
          className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 text-[12px] font-medium text-ds-muted transition hover:border-ds-border-muted hover:bg-ds-hover hover:text-ds-ink"
          aria-label={plainText(contribution.payload.title, 128)}
          data-tooltip={plainText(contribution.payload.title, 128)}
          data-contribution-id={contribution.id}
        >
          <ContributionIcon contribution={contribution} />
          {compact ? null : <span className="max-w-36 truncate">{plainText(contribution.payload.title, 128)}</span>}
        </button>
      ))}
      {failure ? (
        <span role="alert" className="max-w-52 truncate text-[10px] text-red-600 dark:text-red-300">
          {failure}
        </span>
      ) : null}
    </div>
  )
}

export function DeclarativeViewContainers({
  contributions,
  activeId,
  onSelect
}: {
  contributions: readonly RegisteredContribution<'views.containers'>[]
  activeId?: string | null
  onSelect: (contributionId: string) => void
}): ReactElement {
  return (
    <nav className="ds-extension-view-containers flex min-w-0 items-center gap-1" aria-label="Extension Views">
      {contributions.map((contribution) => (
        <button
          key={contribution.id}
          type="button"
          onClick={() => onSelect(contribution.id)}
          aria-current={activeId === contribution.id ? 'page' : undefined}
          data-contribution-id={contribution.id}
          className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition ${activeId === contribution.id ? 'bg-accent/12 text-accent' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}
        >
          <ContributionIcon contribution={contribution} />
          <span className="max-w-36 truncate">{plainText(contribution.payload.title, 128)}</span>
        </button>
      ))}
    </nav>
  )
}

export function DeclarativeContextMenu({
  contributions,
  commands = [],
  context,
  onCommand,
  onClose
}: {
  contributions: readonly RegisteredContribution<'contextMenus'>[]
  commands?: readonly RegisteredContribution<'commands'>[]
  context: JsonValue
  onCommand: (commandId: string, context: JsonValue) => void | Promise<unknown>
  onClose?: () => void
}): ReactElement {
  const [runningId, setRunningId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const labelFor = (contribution: RegisteredContribution<'contextMenus'>): string => {
    const commandId = resolveContributionCommand(contribution, contribution.payload.command)
    const command = commands.find((candidate) =>
      resolveContributionCommand(candidate, candidate.payload.id) === commandId)
    return plainText(command?.payload.title ?? contribution.payload.id, 128)
  }
  return (
    <div role="menu" className="ds-card-strong min-w-48 rounded-xl border border-ds-border p-1 shadow-lg">
      {contributions.map((contribution) => (
        <button
          key={contribution.id}
          type="button"
          role="menuitem"
          disabled={runningId !== null}
          onClick={() => {
            const command = resolveContributionCommand(contribution, contribution.payload.command)
            if (command) {
              setRunningId(contribution.id)
              setFailure(null)
              void Promise.resolve().then(() => onCommand(command, context)).then(
                () => onClose?.(),
                (error) => setFailure(boundedPlainText(
                  error instanceof Error ? error.message : String(error),
                  512
                ))
              ).finally(() => setRunningId(null))
            }
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60"
          data-contribution-id={contribution.id}
        >
          <span className="min-w-0 flex-1 truncate">{labelFor(contribution)}</span>
          {contribution.owner.kind === 'extension' ? (
            <span className="max-w-24 truncate text-[9px] text-ds-faint">
              {contribution.owner.extensionId}
            </span>
          ) : null}
        </button>
      ))}
      {failure ? (
        <div role="alert" className="max-w-64 px-3 py-2 text-[10px] leading-4 text-red-600 dark:text-red-300">
          {failure}
        </div>
      ) : null}
    </div>
  )
}

export type DeclarativeContextMenuPosition = { x: number; y: number }

export function DeclarativeContextMenuOverlay({
  contributions,
  commands = [],
  context,
  position,
  onCommand,
  onClose
}: {
  contributions: readonly RegisteredContribution<'contextMenus'>[]
  commands?: readonly RegisteredContribution<'commands'>[]
  context: JsonValue
  position: DeclarativeContextMenuPosition | null
  onCommand: (commandId: string, context: JsonValue) => void | Promise<unknown>
  onClose: () => void
}): ReactElement | null {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const focusOriginRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!position) return
    focusOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = rootRef.current
    root?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!root?.contains(event.target as Node)) onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      const origin = focusOriginRef.current
      if (origin?.isConnected) origin.focus()
    }
  }, [position])

  if (!position || contributions.length === 0) return null
  const left = Math.max(8, Math.min(position.x, window.innerWidth - 232))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - Math.min(360, contributions.length * 40 + 16)))
  return (
    <div
      ref={rootRef}
      className="ds-no-drag fixed z-[70]"
      style={{ left, top }}
      data-extension-context-menu
    >
      <DeclarativeContextMenu
        contributions={contributions}
        commands={commands}
        context={context}
        onCommand={onCommand}
        onClose={onClose}
      />
    </div>
  )
}

export function canOpenHostContextMenuForTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined') return false
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, button, a, [contenteditable="true"], webview') === null
}

export function DeclarativeNotifications({
  contributions,
  onCommand
}: {
  contributions: readonly RegisteredContribution<'notifications'>[]
  onCommand: (commandId: string, context: JsonValue) => void | Promise<unknown>
}): ReactElement {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const pending = contributions.filter((item) => !dismissed.has(item.id))
  const visible = pending.slice(0, MAX_VISIBLE_EXTENSION_NOTIFICATIONS)
  return (
    <>
      {visible.map((contribution) => (
        <section
          key={contribution.id}
          role={contribution.payload.severity === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto rounded-xl border border-ds-border bg-ds-card p-3 text-ds-ink shadow-xl"
          data-contribution-id={contribution.id}
        >
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[12px] font-semibold">
                  {plainText(contribution.payload.title, 128)}
                </div>
                {contribution.owner.kind === 'extension' ? (
                  <span className="max-w-32 truncate text-[9px] font-normal text-ds-faint">
                    {contribution.owner.extensionId}
                  </span>
                ) : null}
              </div>
              {contribution.payload.message ? (
                <div className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-ds-muted">
                  {plainText(contribution.payload.message, 4_096)}
                </div>
              ) : null}
              {contribution.payload.actions.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {contribution.payload.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={(event) => {
                        if (!isTrustedNotificationActivation(event)) return
                        const command = resolveContributionCommand(contribution, action.command)
                        if (command) void onCommand(command, { notificationId: contribution.id })
                      }}
                      className="rounded-lg border border-ds-border px-2 py-1 text-[11px] font-semibold hover:bg-ds-hover"
                    >
                      {plainText(action.title, 128)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={(event) => {
                if (!isTrustedNotificationActivation(event)) return
                setDismissed((current) => new Set([...current, contribution.id]))
              }}
              aria-label={`Dismiss ${plainText(contribution.payload.title, 128)}`}
              className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      ))}
      {pending.length > visible.length ? (
        <section
          role="status"
          className="pointer-events-auto rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[11px] text-ds-muted shadow-xl"
          data-extension-notifications-queued={pending.length - visible.length}
        >
          {pending.length - visible.length} more extension notifications queued
        </section>
      ) : null}
    </>
  )
}

export function DynamicExtensionNotifications({
  notifications,
  onRespond
}: {
  notifications: readonly ExtensionWorkbenchNotification[]
  onRespond: (notificationId: string, actionId?: string) => void | Promise<unknown>
}): ReactElement {
  const visible = notifications.slice(0, MAX_VISIBLE_EXTENSION_NOTIFICATIONS)
  return (
    <>
      {visible.map((notification) => (
        <section
          key={notification.notificationId}
          role={notification.severity === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto rounded-xl border bg-ds-card p-3 text-ds-ink shadow-xl ${
            notification.severity === 'error'
              ? 'border-red-500/50'
              : notification.severity === 'warning' ? 'border-amber-500/50' : 'border-ds-border'
          }`}
          data-extension-notification-id={notification.notificationId}
        >
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[12px] font-semibold">
                  {plainText(notification.title, 128)}
                </div>
                <span className="max-w-32 truncate text-[9px] font-normal text-ds-faint">
                  {plainText(notification.extensionId, 129)}
                </span>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-ds-muted">
                {plainText(notification.message, 4_096)}
              </div>
              {notification.actions.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {notification.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={(event) => {
                        if (!isTrustedNotificationActivation(event)) return
                        void onRespond(notification.notificationId, action.id)
                      }}
                      className="rounded-lg border border-ds-border px-2 py-1 text-[11px] font-semibold hover:bg-ds-hover"
                    >
                      {plainText(action.title, 128)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={(event) => {
                if (!isTrustedNotificationActivation(event)) return
                void onRespond(notification.notificationId)
              }}
              aria-label={`Dismiss ${plainText(notification.title, 128)}`}
              className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      ))}
      {notifications.length > visible.length ? (
        <section
          role="status"
          className="pointer-events-auto rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[11px] text-ds-muted shadow-xl"
          data-extension-notifications-queued={notifications.length - visible.length}
        >
          {notifications.length - visible.length} more extension notifications queued
        </section>
      ) : null}
    </>
  )
}

type SettingsProperty = JsonObject & {
  type?: JsonValue
  title?: JsonValue
  description?: JsonValue
  default?: JsonValue
  enum?: JsonValue
}

function settingsControl(
  extensionId: string,
  key: string,
  property: SettingsProperty,
  value: JsonValue | undefined,
  onChange: (key: string, value: JsonValue) => void,
  disabled: boolean
): ReactNode {
  const type = property.type
  const id = `${extensionId}-${key}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  if (type === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        disabled={disabled}
        checked={typeof value === 'boolean' ? value : Boolean(property.default)}
        onChange={(event) => onChange(key, event.currentTarget.checked)}
      />
    )
  }
  const options = Array.isArray(property.enum) ? property.enum : []
  if (options.length) {
    const selected = value !== undefined ? value : property.default
    const encodedSelected = selected === undefined ? '' : JSON.stringify(selected)
    return (
      <select
        id={id}
        disabled={disabled}
        value={encodedSelected}
        onChange={(event) => onChange(key, JSON.parse(event.currentTarget.value) as JsonValue)}
        className="rounded-lg border border-ds-border bg-ds-card px-2 py-1.5 text-[12px]"
      >
        {options.map((option) => {
          const encoded = JSON.stringify(option)
          const label = typeof option === 'string' ? option : encoded
          return <option key={encoded} value={encoded}>{plainText(label, 128)}</option>
        })}
      </select>
    )
  }
  if (type === 'array' || type === 'object') {
    const structuredValue = value !== undefined ? value : property.default
    return (
      <textarea
        key={JSON.stringify(structuredValue)}
        id={id}
        disabled={disabled}
        defaultValue={structuredValue === undefined ? '' : JSON.stringify(structuredValue, null, 2)}
        onBlur={(event) => {
          try {
            const parsed = JSON.parse(event.currentTarget.value) as JsonValue
            event.currentTarget.setCustomValidity('')
            onChange(key, parsed)
          } catch {
            event.currentTarget.setCustomValidity('Enter valid JSON.')
            event.currentTarget.reportValidity()
          }
        }}
        className="min-h-20 w-64 rounded-lg border border-ds-border bg-ds-card px-2 py-1.5 font-mono text-[11px]"
      />
    )
  }
  return (
    <input
      id={id}
      disabled={disabled}
      type={type === 'number' || type === 'integer' ? 'number' : 'text'}
      min={typeof property.minimum === 'number' ? property.minimum : undefined}
      max={typeof property.maximum === 'number' ? property.maximum : undefined}
      minLength={typeof property.minLength === 'number' ? property.minLength : undefined}
      maxLength={typeof property.maxLength === 'number' ? property.maxLength : undefined}
      step={type === 'integer' ? 1 : undefined}
      value={typeof value === 'string' || typeof value === 'number' ? value : typeof property.default === 'string' || typeof property.default === 'number' ? property.default : ''}
      onChange={(event) => onChange(key, type === 'number' || type === 'integer' ? Number(event.currentTarget.value) : event.currentTarget.value)}
      className="rounded-lg border border-ds-border bg-ds-card px-2 py-1.5 text-[12px]"
    />
  )
}

export function DeclarativeSettingsSections({
  contributions,
  values,
  disabled = false,
  onChange
}: {
  contributions: readonly RegisteredContribution<'settings'>[]
  values: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
  disabled?: boolean
  onChange: (contributionId: string, key: string, value: JsonValue) => void
}): ReactElement {
  return (
    <div className="space-y-4">
      {contributions.map((contribution) => (
        <section key={contribution.id} className="rounded-xl border border-ds-border p-4" data-contribution-id={contribution.id}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-ds-ink">{plainText(contribution.payload.title, 128)}</h3>
            {contribution.owner.kind === 'extension' ? (
              <span className="max-w-48 truncate text-[10px] text-ds-faint">
                {contribution.owner.extensionId}
              </span>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {Object.entries(contribution.payload.properties).map(([key, raw]) => {
              const property = raw as SettingsProperty
              const title = typeof property.title === 'string' ? property.title : key
              const description = typeof property.description === 'string' ? property.description : ''
              return (
                <label key={key} className="flex items-start justify-between gap-4 text-[12px] text-ds-muted">
                  <span className="min-w-0">
                    <span className="block font-medium text-ds-ink">{plainText(title, 128)}</span>
                    {description ? <span className="mt-0.5 block text-[11px] leading-5 text-ds-faint">{plainText(description, 512)}</span> : null}
                  </span>
                  {isSecretLikeSettingKey(key) ? (
                    <span role="alert" className="max-w-52 text-right text-[10.5px] leading-5 text-amber-700 dark:text-amber-200">
                      Use the protected Account API for credentials.
                    </span>
                  ) : settingsControl(
                    contribution.id,
                    key,
                    property,
                    values[contribution.id]?.[key],
                    (field, value) => onChange(contribution.id, field, value),
                    disabled
                  )}
                </label>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export function ExtensionViewOutlet({
  contribution,
  workspaceRoot,
  initialMessages,
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
  if (contribution.owner.kind !== 'extension') {
    return <div role="alert">Built-in Views are rendered by their owning Kun component.</div>
  }
  if (
    contribution.point !== 'message.resultPreviews' &&
    contribution.payload.externalBrowser &&
    contribution.owner.grantedPermissions.includes('webview.external')
  ) {
    return (
      <ExtensionExternalBrowser
        contribution={contribution}
        workspaceRoot={workspaceRoot}
        onClose={onClose}
      />
    )
  }
  return (
    <ExtensionWebview
      contribution={contribution}
      workspaceRoot={workspaceRoot}
      initialMessages={initialMessages}
      onClose={onClose}
    />
  )
}

export function matchingResultPreviewContributions(
  contributions: readonly RegisteredContribution<'message.resultPreviews'>[],
  mimeType: string
): RegisteredContribution<'message.resultPreviews'>[] {
  const normalized = mimeType.trim().toLowerCase()
  return contributions.filter((contribution) =>
    contribution.payload.mimeTypes.some((declared) => {
      const candidate = declared.trim().toLowerCase()
      if (candidate === normalized) return true
      return candidate.endsWith('/*') && normalized.startsWith(candidate.slice(0, -1))
    })
  )
}

export type ExtensionResultPreviewSource = ResultPreviewSource

export function DeclarativeResultPreviews({
  contributions,
  sources,
  threadId,
  turnId,
  workspaceRoot
}: {
  contributions: readonly RegisteredContribution<'message.resultPreviews'>[]
  sources: readonly ExtensionResultPreviewSource[]
  threadId?: string | null
  turnId?: string | null
  workspaceRoot?: string
}): ReactElement | null {
  const candidates = sources.flatMap((source) =>
    matchingResultPreviewContributions(contributions, source.mimeType).map((contribution) => ({
      key: `${source.sourceId}:${contribution.id}`,
      source,
      contribution
    })))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const active = candidates.find((candidate) => candidate.key === activeKey)
  if (candidates.length === 0) return null

  const initialMessages: HostMessage[] = active ? [{
    channel: RESULT_PREVIEW_OPEN_CHANNEL,
    payload: ResultPreviewOpenPayloadSchema.parse({
      schemaVersion: 1,
      threadId: threadId ?? null,
      turnId: turnId ?? null,
      result: {
        sourceId: active.source.sourceId,
        mimeType: active.source.mimeType,
        ...(active.source.name ? { name: active.source.name } : {}),
        ...(active.source.attachmentId ? { attachmentId: active.source.attachmentId } : {}),
        ...(active.source.artifactId ? { artifactId: active.source.artifactId } : {}),
        ...(active.source.mediaHandleId ? { mediaHandleId: active.source.mediaHandleId } : {}),
        ...(active.source.availability ? { availability: active.source.availability } : {}),
        ...(active.source.relativePath ? { relativePath: active.source.relativePath } : {}),
        ...(active.source.byteSize !== undefined ? { byteSize: active.source.byteSize } : {}),
        ...(active.source.width !== undefined ? { width: active.source.width } : {}),
        ...(active.source.height !== undefined ? { height: active.source.height } : {})
      }
    })
  }] : []

  return (
    <section
      className="mt-2 rounded-xl border border-ds-border-muted bg-ds-card/60 p-2"
      aria-label="Extension result previews"
      data-extension-attachment-context
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {candidates.map((candidate) => {
          const title = boundedPlainText(candidate.contribution.payload.title, 128)
          const sourceName = boundedPlainText(candidate.source.name || candidate.source.mimeType, 128)
          return (
            <button
              key={candidate.key}
              type="button"
              onClick={() => setActiveKey((current) => current === candidate.key ? null : candidate.key)}
              aria-expanded={activeKey === candidate.key}
              data-contribution-id={candidate.contribution.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <FileSearch2 className="h-3.5 w-3.5" aria-hidden />
              <span>{title}</span>
              <span className="max-w-32 truncate text-ds-faint">{sourceName}</span>
            </button>
          )
        })}
      </div>
      {active ? (
        <div className="mt-2 h-[min(44vh,420px)] min-h-64 overflow-hidden rounded-xl border border-ds-border-muted">
          <ExtensionViewOutlet
            key={active.key}
            contribution={active.contribution}
            workspaceRoot={workspaceRoot}
            initialMessages={initialMessages}
            onClose={() => setActiveKey(null)}
          />
        </div>
      ) : null}
    </section>
  )
}
