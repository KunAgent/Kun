import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { ArrowUp, Check, Info, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitPushResult, GitWorkingState } from '@shared/git-commit'
import { commitPlan, firstPushCommand } from './change-source'
import { GitErrorCard, type GitErrorInfo } from './GitErrorCard'
import { gitCommitApi } from './use-git-working-state'

type ReadyState = Extract<GitWorkingState, { ok: true }>
type Phase = 'generating' | 'committing' | 'pushing' | null
type Notice = { kind: 'committed'; sha: string; subject: string } | { kind: 'pushed'; target: string; upstream: boolean }

const PUSH_HINT: Record<Extract<GitPushResult, { ok: false }>['reason'], string> = {
  rejected: 'changesPushRejectedHint',
  auth: 'changesPushAuthHint',
  detached: 'changesDetachedNote',
  no_remote: 'changesNoRemoteNote',
  error: 'changesPushErrorHint'
}

const PRIMARY = 'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-control px-3 text-[12px] font-semibold text-control-foreground hover:opacity-90 disabled:opacity-40'
const SECONDARY = 'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-ds-border bg-ds-card px-3 text-[12px] font-semibold text-ds-ink hover:bg-ds-hover disabled:opacity-40'

/**
 * Commit box under the Changes list. A blank message is written by the model
 * at commit time; with nothing staged the commit stages everything first.
 * Commit & push sets the upstream on a branch's first push.
 */
export function CommitBox({
  workspaceRoot,
  state,
  onChanged
}: {
  workspaceRoot: string
  state: ReadyState
  onChanged: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const plan = commitPlan(state)
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<Phase>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<(GitErrorInfo & { retryPush?: boolean }) | null>(null)
  const [generatedFrom, setGeneratedFrom] = useState<number | null>(null)
  const generation = useRef(0)
  const messageId = useId()

  useEffect(() => {
    generation.current += 1
    setMessage('')
    setPhase(null)
    setNotice(null)
    setError(null)
    setGeneratedFrom(null)
  }, [workspaceRoot])

  const api = gitCommitApi()
  const busy = phase !== null

  const generate = async (): Promise<string | null> => {
    if (!api) return null
    const id = ++generation.current
    setPhase('generating')
    setError(null)
    try {
      const result = await api.generateGitCommitMessage({ workspaceRoot, stageAll: plan.stageAll })
      if (id !== generation.current) return null
      if (!result.ok) {
        setError({
          title: t('changesGenerateFailedTitle'),
          hint: result.reason === 'nothing_to_describe' ? t('changesNothingToDescribe') : t('changesGenerateFailedHint'),
          output: result.message
        })
        return null
      }
      setMessage(result.message)
      setGeneratedFrom(plan.fileCount)
      return result.message
    } catch (failure) {
      if (id === generation.current) {
        setError({ title: t('changesGenerateFailedTitle'), hint: t('changesGenerateFailedHint'), output: String(failure) })
      }
      return null
    } finally {
      if (id === generation.current) setPhase(null)
    }
  }

  const push = async (): Promise<void> => {
    if (!api) return
    setPhase('pushing')
    setError(null)
    try {
      const result = await api.pushGitBranch({ workspaceRoot })
      if (result.ok) {
        setNotice({ kind: 'pushed', target: `${result.remote}/${result.branch}`, upstream: result.setUpstream })
      } else {
        setError({
          title: t('changesPushFailed'),
          hint: t(PUSH_HINT[result.reason]),
          output: result.output,
          command: result.command,
          retryPush: result.reason === 'rejected' || result.reason === 'auth' || result.reason === 'error'
        })
      }
    } catch (failure) {
      setError({ title: t('changesPushFailed'), hint: t('changesPushErrorHint'), output: String(failure), retryPush: true })
    } finally {
      setPhase(null)
      onChanged()
    }
  }

  const commit = async (andPush: boolean): Promise<void> => {
    if (!api || busy) return
    setNotice(null)
    setError(null)
    let text = message.trim()
    if (!text) {
      const generated = await generate()
      if (!generated) return
      text = generated
    }
    setPhase('committing')
    let committed = false
    try {
      const result = await api.commitGitChanges({ workspaceRoot, message: text, stageAll: plan.stageAll })
      if (!result.ok) {
        setError({ title: t('changesCommitFailed'), hint: result.message, output: result.output })
        return
      }
      committed = true
      setMessage('')
      setGeneratedFrom(null)
      setNotice({ kind: 'committed', sha: result.sha, subject: result.subject })
    } catch (failure) {
      setError({ title: t('changesCommitFailed'), hint: String(failure) })
    } finally {
      setPhase(null)
      onChanged()
    }
    if (committed && andPush) await push()
  }

  if (!plan.fileCount && !plan.pushOnly && !notice && !error) return null

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-ds-border-muted px-3 pb-3 pt-2.5" data-commit-box>
      {notice ? (
        <div role="status" className="flex min-w-0 items-center gap-2 rounded-[9px] bg-ds-success-soft px-2.5 py-2 text-[12px] text-ds-success">
          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {notice.kind === 'committed' ? (
            <>
              <span className="shrink-0 font-semibold">{t('changesCommitted')}</span>
              <span className="shrink-0 font-mono text-[11px]">{notice.sha}</span>
              <span className="min-w-0 flex-1 truncate text-ds-ink" title={notice.subject}>{notice.subject}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate font-semibold">
              {t(notice.upstream ? 'changesPushedUpstream' : 'changesPushed', { target: notice.target })}
            </span>
          )}
        </div>
      ) : null}
      {error ? (
        <GitErrorCard
          error={error}
          onRetry={error.retryPush ? () => void push() : undefined}
          retryLabel={t('changesRetryPush')}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {plan.fileCount > 0 ? (
        <>
          <div className="flex flex-col rounded-[10px] border border-ds-border bg-ds-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
            <label htmlFor={messageId} className="sr-only">{t('changesCommitMessage')}</label>
            <textarea
              id={messageId}
              value={message}
              rows={3}
              readOnly={phase === 'generating'}
              onChange={(event) => {
                setMessage(event.target.value)
                if (!event.target.value.trim()) setGeneratedFrom(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void commit(false)
                }
              }}
              placeholder={phase === 'generating' ? t('changesGenerating') : t('changesCommitPlaceholder')}
              className="max-h-[180px] min-h-[64px] resize-none rounded-t-[10px] border-0 bg-transparent px-2.5 pb-1.5 pt-2.5 text-[12px] leading-[18px] text-ds-ink outline-none [field-sizing:content] placeholder:text-ds-muted"
            />
            <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
              {phase === 'generating' ? (
                <>
                  <span className="inline-flex items-center gap-1.5 px-1.5 text-[11.5px] text-accent">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('changesGenerating')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      generation.current += 1
                      setPhase(null)
                    }}
                    className="h-6 rounded-[6px] px-2 text-[11.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                  >
                    {t('changesStop')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void generate()}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] text-accent hover:bg-ds-hover disabled:opacity-40"
                >
                  {message.trim() ? <RefreshCw className="h-[13px] w-[13px]" strokeWidth={1.8} /> : <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.8} />}
                  {message.trim() ? t('changesRegenerate') : t('changesGenerate')}
                </button>
              )}
              <span className="ml-auto min-w-0 truncate pr-1 text-[11px] text-ds-muted">
                {generatedFrom !== null && message.trim()
                  ? t('changesGeneratedFrom', { count: generatedFrom })
                  : t(plan.stageAll ? 'changesWillCommitAll' : 'changesWillCommitStaged', { count: plan.fileCount })}
              </span>
            </div>
          </div>
          {plan.blocker === 'conflicts' ? (
            <p className="m-0 text-[11.5px] leading-4 text-amber-800 dark:text-amber-200">{t('changesConflictsNote')}</p>
          ) : null}
          {plan.firstPush ? (
            <div className="flex items-start gap-2 rounded-[9px] bg-accent-soft px-2.5 py-2 text-[11.5px] leading-[17px] text-ds-ink">
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
              <span>{t('changesFirstPushNote', { command: firstPushCommand(state) })}</span>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !plan.canCommit} onClick={() => void commit(false)} className={SECONDARY}>
              {phase === 'committing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t(plan.stageAll ? 'changesCommitAll' : 'changesCommit')}
            </button>
            {plan.canPush ? (
              <button type="button" disabled={busy || !plan.canCommit} onClick={() => void commit(true)} className={PRIMARY}>
                {phase === 'pushing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />}
                {t(plan.stageAll ? 'changesCommitAllPush' : 'changesCommitPush')}
              </button>
            ) : null}
          </div>
          {plan.pushBlocker ? (
            <p className="m-0 text-[11px] leading-4 text-ds-muted">
              {t(plan.pushBlocker === 'detached' ? 'changesDetachedNote' : 'changesNoRemoteNote')}
            </p>
          ) : null}
        </>
      ) : plan.pushOnly > 0 ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11.5px] text-ds-muted">
            {plan.firstPush && state.unpushed === 0
              ? t('changesNotOnRemote', { remote: state.pushRemote ?? '' })
              : t('changesUnpushed', { count: plan.pushOnly })}
          </span>
          <button type="button" disabled={busy} onClick={() => void push()} className={`${PRIMARY} !flex-none px-3.5`}>
            {phase === 'pushing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />}
            {t('changesPush')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
