import type { ReactElement, ReactNode } from 'react'
import { FolderOpen, MessageSquare, Power, Send, Settings2, TerminalSquare, X } from 'lucide-react'
import type { ClawImChannelV1, SessionDaemonV1 } from '@shared/app-settings'

type Translate = (key: string, values?: Record<string, unknown>) => string

type Props = {
  mode: 'create' | 'edit'
  draft: SessionDaemonV1
  error: string | null
  threads: readonly { id: string; title: string }[]
  weixinChannels: readonly ClawImChannelV1[]
  onConnectWeixin?: () => void
  onDraftChange: (draft: SessionDaemonV1) => void
  onPickWorkspace: () => void
  onSubmit: () => void
  onClose: () => void
  t: Translate
}

function FieldLabel({ required, children }: { required?: boolean; children: ReactNode }): ReactElement {
  return (
    <span className="flex min-h-5 items-center gap-1 text-[13px] font-medium text-ds-ink">
      <span className="min-w-0 truncate">{children}</span>
      {required ? <span className="text-red-500">*</span> : null}
    </span>
  )
}

function Section({
  icon,
  title,
  children
}: {
  icon: ReactElement
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="grid gap-3 border-t border-ds-border-muted pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-ds-subtle text-ds-muted">
          {icon}
        </span>
        {title}
      </div>
      {children}
    </section>
  )
}

const inputClass =
  'h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/15'
const selectClass =
  'h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition focus:border-accent/45 focus:ring-2 focus:ring-accent/15'

export function SessionDaemonDialog({
  mode,
  draft,
  error,
  threads,
  weixinChannels,
  onConnectWeixin,
  onDraftChange,
  onPickWorkspace,
  onSubmit,
  onClose,
  t
}: Props): ReactElement {
  const update = (patch: Partial<SessionDaemonV1>): void => {
    onDraftChange({ ...draft, ...patch })
  }
  const updatePush = (patch: Partial<SessionDaemonV1['push']>): void => {
    onDraftChange({ ...draft, push: { ...draft.push, ...patch } })
  }
  const selectedChannel = weixinChannels.find((channel) => channel.id === draft.push.channelId) ?? null
  const title = mode === 'create' ? t('daemonCreate') : t('daemonEdit')

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-black/58 px-4 py-2"
      onMouseDown={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-daemon-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100vh-1rem)] w-full max-w-[680px] flex-col overflow-hidden rounded-[22px] border border-white/55 bg-ds-card shadow-[0_30px_90px_rgba(20,47,95,0.28)] dark:border-white/10"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-ds-border-muted px-6 py-3">
          <h2 id="session-daemon-dialog-title" className="truncate text-[17px] font-semibold text-ds-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('close')}
            title={t('close')}
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-4">
            <Section icon={<MessageSquare className="h-4 w-4" strokeWidth={1.8} />} title={t('daemonSectionBasic')}>
              <label className="grid gap-2">
                <FieldLabel required>{t('daemonName')}</FieldLabel>
                <input
                  value={draft.title}
                  maxLength={50}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder={t('daemonNamePlaceholder')}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2">
                <FieldLabel required>{t('daemonBindThread')}</FieldLabel>
                <select
                  value={draft.threadId}
                  onChange={(event) => update({ threadId: event.target.value })}
                  className={selectClass}
                >
                  <option value="">{t('daemonBindThreadPlaceholder')}</option>
                  {threads.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.title.trim() || thread.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <FieldLabel>{t('scheduleWorkspace')}</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_138px]">
                  <input
                    value={draft.workspaceRoot}
                    onChange={(event) => update({ workspaceRoot: event.target.value })}
                    placeholder={t('scheduleWorkspacePlaceholder')}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={onPickWorkspace}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <FolderOpen className="h-4 w-4" strokeWidth={1.75} />
                    {draft.workspaceRoot.trim() ? t('changeWorkspace') : t('selectWorkspace')}
                  </button>
                </div>
              </label>
            </Section>

            <Section icon={<TerminalSquare className="h-4 w-4" strokeWidth={1.8} />} title={t('daemonSectionScript')}>
              <label className="grid gap-2">
                <FieldLabel required>{t('daemonScriptPath')}</FieldLabel>
                <input
                  value={draft.scriptPath}
                  onChange={(event) => update({ scriptPath: event.target.value })}
                  placeholder={t('daemonScriptPathPlaceholder')}
                  className={inputClass}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="grid gap-2">
                  <FieldLabel>{t('daemonInterpreter')}</FieldLabel>
                  <select
                    value={draft.interpreter}
                    onChange={(event) => update({ interpreter: event.target.value as SessionDaemonV1['interpreter'] })}
                    className={selectClass}
                  >
                    <option value="auto">{t('daemonInterpreter_auto')}</option>
                    <option value="python">{t('daemonInterpreter_python')}</option>
                    <option value="node">{t('daemonInterpreter_node')}</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <FieldLabel>{t('daemonHeartbeatInterval')}</FieldLabel>
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={draft.heartbeatIntervalSeconds}
                    onChange={(event) => update({ heartbeatIntervalSeconds: Number(event.target.value) })}
                    className={inputClass}
                  />
                </label>
              </div>
            </Section>

            <Section icon={<Settings2 className="h-4 w-4" strokeWidth={1.8} />} title={t('daemonSectionRecovery')}>
              <button
                type="button"
                onClick={() => update({ restartOnFailure: !draft.restartOnFailure })}
                className="flex h-10 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                aria-pressed={draft.restartOnFailure}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Power className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{t('daemonRestartOnFailure')}</span>
                </span>
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${draft.restartOnFailure ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${draft.restartOnFailure ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
              <p className="text-[12px] leading-5 text-ds-faint">{t('daemonRestartHint')}</p>
              <label className="grid gap-2">
                <FieldLabel>{t('daemonSilenceTimeout')}</FieldLabel>
                <input
                  type="number"
                  min={15}
                  max={86400}
                  value={draft.silenceTimeoutSeconds}
                  onChange={(event) => update({ silenceTimeoutSeconds: Number(event.target.value) })}
                  className={inputClass}
                />
              </label>
            </Section>

            <Section icon={<Send className="h-4 w-4" strokeWidth={1.8} />} title={t('daemonSectionPush')}>
              <button
                type="button"
                onClick={() => updatePush({ enabled: !draft.push.enabled })}
                className="flex h-10 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                aria-pressed={draft.push.enabled}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Send className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{t('daemonPushToggle')}</span>
                </span>
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${draft.push.enabled ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${draft.push.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
              {draft.push.enabled ? (
                weixinChannels.length === 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-warning-soft px-3 py-2 text-[12px] leading-5 text-amber-900 dark:text-amber-100">
                    <span>{t('daemonPushUnavailable')}</span>
                    {onConnectWeixin ? (
                      <button
                        type="button"
                        onClick={onConnectWeixin}
                        className="shrink-0 rounded-lg border border-amber-500/25 bg-ds-card px-3 py-1.5 font-semibold transition hover:bg-ds-hover"
                      >
                        {t('daemonConnectWeixin')}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <FieldLabel>{t('daemonPushChannel')}</FieldLabel>
                      <select
                        value={draft.push.channelId}
                        onChange={(event) => {
                          const channelId = event.target.value
                          const channel = weixinChannels.find((item) => item.id === channelId)
                          updatePush({
                            channelId,
                            conversationId: channel?.conversations[0]?.id ?? ''
                          })
                        }}
                        className={selectClass}
                      >
                        <option value="">{t('daemonPushChannelPlaceholder')}</option>
                        {weixinChannels.map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.label.trim() || channel.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <FieldLabel>{t('daemonPushConversation')}</FieldLabel>
                      <select
                        value={draft.push.conversationId}
                        onChange={(event) => updatePush({ conversationId: event.target.value })}
                        disabled={!selectedChannel || selectedChannel.conversations.length === 0}
                        className={selectClass}
                      >
                        {!selectedChannel ? (
                          <option value="">{t('daemonPushChannelFirst')}</option>
                        ) : selectedChannel.conversations.length === 0 ? (
                          <option value="">{t('daemonNoWeixinConversation')}</option>
                        ) : (
                          selectedChannel.conversations.map((conversation) => (
                            <option key={conversation.id} value={conversation.id}>
                              {conversation.senderName.trim() || conversation.chatId || conversation.id}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>
                )
              ) : null}
              <p className="text-[12px] leading-5 text-ds-faint">{t('daemonPushHint')}</p>
            </Section>
          </div>

          {error ? (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted bg-ds-card px-6 py-3">
          <p className="min-w-0 text-[12px] leading-5 text-ds-faint">
            {mode === 'edit' ? t('daemonSaveRestartHint') : t('daemonCreateHint')}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-xl border border-ds-border bg-ds-card px-4 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="h-8 rounded-xl bg-ds-userbubble px-5 text-[13px] font-semibold text-ds-userbubbleFg transition hover:opacity-90"
            >
              {mode === 'create' ? t('daemonSaveAndStart') : t('confirm')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
